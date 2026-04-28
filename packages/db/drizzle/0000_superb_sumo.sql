CREATE TYPE "public"."checkpoint_status" AS ENUM('pending', 'synced', 'deployed', 'evicted');--> statement-breakpoint
CREATE TYPE "public"."endpoint_status" AS ENUM('provisioning', 'ready', 'failed', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step" integer NOT NULL,
	"epoch" real,
	"val_loss" real,
	"storage_path" text NOT NULL,
	"size_gb" real NOT NULL,
	"status" "checkpoint_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"checkpoint_id" text,
	"backend" text NOT NULL,
	"model" text NOT NULL,
	"url" text NOT NULL,
	"gpu_allocation" integer NOT NULL,
	"status" "endpoint_status" DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"script" text NOT NULL,
	"framework" text NOT NULL,
	"base_model" text NOT NULL,
	"dataset" text NOT NULL,
	"gpus" integer NOT NULL,
	"nodes" integer DEFAULT 1 NOT NULL,
	"precision" text DEFAULT 'bf16' NOT NULL,
	"checkpoint_every" integer DEFAULT 500 NOT NULL,
	"max_steps" integer,
	"image" text,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slurm_job_id" text,
	"current_step" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;