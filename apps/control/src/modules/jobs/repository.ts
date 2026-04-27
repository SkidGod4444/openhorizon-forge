import type { CreateJobRequest } from "@openhorizon/contracts";
import { db, jobEvents, jobs } from "@openhorizon/db";
import { desc, eq } from "drizzle-orm";

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

export async function listRecentEvents(jobId: string, limit = 10) {
  return db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(desc(jobEvents.createdAt))
    .limit(limit);
}
