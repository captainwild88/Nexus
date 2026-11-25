import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { configSource } from "./write-worker-config.mjs";

test("worker config only accepts a workers.dev address", () => {
  assert.equal(
    configSource("https://nexus-goals.bright-pine.workers.dev/"),
    'export const workerUrl = "https://nexus-goals.bright-pine.workers.dev";\n',
  );
  assert.throws(() => configSource("http://nexus-goals.example.workers.dev"));
  assert.throws(() => configSource("https://captainwild88.github.io/Nexus/"));
  assert.throws(() => configSource(""));
});

test("writing the same address leaves the file alone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-config-"));
  const file = path.join(dir, "config.js");
  const source = configSource("https://nexus-goals.bright-pine.workers.dev");
  await writeFile(file, source);
  const result = spawnSync(process.execPath, ["scripts/write-worker-config.mjs", file, "https://nexus-goals.bright-pine.workers.dev"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already saved/);
  assert.equal(await readFile(file, "utf8"), source);
});
