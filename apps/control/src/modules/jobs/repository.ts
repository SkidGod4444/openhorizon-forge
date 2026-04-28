import type { CreateJobRequest } from "@openhorizon/contracts";
import { checkpoints, db, jobArtifacts, jobEvents, jobs } from "@openhorizon/db";
import { and, desc, eq } from "drizzle-orm";

export async function createJob(payload: CreateJobRequest) {
  const now = new Date();
  const jobId = `ohj_${crypto.randomUUID()}`;

  await db.insert(jobs).values({
    id: jobId,
    requestedBy: payload.requestedBy,
    status: "queued",
    script: payload.script,
    framework: payload.framework,
    baseModel: payload.baseModel,
    dataset: payload.dataset,
    gpus: payload.gpus,
    nodes: payload.nodes,
    precision: payload.precision,
    checkpointEvery: payload.checkpointEvery,
    maxSteps: payload.maxSteps,
    image: payload.image,
    env: payload.env,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId,
    type: "job.submitted",
    message: "Job accepted by control plane and queued for scheduling.",
    payload: {
      framework: payload.framework,
      gpus: payload.gpus,
      nodes: payload.nodes,
    },
    createdAt: now,
  });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function getJobById(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}

export async function assignSlurmJobId(jobId: string, slurmJobId: string) {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      slurmJobId,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId,
    type: "job.scheduler.submitted",
    message: "Job submitted to SLURM scheduler.",
    payload: { slurmJobId },
    createdAt: now,
  });
}

export async function markJobCancelled(jobId: string) {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: "cancelled",
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId,
    type: "job.cancelled",
    message: "Job cancellation requested.",
    createdAt: now,
  });
}

export async function syncJobStatus(
  jobId: string,
  status: "queued" | "running" | "completed" | "failed" | "cancelled",
  schedulerState: string,
) {
  const now = new Date();
  const [current] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!current) {
    return null;
  }

  const isTerminal = status === "completed" || status === "failed" || status === "cancelled";
  await db
    .update(jobs)
    .set({
      status,
      startedAt: current.startedAt ?? (status === "running" ? now : null),
      finishedAt: isTerminal ? now : current.finishedAt,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId,
    type: "job.scheduler.state_sync",
    message: `Scheduler reported state ${schedulerState}.`,
    payload: {
      schedulerState,
      status,
    },
    createdAt: now,
  });

  const [updated] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return updated ?? null;
}

export async function listRecentEvents(jobId: string, limit = 10) {
  return db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(desc(jobEvents.createdAt))
    .limit(limit);
}

type ListJobsInput = {
  requestedBy?: string;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  limit: number;
  offset: number;
};

export async function listJobs(input: ListJobsInput) {
  const predicates = [];
  if (input.requestedBy) {
    predicates.push(eq(jobs.requestedBy, input.requestedBy));
  }
  if (input.status) {
    predicates.push(eq(jobs.status, input.status));
  }

  const whereClause = predicates.length > 0 ? and(...predicates) : undefined;

  const rows = await db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(desc(jobs.createdAt))
    .limit(input.limit)
    .offset(input.offset);

  const totalRows = await db
    .select({ value: jobs.id })
    .from(jobs)
    .where(whereClause);

  return {
    items: rows,
    total: totalRows.length,
  };
}

export async function listCheckpointsForJob(jobId: string, limit = 50) {
  return db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.jobId, jobId))
    .orderBy(desc(checkpoints.createdAt))
    .limit(limit);
}

export async function findCheckpointForJob(jobId: string, checkpointRef: string) {
  const [byId] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.jobId, jobId), eq(checkpoints.id, checkpointRef)))
    .limit(1);
  if (byId) {
    return byId;
  }

  const stepMatch = checkpointRef.match(/^step-(\d+)$/);
  if (!stepMatch) {
    return null;
  }
  const step = Number(stepMatch[1]);
  if (!Number.isFinite(step)) {
    return null;
  }

  const [byStep] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.jobId, jobId), eq(checkpoints.step, step)))
    .limit(1);

  return byStep ?? null;
}

export async function createResumeJobFromCheckpoint(
  sourceJobId: string,
  checkpointId: string,
  requestedBy?: string,
) {
  const [sourceJob] = await db.select().from(jobs).where(eq(jobs.id, sourceJobId)).limit(1);
  if (!sourceJob) {
    return null;
  }

  const now = new Date();
  const resumedJobId = `ohj_${crypto.randomUUID()}`;
  await db.insert(jobs).values({
    id: resumedJobId,
    requestedBy: requestedBy ?? sourceJob.requestedBy,
    status: "queued",
    script: sourceJob.script,
    framework: sourceJob.framework,
    baseModel: sourceJob.baseModel,
    dataset: sourceJob.dataset,
    gpus: sourceJob.gpus,
    nodes: sourceJob.nodes,
    precision: sourceJob.precision,
    checkpointEvery: sourceJob.checkpointEvery,
    maxSteps: sourceJob.maxSteps ?? undefined,
    image: sourceJob.image ?? undefined,
    env: sourceJob.env,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId: resumedJobId,
    type: "job.resumed",
    message: `Job resumed from checkpoint ${checkpointId}.`,
    payload: { sourceJobId, checkpointId },
    createdAt: now,
  });

  const [created] = await db.select().from(jobs).where(eq(jobs.id, resumedJobId)).limit(1);
  return created ?? null;
}

export async function ensureFinalModelArtifact(jobId: string) {
  const existing = await db
    .select()
    .from(jobArtifacts)
    .where(and(eq(jobArtifacts.jobId, jobId), eq(jobArtifacts.kind, "final_model")))
    .limit(1);
  if (existing.length > 0) {
    return existing[0];
  }

  const latestCheckpoint = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.jobId, jobId))
    .orderBy(desc(checkpoints.step))
    .limit(1);
  const checkpoint = latestCheckpoint[0];
  if (!checkpoint) {
    return null;
  }
  const artifactId = `oha_${crypto.randomUUID()}`;
  await db.insert(jobArtifacts).values({
    id: artifactId,
    jobId,
    name: `final-weights-step-${checkpoint.step}`,
    kind: "final_model",
    format: "checkpoint",
    storagePath: checkpoint.storagePath,
    sizeBytes: Math.max(1, Math.round(checkpoint.sizeGb * 1024 * 1024 * 1024)),
    checksumSha256: null,
    createdAt: new Date(),
  });

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId,
    type: "artifact.finalized",
    message: `Final model artifact generated from checkpoint step ${checkpoint.step}.`,
    payload: { artifactId, checkpointId: checkpoint.id },
    createdAt: new Date(),
  });

  const [created] = await db.select().from(jobArtifacts).where(eq(jobArtifacts.id, artifactId)).limit(1);
  return created ?? null;
}

export async function listArtifactsForJob(jobId: string, limit = 50) {
  return db
    .select()
    .from(jobArtifacts)
    .where(eq(jobArtifacts.jobId, jobId))
    .orderBy(desc(jobArtifacts.createdAt))
    .limit(limit);
}

export async function getArtifactForJob(jobId: string, artifactId: string) {
  const [artifact] = await db
    .select()
    .from(jobArtifacts)
    .where(and(eq(jobArtifacts.jobId, jobId), eq(jobArtifacts.id, artifactId)))
    .limit(1);
  return artifact ?? null;
}

type CreateArtifactInput = {
  jobId: string;
  name: string;
  kind: string;
  format: string;
  storagePath: string;
  sizeBytes: number;
  checksumSha256?: string | null;
};

export async function createArtifactForJob(input: CreateArtifactInput) {
  const now = new Date();
  const artifactId = `oha_${crypto.randomUUID()}`;
  await db.insert(jobArtifacts).values({
    id: artifactId,
    jobId: input.jobId,
    name: input.name,
    kind: input.kind,
    format: input.format,
    storagePath: input.storagePath,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256 ?? null,
    createdAt: now,
  });

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId: input.jobId,
    type: "artifact.created",
    message: `Artifact ${input.name} registered (${input.kind}).`,
    payload: {
      artifactId,
      kind: input.kind,
      storagePath: input.storagePath,
      sizeBytes: input.sizeBytes,
    },
    createdAt: now,
  });

  const [artifact] = await db.select().from(jobArtifacts).where(eq(jobArtifacts.id, artifactId)).limit(1);
  return artifact ?? null;
}
