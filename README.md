# NEXUS

Brody's personal dashboard. A dark sci-fi home screen for today's to-dos, ongoing tasks, goals, and daily AI lessons.

**Live site:** https://captainwild88.github.io/nexus/

To-do lists and lessons are read from Notion. Goals and the Hall of Wins stay in the browser, with a JSON backup you can export and import.

New here? Read [SETUP.md](SETUP.md). It walks through turning on GitHub Pages, adding the Notion token, and sharing your pages.

Until the `NOTION_TOKEN` secret exists, the site shows example lists. They are labelled example data, with a note that says Notion is not connected yet.

## For developers

Plain HTML, CSS, and JavaScript. No install step.

```bash
npm test
npm run build
```

`npm run build` writes the site to `_site/`. Serve that folder, or serve the repo root. Opening `index.html` as a file will not load `data/data.json`.

The site uses relative links so it works at `https://captainwild88.github.io/nexus/`.

GitHub Actions:

- `.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`, and when you run it by hand.
- `.github/workflows/sync-notion.yml` reads Notion every hour. If `NOTION_TOKEN` is missing, it exits successfully and leaves the example data in place. It commits `data/data.json` only when the content changed, then starts a Pages deploy.

Page ids used by the sync:

- Daily To-Dos: `420bc823-fc97-8157-bd78-c1a175e4ab8c`
- To-Dos: `422bc823-fc97-813d-bfb2-cfb693d9102c`
- Daily Learning: found by the title `Daily Learning`
