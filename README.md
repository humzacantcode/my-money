# My Money

A private, offline finance tracker. Plain HTML/CSS/JS, no build step, no backend. All data is stored in your browser's `localStorage` on your device.

## Files
`index.html`, `style.css`, `app.js`, `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.

## Host it free on GitHub Pages
1. Create a GitHub account → **New repository** (e.g. `my-money`). Public is fine; the repo holds only the app code, never your data.
2. Upload every file in this folder (keep the `icons/` folder) via **Add file → Upload files**, then commit.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save.**
4. After about a minute your app is at `https://<your-username>.github.io/my-money/`.

(Netlify Drop or Cloudflare Pages also work — drag the folder in.)

## Add it to your iPhone home screen
1. Open the URL in **Safari** (must be Safari, not Chrome).
2. Tap **Share → Add to Home Screen → Add**.
3. Launch it from the icon. After the first load it works offline.

Your data lives in the home-screen app's own storage. It is **separate** from the Safari tab's storage, so enter/import your data inside the installed app.

## First run
The app starts empty. In the installed app go to **Settings → Import backup** and pick your backup file (keep it out of the hosted folder), or enter everything by hand.

## Checklist after importing
- **Pay schedule** → set a real payday date (the default is a placeholder). This drives pay periods, family-check vs. regular check, and bonus (3rd) checks.
- **Subscriptions** → set each billing day (they all start on the 1st).
- **Debts → Edit** → check each debt’s rate, minimum payment and any 0% promo end date.
- Optional: set a **PIN**.

## Backups
**Settings → Export backup** saves a JSON file (on iPhone: the share sheet → Save to Files). **Import backup** restores it. Export after big changes; clearing Safari data or deleting the app erases everything.

## Updating the app
Edit the files, bump `CACHE` in `sw.js` (e.g. `mymoney-v2`), and push. Installed copies pick up the update on the next launch or two. Your data is not touched.

## How the numbers work
- Pay period = 14 days from your payday anchor. Budgets per period: gas, food, fun and car are half the monthly amount; family is the full amount in the first check of each month.
- Templates: **Family check** = family + gas + food + tax + other debt minimums, remainder → first unpaid debt. **Regular check** = subscriptions + car + fun + buffer + gas + food + tax, remainder → first unpaid debt. **Bonus check** = gas + food, remainder → debt.
- Projections run month by month: each debt gets its planned payment, and money freed by a paid-off debt rolls to the next one in order. A debt flagged “gets the tax-fund money” receives the monthly tax amount once the fund is complete or tax day passes.
- Spending bars turn yellow at 75% and red at 100%.
