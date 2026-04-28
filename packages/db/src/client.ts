import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readEnvOrFile } from "./env.js";
import * as schema from "./schema.js";

const databaseUrl =
  readEnvOrFile("DATABASE_URL") ?? "postgres://postgres:postgres@localhost:5432/openhorizon";

export const sql = postgres(databaseUrl, {
  // Required for Supabase transaction pooler mode.
  prepare: false,
  max: Number(process.env.DATABASE_MAX_CONNECTIONS ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });
