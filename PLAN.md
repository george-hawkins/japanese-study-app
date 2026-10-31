# Japanese study app: plan

This is a living document. It records the requirements, design decisions and open questions so that work can carry on across separate sessions. Update it whenever a decision is made.

## Status

- [x] Requirements gathered; "what" derived from the original "how" (below)
- [x] Icon draft: `design/icon-draft.svg` / `.png`
- [ ] **Waiting on answers to the open questions (see end of document)**
- [ ] App shell: manifest, service worker, tab bar, settings
- [ ] Local persistence layer
- [ ] GitHub sync layer
- [ ] Forgotten kanji activity
- [ ] Corrections activity
- [ ] Final icons (PNG sizes, maskable, Apple touch icon)
- [ ] GitHub Pages deployment

## The "what" (requirements)

1. **A phone app for small, quick study chores.** It's used on Android and should work on iOS where that's cheap. Opening it must be instant, it must work offline, and it should look like a native app (launcher icon, splash screen, no browser chrome).
2. **Nothing typed or ticked off is ever lost.** That holds when switching away, when Android kills the app in the background, when there's no network, and when a new app version is deployed.
3. **Data ends up somewhere visible and human-editable outside the app.** These are Markdown files on GitHub that other processes, including manual edits, can read and change.
4. **Activity 1, forgotten kanji:** a fast capture list of English keywords for kanji I forgot. The newest entry goes at the top, and the scroll position survives leaving and coming back. Next to it is a scratch pad for writing one kanji at a time with a finger: a fixed black round brush and a single clear button. The list can be hidden to give more room for drawing.
5. **Activity 2, corrections:** two lists of one-line notes, "Corrections" (do soon) and "Maybe" (long-term). Adding at the top and editing in place should feel as easy as a textarea. Marking an item done is a quick gesture. Done items disappear from the UI but are kept in the file under `## Done`.
6. **Settings:** the GitHub location of each Markdown file, and a way to authorise writes.
7. **Hosting:** fully static, served by GitHub Pages from this repo, and updated by pushing.

## Design decisions (proposed; ✅ = agreed)

### Tech stack
- Plain HTML, CSS and JavaScript (ES modules), with no framework and **no build step**. The repo is the site, so Pages can serve it directly from a branch. The app is small enough that a framework would cost more than it saves.

### Persistence: local first, GitHub second
- Correction to the original idea: **service workers don't protect your data.** They cache the app's *code* so it loads offline. User data has to be written to on-device storage (IndexedDB or localStorage) by the page itself.
- Every edit is saved locally **immediately** (synchronously to localStorage, or to IndexedDB on each change). There's no "save on exit" step to miss: Android can kill a backgrounded page without warning, but by then everything has already been written.
- Call `navigator.storage.persist()` so the browser doesn't evict the data under storage pressure. Installed PWAs on Chrome usually get this automatically.
- Local storage is the source of truth for the UI. GitHub is a sync target.
- **Origin caveat:** every project site under `george-hawkins.github.io` shares one origin, so they share localStorage and IndexedDB. Prefix all keys/DB names (e.g. `jsa:`) so other project sites can't clash with ours.

### GitHub sync
- Use the GitHub REST **Contents API**. `GET` returns the file and its `sha`. `PUT` with that `sha` writes a new commit, and if the file changed remotely since our `GET` the write is rejected with 409/422, so remote edits are never silently overwritten.
- When to sync: debounce after edits (e.g. 10 s idle), on `visibilitychange → hidden` (best effort, `fetch(..., {keepalive: true})`), on app open, and on the `online` event. A "dirty" flag in local storage means an interrupted sync is retried next time.
- Pull: on open/focus, `GET` the file. If there are no local unsynced changes, adopt the remote version. If both sides changed, merge (see open question Q4).
- A small sync indicator in the top bar: synced / pending / offline / error. Tapping it forces a sync.
- Each sync creates one commit. Debouncing keeps this to a handful per session. The commit message is something like `Update corrections.md (japanese-study-app)`.
- Background Sync API (Android only) could retry a sync after the app is closed. It adds service worker complexity, so it's deferred; retry-on-next-open is the baseline.

### Authentication (important change from the original idea)
- A proper "Sign in with GitHub" OAuth flow **can't be done from a purely static site.** GitHub's OAuth web flow needs a client secret, i.e. a server. The device flow endpoints don't allow browser (CORS) requests. Working around either means running a small proxy (e.g. a Cloudflare Worker), which conflicts with "no server component".
- Proposal: use a **fine-grained personal access token** limited to *only* the repo holding the Markdown files, with *Contents: read and write* permission and nothing else, and a long expiry. You create it once on github.com and paste it into Settings. The app validates it (test `GET`) and stores it locally.
- The token is readable by any other project site on the same `george-hawkins.github.io` origin, so keep its scope to that single repo.

### Where the Markdown files live
- Recommendation: a **separate repo** (could be private, e.g. `george-hawkins/japanese-study-notes`) rather than this app repo. Otherwise every sync commit would trigger a Pages rebuild and clutter the app's history with note commits. See Q1.

### Navigation
- Top bar with tabs: **Kanji | Corrections**, a sync indicator, and a ⚙ icon for Settings. Settings is a page rather than a tab, and there's no hamburger menu until there's more than one thing to put in it.
- The bar stays at the top rather than Material's usual bottom navigation, because a bottom bar is easy to hit by accident while drawing.

### Forgotten kanji activity
- Left third: an add field at the top, with the list below it, newest first. Right two thirds: the canvas. A toggle button hides or shows the list.
- Canvas: Pointer Events with `touch-action: none` (so the page doesn't scroll or zoom while drawing), scaled for `devicePixelRatio` so lines are sharp, and round caps and joins with light smoothing.
- Brush width is relative to the canvas size, so it looks the same in portrait, landscape and with the list hidden. In the reference image (`/tmp/kanji.png`, 787 px wide) the stroke is ~32 px ≈ 4 % of the width. Target **~3.2 %** of the canvas's shorter side, tuned on the device.
- Clear button only, with no undo, colours or widths.
- Scroll position is saved on scroll (throttled) and restored on load. The current drawing is also saved locally (cheap), so switching apps mid-kanji doesn't wipe it. The drawing is never synced.
- File format (`forgotten.md`):
  ```
  # Forgotten kanji

  * apply
  * discard
  ```

### Corrections activity
- Top two thirds is "Corrections", bottom third is "Maybe", and each part scrolls on its own.
- Each item is its own single-line editable row (an outliner, like a Google Keep checklist) rather than one big textarea, because swipe-to-done needs a separate element per line. Tap to edit in place. Enter at the end of a row creates a new row below it. Backspace on an empty row deletes it. A permanently visible empty row at the top of each list adds new items at the top.
- Swiping a row (either direction) marks it done, and a short-lived **Undo** snackbar appears, because swipes misfire.
- Done items are hidden in the UI and go at the top of `## Done` (newest done first). This keeps the format shown in the original request.
- Moving an item between Corrections and Maybe is possibly a later feature (e.g. long-press).

### App updates without losing state
- Data lives in localStorage/IndexedDB, which app updates never touch. Only the service worker's code cache is replaced.
- The service worker uses a versioned cache. A new version downloads in the background and takes over on the next launch, or immediately via a small "Update available, tap to reload" prompt. Because everything is saved continuously, reloading is always safe.
- Local data gets a schema version so later changes to the data format can be migrated.

### iOS friendliness (cheap parts only)
- `apple-touch-icon`, `apple-mobile-web-app-capable`, status bar style, safe-area insets (`env(safe-area-inset-*)`).
- Skipped: per-device `apple-touch-startup-image` splash screens. They need a dozen device-specific images, so iOS shows a plain background instead.
- Note: iOS Safari wipes storage for sites not used for 7 days, *unless* the app is added to the home screen. GitHub sync covers this anyway.

### Icon
- A **daruma** doll on a washi-cream background, with only one eye painted in. Traditionally you paint in one eye when you set a goal and the second when you achieve it, which suits a study app. The belly has 学 in gold. Draft: `design/icon-draft.svg`.
- To do: convert 学 to a path (no font dependency), then render PNGs at 192/512 (`any` and `maskable`; the daruma already sits inside the maskable safe circle) and 180 (Apple), using headless Chrome. The splash background colour is the same cream (`#f3ead7`), with theme colour daruma red (`#c8102e`) or similar.

## GitHub Pages setup (to do when deploying)

1. Push to `master` on `george-hawkins/japanese-study-app`.
2. On GitHub: repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `master`, folder `/ (root)`. Save.
3. The site appears at `https://george-hawkins.github.io/japanese-study-app/` within a minute or two of each push.
4. Add an empty `.nojekyll` file so Pages serves files as-is, without Jekyll processing.
5. All paths in the app must be relative (`./`), because it's served from a `/japanese-study-app/` sub-path. The manifest's `start_url` and `scope` are `./`.
6. On the phone: open the URL in Chrome → ⋮ → **Add to home screen / Install app**.

## Open questions (for George)

- **Q1** Where should `forgotten.md` and `corrections.md` live: a separate (private?) notes repo (recommended), or this app repo?
- **Q2** Is a pasted fine-grained personal access token OK, or do you want a real OAuth login? A real login means adding a tiny serverless proxy (e.g. a free Cloudflare Worker).
- **Q3** Forgotten kanji list: do entries need editing or deleting in the app? Should each entry record the date it was added (e.g. `* 2026-10-31 apply`)?
- **Q4** Who else edits the files? If the separate corrections process edits `corrections.md` (e.g. moves items to Done), the app needs a real merge. If remote edits are rare, "if both changed: keep local changes, re-apply them on top of remote, and show a notice" is enough.
- **Q5** Is swipe-either-way = done (with Undo) OK, or should the other swipe direction move the item between Corrections and Maybe?
- **Q6** Should the drawing persist across leaving the app? (Proposed: yes, locally only.)
- **Q7** Do you like the daruma?
