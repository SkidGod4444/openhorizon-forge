import { z } from "zod";

export const trainingFrameworkSchema = z.enum([
  "axolotl",
  "trl",
  "deepspeed",
  "megatron",
  "custom",
]);

export const precisionSchema = z.enum(["fp8", "bf16", "fp16", "fp32"]);

export const createJobRequestSchema = z.object({
  script: z.string().min(1),
  framework: trainingFrameworkSchema,
  baseModel: z.string().min(1),
  dataset: z.string().min(1),
  gpus: z.int().min(1).max(8),
  nodes: z.int().min(1).max(8).default(1),
  precision: precisionSchema.default("bf16"),
  checkpointEvery: z.int().min(1).default(500),
  maxSteps: z.int().min(1).optional(),
  image: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  requestedBy: z.string().min(1),
});

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const createJobResponseSchema = z.object({
  jobId: z.string().min(1),
  status: jobStatusSchema,
  submittedAt: z.iso.datetime(),
  requestedBy: z.string().min(1),
});

export const jobStatusResponseSchema = z.object({
  jobId: z.string().min(1),
  status: jobStatusSchema,
  step: z.int().min(0).optional(),
  maxSteps: z.int().min(1).optional(),
  gpusAllocated: z.int().min(1).max(8),
  nodesAllocated: z.int().min(1).max(8),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime(),
});

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type CreateJobResponse = z.infer<typeof createJobResponseSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
