import { bootstrapDatabase } from "./bootstrap.js";
import { sql } from "./client.js";

try {
  await bootstrapDatabase();
  console.log("Database bootstrap completed.");
} finally {
  await sql.end({ timeout: 5 });
}
