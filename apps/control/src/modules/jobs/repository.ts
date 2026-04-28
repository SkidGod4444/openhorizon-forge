import type { CreateJobRequest } from "@openhorizon/contracts";
import { checkpoints, db, endpoints, jobEvents, jobs } from "@openhorizon/db";
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

type CreateEndpointInput = {
  jobId: string;
  checkpointId: string;
  backend: "vllm" | "triton";
  gpuAllocation: number;
};

export async function createEndpointDeployment(input: CreateEndpointInput) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
  if (!job) {
    return null;
  }
  const [checkpoint] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.jobId, input.jobId), eq(checkpoints.id, input.checkpointId)))
    .limit(1);
  if (!checkpoint) {
    return null;
  }

  const now = new Date();
  const endpointId = `ohe_${crypto.randomUUID()}`;
  const url = `https://api.openhorizon.local/v1/endpoints/${endpointId}`;

  await db.insert(endpoints).values({
    id: endpointId,
    jobId: input.jobId,
    checkpointId: checkpoint.id,
    backend: input.backend,
    model: job.baseModel,
    url,
    gpuAllocation: input.gpuAllocation,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(checkpoints)
    .set({
      status: "deployed",
    })
    .where(eq(checkpoints.id, checkpoint.id));

  await db.insert(jobEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    jobId: input.jobId,
    type: "endpoint.deployed",
    message: `Deployed checkpoint ${checkpoint.id} to endpoint ${endpointId}.`,
    payload: {
      endpointId,
      backend: input.backend,
      gpuAllocation: input.gpuAllocation,
    },
    createdAt: now,
  });

  const [endpoint] = await db
    .select()
    .from(endpoints)
    .where(eq(endpoints.id, endpointId))
    .limit(1);
  return endpoint ?? null;
}

type ListEndpointsInput = {
  status?: "provisioning" | "ready" | "failed" | "terminated";
  limit: number;
  offset: number;
};

export async function listEndpoints(input: ListEndpointsInput) {
  const whereClause = input.status ? eq(endpoints.status, input.status) : undefined;
  const rows = await db
    .select()
    .from(endpoints)
    .where(whereClause)
    .orderBy(desc(endpoints.createdAt))
    .limit(input.limit)
    .offset(input.offset);

  const totalRows = await db.select({ value: endpoints.id }).from(endpoints).where(whereClause);

  return {
    items: rows,
    total: totalRows.length,
  };
}
