import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const checkpointStatusEnum = pgEnum("checkpoint_status", [
  "pending",
  "synced",
  "deployed",
  "evicted",
]);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  requestedBy: text("requested_by").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  script: text("script").notNull(),
  framework: text("framework").notNull(),
  baseModel: text("base_model").notNull(),
  dataset: text("dataset").notNull(),
  gpus: integer("gpus").notNull(),
  nodes: integer("nodes").notNull().default(1),
  precision: text("precision").notNull().default("bf16"),
  checkpointEvery: integer("checkpoint_every").notNull().default(500),
  maxSteps: integer("max_steps"),
  image: text("image"),
  env: jsonb("env")
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  slurmJobId: text("slurm_job_id"),
  currentStep: integer("current_step").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobEvents = pgTable("job_events", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checkpoints = pgTable("checkpoints", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  epoch: real("epoch"),
  valLoss: real("val_loss"),
  storagePath: text("storage_path").notNull(),
  sizeGb: real("size_gb").notNull(),
  status: checkpointStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobArtifacts = pgTable("job_artifacts", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  format: text("format").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksumSha256: text("checksum_sha256"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
