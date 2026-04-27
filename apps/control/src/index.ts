import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createJobRequestSchema,
  createJobResponseSchema,
  jobStatusResponseSchema,
} from "@openhorizon/contracts";
import { bootstrapDatabase } from "@openhorizon/db";
import { createJob, getJobById } from "./modules/jobs/repository.js";

await bootstrapDatabase();

const app = new Hono();

app.get("/healthz", (c) => {
  return c.json({
    ok: true,
    service: "openhorizon-control",
    timestamp: new Date().toISOString(),
  });
});

app.post("/v1/jobs", zValidator("json", createJobRequestSchema), async (c) => {
  const payload = c.req.valid("json");
  const job = await createJob(payload);
  if (!job) {
    return c.json({ error: "Failed to create job." }, 500);
  }
  const response = createJobResponseSchema.parse({
    jobId: job.id,
    status: job.status,
    submittedAt: job.createdAt.toISOString(),
    requestedBy: job.requestedBy,
  });

  return c.json(response, 202);
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

export default {
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8080),
};
