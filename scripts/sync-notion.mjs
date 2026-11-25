import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assembleLessons,
  findChildDatabases,
  findChildPageRefs,
  parseLearningDatabase,
  parseOngoingTodos,
  perthISODate,
  pickLearningResult,
} from "./parse-notion.mjs";

export const TODOS_PAGE_ID = "422bc823-fc97-813d-bfb2-cfb693d9102c";
export const LEARNING_PAGE_TITLE = "Daily Learning";

const NOTION_VERSION = "2022-06-28";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function dataFilePath() {
  return process.env.NEXUS_DATA_PATH || path.join(ROOT, "data", "data.json");
}

export function contentKey(data) {
  const copy = JSON.parse(JSON.stringify(data));
  delete copy.syncedAt;
  return JSON.stringify(copy);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notion(url, token, { method = "GET", body } = {}, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const wrapped = new Error(error.name === "AbortError" ? "Notion took too long to answer." : error.message);
    wrapped.status = 0;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429 && attempt < 2) {
    await response.arrayBuffer().catch(() => {});
    const waitSeconds = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.min(Number.isFinite(waitSeconds) ? waitSeconds : 1, 10) * 1000);
    return notion(url, token, { method, body }, attempt + 1);
  }

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const error = new Error(payload.message || `Notion error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchChildren(blockId, token) {
  const results = [];
  let cursor;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const data = await notion(url, token);
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function hydrate(blockId, token, depth = 0) {
  const blocks = await fetchChildren(blockId, token);
  if (depth >= 4) return blocks;
  for (const block of blocks) {
    if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
      block.children = await hydrate(block.id, token, depth + 1);
    }
  }
  return blocks;
}

function friendly(error) {
  if (error.status === 404 || /could not find/i.test(error.message || "")) {
    return "Notion could not find this page. Open it, choose Share, and invite the NEXUS integration.";
  }
  if (error.status === 403) {
    return "Notion refused access. Open the page, choose Share, and invite the NEXUS integration.";
  }
  return "This list could not be loaded from Notion. The next sync will try again.";
}

function emptyPayload() {
  return {
    version: 1,
    source: "notion",
    notionConnected: true,
    syncedAt: new Date().toISOString(),
    todos: { title: "To-Dos", todo: [], done: [], error: null },
    learning: { found: false, lessons: [], error: null },
  };
}

async function searchLearning(token) {
  const results = [];
  let cursor;
  do {
    const data = await notion("https://api.notion.com/v1/search", token, {
      method: "POST",
      body: {
        query: LEARNING_PAGE_TITLE,
        page_size: 20,
        start_cursor: cursor,
      },
    });
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && results.length < 40);
  return pickLearningResult(results);
}

async function queryDatabase(databaseId, token) {
  const results = [];
  let cursor;
  do {
    const data = await notion(`https://api.notion.com/v1/databases/${databaseId}/query`, token, {
      method: "POST",
      body: { page_size: 100, start_cursor: cursor },
    });
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function loadLessons(match, token) {
  if (match.object === "database") {
    const rows = await queryDatabase(match.id, token);
    return parseLearningDatabase(rows);
  }

  const blocks = await hydrate(match.id, token);
  const childRefs = findChildPageRefs(blocks).slice(0, 40);
  const childPages = [];
  for (const child of childRefs) {
    const childBlocks = await hydrate(child.id, token);
    childPages.push({
      title: child.title,
      date: child.created ? perthISODate(child.created) : null,
      blocks: childBlocks,
    });
  }

  let lessons = assembleLessons({ pageBlocks: blocks, childPages });
  if (lessons.length === 0) {
    const databases = findChildDatabases(blocks);
    if (databases[0]) {
      const rows = await queryDatabase(databases[0].id, token);
      lessons = parseLearningDatabase(rows);
    }
  }
  return lessons;
}

export async function writeIfChanged(file, data) {
  const nextKey = contentKey(data);
  let previous = "";
  try {
    previous = await readFile(file, "utf8");
  } catch {
    previous = "";
  }
  if (previous) {
    try {
      if (contentKey(JSON.parse(previous)) === nextKey) {
        console.log("Notion content is unchanged. Leaving data.json as it is.");
        return false;
      }
    } catch {
      // The existing file is unreadable. Replace it.
    }
  }
  const serialised = `${JSON.stringify(data, null, 2)}\n`;
  const temporary = `${file}.tmp`;
  await writeFile(temporary, serialised);
  await rename(temporary, file);
  console.log("Updated data.json.");
  return true;
}

export async function runSync() {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) {
    console.log("NOTION_TOKEN is not set. Skipping Notion sync. The site will keep showing example data.");
    return { skipped: true, changed: false };
  }

  const data = emptyPayload();
  const hardFailures = [];

  const guard = async (label, assign) => {
    try {
      await assign();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      console.error(`${label}: ${error.status || "network"} ${error.message}`);
      if (!error.status || error.status >= 500) hardFailures.push(error);
      return error;
    }
  };

  try {
    const todoResult = await guard("To-Dos", async () => {
      const blocks = await hydrate(TODOS_PAGE_ID, token);
      const split = parseOngoingTodos(blocks);
      data.todos.todo = split.todo;
      data.todos.done = split.done;
    });
    if (todoResult instanceof Error) data.todos.error = friendly(todoResult);

    const learningResult = await guard("Daily Learning", async () => {
      const match = await searchLearning(token);
      if (!match) {
        data.learning.found = false;
        data.learning.lessons = [];
        console.log(`No Notion page titled "${LEARNING_PAGE_TITLE}". The site will show an empty state.`);
        return;
      }
      data.learning.found = true;
      data.learning.lessons = await loadLessons(match, token);
    });
    if (learningResult instanceof Error) data.learning.error = friendly(learningResult);
  } catch (error) {
    console.error(error.status === 401
      ? "Notion rejected the token. Check that the NOTION_TOKEN secret is the internal integration secret."
      : error.message);
    return { skipped: false, changed: false, failed: true };
  }

  const sections = [data.todos.error, data.learning.error].filter(Boolean);
  if (sections.length === 2 && hardFailures.length === 2) {
    console.error("Notion could not be reached. data.json was not changed.");
    return { skipped: false, changed: false, failed: true };
  }

  console.log(
    `To-dos: ${data.todos.todo.length} open, ${data.todos.done.length} done. Lessons: ${data.learning.lessons.length}.`,
  );

  const changed = await writeIfChanged(dataFilePath(), data);
  return { skipped: false, changed, failed: false };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runSync()
    .then((result) => {
      if (result.failed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message || String(error));
      process.exitCode = 1;
    });
}
