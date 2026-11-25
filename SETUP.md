# Set up NEXUS

NEXUS is your dashboard: today's to-dos, your bigger to-do list, goals, and daily lessons.

The website address is:

https://captainwild88.github.io/nexus/

Lists and lessons come from Notion. Goals stay on the phone or computer you add them on.

Do these three steps after the NEXUS files are on the main branch.

## 1. Turn on GitHub Pages

This publishes the website.

1. Open https://github.com/captainwild88/nexus
2. Click **Settings**.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.

Then publish it once:

1. Click the **Actions** tab.
2. Click **Deploy to GitHub Pages**.
3. Click **Run workflow**. Leave the branch as **main**, then click the green **Run workflow** button.
4. Wait until the yellow dot turns green.
5. Open https://captainwild88.github.io/nexus/

The first time can take a minute. If you see "page not found", wait a moment and refresh.

Until Notion is connected, the site shows example lists. They are labelled **Example**, and a note says **Notion not connected yet**.

## 2. Create a Notion integration and save the token

The token is a password that lets GitHub read your Notion pages. It stays in GitHub's secret store. It is not written on the website.

1. Open https://www.notion.so/my-integrations
2. Click **New integration**.
3. Name it `NEXUS`. Choose the workspace that has your to-do pages. The type should be **Internal**.
4. Save it.
5. Copy the secret token. Notion calls it the **Internal Integration Secret**. It starts with `ntn_` or `secret_`.
6. Open https://github.com/captainwild88/nexus/settings/secrets/actions
7. Click **New repository secret**.
8. For the name, type exactly `NOTION_TOKEN`
9. Paste the secret into the value box.
10. Click **Add secret**.

## 3. Share your Notion pages with NEXUS

The integration cannot see a page until you invite it.

Share these pages:

- **Daily To-Dos**
- **To-Dos**

When you have a page titled **Daily Learning**, share that too. The hourly update finds it by that exact title. Until the page exists, Daily Learning shows a short empty message. That is normal.

On each page:

1. Open the page in Notion.
2. Click **Share**.
3. Add a connection and choose **NEXUS**.
4. Confirm.

Sharing a page shares what is inside it, including sub-pages.

## What happens next

About once an hour, GitHub reads those pages and updates the site. It only saves a new copy when something actually changed.

To update sooner, open the **Actions** tab, click **Sync Notion data**, then **Run workflow**.

Your goals are not stored in Notion. They are saved in the browser. On the Goals panel, **Export backup** downloads a file. Keep that file somewhere safe. **Import backup** puts it back on a new phone.

One privacy note: this website is public. Anything copied from Notion can be read by anyone with the link. Keep passwords and private details off those pages.
