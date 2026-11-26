import assert from "node:assert/strict";
import test from "node:test";

import { clearListsCache, handle, perthDate } from "./index.js";

const env = {
  NOTION_TOKEN: "secret-token",
  NEXUS_PASSCODE: "open-sesame",
  NOTION_DATA_SOURCE_ID: "423bc823-fc97-8151-aff3-000b1b2bcd0a",
  NOTION_VERSION: "2026-03-11",
  ALLOWED_ORIGIN: "https://captainwild88.github.io",
};

const pageId = "423bc823-fc97-8183-ba82-d50db861beb5";

function page(id, text, { done = false, completed = null, created = "2026-11-20T01:00:00.000Z" } = {}) {
  return {
    id,
    created_time: created,
    properties: {
      Goal: { type: "title", title: [{ plain_text: text }] },
      Done: { type: "checkbox", checkbox: done },
      Completed: { type: "date", date: completed ? { start: completed } : null },
      Created: { type: "created_time", created_time: created },
    },
  };
}

function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method, body, authorization: options.headers?.Authorization });
    const payload = await handler({ url: String(url), method: options.method, body, calls });
    return new Response(JSON.stringify(payload.body), {
      status: payload.status || 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function request(path, { method = "GET", passcode = env.NEXUS_PASSCODE, origin = env.ALLOWED_ORIGIN, body } = {}) {
  return new Request(`https://nexus-goals.test${path}`, {
    method,
    headers: {
      Origin: origin,
      "X-Nexus-Passcode": passcode,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("Perth dates stay on the Perth calendar", () => {
  assert.equal(perthDate("2026-11-24T16:30:00.000Z"), "2026-11-25");
  assert.equal(perthDate("2026-11-24T15:30:00.000Z"), "2026-11-24");
});

test("requests without the passcode are rejected", async () => {
  const response = await handle(request("/goals", { passcode: "" }), env);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(body.error, /passcode/i);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGIN);
});

test("a wrong passcode is rejected and the token is not echoed", async () => {
  const response = await handle(request("/goals", { passcode: "nope" }), env);
  assert.equal(response.status, 401);
  const text = JSON.stringify(await response.json());
  assert.doesNotMatch(text, /secret-token/);
});

test("another website cannot use the goals service", async () => {
  const response = await handle(request("/goals", { origin: "https://evil.example" }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("the browser preflight does not need the passcode", async () => {
  const response = await handle(
    new Request("https://nexus-goals.test/goals", {
      method: "OPTIONS",
      headers: { Origin: env.ALLOWED_ORIGIN },
    }),
    env,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGIN);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Nexus-Passcode/);
});

test("list splits open goals and wins", async () => {
  const mock = installFetch(() => ({
    body: {
      results: [
        page("11111111-1111-4111-8111-111111111111", "Rake leaves", { created: "2026-11-20T01:00:00.000Z" }),
        page("22222222-2222-4222-8222-222222222222", "Fix the tap", {
          done: true,
          completed: "2026-11-19",
          created: "2026-11-18T01:00:00.000Z",
        }),
      ],
      has_more: false,
    },
  }));
  try {
    const response = await handle(request("/goals"), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.active.map((item) => item.text), ["Rake leaves"]);
    assert.equal(body.wins[0].text, "Fix the tap");
    assert.equal(body.wins[0].completedAt, "2026-11-19");
    assert.equal(mock.calls[0].method, "POST");
    assert.match(mock.calls[0].url, /\/data_sources\/423bc823-fc97-8151-aff3-000b1b2bcd0a\/query$/);
    assert.equal(mock.calls[0].authorization, "Bearer secret-token");
    assert.equal(mock.calls[0].body.archive_status, "active");
  } finally {
    mock.restore();
  }
});

test("add, done, undo, and delete call Notion", async () => {
  const created = page(pageId, "Weed the beds");
  const done = page(pageId, "Weed the beds", { done: true, completed: perthDate(new Date()) });
  const undone = page(pageId, "Weed the beds");
  const responses = [
    { body: created, status: 200 },
    { body: done, status: 200 },
    { body: undone, status: 200 },
    { body: { id: pageId, in_trash: true }, status: 200 },
  ];
  const mock = installFetch(() => responses.shift());
  try {
    const added = await handle(request("/goals", { method: "POST", body: { text: "  Weed the beds  " } }), env);
    assert.equal(added.status, 201);
    assert.equal((await added.json()).goal.text, "Weed the beds");
    assert.equal(mock.calls[0].body.parent.data_source_id, env.NOTION_DATA_SOURCE_ID);
    assert.equal(mock.calls[0].body.properties.Done.checkbox, false);

    const marked = await handle(request(`/goals/${pageId}/done`, { method: "POST" }), env);
    assert.equal(marked.status, 200);
    assert.equal(mock.calls[1].body.properties.Done.checkbox, true);
    assert.equal(mock.calls[1].body.properties.Completed.date.start, perthDate(new Date()));

    const undo = await handle(request(`/goals/${pageId}/undo`, { method: "POST" }), env);
    assert.equal(undo.status, 200);
    assert.equal(mock.calls[2].body.properties.Done.checkbox, false);
    assert.equal(mock.calls[2].body.properties.Completed.date, null);

    const removed = await handle(request(`/goals/${pageId}`, { method: "DELETE" }), env);
    assert.equal(removed.status, 200);
    assert.equal(mock.calls[3].body.in_trash, true);
    assert.match(mock.calls[3].url, new RegExp(`/pages/${pageId}$`));
  } finally {
    mock.restore();
  }
});

test("import creates open goals and wins with their completed dates", async () => {
  const mock = installFetch((call) => {
    if (String(call.url).endsWith("/query")) {
      return { body: { results: [page(pageId, "From the phone", { done: true, completed: "2026-11-01" })], has_more: false } };
    }
    return { body: page(pageId, "created"), status: 200 };
  });
  try {
    const response = await handle(
      request("/goals/import", {
        method: "POST",
        body: {
          active: [{ text: "Rake leaves" }],
          wins: [{ text: "Fix the tap", completedAt: "2026-11-01T02:00:00.000Z" }],
        },
      }),
      env,
    );
    assert.equal(response.status, 200);
    const creates = mock.calls.filter((call) => call.url.endsWith("/pages"));
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.properties.Done.checkbox, false);
    assert.equal(creates[1].body.properties.Done.checkbox, true);
    assert.equal(creates[1].body.properties.Completed.date.start, "2026-11-01");
    const body = await response.json();
    assert.equal(body.wins[0].text, "From the phone");
  } finally {
    mock.restore();
  }
});

function blockList(blocks) {
  return { body: { results: blocks, has_more: false }, status: 200 };
}

test("lists need the passcode and reuse the lesson parser", async () => {
  clearListsCache();
  const mock = installFetch((call) => {
    if (call.url.includes("422bc823-fc97-813d-bfb2-cfb693d9102c")) {
      return blockList([
        {
          id: "todo-1",
          type: "to_do",
          has_children: false,
          to_do: { checked: false, rich_text: [{ plain_text: "Rake leaves" }] },
        },
      ]);
    }
    return blockList([
      {
        id: "lesson-heading",
        type: "heading_1",
        has_children: false,
        heading_1: { rich_text: [{ plain_text: "25 Nov 2026" }] },
      },
      {
        id: "lesson-body",
        type: "paragraph",
        has_children: false,
        paragraph: {
          rich_text: [{
            plain_text: "What an LLM actually is\nThe Big Idea: It predicts the next word.\nPractical Use Case: A tradie asks for a quote.\nPro Tip: Give it a role.",
          }],
        },
      },
    ]);
  });
  try {
    const denied = await handle(request("/lists", { passcode: "" }), env);
    assert.equal(denied.status, 401);

    const response = await handle(request("/lists"), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
    const body = await response.json();
    assert.deepEqual(body.todos.todo.map((item) => item.text), ["Rake leaves"]);
    assert.equal(body.learning.lessons[0].topic, "What an LLM actually is");
    assert.equal(body.learning.lessons[0].bigIdea, "It predicts the next word.");
    assert.equal(body.learning.lessons[0].useCase, "A tradie asks for a quote.");
    assert.equal(body.learning.lessons[0].proTip, "Give it a role.");
    const callsAfterFirst = mock.calls.length;

    const cached = await handle(request("/lists"), env);
    assert.equal(cached.status, 200);
    assert.equal(mock.calls.length, callsAfterFirst);

    const fresh = await handle(request("/lists?fresh=1"), env);
    assert.equal(fresh.status, 200);
    assert.ok(mock.calls.length > callsAfterFirst);
  } finally {
    mock.restore();
    clearListsCache();
  }
});
