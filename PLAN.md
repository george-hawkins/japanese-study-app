# Daruma: plan

Daruma (the repo is `japanese-study-app`) is a small installable web app (PWA) for Japanese study chores. This is a living document. It records the requirements, decisions and status so that work can carry on across separate sessions. Update it whenever something is decided or built.

## Status

- [x] Requirements and design agreed (below)
- [x] App shell: manifest, network-first service worker, top bar with tabs, sync indicator, settings page
- [x] Local persistence (localStorage, prefixed `daruma:`)
- [x] GitHub sync (Contents API, fine-grained token)
- [x] Forgotten kanji activity
- [x] Corrections activity
- [x] Icons (192/512 `any`, 512 `maskable`, 180 Apple touch icon) from `design/icon.svg`
- [x] Tested in headless Chrome (drawing, add, swipe-to-done + undo, tap-to-edit, Enter for new line, sync scenarios against a mocked GitHub API)
- [ ] GitHub Pages enabled (George, see below)
- [ ] Notes repo + token created and entered in Settings (George)
- [x] Multi-instance sync with three-way merge (0.7). Unit tests: `node --test` (in `test/`).
- [ ] Try it on the phone; tune brush width (`BRUSH` in `js/kanji.js`) and anything else that feels off

## Requirements (the "what")

1. **A phone app for small, quick study chores.** It's used on Android, and is iOS-friendly where that's cheap. It must open instantly, work offline, and look like a native app (launcher icon, splash screen, no browser chrome).
2. **Nothing typed or ticked off is ever lost.** That holds when switching away, when Android kills the app, when there's no network, and when a new version is deployed.
3. **Data is stored as visible, versioned Markdown files on GitHub**, in a separate notes repo.
4. **Forgotten kanji:** a fast capture list of English keywords, newest at the top. The scroll position is remembered. Next to it is a finger-drawing scratch pad with a fixed black round brush and a single Clear button (no undo, no options). The list can be hidden. Entries can be edited or deleted, though this is very rare.
5. **Corrections:** two lists of one-line notes, "Corrections" (top ⅔) and "Maybe" (bottom ⅓). New items go at the top. Editing should be as easy as in a textarea. Marking an item done is quick. Done items are hidden in the app but kept in the file under `## Done`.
6. **Settings:** the GitHub URLs of the two files, and the access token.
7. **Hosting:** fully static, on GitHub Pages from this repo, updated by pushing.

## Decisions

### Stack
- Plain HTML, CSS and JavaScript ES modules. No framework and **no build step**: the repo *is* the site.
- **Version:** `js/version.js` holds `VERSION`, shown in Settings → About. Bump it in every commit that changes the app, so the running version can be checked on the phone.
- Files: `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `js/` (`app.js` wiring, `store.js` localStorage, `markdown.js` parse/serialize, `github.js` API client, `sync.js` sync logic, `settings.js`, `ui.js` snackbar/dialogs/gestures, `kanji.js`, `corrections.js`), `icons/`, `design/icon.svg` (icon source).

### Persistence and sync
- **Local first.** Every change is written to localStorage immediately. This is what guarantees nothing is lost, and it costs nothing. Text being typed in the "add" boxes is saved as a draft too. The service worker only caches the app's code, not data.
- All `*.github.io` project sites share one origin, so all keys are prefixed `daruma:`.
- **GitHub is a sync target.** Pushes (one commit each) happen when the app goes to the background, 60 s after the last edit, or when the sync indicator is tapped. Pulls happen on open, on returning to the app or the window regaining focus (if more than 30 s since the last pull), and every 5 minutes while visible (skipped while an input has focus). An interrupted push leaves the doc "dirty" and is retried next time.
- **Several instances edit the same files** (George adds corrections on his phone and marks them done in a laptop browser later; he also occasionally edits files on GitHub). Switching is slow and best effort is fine. Design, from 0.7:
  - Each doc stores `sha` (the blob it last synced) and `base` (that blob's parsed content). No git history beyond that is needed: `base` is the common ancestor for a three-way merge.
  - File changed on GitHub, no local changes: take GitHub's version.
  - Changed on both sides: `merge3(base, local, remote)` in `js/merge.js`, then push the result and show a notice. The merge works per item text, deciding which list it ends up in. One side changed it: take that. Both made the same change: take it. Both changed it differently: never lose the item, and prefer this device's list. Edits are remove-plus-add, so "edited here, marked done there" keeps both. New arrivals go at the top of their list (this device's first), then the rest in GitHub's order. Identical lines collapse into one.
  - First sync with a file URL: base = empty, so the merge is a union.
  - Docs synced by older versions have no `base`. It is fetched from GitHub by sha (`git/blobs/{sha}`), falling back to empty (union).
  - Writes send the base `sha`, so GitHub rejects them (409/422) if another instance pushed in between. The sync then re-reads, re-merges and retries (up to 3 attempts). The quick push on hide doesn't read first; if it's rejected, the next full sync merges.
  - Header, preamble and unknown sections can only change on GitHub, so GitHub's are kept.
  - 0.6's "which version do you want to keep?" prompt was replaced by this merge.
- Settings → *Sync details* shows, per document, the item count, whether there are unpushed changes, the last known GitHub blob sha and the result of the last sync. A missing file is created on the first sync, even when there is nothing new to push.
- Sync indicator: a line-icon cloud with a tick (synced), an up arrow (pending; pulsing while syncing), a slash (offline / not set up) or "!" (error). Tapping it shows the status and syncs now.
- Help: the ? button in the top bar opens a dialog. Its content is the `<template id="help">` in `index.html`; keep it in step with the gestures.

### Authentication
- A **fine-grained personal access token**, pasted into Settings. It is limited to the notes repo, with *Contents: Read and write* permission only.
- Why not "Sign in with GitHub": GitHub's OAuth needs a client secret (i.e. a server), and its token endpoints don't allow browser (CORS) requests. Google supports browser-only OAuth clients, which is why Google Drive sign-in works from static sites. This was considered and rejected: no server component.
- The token is stored in localStorage. It is readable by other project sites on the same origin, hence the narrow scope.

### File formats
- `forgotten.md`:
  ```
  # Forgotten kanji

  * apply
  * discard
  ```
- `corrections.md`:
  ```
  ## Corrections

  * Intelligent clue --> not CLEVER

  ## Maybe

  * Switch to Hawaii story for young

  ## Done

  * Discard clue: not DISPOSE
  ```
- Newest first in all lists. Text before the first section and unknown `##` sections are kept verbatim. `*` and `-` bullets are both accepted, and `*` is written.

### Navigation
- A top bar with tabs **Kanji | Corrections**, the sync indicator, and ⚙ for Settings. There's no hamburger menu until there's more to put in it.
- Navigation stays at the top (not bottom navigation) so it isn't hit while drawing. The last page shown is remembered.

### Forgotten kanji
- Left third: an add box at the top (Enter adds the entry at the top; focus stays in the box for the next word), with the list below it. Long-press an entry → Edit / Delete.
- ◀/▶ button hides or shows the list (remembered). The scroll position is saved and restored.
- Canvas: Pointer Events, `touch-action: none`, high-DPI, coalesced events plus quadratic smoothing. Only the first finger draws.
- Brush diameter = `BRUSH` (0.035) × the canvas's shorter side. The reference image is ~4.9 % of the kanji's size, and this gives ~4 %.
- The drawing is **not** preserved (George: drawings are throwaway). It does survive the canvas resizing, e.g. when the keyboard opens.

### Corrections
- Each list has an add box at the top. Enter adds the item and keeps focus, so several items can be typed in a row.
- Tap a row to edit it in place (the caret goes where you tap). Enter starts a new row below it. Rows left empty are removed.
- **Swipe a row either way → done**, with an **Undo** snackbar.
- Long-press → Move to the other list / Mark done / Delete.

### Updates without losing state
- `sw.js` is network-first (3 s timeout, then the cache). When online, the latest deployed version is always used, so there's no cache version number to bump on deploy. Offline, the cached copy is used.
- Data in localStorage is never touched by updates. If the data format ever changes, add a migration (each doc's state is `{data, dirty, sha, syncedUrl, rev}`).
- If a new file is added to the app, add it to `SHELL` in `sw.js` so it's available offline.

### iOS
- Included: `apple-touch-icon`, `apple-mobile-web-app-*` meta tags, safe-area insets.
- Skipped: per-device `apple-touch-startup-image` splash screens.
- iOS clears storage of non-installed sites after 7 days unused; home-screen apps are exempt, and GitHub has the data anyway.

### Visual design
- Concept: *genkō yōshi* (red-ruled Japanese manuscript paper) with the daruma's colours.
  - Daruma red `#b5162b`: top bar and primary buttons.
  - Gold `#e6c877` / `#c9a14a`: the active tab and Undo.
  - White paper, with pale vermilion rules (`#efcbc5`, `#e2a59c`) for list lines and guides.
- The drawing pad is plain white with no guides. (A practice square with a dashed 十 guide was tried in 0.5.0 and removed at George's request.)
- Swiping a correction reveals a 済 ("done") seal. "Maybe" sits on faintly tinted paper, with a muted heading, to show it's lower priority.
- Line-style SVG icons: a cloud with a state mark for sync, sliders for settings.
- System fonts only (Roboto and Noto Sans CJK on Android). Sentence-case headings, no all-caps labels.
- Screenshots at Pixel 8a size (412×915 CSS px, DPR 2.625) are in `design/screenshots/`.

### Icon
- A daruma doll with one eye painted in. Traditionally you paint one eye when you set a goal and the other when you achieve it. The belly has 学 in gold, on a cream background (`#f3ead7`, also the splash background). Theme colour `#c8102e`.
- Source: `design/icon.svg`. PNGs were rendered with headless Chrome: the `maskable` version scales the artwork to 86 % to sit inside the safe zone. The 学 relies on a Japanese font at render time (Hiragino on macOS). To regenerate: `design/render-icons.sh`.

## Setup

### GitHub Pages (once)
1. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `master`, folder `/ (root)`, Save.
2. The site is at `https://george-hawkins.github.io/japanese-study-app/`. Each push to `master` redeploys it within a minute or two.
3. `.nojekyll` is present, so files are served as-is. All paths in the app are relative because it's served from a sub-path.

### Notes repo and token (once)
1. Create a repo for the notes, e.g. `george-hawkins/japanese-study-notes` (it can be private). It can be empty; the app creates the files on the first push.
2. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new. Under *Repository access*, choose *Only select repositories* and pick the notes repo. Under *Permissions → Contents*, choose *Read and write*. Pick a long expiry.
3. In the app's Settings, enter `https://github.com/george-hawkins/japanese-study-notes/blob/main/forgotten.md`, the corresponding `corrections.md` URL, and the token, then tap **Save and test**.

### On the phone
Open the site in Chrome → ⋮ → **Add to home screen → Install**.

## Ideas / later
- Background Sync API (Android) to push even after the app is closed. Currently an interrupted push is retried on the next open.
- Long-press drag to reorder items, if ever needed.
