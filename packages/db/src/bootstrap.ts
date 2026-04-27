import { sql } from "./client.js";

export async function bootstrapDatabase(): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkpoint_status') THEN
        CREATE TYPE checkpoint_status AS ENUM ('pending', 'synced', 'deployed', 'evicted');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'endpoint_status') THEN
        CREATE TYPE endpoint_status AS ENUM ('provisioning', 'ready', 'failed', 'terminated');
      END IF;
    END
    $$;
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      requested_by TEXT NOT NULL,
      status job_status NOT NULL DEFAULT 'queued',
      script TEXT NOT NULL,
      framework TEXT NOT NULL,
      base_model TEXT NOT NULL,
      dataset TEXT NOT NULL,
      gpus INTEGER NOT NULL,
      nodes INTEGER NOT NULL DEFAULT 1,
      precision TEXT NOT NULL DEFAULT 'bf16',
      checkpoint_every INTEGER NOT NULL DEFAULT 500,
      max_steps INTEGER,
      image TEXT,
      env JSONB NOT NULL DEFAULT '{}'::jsonb,
      slurm_job_id TEXT,
      current_step INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      epoch REAL,
      val_loss REAL,
      storage_path TEXT NOT NULL,
      size_gb REAL NOT NULL,
      status checkpoint_status NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      checkpoint_id TEXT,
      backend TEXT NOT NULL,
      model TEXT NOT NULL,
      url TEXT NOT NULL,
      gpu_allocation INTEGER NOT NULL,
      status endpoint_status NOT NULL DEFAULT 'provisioning',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}
