/**
 * Pure Notion payload parsers for NEXUS.
 * The sync script fetches blocks. These functions turn them into dashboard data.
 */

const MONTHS = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const ITEM_TYPES = new Set(["to_do", "bulleted_list_item", "numbered_list_item"]);
const PASS_THROUGH = new Set(["column_list", "column", "synced_block"]);

export function richText(items) {
  if (!Array.isArray(items)) return "";
  return items.map((part) => part?.plain_text ?? part?.text?.content ?? "").join("");
}

export function perthISODate(value) {
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

export function extractDate(text) {
  if (!text) return null;
  const source = String(text);
  const iso = source.match(/(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }
  const dayMonth = source.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (dayMonth && MONTHS[dayMonth[2].toLowerCase()]) {
    return `${dayMonth[3]}-${MONTHS[dayMonth[2].toLowerCase()]}-${String(dayMonth[1]).padStart(2, "0")}`;
  }
  const monthDay = source.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (monthDay && MONTHS[monthDay[1].toLowerCase()]) {
    return `${monthDay[3]}-${MONTHS[monthDay[1].toLowerCase()]}-${String(monthDay[2]).padStart(2, "0")}`;
  }
  return null;
}

function stripEmoji(text) {
  return String(text)
    .replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\uFE0F\u200D])+\s*/gu, "")
    .trim();
}

function cleanInline(text) {
  return stripEmoji(text).replace(/\s+/g, " ").trim();
}

function blockPayload(block) {
  if (!block || typeof block !== "object") return {};
  return block[block.type] || {};
}

function blockText(block) {
  const data = blockPayload(block);
  if (Array.isArray(data.rich_text)) return richText(data.rich_text);
  if (block.type === "table_row") {
    return (data.cells || []).map((cell) => richText(cell)).filter(Boolean).join(" — ");
  }
  if (block.type === "child_page") return data.title || "";
  if (block.type === "child_database") return data.title || "";
  return "";
}

function isHeading(block) {
  return block?.type === "heading_1" || block?.type === "heading_2" || block?.type === "heading_3";
}

function sectionKind(text) {
  const normalised = stripEmoji(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalised) return null;
  if (/^(done|completed|complete|finished)$/.test(normalised)) return "done";
  if (/^(to do|todo|todos|to dos|tasks|task|in progress|open|backlog)$/.test(normalised)) {
    return "todo";
  }
  return null;
}

function checkboxParagraph(text) {
  const trimmed = cleanInline(text);
  const match = trimmed.match(/^(?:[-*]\s*)?(?:\[( |x|X)\]|(☑|✓|✔|✅|☐|❌))\s+(.+)$/);
  if (!match) return null;
  const word = (match[1] || "").toLowerCase();
  const symbol = match[2] || "";
  const checked = word === "x" || ["☑", "✓", "✔", "✅"].includes(symbol);
  const label = match[3].trim();
  if (!label) return null;
  return { checked, text: label };
}

function collectItems(blocks, section = null, explicit = false) {
  const items = [];
  let current = section;
  let currentExplicit = explicit;

  for (const block of blocks || []) {
    if (!block || typeof block !== "object") continue;

    if (PASS_THROUGH.has(block.type) || block.type === "table") {
      items.push(...collectItems(block.children, current, currentExplicit));
      continue;
    }

    if (isHeading(block)) {
      const kind = sectionKind(blockText(block));
      if (kind) {
        current = kind;
        currentExplicit = true;
      }
    }

    if (ITEM_TYPES.has(block.type)) {
      const text = cleanInline(blockText(block));
      if (text) {
        items.push({
          id: block.id || null,
          text,
          checked: block.type === "to_do" ? Boolean(block.to_do?.checked) : false,
          section: current,
          explicitSection: currentExplicit && Boolean(current),
        });
      }
    } else if (block.type === "paragraph" || block.type === "quote" || block.type === "callout") {
      const parsed = checkboxParagraph(blockText(block));
      if (parsed) {
        items.push({
          id: block.id || null,
          text: parsed.text,
          checked: parsed.checked,
          section: current,
          explicitSection: currentExplicit && Boolean(current),
        });
      }
    }

    if (block.children?.length && !PASS_THROUGH.has(block.type) && block.type !== "table") {
      items.push(...collectItems(block.children, current, currentExplicit));
    }
  }

  return items;
}

function publicItem(item, index, prefix) {
  return {
    id: item.id || `${prefix}-${index + 1}`,
    text: item.text,
    checked: Boolean(item.checked || item.section === "done"),
  };
}

export function parseDailyTodos(blocks) {
  return collectItems(blocks)
    .map((item, index) => publicItem(item, index, "daily"))
    .sort((a, b) => Number(a.checked) - Number(b.checked));
}

export function parseOngoingTodos(blocks) {
  const items = collectItems(blocks);
  const sawSection = items.some((item) => item.explicitSection);
  const todo = [];
  const done = [];

  items.forEach((item, index) => {
    const pub = publicItem(item, index, "todo");
    let bucket = null;
    if (item.explicitSection && item.section) bucket = item.section;
    else bucket = pub.checked ? "done" : "todo";
    if (!sawSection) bucket = pub.checked ? "done" : "todo";
    (bucket === "done" ? done : todo).push(pub);
  });

  return { todo, done };
}

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchProp(name) {
  const normalised = normName(name);
  const groups = [
    ["topic", ["today s topic", "todays topic", "topic", "lesson", "name", "title"]],
    ["bigIdea", ["the big idea", "big idea"]],
    ["useCase", ["practical use case", "use case"]],
    ["proTip", ["pro tip"]],
    ["date", ["lesson date", "date", "day"]],
  ];
  for (const [key, names] of groups) {
    const index = names.indexOf(normalised);
    if (index !== -1) return { key, rank: names.length - index };
  }
  return null;
}

function formulaToString(formula) {
  if (!formula) return "";
  if (formula.type === "string") return formula.string || "";
  if (formula.type === "number") return formula.number == null ? "" : String(formula.number);
  if (formula.type === "boolean") return formula.boolean ? "Yes" : "";
  if (formula.type === "date") return formula.date?.start || "";
  return "";
}

function propToString(prop) {
  if (!prop || typeof prop !== "object") return "";
  switch (prop.type) {
    case "title":
      return richText(prop.title).trim();
    case "rich_text":
      return richText(prop.rich_text).trim();
    case "date":
      return prop.date?.start || "";
    case "select":
      return prop.select?.name || "";
    case "status":
      return prop.status?.name || "";
    case "multi_select":
      return (prop.multi_select || []).map((item) => item.name).filter(Boolean).join(", ");
    case "number":
      return prop.number == null ? "" : String(prop.number);
    case "url":
      return prop.url || "";
    case "email":
      return prop.email || "";
    case "phone_number":
      return prop.phone_number || "";
    case "checkbox":
      return prop.checkbox ? "Yes" : "";
    case "formula":
      return formulaToString(prop.formula).trim();
    default:
      return "";
  }
}

function emptyLesson() {
  return { date: null, topic: "", bigIdea: "", useCase: "", proTip: "" };
}

function lessonScore(lesson) {
  return [lesson.topic, lesson.bigIdea, lesson.useCase, lesson.proTip].filter(Boolean).length;
}

function usableLesson(lesson) {
  if (!lesson) return null;
  const cleaned = {
    date: lesson.date || null,
    topic: (lesson.topic || "").trim(),
    bigIdea: (lesson.bigIdea || "").trim(),
    useCase: (lesson.useCase || "").trim(),
    proTip: (lesson.proTip || "").trim(),
  };
  const filled = lessonScore(cleaned);
  if (filled >= 2 || (cleaned.date && filled >= 1)) return cleaned;
  return null;
}

export function sortLessons(lessons) {
  return lessons
    .map((lesson, index) => ({ lesson, index }))
    .sort((a, b) => {
      if (a.lesson.date && b.lesson.date && a.lesson.date !== b.lesson.date) {
        return b.lesson.date < a.lesson.date ? -1 : 1;
      }
      if (a.lesson.date && !b.lesson.date) return -1;
      if (!a.lesson.date && b.lesson.date) return 1;
      return b.index - a.index;
    })
    .map(({ lesson }) => lesson);
}

function dedupeLessons(lessons) {
  const seen = new Set();
  const unique = [];
  for (const lesson of lessons) {
    const key = `${lesson.date || ""}|${lesson.topic.toLowerCase()}|${lesson.bigIdea.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(lesson);
  }
  return unique;
}

const FIELD_PATTERNS = [
  ["topic", /^(?:today'?s topic|topic)\s*[:\-–—]\s*(.*)$/i],
  ["bigIdea", /^(?:the )?big idea\s*[:\-–—]\s*(.*)$/i],
  ["useCase", /^(?:practical )?use case\s*[:\-–—]\s*(.*)$/i],
  ["proTip", /^pro tip\s*[:\-–—]\s*(.*)$/i],
  ["date", /^date\s*[:\-–—]\s*(.*)$/i],
];

const FIELD_ONLY = [
  ["topic", /^(?:today'?s topic|topic)$/i],
  ["bigIdea", /^(?:the )?big idea$/i],
  ["useCase", /^(?:practical )?use case$/i],
  ["proTip", /^pro tip$/i],
  ["date", /^date$/i],
];

function normalizeLessonText(text) {
  return stripEmoji(text)
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/\*\*|__/g, "")
    .replace(/：/g, ":");
}

function labelToField(label) {
  const name = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (name === "today's topic") return "topic";
  if (name === "the big idea" || name === "big idea") return "bigIdea";
  if (name === "practical use case" || name === "use case") return "useCase";
  if (name === "pro tip") return "proTip";
  return null;
}

function splitLabeled(text) {
  const pattern = /(today's\s+topic|practical\s+use\s+case|the\s+big\s+idea|pro\s+tip|use\s+case|big\s+idea)\s*[:\-–—]/gi;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return null;
  const pieces = [];
  let cursor = 0;
  for (const match of matches) {
    const before = text.slice(cursor, match.index).trim();
    if (before) pieces.push({ text: before });
    const field = labelToField(match[1]);
    if (field) pieces.push({ field });
    cursor = match.index + match[0].length;
  }
  const after = text.slice(cursor).trim();
  if (after) pieces.push({ text: after });
  return pieces.length ? pieces : null;
}

function matchInlineField(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  for (const [field, pattern] of FIELD_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) return { field, value: (match[1] || "").trim() };
  }
  return null;
}

function matchFieldLabel(text) {
  const cleaned = stripEmoji(text)
    .replace(/\s*[:\-–—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [field, pattern] of FIELD_ONLY) {
    if (pattern.test(cleaned)) return field;
  }
  return null;
}

function splitDateHeading(text) {
  const date = extractDate(text);
  if (!date) return null;
  const rest = stripEmoji(text)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/, "")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\b/, "")
    .replace(/\b[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/, "")
    .replace(/^[\s:—–\-|]+/, "")
    .replace(/[\s:—–\-|]+$/, "")
    .trim();
  return { date, rest };
}

function flattenLearning(blocks, out = []) {
  for (const block of blocks || []) {
    if (!block || typeof block !== "object") continue;
    if (PASS_THROUGH.has(block.type) || block.type === "table") {
      flattenLearning(block.children, out);
      continue;
    }
    if (block.type === "divider") {
      out.push({ kind: "divider" });
      continue;
    }
    if (block.type === "child_page" || block.type === "child_database") {
      out.push({ kind: "skip" });
      continue;
    }
    const text = blockText(block).trim();
    if (isHeading(block)) {
      out.push({ kind: "heading", level: Number(String(block.type).slice(-1)), text });
    } else if (text && block.type !== "table_row") {
      out.push({ kind: "text", text });
    } else if (block.type === "table_row" && text) {
      out.push({ kind: "text", text });
    }
    if (block.children?.length) flattenLearning(block.children, out);
  }
  return out;
}

export function parseLessonBlocks(blocks) {
  const nodes = flattenLearning(blocks);
  const lessons = [];
  let current = emptyLesson();
  let field = null;
  let implicit = { topic: false, bigIdea: false, useCase: false, proTip: false };

  const reset = () => {
    current = emptyLesson();
    field = null;
    implicit = { topic: false, bigIdea: false, useCase: false, proTip: false };
  };

  const flush = () => {
    const lesson = usableLesson(current);
    if (lesson) lessons.push(lesson);
    reset();
  };

  const hasContent = () =>
    Boolean(current.date || current.topic || current.bigIdea || current.useCase || current.proTip);

  const assign = (key, value, explicit = false) => {
    const chunk = String(value || "").trim();
    if (!chunk) return;
    if (key === "date") {
      const date = extractDate(chunk);
      if (date) current.date = date;
      return;
    }
    if (!current[key] || (explicit && implicit[key])) {
      current[key] = chunk;
      implicit[key] = !explicit;
      return;
    }
    if (current[key] === chunk) return;
    current[key] = `${current[key]}\n\n${chunk}`;
  };

  for (const node of nodes) {
    if (node.kind === "skip") continue;
    if (node.kind === "divider") {
      if (hasContent()) flush();
      continue;
    }

    const normalized = normalizeLessonText(node.text || "");
    const dated = node.kind === "heading" ? splitDateHeading(normalized) : null;
    const labeledSource = dated ? dated.rest : normalized;
    const pieces = splitLabeled(labeledSource);

    const applyLabeled = (parts, activeField) => {
      let active = activeField;
      for (const part of parts) {
        if (part.field) {
          active = part.field;
          field = part.field;
          continue;
        }
        if (!part.text) continue;
        if (active) assign(active, part.text, true);
        else assign("topic", part.text, true);
      }
    };

    if (dated && !pieces) {
      if (hasContent()) flush();
      current.date = dated.date;
      if (dated.rest) assign("topic", dated.rest, true);
      field = null;
      continue;
    }
    if (dated && pieces) {
      if (hasContent()) flush();
      current.date = dated.date;
      field = null;
      applyLabeled(pieces, null);
      continue;
    }
    if (pieces) {
      applyLabeled(pieces, field);
      continue;
    }

    const inline = matchInlineField(normalized);
    if (inline) {
      field = inline.field;
      if (inline.value) assign(inline.field, inline.value, true);
      continue;
    }
    const label = matchFieldLabel(normalized);
    if (label) {
      field = label;
      continue;
    }

    if (node.kind === "heading") {
      if (node.level <= 2 && hasContent()) flush();
      assign(field || "topic", normalized, Boolean(field));
      if (!field) field = null;
      continue;
    }

    if (field) assign(field, normalized, true);
    else if (!current.topic) assign("topic", normalized, false);
    else if (!current.bigIdea) assign("bigIdea", normalized, false);
    else if (!current.useCase) assign("useCase", normalized, false);
    else assign("proTip", normalized, false);
  }

  if (hasContent()) flush();
  return lessons;
}

function looseLesson(blocks, context) {
  const texts = flattenLearning(blocks)
    .filter((node) => node.kind === "text" || node.kind === "heading")
    .map((node) => stripEmoji(node.text))
    .filter(Boolean);
  const lesson = emptyLesson();
  lesson.date = extractDate(context.title || "") || context.date || null;
  lesson.topic = (context.title || "").trim();
  const body = texts.filter((text) => text !== lesson.topic && !matchFieldLabel(text));
  if (!lesson.topic && body.length) lesson.topic = body.shift();
  if (body[0]) lesson.bigIdea = body[0];
  if (body[1]) lesson.useCase = body[1];
  if (body[2]) lesson.proTip = body.slice(2).join("\n\n");
  return usableLesson(lesson);
}

export function lessonsFromPage(blocks, context = {}) {
  const structured = parseLessonBlocks(blocks);
  if (structured.length === 1) {
    const lesson = { ...structured[0] };
    if (!lesson.topic && context.title) lesson.topic = context.title.trim();
    if (!lesson.date) lesson.date = extractDate(context.title || "") || context.date || null;
    const usable = usableLesson(lesson);
    return usable ? [usable] : [];
  }
  if (structured.length > 1) return structured;
  const loose = looseLesson(blocks, context);
  return loose ? [loose] : [];
}

export function assembleLessons({ pageBlocks = [], childPages = [] } = {}) {
  const lessons = [...parseLessonBlocks(pageBlocks)];
  for (const child of childPages) {
    lessons.push(
      ...lessonsFromPage(child.blocks || [], {
        title: child.title || "",
        date: child.date || null,
      }),
    );
  }
  return sortLessons(dedupeLessons(lessons.filter(Boolean)));
}

export function parseLearningDatabase(pages) {
  const lessons = [];
  for (const page of pages || []) {
    const props = page?.properties || {};
    const chosen = {};
    let titleText = "";
    for (const [name, prop] of Object.entries(props)) {
      if (prop?.type === "title") titleText = propToString(prop);
      const matched = matchProp(name);
      if (!matched) continue;
      const value = propToString(prop);
      if (!value) continue;
      const previous = chosen[matched.key];
      if (!previous || matched.rank > previous.rank) {
        chosen[matched.key] = { rank: matched.rank, value };
      }
    }
    const lesson = emptyLesson();
    lesson.topic = chosen.topic?.value || titleText || "";
    lesson.bigIdea = chosen.bigIdea?.value || "";
    lesson.useCase = chosen.useCase?.value || "";
    lesson.proTip = chosen.proTip?.value || "";
    const dateValue = chosen.date?.value || "";
    lesson.date = extractDate(dateValue) || extractDate(lesson.topic) || null;
    if (!lesson.date && page?.created_time) lesson.date = perthISODate(page.created_time);
    const usable = usableLesson(lesson);
    if (usable) lessons.push(usable);
  }
  return sortLessons(lessons);
}

export function resultTitle(result) {
  if (!result) return "";
  if (result.object === "database" || Array.isArray(result.title)) {
    return richText(result.title).trim();
  }
  const props = result.properties || {};
  for (const prop of Object.values(props)) {
    if (prop?.type === "title") return richText(prop.title).trim();
  }
  return "";
}

export function pickLearningResult(results) {
  const ranked = [];
  for (const result of results || []) {
    const title = resultTitle(result).replace(/\s+/g, " ").trim();
    const normalised = title.toLowerCase();
    let score = 0;
    if (normalised === "daily learning") score = 100;
    else if (normalised.includes("daily learning")) score = 60;
    if (!score) continue;
    ranked.push({ result, score, edited: result.last_edited_time || "" });
  }
  ranked.sort((a, b) => b.score - a.score || (a.edited < b.edited ? 1 : a.edited > b.edited ? -1 : 0));
  return ranked[0]?.result || null;
}

export function findChildDatabases(blocks, found = []) {
  for (const block of blocks || []) {
    if (block?.type === "child_database") {
      found.push({ id: block.id, title: block.child_database?.title || "" });
    }
    if (block?.children?.length) findChildDatabases(block.children, found);
  }
  return found;
}

export function findChildPageRefs(blocks, found = []) {
  for (const block of blocks || []) {
    if (block?.type === "child_page") {
      found.push({
        id: block.id,
        title: block.child_page?.title || "",
        created: block.created_time || null,
      });
    }
    if (block?.children?.length) findChildPageRefs(block.children, found);
  }
  return found;
}
