import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assembleLessons,
  extractDate,
  parseDailyTodos,
  parseLessonBlocks,
  parseLearningDatabase,
  parseOngoingTodos,
  perthISODate,
  pickLearningResult,
  resultTitle,
} from "./parse-notion.mjs";
import {
  TODOS_PAGE_ID,
  contentKey,
  writeIfChanged,
} from "./sync-notion.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function text(value) {
  return [{ type: "text", plain_text: value }];
}

function todo(id, value, checked = false) {
  return {
    id,
    type: "to_do",
    has_children: false,
    to_do: { rich_text: text(value), checked: Boolean(checked) },
  };
}

function bullet(id, value) {
  return {
    id,
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: text(value) },
  };
}

function heading(level, value, children = []) {
  const type = `heading_${level}`;
  return {
    id: `h-${value}`,
    type,
    [type]: { rich_text: text(value) },
    children,
  };
}

function paragraph(value) {
  return {
    id: `p-${value.slice(0, 24)}`,
    type: "paragraph",
    paragraph: { rich_text: text(value) },
  };
}

test("daily todos keep nested items and show open ones first", () => {
  const blocks = [
    heading(2, "Morning", [
      todo("a", "Reply to the school email", false),
      {
        id: "toggle",
        type: "toggle",
        toggle: { rich_text: text("Errands") },
        children: [bullet("b", "Pick up milk")],
      },
    ]),
    todo("c", "Put the bins out", true),
    paragraph("[x] Water the plants"),
    paragraph("This is just a note"),
  ];
  const items = parseDailyTodos(blocks);
  assert.deepEqual(
    items.map((item) => item.text),
    ["Reply to the school email", "Pick up milk", "Put the bins out", "Water the plants"],
  );
  assert.deepEqual(
    items.map((item) => item.checked),
    [false, false, true, true],
  );
});

test("ongoing todos follow To do and Done headings, including emoji", () => {
  const blocks = [
    heading(2, "To do", [todo("open-1", "Book the car service", false)]),
    todo("open-2", "Sort the photos", true),
    heading(2, "✅ Done"),
    bullet("done-1", "Renew the driver's licence"),
    todo("done-2", "Fix the tap", true),
  ];
  const split = parseOngoingTodos(blocks);
  assert.deepEqual(split.todo.map((item) => item.text), ["Book the car service", "Sort the photos"]);
  assert.equal(split.todo[1].checked, true);
  assert.deepEqual(split.done.map((item) => item.text), [
    "Renew the driver's licence",
    "Fix the tap",
  ]);
  assert.equal(split.done[0].checked, true);
});

test("ongoing todos without headings split on the checkbox", () => {
  const split = parseOngoingTodos([
    todo("1", "Still open", false),
    todo("2", "Finished", true),
    bullet("3", "Also open"),
  ]);
  assert.deepEqual(split.todo.map((item) => item.text), ["Still open", "Also open"]);
  assert.deepEqual(split.done.map((item) => item.text), ["Finished"]);
});

test("columns are included once", () => {
  const blocks = [
    {
      id: "cols",
      type: "column_list",
      children: [
        { id: "c1", type: "column", children: [todo("a", "Left")] },
        { id: "c2", type: "column", children: [todo("b", "Right", true)] },
      ],
    },
  ];
  const items = parseDailyTodos(blocks);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.text), ["Left", "Right"]);
});

test("lessons can be headings plus labelled sections", () => {
  const blocks = [
    heading(1, "25 Nov 2026"),
    heading(2, "Today's Topic"),
    paragraph("Ask AI to show its working"),
    heading(2, "The Big Idea"),
    paragraph("Better questions get better answers."),
    paragraph("Ask it what it is unsure about."),
    heading(2, "Practical Use Case"),
    paragraph("Compare two phones before you buy."),
    heading(2, "Pro Tip"),
    paragraph("Mention Perth and a budget."),
    { id: "d", type: "divider", divider: {} },
    heading(1, "24 November 2026 — Save the prompt that worked"),
    paragraph("The Big Idea: A good prompt is a recipe."),
    paragraph("Practical Use Case: Keep a note called Prompt recipes."),
    paragraph("Pro Tip: Give each recipe a plain name."),
  ];
  const lessons = assembleLessons({ pageBlocks: blocks });
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].date, "2026-11-25");
  assert.equal(lessons[0].topic, "Ask AI to show its working");
  assert.match(lessons[0].bigIdea, /unsure/);
  assert.equal(lessons[0].useCase, "Compare two phones before you buy.");
  assert.equal(lessons[0].proTip, "Mention Perth and a budget.");
  assert.equal(lessons[1].date, "2026-11-24");
  assert.equal(lessons[1].topic, "Save the prompt that worked");
  assert.equal(lessons[1].bigIdea, "A good prompt is a recipe.");
});

test("child pages become lessons and a missing title is filled in", () => {
  const lessons = assembleLessons({
    pageBlocks: [paragraph("Welcome to the learning log")],
    childPages: [
      {
        title: "23 Nov 2026",
        date: "2026-11-23",
        blocks: [
          heading(2, "The Big Idea"),
          paragraph("You still decide what gets sent."),
          heading(2, "Practical Use Case"),
          paragraph("Edit one sentence of a draft email."),
          heading(2, "Pro Tip"),
          paragraph("Leave passwords out of the chat."),
        ],
      },
    ],
  });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].date, "2026-11-23");
  assert.equal(lessons[0].topic, "23 Nov 2026");
  assert.match(lessons[0].bigIdea, /decide/);
});

test("database rows prefer Today's Topic over the page name", () => {
  const lessons = parseLearningDatabase([
    {
      id: "row-1",
      created_time: "2026-11-24T16:30:00.000Z",
      properties: {
        Name: { type: "title", title: text("Name fallback") },
        "Today's Topic": { type: "rich_text", rich_text: text("Ask better questions") },
        "The Big Idea": { type: "rich_text", rich_text: text("Clarity in, clarity out.") },
        "Practical Use Case": { type: "rich_text", rich_text: text("Plan a day out.") },
        "Pro Tip": { type: "rich_text", rich_text: text("Name the city.") },
        Date: { type: "date", date: { start: "2026-11-25" } },
      },
    },
    {
      id: "row-2",
      created_time: "2026-11-24T15:30:00.000Z",
      properties: {
        Lesson: { type: "title", title: text("Older note") },
        Idea: { type: "rich_text", rich_text: text("Not a mapped field") },
      },
    },
  ]);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].topic, "Ask better questions");
  assert.equal(lessons[0].date, "2026-11-25");
  assert.equal(lessons[0].proTip, "Name the city.");
  assert.equal(lessons[1].topic, "Older note");
  assert.equal(lessons[1].date, "2026-11-24");
});

test("learning search prefers the exact Daily Learning title", () => {
  const exact = {
    object: "page",
    last_edited_time: "2026-11-20T00:00:00.000Z",
    properties: { title: { type: "title", title: text("Daily Learning") } },
  };
  const partial = {
    object: "page",
    last_edited_time: "2026-11-25T00:00:00.000Z",
    properties: { title: { type: "title", title: text("My Daily Learning Notes") } },
  };
  const other = {
    object: "database",
    last_edited_time: "2026-11-26T00:00:00.000Z",
    title: text("Learning"),
  };
  assert.equal(pickLearningResult([partial, other, exact]), exact);
  assert.equal(pickLearningResult([other]), null);
  assert.equal(resultTitle(other), "Learning");
});

test("dates and Perth calendar days", () => {
  assert.equal(extractDate("Lesson on 25 Nov 2026"), "2026-11-25");
  assert.equal(extractDate("November 3rd, 2026"), "2026-11-03");
  assert.equal(extractDate("2026-11-25T02:00:00.000+08:00"), "2026-11-25");
  assert.equal(extractDate("no date here"), null);
  assert.equal(perthISODate("2026-11-24T16:30:00.000Z"), "2026-11-25");
  assert.equal(perthISODate("2026-11-24T15:30:00.000Z"), "2026-11-24");
});

test("sync reads the general to-do page and skips Daily To-Dos", async () => {
  assert.equal(TODOS_PAGE_ID, "422bc823-fc97-813d-bfb2-cfb693d9102c");
  const sync = await readFile(path.join(root, "scripts", "sync-notion.mjs"), "utf8");
  assert.doesNotMatch(sync, /420bc823-fc97-8157-bd78-c1a175e4ab8c/);
  assert.doesNotMatch(sync, /dailyTodos/);
});

test("content changes are detected without counting the sync clock", () => {
  const base = {
    version: 1,
    source: "notion",
    notionConnected: true,
    syncedAt: "2026-11-25T01:00:00.000Z",
    todos: { title: "To-Dos", todo: [], done: [], error: null },
    learning: { found: false, lessons: [], error: null },
  };
  const later = { ...base, syncedAt: "2026-11-25T02:00:00.000Z" };
  assert.equal(contentKey(base), contentKey(later));
  const changed = {
    ...base,
    todos: { ...base.todos, todo: [{ id: "1", text: "Walk", checked: false }] },
  };
  assert.notEqual(contentKey(base), contentKey(changed));
});

test("unchanged Notion content does not rewrite data.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-"));
  const file = path.join(dir, "data.json");
  const data = {
    version: 1,
    source: "notion",
    notionConnected: true,
    syncedAt: "2026-11-25T01:00:00.000Z",
    todos: { title: "To-Dos", todo: [{ id: "1", text: "Walk", checked: false }], done: [], error: null },
    learning: { found: false, lessons: [], error: null },
  };
  assert.equal(await writeIfChanged(file, data), true);
  assert.equal(await writeIfChanged(file, { ...data, syncedAt: "2026-11-25T05:00:00.000Z" }), false);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.syncedAt, "2026-11-25T01:00:00.000Z");
  const updated = {
    ...data,
    todos: { ...data.todos, todo: [{ id: "1", text: "Walk further", checked: false }] },
  };
  assert.equal(await writeIfChanged(file, updated), true);
});

test("missing Notion token exits cleanly and leaves example data alone", () => {
  const result = spawnSync(process.execPath, ["scripts/sync-notion.mjs"], {
    cwd: root,
    env: { ...process.env, NOTION_TOKEN: "   " },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NOTION_TOKEN is not set/);
  assert.match(result.stdout, /example data/);
});

test("data.json has the sections the dashboard reads", async () => {
  const data = JSON.parse(await readFile(path.join(root, "data", "data.json"), "utf8"));
  assert.ok(data.source === "notion" || data.source === "sample");
  assert.ok(Array.isArray(data.todos.todo));
  assert.ok(Array.isArray(data.todos.done));
  assert.equal(typeof data.learning.found, "boolean");
  assert.ok(Array.isArray(data.learning.lessons));
});

test("one paragraph splits on the lesson labels, including the live lesson text", () => {
  const packed =
    'What an LLM actually is The Big Idea: An LLM is a very well-read autocomplete. It has read a huge amount of text, and all it does is predict the next word that fits, again and again. It doesn\'t look facts up or "know" things the way you do. It\'s spotted the patterns in how people write and explain things. Practical Use Case: A tradie says "write a quote email for a deck job, friendly, under 100 words", and the LLM writes something that sounds like thousands of good quote emails it\'s seen. A coach pastes in rough notes and gets a clean session summary back. In both cases it\'s matching patterns, not thinking up something new. Pro Tip: It answers in the style you set it up for, so give it a role and an audience. Instead of "explain habits", try: "You\'re a coach talking to a tired dad who works labouring jobs. Explain in 5 short lines why small habits change identity." The answer will be a lot sharper.';
  const marker = "The Big Idea:";
  const at = packed.indexOf(marker);
  const blocks = [
    heading(1, "25 Nov 2026"),
    {
      id: "packed",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", plain_text: packed.slice(0, at) },
          { type: "text", plain_text: marker, annotations: { bold: true } },
          { type: "text", plain_text: packed.slice(at + marker.length) },
        ],
      },
    },
  ];
  const [lesson] = parseLessonBlocks(blocks);
  assert.equal(lesson.date, "2026-11-25");
  assert.equal(lesson.topic, "What an LLM actually is");
  assert.equal(
    lesson.bigIdea,
    "An LLM is a very well-read autocomplete. It has read a huge amount of text, and all it does is predict the next word that fits, again and again. It doesn't look facts up or \"know\" things the way you do. It's spotted the patterns in how people write and explain things.",
  );
  assert.equal(
    lesson.useCase,
    'A tradie says "write a quote email for a deck job, friendly, under 100 words", and the LLM writes something that sounds like thousands of good quote emails it\'s seen. A coach pastes in rough notes and gets a clean session summary back. In both cases it\'s matching patterns, not thinking up something new.',
  );
  assert.equal(
    lesson.proTip,
    'It answers in the style you set it up for, so give it a role and an audience. Instead of "explain habits", try: "You\'re a coach talking to a tired dad who works labouring jobs. Explain in 5 short lines why small habits change identity." The answer will be a lot sharper.',
  );

  const withBreaks = packed
    .replace(" The Big Idea:", "\nThe Big Idea:")
    .replace(" Practical Use Case:", "\nPractical Use Case:")
    .replace(" Pro Tip:", "\nPro Tip:");
  const broken = parseLessonBlocks([
    heading(1, "25 Nov 2026"),
    paragraph(withBreaks),
  ]);
  assert.equal(broken[0].topic, lesson.topic);
  assert.equal(broken[0].bigIdea, lesson.bigIdea);
  assert.equal(broken[0].useCase, lesson.useCase);
  assert.equal(broken[0].proTip, lesson.proTip);

  const curly = parseLessonBlocks([
    heading(1, "26 Nov 2026"),
    paragraph("Today\u2019s Topic: Curly apostrophe\n**The Big Idea:** Bold label still splits."),
  ]);
  assert.equal(curly[0].topic, "Curly apostrophe");
  assert.equal(curly[0].bigIdea, "Bold label still splits.");
});

test("pages assets stay relative for any repository-name case", async () => {
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const css = await readFile(path.join(root, "css", "styles.css"), "utf8");
  const js = await readFile(path.join(root, "js", "app.js"), "utf8");
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(html, /href="\.\/css\/styles\.css"/);
  assert.match(html, /src="\.\/js\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
  assert.doesNotMatch(css, /url\(\s*["']?\//);
  assert.match(css, /url\("\.\/fonts\//);
  assert.match(js, /new URL\("\.\/data\/data\.json", document\.baseURI\)/);
  assert.doesNotMatch(`${html}\n${css}\n${js}`, /github\.io\/nexus/i);
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const setup = await readFile(path.join(root, "SETUP.md"), "utf8");
  assert.match(readme, /https:\/\/captainwild88\.github\.io\/Nexus\//);
  assert.match(setup, /https:\/\/captainwild88\.github\.io\/Nexus\//);
  assert.doesNotMatch(`${readme}\n${setup}`, /github\.io\/nexus\//);
  assert.equal(spawnSync(process.execPath, ["--check", "js/app.js"], { cwd: root }).status, 0);
  assert.equal(spawnSync(process.execPath, ["--check", "scripts/sync-notion.mjs"], { cwd: root }).status, 0);
});

test("workflows sync hourly, skip a missing secret, and deploy with Actions", async () => {
  const deploy = await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8");
  const sync = await readFile(path.join(root, ".github/workflows/sync-notion.yml"), "utf8");
  assert.match(deploy, /workflow_dispatch/);
  assert.match(deploy, /branches:\s*\n\s*- main/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /actions: read/);
  assert.match(deploy, /upload-pages-artifact@v5/);
  assert.match(deploy, /deploy-pages@v5/);
  assert.match(deploy, /node scripts\/build-site\.mjs/);
  assert.match(sync, /cron:\s*"0 \* \* \* \*"/);
  assert.match(sync, /workflow_dispatch/);
  assert.match(sync, /NOTION_TOKEN:\s*\$\{\{\s*secrets\.NOTION_TOKEN\s*\}\}/);
  assert.match(sync, /git diff --quiet -- data\/data\.json/);
  assert.match(sync, /gh workflow run deploy\.yml/);
  assert.match(sync, /contents: write/);
});

test("sample file is untouched when the token is blank", async () => {
  const before = await readFile(path.join(root, "data", "data.json"), "utf8");
  const result = spawnSync(process.execPath, ["scripts/sync-notion.mjs"], {
    cwd: root,
    env: { ...process.env, NOTION_TOKEN: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  const after = await readFile(path.join(root, "data", "data.json"), "utf8");
  assert.equal(after, before);
  await writeFile(path.join(root, "data", "data.json"), before);
});
