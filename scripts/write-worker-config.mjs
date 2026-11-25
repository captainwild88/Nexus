import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function configSource(url) {
  const clean = String(url || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/i.test(clean)) {
    throw new Error("The Worker address must look like https://nexus-goals.example.workers.dev");
  }
  return `export const workerUrl = ${JSON.stringify(clean)};\n`;
}

async function main() {
  const file = process.argv[2];
  const url = process.argv[3];
  if (!file || !url) {
    console.error("Usage: node scripts/write-worker-config.mjs js/config.js https://nexus-goals.example.workers.dev");
    process.exitCode = 1;
    return;
  }
  const next = configSource(url);
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = "";
  }
  if (current === next) {
    console.log("Worker address is already saved.");
    return;
  }
  await writeFile(file, next);
  console.log("Saved the Worker address.");
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
