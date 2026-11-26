import {
  assembleLessons,
  findChildDatabases,
  findChildPageRefs,
  parseLearningDatabase,
  parseOngoingTodos,
  perthISODate,
} from "./parse-notion.mjs";

export const TODOS_PAGE_ID = "422bc823-fc97-813d-bfb2-cfb693d9102c";
export const LEARNING_PAGE_ID = "423bc823-fc97-81c8-92b9-d3015213b159";

export async function hydrate(blockId, listChildren, depth = 0) {
  const blocks = await listChildren(blockId);
  if (depth >= 4) return blocks;
  for (const block of blocks || []) {
    if (block?.has_children && block.type !== "child_page" && block.type !== "child_database") {
      block.children = await hydrate(block.id, listChildren, depth + 1);
    }
  }
  return blocks || [];
}

function friendly(error) {
  if (error?.status === 404 || /could not find/i.test(error?.message || "")) {
    return "Notion could not find this page. Open it, choose Share, and invite the NEXUS integration.";
  }
  if (error?.status === 403) {
    return "Notion refused access. Open the page, choose Share, and invite the NEXUS integration.";
  }
  return "This list could not be loaded from Notion. Try Refresh in a moment.";
}

async function lessonsFromPage(pageId, listChildren, queryDatabase) {
  const blocks = await hydrate(pageId, listChildren);
  const childRefs = findChildPageRefs(blocks).slice(0, 40);
  const childPages = [];
  for (const child of childRefs) {
    childPages.push({
      title: child.title,
      date: child.created ? perthISODate(child.created) : null,
      blocks: await hydrate(child.id, listChildren),
    });
  }
  let lessons = assembleLessons({ pageBlocks: blocks, childPages });
  if (!lessons.length && queryDatabase) {
    const databases = findChildDatabases(blocks);
    if (databases[0]) lessons = parseLearningDatabase(await queryDatabase(databases[0].id));
  }
  return lessons;
}

export async function buildLists({
  listChildren,
  queryDatabase,
  todosPageId = TODOS_PAGE_ID,
  learningPageId = LEARNING_PAGE_ID,
} = {}) {
  const todos = { title: "To-Dos", todo: [], done: [], error: null };
  const learning = { found: false, lessons: [], error: null };

  try {
    const blocks = await hydrate(todosPageId, listChildren);
    const split = parseOngoingTodos(blocks);
    todos.todo = split.todo;
    todos.done = split.done;
  } catch (error) {
    todos.error = friendly(error);
  }

  try {
    learning.found = true;
    learning.lessons = await lessonsFromPage(learningPageId, listChildren, queryDatabase);
  } catch (error) {
    if (error?.status === 404) learning.found = false;
    learning.error = friendly(error);
  }

  return { todos, learning };
}
