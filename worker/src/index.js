const PASSCODE_HEADER = "x-nexus-passcode";

export function perthDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Australia/Perth",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function allowedOrigin(env) {
  return env.ALLOWED_ORIGIN || "https://captainwild88.github.io";
}

function corsHeaders(request, env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Nexus-Passcode",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (request.headers.get("Origin") === allowedOrigin(env)) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin(env);
  }
  return headers;
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

function passcodeOk(request, env) {
  const given = request.headers.get(PASSCODE_HEADER) || "";
  const expected = env.NEXUS_PASSCODE || "";
  if (!expected || given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < given.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function pageId(value) {
  const raw = String(value || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(raw)) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function plainTitle(property) {
  const items = property?.title || [];
  return items.map((item) => item.plain_text || item.text?.content || "").join("").trim();
}

function goalFromPage(page) {
  const properties = page.properties || {};
  const text = plainTitle(properties.Goal);
  const done = Boolean(properties.Done?.checkbox);
  const completed = properties.Completed?.date?.start || null;
  return {
    id: page.id,
    text,
    createdAt: page.created_time || properties.Created?.created_time || null,
    completedAt: done ? completed || page.created_time || null : null,
    done,
  };
}

function splitGoals(pages) {
  const active = [];
  const wins = [];
  for (const page of pages) {
    const goal = goalFromPage(page);
    if (!goal.text) continue;
    if (goal.done) wins.push(goal);
    else active.push(goal);
  }
  active.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  wins.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return { active, wins };
}

async function notion(env, path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": env.NOTION_VERSION || "2026-03-11",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw.slice(0, 180) };
    }
  }
  if (!response.ok) {
    const error = new Error(payload.message || `Notion error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function listPages(env) {
  const pages = [];
  let cursor;
  do {
    const data = await notion(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: { page_size: 100, start_cursor: cursor, archive_status: "active" },
    });
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && pages.length < 500);
  return pages;
}

function titleProperty(text) {
  return { title: [{ type: "text", text: { content: text } }] };
}

async function createGoal(env, text, { done = false, completedAt = null } = {}) {
  const properties = {
    Goal: titleProperty(text),
    Done: { checkbox: done },
  };
  if (done) {
    properties.Completed = { date: { start: completedAt || perthDate(new Date()) } };
  }
  return notion(env, "/pages", {
    method: "POST",
    body: {
      parent: {
        type: "data_source_id",
        data_source_id: env.NOTION_DATA_SOURCE_ID,
      },
      properties,
    },
  });
}

function cleanText(value, limit = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function notionFailure(error) {
  if (error.status === 401 || error.status === 403) {
    return "Notion refused the connection. Check that NEXUS Goals is shared with the integration.";
  }
  if (error.status === 404) {
    return "Notion could not find that goal.";
  }
  return "Notion could not save that change.";
}

export async function handle(request, env = {}) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== allowedOrigin(env)) {
    return json(request, env, 403, { error: "This site is not allowed to use the goals service." });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (!passcodeOk(request, env)) {
    return json(request, env, 401, { error: "That passcode was not accepted." });
  }
  if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) {
    return json(request, env, 500, { error: "The goals service is missing its Notion settings." });
  }

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (request.method === "GET" && parts.length === 1 && parts[0] === "goals") {
      return json(request, env, 200, splitGoals(await listPages(env)));
    }

    if (request.method === "POST" && parts.length === 1 && parts[0] === "goals") {
      const body = await request.json().catch(() => ({}));
      const text = cleanText(body.text, 200);
      if (!text) return json(request, env, 400, { error: "Type a goal first." });
      const page = await createGoal(env, text);
      return json(request, env, 201, { goal: goalFromPage(page) });
    }

    if (request.method === "POST" && parts.length === 2 && parts[0] === "goals" && parts[1] === "import") {
      const body = await request.json().catch(() => ({}));
      const active = Array.isArray(body.active) ? body.active : null;
      const wins = Array.isArray(body.wins) ? body.wins : null;
      if (!active || !wins) return json(request, env, 400, { error: "That backup could not be read." });
      if (active.length + wins.length > 200) {
        return json(request, env, 400, { error: "That backup has too many goals to move." });
      }
      for (const item of active) {
        const text = cleanText(item?.text, 500);
        if (text) await createGoal(env, text, { done: false });
      }
      for (const item of wins) {
        const text = cleanText(item?.text, 500);
        if (!text) continue;
        const completed = item?.completedAt ? perthDate(item.completedAt) : perthDate(new Date());
        await createGoal(env, text, { done: true, completedAt: completed });
      }
      return json(request, env, 200, splitGoals(await listPages(env)));
    }

    const id = parts[0] === "goals" ? pageId(parts[1]) : null;
    if (!id) return json(request, env, 404, { error: "That goal was not found." });

    if (request.method === "POST" && parts[2] === "done" && parts.length === 3) {
      const page = await notion(env, `/pages/${id}`, {
        method: "PATCH",
        body: {
          properties: {
            Done: { checkbox: true },
            Completed: { date: { start: perthDate(new Date()) } },
          },
        },
      });
      return json(request, env, 200, { goal: goalFromPage(page) });
    }

    if (request.method === "POST" && parts[2] === "undo" && parts.length === 3) {
      const page = await notion(env, `/pages/${id}`, {
        method: "PATCH",
        body: {
          properties: {
            Done: { checkbox: false },
            Completed: { date: null },
          },
        },
      });
      return json(request, env, 200, { goal: goalFromPage(page) });
    }

    if (request.method === "DELETE" && parts.length === 2) {
      await notion(env, `/pages/${id}`, {
        method: "PATCH",
        body: { in_trash: true },
      });
      return json(request, env, 200, { ok: true, id });
    }

    return json(request, env, 404, { error: "That goal was not found." });
  } catch (error) {
    return json(request, env, 502, { error: notionFailure(error) });
  }
}

export default {
  fetch: handle,
};
