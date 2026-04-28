import { readFileSync } from "node:fs";

export function readEnvOrFile(name: string): string | undefined {
  const direct = process.env[name];
  if (direct && direct.trim() !== "") {
    return direct;
  }

  const fileVar = process.env[`${name}_FILE`];
  if (!fileVar) {
    return undefined;
  }

  try {
    return readFileSync(fileVar, "utf8").trim();
  } catch {
    return undefined;
  }
}
