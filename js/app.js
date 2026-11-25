const STORAGE_KEY = "nexus.goals.v1";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dataUrl = new URL("../data/data.json", import.meta.url);

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "hidden") node.hidden = true;
    else if (key === "checked" || key === "disabled") node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function perthHour(date) {
  const part = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((item) => item.type === "hour");
  return Number(part?.value ?? "0") % 24;
}

function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Good night";
}

function renderClock() {
  const now = new Date();
  const hour = perthHour(now);
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const clock = document.querySelector("#clock");
  clock.textContent = time;
  clock.dateTime = now.toISOString();
  document.querySelector("#date-line").textContent = date;
  document.querySelector("#greeting").textContent = `${greetingFor(hour)}, Brody`;
}

function startClock() {
  renderClock();
  setInterval(renderClock, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderClock();
  });
}

function startParticles() {
  const canvas = document.querySelector("#particles");
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  const dots = Array.from({ length: mobile ? 28 : 64 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.5 + 0.4,
    v: Math.random() * 0.00012 + 0.00004,
    wobble: Math.random() * Math.PI * 2,
    color: Math.random() < 0.7 ? "62, 240, 255" : Math.random() < 0.5 ? "255, 61, 203" : "176, 140, 255",
  }));
  let width = 0;
  let height = 0;
  let frame = 0;
  let running = false;
  const scale = Math.min(window.devicePixelRatio || 1, 1.75);

  function resize() {
    width = Math.max(1, Math.floor(window.innerWidth * scale));
    height = Math.max(1, Math.floor(window.innerHeight * scale));
    canvas.width = width;
    canvas.height = height;
  }

  function loop() {
    if (!running) return;
    context.clearRect(0, 0, width, height);
    for (const dot of dots) {
      dot.y -= dot.v;
      dot.x += Math.sin(dot.wobble + dot.y * 12) * 0.00015;
      if (dot.y < 0) {
        dot.y = 1;
        dot.x = Math.random();
      }
      context.beginPath();
      context.fillStyle = `rgba(${dot.color}, 0.75)`;
      context.arc(dot.x * width, dot.y * height, dot.r * scale, 0, Math.PI * 2);
      context.fill();
    }
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    loop();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  resize();
  start();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyGoals() {
  return { active: [], wins: [] };
}

function cleanGoalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normaliseBackup(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("That file is not a NEXUS goals backup.");
  }
  if (data.kind && data.kind !== "nexus-goals") {
    throw new Error("That file is not a NEXUS goals backup.");
  }
  if (!Array.isArray(data.active) || !Array.isArray(data.wins)) {
    throw new Error("That file is not a NEXUS goals backup.");
  }
  if (data.active.length + data.wins.length > 500) {
    throw new Error("That backup has too many goals to import.");
  }
  const used = new Set();
  const takeId = (id) => {
    if (typeof id === "string" && id && !used.has(id)) {
      used.add(id);
      return id;
    }
    let next = uid();
    while (used.has(next)) next = uid();
    used.add(next);
    return next;
  };
  const now = new Date().toISOString();
  const active = [];
  for (const item of data.active) {
    const text = cleanGoalText(item?.text);
    if (!text) continue;
    active.push({
      id: takeId(item?.id),
      text,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : now,
    });
  }
  const wins = [];
  for (const item of data.wins) {
    const text = cleanGoalText(item?.text);
    if (!text) continue;
    wins.push({
      id: takeId(item?.id),
      text,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : now,
      completedAt: typeof item?.completedAt === "string" ? item.completedAt : now,
    });
  }
  return { active, wins };
}

let goals = emptyGoals();
let toastTimer = 0;

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3200);
}

function sortedGoals() {
  return {
    active: [...goals.active].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    wins: [...goals.wins].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)),
  };
}

function saveGoals() {
  goals = sortedGoals();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...goals }));
  } catch {
    toast("This browser could not save your goals. Export a backup.");
  }
}

function loadGoals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    goals = raw ? normaliseBackup(JSON.parse(raw)) : emptyGoals();
  } catch {
    goals = emptyGoals();
  }
}

function winLabel(count) {
  return count === 1 ? "1 win" : `${count} wins`;
}

function formatPerthDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function renderGoals() {
  const view = sortedGoals();
  const list = document.querySelector("#goal-list");
  const empty = document.querySelector("#goal-empty");
  list.replaceChildren();
  empty.hidden = view.active.length > 0;
  for (const goal of view.active) {
    list.append(
      h("li", { class: "goal", "data-id": goal.id }, [
        h("label", { class: "checkline" }, [
          h("input", { type: "checkbox", "aria-label": `Mark done: ${goal.text}` }),
          h("span", { class: "box", "aria-hidden": "true" }),
          h("span", { class: "text", text: goal.text }),
        ]),
        h("button", {
          type: "button",
          class: "btn btn-small btn-ghost",
          "data-remove": goal.id,
          text: "Remove",
        }),
      ]),
    );
  }

  const wins = document.querySelector("#win-list");
  const winEmpty = document.querySelector("#win-empty");
  document.querySelector("#win-count").textContent = winLabel(view.wins.length);
  wins.replaceChildren();
  winEmpty.hidden = view.wins.length > 0;
  for (const win of view.wins) {
    const when = formatPerthDay(win.completedAt);
    wins.append(
      h("li", { class: "win", "data-id": win.id }, [
        h("span", { class: "box on", "aria-hidden": "true" }),
        h("span", { class: "text", text: win.text }),
        h("span", { class: "count", text: when ? `Completed ${when}` : "Completed" }),
        h("button", {
          type: "button",
          class: "btn btn-small btn-ghost",
          "data-undo": win.id,
          text: "Undo",
        }),
      ]),
    );
  }
}

function addGoal(text) {
  const clean = cleanGoalText(text);
  if (!clean) return;
  goals.active.unshift({ id: uid(), text: clean.slice(0, 200), createdAt: new Date().toISOString() });
  saveGoals();
  renderGoals();
  toast("Goal added.");
}

function completeGoal(id) {
  const goal = goals.active.find((item) => item.id === id);
  if (!goal) return;
  goals.active = goals.active.filter((item) => item.id !== id);
  goals.wins.unshift({ ...goal, completedAt: new Date().toISOString() });
  saveGoals();
  renderGoals();
  toast("Moved to the Hall of Wins.");
}

function undoWin(id) {
  const win = goals.wins.find((item) => item.id === id);
  if (!win) return;
  goals.wins = goals.wins.filter((item) => item.id !== id);
  const { completedAt, ...goal } = win;
  goals.active.unshift(goal);
  saveGoals();
  renderGoals();
  toast("Moved back to Goals.");
}

function removeGoal(id) {
  const goal = goals.active.find((item) => item.id === id);
  if (!goal) return;
  if (!window.confirm("Remove this goal? It will not be saved in the Hall of Wins.")) return;
  goals.active = goals.active.filter((item) => item.id !== id);
  saveGoals();
  renderGoals();
  toast("Goal removed.");
}

function exportGoals() {
  const payload = {
    kind: "nexus-goals",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...sortedGoals(),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: "nexus-goals-backup.json" });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded.");
}

function importGoals(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = normaliseBackup(JSON.parse(String(reader.result)));
      if (!window.confirm("Replace the goals and wins saved in this browser with this file?")) return;
      goals = next;
      saveGoals();
      renderGoals();
      const tally = (count, one, many) => `${count} ${count === 1 ? one : many}`;
      toast(
        `Imported ${tally(next.active.length, "open goal", "open goals")} and ${tally(next.wins.length, "win", "wins")}.`,
      );
    } catch (error) {
      toast(error.message || "That file could not be read.");
    }
  };
  reader.onerror = () => toast("That file could not be read.");
  reader.readAsText(file);
}

function bindGoals() {
  document.querySelector("#goal-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#goal-input");
    addGoal(input.value);
    input.value = "";
    input.focus();
  });
  document.querySelector("#goal-list").addEventListener("change", (event) => {
    const row = event.target.closest("[data-id]");
    if (event.target.matches('input[type="checkbox"]') && row) completeGoal(row.dataset.id);
  });
  document.querySelector("#goal-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (button) removeGoal(button.dataset.remove);
  });
  document.querySelector("#win-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-undo]");
    if (button) undoWin(button.dataset.undo);
  });
  document.querySelector("#export-goals").addEventListener("click", exportGoals);
  const fileInput = document.querySelector("#import-file");
  document.querySelector("#import-goals").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) importGoals(file);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    loadGoals();
    renderGoals();
  });
}

function taskList(items, emptyText) {
  if (!items.length) return h("p", { class: "empty", text: emptyText });
  const list = h("ul", { class: "task-list" });
  for (const item of items) {
    list.append(
      h("li", { class: item.checked ? "task is-done" : "task" }, [
        h("span", { class: item.checked ? "box on" : "box", "aria-hidden": "true" }),
        h("span", { class: "text" }, [
          h("span", { class: "sr-only", text: item.checked ? "Done. " : "Not done. " }),
          item.text || "",
        ]),
      ]),
    );
  }
  return list;
}

function formatISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return "Undated";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "Undated";
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function formatPerthStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  const formatted = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `Last synced ${formatted} Perth`;
}

function lessonCards(lesson) {
  const grid = h("div", { class: "lesson-grid" });
  const cards = [
    ["idea", "The Big Idea", lesson.bigIdea],
    ["use", "Practical Use Case", lesson.useCase],
    ["tip", "Pro Tip", lesson.proTip],
  ];
  for (const [tone, label, value] of cards) {
    if (!value) continue;
    grid.append(
      h("article", { class: "subcard", "data-tone": tone }, [
        h("h3", { text: label }),
        h("p", { text: value }),
      ]),
    );
  }
  return grid;
}

function renderFeatured(lesson) {
  return h("article", { class: "featured" }, [
    h("div", { class: "meta-row" }, [
      h("span", { class: "pill hot", text: "Latest" }),
      h("span", { class: "pill", text: formatISODate(lesson.date) }),
    ]),
    h("h3", { class: "lesson-title", text: lesson.topic || "Untitled lesson" }),
    lessonCards(lesson),
  ]);
}

function renderArchiveLesson(lesson) {
  const summary = h("summary");
  summary.append(h("span", { class: "past-date", text: formatISODate(lesson.date) }));
  summary.append(h("span", { class: "past-topic", text: lesson.topic || "Untitled lesson" }));
  return h("details", { class: "past-lesson" }, [summary, lessonCards(lesson)]);
}

function renderDaily(data) {
  const section = data.dailyTodos || {};
  const count = document.querySelector("#daily-count");
  const mount = document.querySelector("#daily-mount");
  if (section.error) {
    count.hidden = true;
    mount.replaceChildren(h("p", { class: "empty", text: section.error }));
    return;
  }
  const items = Array.isArray(section.items) ? section.items : [];
  const open = items.filter((item) => !item.checked).length;
  count.hidden = false;
  count.textContent = open === 1 ? "1 open" : `${open} open`;
  mount.replaceChildren(taskList(items, "Nothing on today's list. Enjoy the clear space."));
}

function renderOngoing(data) {
  const section = data.todos || {};
  const mount = document.querySelector("#ongoing-mount");
  if (section.error) {
    mount.replaceChildren(h("p", { class: "empty", text: section.error }));
    return;
  }
  const todo = Array.isArray(section.todo) ? section.todo : [];
  const done = Array.isArray(section.done) ? section.done : [];
  const column = (title, items, emptyText) =>
    h("div", { class: "column" }, [
      h("div", { class: "column-head" }, [
        h("h3", { text: title }),
        h("span", { class: "count", text: String(items.length) }),
      ]),
      taskList(items, emptyText),
    ]);
  mount.replaceChildren(
    h("div", { class: "split" }, [
      column("To do", todo, "Nothing waiting here."),
      column("Done", done, "Nothing finished yet."),
    ]),
  );
}

function renderLearning(data) {
  const learning = data.learning || {};
  const mount = document.querySelector("#learning-mount");
  if (learning.error) {
    mount.replaceChildren(h("p", { class: "empty", text: learning.error }));
    return;
  }
  const lessons = Array.isArray(learning.lessons) ? learning.lessons : [];
  if (!lessons.length) {
    const message = learning.found
      ? "The Daily Learning page is connected, but there isn't a lesson to show yet. Add a date, Today's Topic, The Big Idea, a Practical Use Case, and a Pro Tip."
      : "No Daily Learning page yet. When your AI mentor adds a Notion page titled Daily Learning, and you share it with the NEXUS integration, the newest lesson will show up here.";
    mount.replaceChildren(h("p", { class: "empty", text: message }));
    return;
  }
  const [latest, ...older] = lessons;
  const pieces = [renderFeatured(latest)];
  if (older.length) {
    const summary = h("summary", {
      text: older.length === 1 ? "1 earlier lesson" : `${older.length} earlier lessons`,
    });
    const stack = h("div", { class: "archive-list" });
    for (const lesson of older) stack.append(renderArchiveLesson(lesson));
    pieces.push(h("div", { class: "archive" }, [h("details", {}, [summary, stack])]));
  }
  mount.replaceChildren(...pieces);
}

function applySource(data) {
  const example = data.source !== "notion" || data.notionConnected === false;
  document.body.dataset.notion = example ? "example" : "live";
  document.querySelectorAll("[data-example]").forEach((node) => {
    node.hidden = !example;
  });
  document.querySelector("#link-dot").classList.toggle("live", !example);
  document.querySelector("#link-state").textContent = example
    ? "Notion not connected yet"
    : "Notion connected";
  document.querySelector("#sync-line").textContent = data.syncedAt
    ? formatPerthStamp(data.syncedAt)
    : "Not synced yet";

  const banner = document.querySelector("#banner");
  const errors = [data.dailyTodos?.error, data.todos?.error, data.learning?.error].filter(Boolean);
  if (example) {
    banner.hidden = false;
    banner.textContent =
      "Notion not connected yet. These lists and lessons are example data, so you can see how NEXUS works. Your real Notion pages will replace them after the token is added.";
  } else if (errors.length) {
    banner.hidden = false;
    banner.textContent =
      "Some Notion pages could not be read. Share them with the NEXUS integration, then run Sync Notion data from the Actions tab.";
  } else {
    banner.hidden = true;
    banner.textContent = "";
  }
}

function renderNotion(data) {
  applySource(data || {});
  renderDaily(data || {});
  renderOngoing(data || {});
  renderLearning(data || {});
}

async function loadNotion() {
  try {
    const response = await fetch(dataUrl, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not load data (${response.status})`);
    renderNotion(await response.json());
  } catch {
    document.body.dataset.notion = "error";
    const banner = document.querySelector("#banner");
    banner.hidden = false;
    banner.textContent = "The dashboard lists could not be loaded. Goals saved on this device still work.";
    document.querySelector("#link-state").textContent = "Lists unavailable";
    document.querySelector("#sync-line").textContent = "Not synced yet";
    for (const id of ["#daily-mount", "#ongoing-mount", "#learning-mount"]) {
      document.querySelector(id).replaceChildren(h("p", { class: "empty", text: "Could not load this section." }));
    }
  }
}

startClock();
startParticles();
loadGoals();
bindGoals();
renderGoals();
loadNotion();
