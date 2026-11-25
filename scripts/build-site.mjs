import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "_site");

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "data"), { recursive: true });

await cp(path.join(root, "index.html"), path.join(out, "index.html"));
await cp(path.join(root, "favicon.svg"), path.join(out, "favicon.svg"));
await cp(path.join(root, "css"), path.join(out, "css"), { recursive: true });
await cp(path.join(root, "js"), path.join(out, "js"), { recursive: true });
await cp(path.join(root, "data", "data.json"), path.join(out, "data", "data.json"));

const html = await readFile(path.join(out, "index.html"), "utf8");
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const url = match[1];
  if (url.startsWith("#") || url.startsWith("data:") || url.startsWith("mailto:")) continue;
  if (/^https?:\/\//.test(url)) continue;
  if (url.startsWith("/")) {
    throw new Error(`Root-absolute URL breaks the /nexus/ base path: ${url}`);
  }
  await access(path.join(out, url.split("#")[0].split("?")[0]));
}

const css = await readFile(path.join(out, "css", "styles.css"), "utf8");
for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
  const url = match[1].trim().replace(/^['"]|['"]$/g, "");
  if (url.startsWith("data:")) continue;
  if (url.startsWith("/")) {
    throw new Error(`Root-absolute CSS URL breaks the /nexus/ base path: ${url}`);
  }
  await access(path.join(out, "css", url));
}

const data = JSON.parse(await readFile(path.join(out, "data", "data.json"), "utf8"));
for (const key of ["dailyTodos", "todos", "learning", "source"]) {
  if (!(key in data)) throw new Error(`data.json is missing ${key}`);
}

console.log("Built _site");
