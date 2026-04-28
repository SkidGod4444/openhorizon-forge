import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createJobRequestSchema,
  createJobResponseSchema,
  jobStatusResponseSchema,
} from "@openhorizon/contracts";
import { bootstrapDatabase } from "@openhorizon/db";
import {
  assignSlurmJobId,
  createArtifactForJob,
  createResumeJobFromCheckpoint,
  createJob,
  ensureFinalModelArtifact,
  findCheckpointForJob,
  getArtifactForJob,
  getJobById,
  listArtifactsForJob,
  listCheckpointsForJob,
  listJobs,
  listRecentEvents,
  listSchedulerSyncCandidates,
  markJobCancelled,
  syncJobStatus,
} from "./modules/jobs/repository.js";
import { cancelJob, getJobStatus, readJobLogs, submitJob } from "./modules/slurm/adapter.js";

await bootstrapDatabase();

const app = new Hono();
const controlAPIKey = process.env.CONTROL_API_KEY;
const reconcilerEnabled = process.env.STATUS_RECONCILER_ENABLED !== "false";
const reconcilerIntervalMs = Math.max(
  2000,
  Number.parseInt(process.env.STATUS_RECONCILER_INTERVAL_MS ?? "10000", 10) || 10000,
);
const reconcilerBatchSize = Math.max(
  1,
  Number.parseInt(process.env.STATUS_RECONCILER_BATCH_SIZE ?? "50", 10) || 50,
);

app.use("*", async (c, next) => {
  if (!controlAPIKey || c.req.path === "/healthz") {
    await next();
    return;
  }

  const authHeader = c.req.header("authorization");
  const expected = `Bearer ${controlAPIKey}`;
  if (!authHeader || authHeader !== expected) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  await next();
});

app.get("/healthz", (c) => {
  return c.json({
    ok: true,
    service: "openhorizon-control",
    timestamp: new Date().toISOString(),
  });
});

if (reconcilerEnabled) {
  setInterval(async () => {
    try {
      const jobs = await listSchedulerSyncCandidates(reconcilerBatchSize);
      for (const job of jobs) {
        if (!job.slurmJobId) {
          continue;
        }
        const schedulerStatus = await getJobStatus(job.slurmJobId);
        const updated = await syncJobStatus(job.id, schedulerStatus.status, schedulerStatus.slurmState);
        if (updated?.status === "completed") {
          await ensureFinalModelArtifact(updated.id);
        }
      }
    } catch (error) {
      console.error("status_reconciler_error", error);
    }
  }, reconcilerIntervalMs);
}

app.get("/v1/jobs", async (c) => {
  const requestedBy = c.req.query("requestedBy");
  const status = c.req.query("status");
  const limitValue = Number(c.req.query("limit") ?? "20");
  const offsetValue = Number(c.req.query("offset") ?? "0");
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
    : 20;
  const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.trunc(offsetValue)) : 0;

  const statusFilter =
    status && ["queued", "running", "completed", "failed", "cancelled"].includes(status)
      ? (status as "queued" | "running" | "completed" | "failed" | "cancelled")
      : undefined;

  const result = await listJobs({
    requestedBy,
    status: statusFilter,
    limit,
    offset,
  });

  return c.json({
    items: result.items.map((job) => ({
      jobId: job.id,
      requestedBy: job.requestedBy,
      status: job.status,
      slurmJobId: job.slurmJobId,
      gpus: job.gpus,
      nodes: job.nodes,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    })),
    total: result.total,
    limit,
    offset,
  });
});

app.post("/v1/jobs", zValidator("json", createJobRequestSchema), async (c) => {
  const payload = c.req.valid("json");
  const job = await createJob(payload);
  if (!job) {
    return c.json({ error: "Failed to create job." }, 500);
  }

  try {
    const schedulerResult = await submitJob({
      jobId: job.id,
      scriptPath: payload.script,
      gpus: payload.gpus,
      nodes: payload.nodes,
      env: payload.env,
    });
    await assignSlurmJobId(job.id, schedulerResult.slurmJobId);
  } catch (error) {
    return c.json(
      {
        error: "Job created but scheduler submission failed.",
        jobId: job.id,
        detail: error instanceof Error ? error.message : "Unknown scheduler error.",
      },
      502,
    );
  }

  const response = createJobResponseSchema.parse({
    jobId: job.id,
    status: job.status,
    submittedAt: job.createdAt.toISOString(),
    requestedBy: job.requestedBy,
  });

  return c.json(response, 202);
});

app.post("/v1/jobs/:jobId/cancel", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    return c.json({ error: `Job ${jobId} is already in terminal state ${job.status}.` }, 409);
  }

  if (job.slurmJobId) {
    await cancelJob(job.slurmJobId);
  }
  await markJobCancelled(jobId);

  return c.json({
    jobId,
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
});

app.post("/v1/jobs/:jobId/sync", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }
  if (!job.slurmJobId) {
    return c.json({ error: `Job ${jobId} has no slurmJobId yet.` }, 409);
  }

  const schedulerStatus = await getJobStatus(job.slurmJobId);
  const updated = await syncJobStatus(jobId, schedulerStatus.status, schedulerStatus.slurmState);
  if (!updated) {
    return c.json({ error: `Job ${jobId} not found after sync.` }, 404);
  }
  if (updated.status === "completed") {
    await ensureFinalModelArtifact(jobId);
  }

  return c.json({
    jobId: updated.id,
    slurmJobId: updated.slurmJobId,
    schedulerState: schedulerStatus.slurmState,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
  });
});

app.get("/v1/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  const response = jobStatusResponseSchema.parse({
    jobId: job.id,
    status: job.status,
    step: job.currentStep,
    maxSteps: job.maxSteps ?? undefined,
    gpusAllocated: job.gpus,
    nodesAllocated: job.nodes,
    startedAt: job.startedAt?.toISOString(),
    finishedAt: job.finishedAt?.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });

  return c.json(response);
});

app.get("/v1/jobs/:jobId/events", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  const limitValue = Number(c.req.query("limit") ?? "20");
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
    : 20;
  const events = await listRecentEvents(jobId, limit);

  return c.json({
    jobId,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
  });
});

app.get("/v1/jobs/:jobId/checkpoints", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  const limitValue = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(200, Math.trunc(limitValue)))
    : 50;
  const items = await listCheckpointsForJob(jobId, limit);

  return c.json({
    jobId,
    checkpoints: items.map((checkpoint) => ({
      id: checkpoint.id,
      step: checkpoint.step,
      epoch: checkpoint.epoch,
      valLoss: checkpoint.valLoss,
      storagePath: checkpoint.storagePath,
      sizeGb: checkpoint.sizeGb,
      status: checkpoint.status,
      createdAt: checkpoint.createdAt.toISOString(),
    })),
  });
});

app.post("/v1/jobs/:jobId/resume", async (c) => {
  const jobId = c.req.param("jobId");
  const sourceJob = await getJobById(jobId);
  if (!sourceJob) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  let payload: { checkpoint?: string; requestedBy?: string } = {};
  try {
    payload = (await c.req.json()) as { checkpoint?: string; requestedBy?: string };
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  if (!payload.checkpoint) {
    return c.json({ error: "`checkpoint` is required. Use checkpoint id or step-<N>." }, 400);
  }

  const checkpoint = await findCheckpointForJob(jobId, payload.checkpoint);
  if (!checkpoint) {
    return c.json({ error: `Checkpoint ${payload.checkpoint} not found for job ${jobId}.` }, 404);
  }

  const resumedJob = await createResumeJobFromCheckpoint(
    jobId,
    checkpoint.id,
    payload.requestedBy ?? sourceJob.requestedBy,
  );
  if (!resumedJob) {
    return c.json({ error: "Failed to create resumed job." }, 500);
  }

  try {
    const schedulerResult = await submitJob({
      jobId: resumedJob.id,
      scriptPath: resumedJob.script,
      gpus: resumedJob.gpus,
      nodes: resumedJob.nodes,
      env: resumedJob.env,
      resumeFromCheckpointPath: checkpoint.storagePath,
    });
    await assignSlurmJobId(resumedJob.id, schedulerResult.slurmJobId);
  } catch (error) {
    return c.json(
      {
        error: "Resumed job created but scheduler submission failed.",
        jobId: resumedJob.id,
        detail: error instanceof Error ? error.message : "Unknown scheduler error.",
      },
      502,
    );
  }

  const response = createJobResponseSchema.parse({
    jobId: resumedJob.id,
    status: resumedJob.status,
    submittedAt: resumedJob.createdAt.toISOString(),
    requestedBy: resumedJob.requestedBy,
  });

  return c.json({
    ...response,
    resumedFrom: {
      jobId,
      checkpointId: checkpoint.id,
      step: checkpoint.step,
    },
  }, 202);
});

app.get("/v1/jobs/:jobId/artifacts", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  const limitValue = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(limitValue)
    ? Math.max(1, Math.min(200, Math.trunc(limitValue)))
    : 50;
  const artifacts = await listArtifactsForJob(jobId, limit);
  return c.json({
    jobId,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      format: artifact.format,
      storagePath: artifact.storagePath,
      sizeBytes: artifact.sizeBytes,
      checksumSha256: artifact.checksumSha256,
      createdAt: artifact.createdAt.toISOString(),
    })),
  });
});

app.get("/v1/jobs/:jobId/artifacts/:artifactId/download", async (c) => {
  const jobId = c.req.param("jobId");
  const artifactId = c.req.param("artifactId");
  const artifact = await getArtifactForJob(jobId, artifactId);
  if (!artifact) {
    return c.json({ error: `Artifact ${artifactId} not found for job ${jobId}.` }, 404);
  }

  // V1: return storage location metadata; signed URL support can be added later.
  return c.json({
    artifactId: artifact.id,
    jobId: artifact.jobId,
    name: artifact.name,
    kind: artifact.kind,
    format: artifact.format,
    storagePath: artifact.storagePath,
    sizeBytes: artifact.sizeBytes,
    checksumSha256: artifact.checksumSha256,
  });
});

app.post("/v1/jobs/:jobId/artifacts/finalize", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }

  let payload: {
    name?: string;
    kind?: string;
    format?: string;
    storagePath?: string;
    sizeBytes?: number;
    checksumSha256?: string;
  } = {};
  try {
    payload = (await c.req.json()) as typeof payload;
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  if (!payload.name || !payload.kind || !payload.format || !payload.storagePath) {
    return c.json(
      { error: "`name`, `kind`, `format`, and `storagePath` are required." },
      400,
    );
  }
  if (!payload.sizeBytes || !Number.isFinite(payload.sizeBytes) || payload.sizeBytes <= 0) {
    return c.json({ error: "`sizeBytes` must be a positive number." }, 400);
  }

  const artifact = await createArtifactForJob({
    jobId,
    name: payload.name,
    kind: payload.kind,
    format: payload.format,
    storagePath: payload.storagePath,
    sizeBytes: Math.trunc(payload.sizeBytes),
    checksumSha256: payload.checksumSha256 ?? null,
  });
  if (!artifact) {
    return c.json({ error: "Failed to finalize artifact." }, 500);
  }

  return c.json(
    {
      jobId,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        kind: artifact.kind,
        format: artifact.format,
        storagePath: artifact.storagePath,
        sizeBytes: artifact.sizeBytes,
        checksumSha256: artifact.checksumSha256,
        createdAt: artifact.createdAt.toISOString(),
      },
    },
    201,
  );
});

app.get("/v1/jobs/:jobId/logs", async (c) => {
  const jobId = c.req.param("jobId");
  const job = await getJobById(jobId);
  if (!job) {
    return c.json({ error: `Job ${jobId} not found.` }, 404);
  }
  if (!job.slurmJobId) {
    return c.json({ error: `Job ${jobId} has no slurmJobId yet.` }, 409);
  }

  const tailValue = Number(c.req.query("tail") ?? "200");
  const tail = Number.isFinite(tailValue) ? Math.max(1, Math.min(5000, Math.trunc(tailValue))) : 200;
  const since = c.req.query("since");
  const lines = await readJobLogs({
    slurmJobId: job.slurmJobId,
    tail,
    since,
  });

  return c.json({
    jobId,
    slurmJobId: job.slurmJobId,
    tail,
    since: since ?? null,
    lines,
  });
});

export default {
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8080),
};
