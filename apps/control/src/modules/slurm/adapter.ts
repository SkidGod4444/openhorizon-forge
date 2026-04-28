import { $ } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type SubmitJobInput = {
  jobId: string;
  scriptPath: string;
  gpus: number;
  nodes: number;
  env?: Record<string, string>;
  resumeFromCheckpointPath?: string;
};

type SubmitJobOutput = {
  slurmJobId: string;
};

type SchedulerJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

type SchedulerStatusOutput = {
  slurmState: string;
  status: SchedulerJobState;
};

type ReadLogsInput = {
  slurmJobId: string;
  tail?: number;
  since?: string;
};

function isMockModeEnabled() {
  return process.env.SLURM_MOCK_MODE !== "false";
}

function schedulerBackend() {
  return (process.env.SCHEDULER_BACKEND ?? "slurm").toLowerCase();
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function buildSbatchScript(input: SubmitJobInput) {
  const baseDir = process.env.SLURM_SCRIPTS_DIR ?? "/tmp/openhorizon/slurm";
  const logsDir = process.env.SLURM_LOGS_DIR ?? "/tmp/openhorizon/logs";
  await mkdir(baseDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const scriptFile = path.join(baseDir, `${input.jobId}.sbatch`);
  const outputPath = path.join(logsDir, `${input.jobId}-%j.out`);
  const errorPath = path.join(logsDir, `${input.jobId}-%j.err`);

  const lines: string[] = [
    "#!/usr/bin/env bash",
    `#SBATCH --job-name=ohf-${input.jobId}`,
    `#SBATCH --nodes=${input.nodes}`,
    `#SBATCH --gpus-per-node=${input.gpus}`,
    `#SBATCH --output=${outputPath}`,
    `#SBATCH --error=${errorPath}`,
    "",
    "set -euo pipefail",
    "",
    `export OH_SCRIPT_PATH=${shellSingleQuote(input.scriptPath)}`,
  ];

  for (const [key, value] of Object.entries(input.env ?? {})) {
    lines.push(`export ${key}=${shellSingleQuote(String(value))}`);
  }
  if (input.resumeFromCheckpointPath) {
    lines.push(
      `export OH_RESUME_CHECKPOINT_PATH=${shellSingleQuote(input.resumeFromCheckpointPath)}`,
    );
  }

  lines.push(
    "",
    "if [[ \"$OH_SCRIPT_PATH\" == *.sh ]]; then",
    "  bash \"$OH_SCRIPT_PATH\"",
    "else",
    "  python \"$OH_SCRIPT_PATH\"",
    "fi",
    "",
  );

  await writeFile(scriptFile, lines.join("\n"), { mode: 0o755 });
  return scriptFile;
}

export async function submitJob(input: SubmitJobInput): Promise<SubmitJobOutput> {
  if (isMockModeEnabled()) {
    return {
      slurmJobId: `mock-${Date.now()}`,
    };
  }

  if (schedulerBackend() === "k8s") {
    return submitK8sJob(input);
  }

  const sbatchScript = await buildSbatchScript(input);
  const result = await $`sbatch --parsable ${sbatchScript}`.text();
  const slurmJobId = result.trim().split(";")[0];
  if (!slurmJobId) {
    throw new Error("Failed to parse SLURM job id from sbatch output.");
  }

  return { slurmJobId };
}

export async function cancelJob(slurmJobId: string): Promise<void> {
  if (isMockModeEnabled()) {
    return;
  }

  if (schedulerBackend() === "k8s") {
    await $`kubectl delete job ${slurmJobId} --ignore-not-found=true`.quiet();
    return;
  }

  await $`scancel ${slurmJobId}`.quiet();
}

function mapSlurmStateToPlatformStatus(state: string): SchedulerJobState {
  const value = state.trim().toUpperCase();
  if (["PENDING", "CONFIGURING", "SUSPENDED"].includes(value)) {
    return "queued";
  }
  if (["RUNNING", "COMPLETING", "STAGE_OUT"].includes(value)) {
    return "running";
  }
  if (["COMPLETED"].includes(value)) {
    return "completed";
  }
  if (["CANCELLED", "PREEMPTED", "STOPPED", "TIMEOUT"].includes(value)) {
    return "cancelled";
  }
  return "failed";
}

export async function getJobStatus(slurmJobId: string): Promise<SchedulerStatusOutput> {
  if (isMockModeEnabled()) {
    return {
      slurmState: "RUNNING",
      status: "running",
    };
  }

  if (schedulerBackend() === "k8s") {
    return getK8sJobStatus(slurmJobId);
  }

  const raw = await $`squeue -h -j ${slurmJobId} -o %T`.text();
  const state = raw.trim();
  if (state) {
    return {
      slurmState: state,
      status: mapSlurmStateToPlatformStatus(state),
    };
  }

  const acctRaw = await $`sacct -n -j ${slurmJobId} --format=State -P`.text();
  const acctState = acctRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0];

  if (!acctState) {
    return {
      slurmState: "UNKNOWN",
      status: "failed",
    };
  }

  return {
    slurmState: acctState,
    status: mapSlurmStateToPlatformStatus(acctState),
  };
}

export async function readJobLogs(input: ReadLogsInput): Promise<string[]> {
  if (isMockModeEnabled()) {
    const now = new Date().toISOString();
    return [
      `${now} INFO trainer: starting step loop`,
      `${now} INFO trainer: current_step=1280 val_loss=1.92`,
      `${now} INFO trainer: checkpoint saved step=1000`,
    ];
  }

  if (schedulerBackend() === "k8s") {
    const podName = (
      await $`kubectl get pods -l job-name=${input.slurmJobId} -o jsonpath={.items[0].metadata.name}`.text()
    ).trim();
    if (!podName) {
      return [];
    }
    const raw = await $`kubectl logs ${podName}`.text();
    const rows = raw.split("\n").filter(Boolean);
    if (!input.since) {
      return rows;
    }
    return rows.filter((line) => line >= input.since!);
  }

  const tail = input.tail ?? 200;
  const lines = Number.isFinite(tail) ? Math.max(1, Math.min(5000, Math.trunc(tail))) : 200;
  const output = await $`scontrol show job ${input.slurmJobId}`.text();
  const stdoutMatch = output.match(/StdOut=(\S+)/);
  const logPath = stdoutMatch?.[1];
  if (!logPath) {
    return [];
  }

  const raw = await $`tail -n ${lines} ${logPath}`.text();
  const rows = raw.split("\n").filter(Boolean);
  if (!input.since) {
    return rows;
  }

  // Lightweight best-effort filter: keep lines lexicographically >= since.
  return rows.filter((line) => line >= input.since!);
}

async function submitK8sJob(input: SubmitJobInput): Promise<SubmitJobOutput> {
  const namespace = process.env.K8S_NAMESPACE ?? "default";
  const image = process.env.K8S_TRAIN_IMAGE ?? "python:3.11";
  const k8sJobName = `ohf-${input.jobId.toLowerCase().replace(/[^a-z0-9-]/g, "")}`.slice(0, 58);
  const command = input.scriptPath.endsWith(".sh")
    ? `bash ${shellSingleQuote(input.scriptPath)}`
    : `python ${shellSingleQuote(input.scriptPath)}`;

  const envYaml = Object.entries(input.env ?? {})
    .map(([key, value]) => `        - name: ${key}\n          value: ${JSON.stringify(String(value))}`)
    .join("\n");
  const resumeEnv = input.resumeFromCheckpointPath
    ? `\n        - name: OH_RESUME_CHECKPOINT_PATH\n          value: ${JSON.stringify(input.resumeFromCheckpointPath)}`
    : "";

  const yaml = `apiVersion: batch/v1
kind: Job
metadata:
  name: ${k8sJobName}
  namespace: ${namespace}
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: trainer
        image: ${image}
        command: ["/bin/bash", "-lc", ${JSON.stringify(command)}]
        env:
        - name: OH_SCRIPT_PATH
          value: ${JSON.stringify(input.scriptPath)}${resumeEnv}${envYaml ? "\n" + envYaml : ""}
`;

  const manifestFile = path.join(
    process.env.SLURM_SCRIPTS_DIR ?? "/tmp/openhorizon/slurm",
    `${input.jobId}.k8s-job.yaml`,
  );
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, yaml, { mode: 0o644 });
  await $`kubectl apply -f ${manifestFile}`.quiet();

  return { slurmJobId: k8sJobName };
}

async function getK8sJobStatus(jobName: string): Promise<SchedulerStatusOutput> {
  const readField = async (field: string) =>
    (
      await $`bash -lc ${`kubectl get job ${jobName} -o jsonpath='{${field}}' 2>/dev/null || true`}`.text()
    ).trim();
  const succeeded = await readField(".status.succeeded");
  const failed = await readField(".status.failed");
  const active = await readField(".status.active");

  if (succeeded && succeeded !== "0") {
    return { slurmState: "COMPLETED", status: "completed" };
  }
  if (failed && failed !== "0") {
    return { slurmState: "FAILED", status: "failed" };
  }
  if (active && active !== "0") {
    return { slurmState: "RUNNING", status: "running" };
  }
  return { slurmState: "PENDING", status: "queued" };
}
