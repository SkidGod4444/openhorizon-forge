import { $ } from "bun";

type SubmitJobInput = {
  jobId: string;
  scriptPath: string;
  gpus: number;
  nodes: number;
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

export async function submitJob(input: SubmitJobInput): Promise<SubmitJobOutput> {
  if (isMockModeEnabled()) {
    return {
      slurmJobId: `mock-${Date.now()}`,
    };
  }

  const result =
    await $`sbatch --parsable --gpus-per-node=${input.gpus} --nodes=${input.nodes} --job-name ohf-${input.jobId} ${input.scriptPath}`.text();
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
