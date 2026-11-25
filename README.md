# NEXUS

Brody's personal dashboard. A dark sci-fi home screen for to-dos, goals, and daily AI lessons.

**Live site:** https://captainwild88.github.io/Nexus/

To-do lists and lessons are read from Notion. Goals stay on this device until the Cloudflare Worker is connected, then they sync through the NEXUS Goals database. Export backup still downloads a copy.

New here? Read [SETUP.md](SETUP.md). It walks through turning on GitHub Pages, adding the Notion token, and sharing your pages.

Until the `NOTION_TOKEN` secret exists, the site shows example lists. They are labelled example data, with a note that says Notion is not connected yet.

## For developers

Plain HTML, CSS, and JavaScript. No install step.

```bash
npm test
npm run build
```

`npm run build` writes the site to `_site/`. Serve that folder, or serve the repo root. Opening `index.html` as a file will not load `data/data.json`.

Assets and `data/data.json` use a relative `./` path, so the site follows the repository name GitHub Pages uses: https://captainwild88.github.io/Nexus/

GitHub Actions:

- `.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`, and when you run it by hand.
- `.github/workflows/sync-notion.yml` reads Notion every hour. If `NOTION_TOKEN` is missing, it exits successfully and leaves the example data in place. It commits `data/data.json` only when the content changed, then starts a Pages deploy.

Page ids used by the sync:

- To-Dos: `422bc823-fc97-813d-bfb2-cfb693d9102c`
- Daily Learning: found by the title `Daily Learning`
