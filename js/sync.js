// Local-first documents with best-effort sync to GitHub.
//
// Every change is written to localStorage immediately; that alone guarantees
// nothing is lost. Pushing to GitHub (one commit per push) happens when the app
// is backgrounded, after PUSH_DELAY without further edits, or on request.
// Pulling happens on open, when the app comes back to the front or the window
// regains focus, and every POLL_INTERVAL while it's visible.
//
// Several instances (phone, laptop) can edit the same files. Each doc keeps
// the sha of the last version it synced and that version's content (`base`).
// If GitHub has moved on:
// - no local changes: take GitHub's version;
// - local changes too: three-way merge base / local / GitHub (see merge.js),
//   then push the result.
// Writes name the sha they're based on, so GitHub rejects a write if another
// instance pushed in between; the sync then re-reads, re-merges and retries.

import { load, save } from './store.js';
import { parseGitHubUrl, getFile, getBlob, putFile } from './github.js';
import { getSettings } from './settings.js';

const PUSH_DELAY = 60_000;
const PULL_INTERVAL = 30_000;
const POLL_INTERVAL = 5 * 60_000;
const PUSH_ATTEMPTS = 3;

const copy = (x) => JSON.parse(JSON.stringify(x));

export class SyncedDoc {
  constructor(name, { urlKey, empty, parse, serialize, merge3, count }) {
    Object.assign(this, { name, urlKey, empty, parse, serialize, merge3, count });
    // state: { data, dirty, rev, syncedUrl, sha, base }. `base` is the content
    // at `sha`; docs saved by versions before 0.7 don't have it.
    this.state = load(`doc:${name}`, null) ?? { data: empty(), dirty: false, sha: null, syncedUrl: null, rev: 0 };
    delete this.state.conflict; // from 0.6
    this.listeners = [];
  }

  get data() { return this.state.data; }

  // Call after mutating `data`.
  changed() {
    this.state.dirty = true;
    this.state.rev++;
    this.persist();
    this.emit('local');
  }

  persist() { save(`doc:${this.name}`, this.state); }
  on(fn) { this.listeners.push(fn); }
  emit(kind) { this.listeners.forEach((fn) => fn(kind)); }
}

export class Syncer {
  constructor(docs, { onStatus, notify }) {
    Object.assign(this, { docs, onStatus, notify });
    this.running = null;
    this.again = false;
    this.error = null;
    this.lastPull = 0;
    this.timer = null;
    this.results = {}; // per doc: { time, text } describing the last sync
    for (const d of docs) {
      d.on((kind) => {
        if (kind !== 'local') return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.sync(), PUSH_DELAY);
        this.report();
      });
    }
  }

  start() {
    const pullIfStale = () => Date.now() - this.lastPull > PULL_INTERVAL && this.sync();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.sync({ quick: true });
      else pullIfStale();
    });
    // On a desktop, switching windows doesn't hide the page, but does blur it.
    window.addEventListener('focus', pullIfStale);
    window.addEventListener('online', () => this.sync());
    window.addEventListener('offline', () => this.report());
    // Keep an always-visible instance (e.g. a laptop tab) from going stale,
    // but don't pull in the middle of typing.
    setInterval(() => {
      if (document.visibilityState === 'visible' && document.activeElement?.tagName !== 'INPUT') this.sync();
    }, POLL_INTERVAL);
    this.sync();
  }

  // quick: push dirty docs only, without first checking GitHub (used when the
  // app is being backgrounded and may be frozen or killed at any moment). If
  // GitHub has moved on, the write is rejected and the next full sync merges.
  sync({ quick = false } = {}) {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        this.report();
        await this.syncAll(quick);
        quick = false;
      } while (this.again);
    })().finally(() => {
      this.running = null;
      this.report();
    });
    this.report();
    return this.running;
  }

  async syncAll(quick) {
    const settings = getSettings();
    const errors = [];
    for (const d of this.docs) {
      if (quick && !d.state.dirty) continue;
      try {
        const text = await (quick ? this.quickPush(d, settings) : this.syncDoc(d, settings));
        this.results[d.name] = { time: new Date(), text };
      } catch (e) {
        if (quick) continue;
        errors.push(`${d.name}: ${e.message}`);
        this.results[d.name] = { time: new Date(), text: `failed: ${e.message}` };
      }
    }
    if (!quick) {
      this.lastPull = Date.now();
      const error = errors.join('\n') || null;
      if (error && error !== this.error) this.notify(`Sync failed: ${error}`, null, 8000);
      this.error = error;
    }
  }

  async quickPush(doc, settings) {
    const url = settings[doc.urlKey];
    const loc = parseGitHubUrl(url);
    if (!loc || !settings.token || doc.state.syncedUrl !== url) return 'skipped';
    return this.push(doc, loc, settings.token, { keepalive: true });
  }

  async syncDoc(doc, settings) {
    const url = settings[doc.urlKey];
    const loc = parseGitHubUrl(url);
    if (!loc || !settings.token) return 'not configured';
    const st = doc.state;
    const file = loc.path.split('/').pop();
    let merged = false;

    for (let attempt = 1; ; attempt++) {
      const remote = await getFile(loc, settings.token);
      const firstSync = st.syncedUrl !== url;

      if (remote && (firstSync || remote.sha !== st.sha)) {
        const theirs = doc.parse(remote.text);
        if (!st.dirty) {
          // Changed on GitHub only: take its version.
          Object.assign(st, { data: theirs, base: copy(theirs), sha: remote.sha, syncedUrl: url });
          doc.persist();
          doc.emit('remote');
          return `took GitHub's version of ${file}`;
        }
        // Changed on both sides: merge. With no known base (first sync with
        // this file), everything counts as added on both sides, i.e. a union.
        const base = firstSync ? doc.empty() : await this.baseOf(doc, loc, settings.token);
        Object.assign(st, { data: doc.merge3(base, st.data, theirs), base: copy(theirs), sha: remote.sha, syncedUrl: url });
        doc.persist();
        doc.emit('remote');
        merged = true;
      } else if (!remote) {
        // Not on GitHub (yet, or deleted there): (re)create it from this device.
        Object.assign(st, { sha: null, base: null, syncedUrl: url });
        doc.persist();
      } else if (!st.dirty) {
        return 'up to date';
      }

      try {
        const result = await this.push(doc, loc, settings.token, { create: !remote });
        if (merged) this.notify(`Merged changes made elsewhere into ${file}`);
        return merged ? `merged with GitHub, then ${result}` : result;
      } catch (e) {
        // 409/422: someone else pushed since we read the file. Re-read and merge.
        if (![409, 422].includes(e.status) || attempt >= PUSH_ATTEMPTS) throw e;
      }
    }
  }

  // The content at the last synced sha: stored locally since 0.7, otherwise
  // fetched from GitHub's history. Falls back to empty (i.e. a union merge).
  async baseOf(doc, loc, token) {
    const st = doc.state;
    if (st.base) return st.base;
    if (st.sha) {
      try {
        const text = await getBlob(loc, token, st.sha);
        if (text !== null) return doc.parse(text);
      } catch { /* fall through */ }
    }
    return doc.empty();
  }

  async push(doc, loc, token, { keepalive = false, create = false } = {}) {
    const st = doc.state;
    const file = loc.path.split('/').pop();
    const rev = st.rev;
    const text = doc.serialize(st.data);
    const sha = await putFile(loc, token, text, st.sha, `Update ${file} from Daruma`, { keepalive });
    st.sha = sha;
    st.base = doc.parse(text);
    if (st.rev === rev) st.dirty = false; // unless edited during the push
    doc.persist();
    return `${create ? 'created' : 'pushed'} ${file} (${sha.slice(0, 7)})`;
  }

  // Human-readable state of each doc, for the settings page.
  details() {
    const s = getSettings();
    return this.docs.map((d) => {
      const st = d.state, r = this.results[d.name];
      const count = d.count(st.data);
      return [
        `${d.name}: ${count} item${count === 1 ? '' : 's'} on this device, ${st.dirty ? 'with changes not yet pushed' : 'no unpushed changes'}`,
        `  file: ${s[d.urlKey] || '(not set)'}`,
        `  last synced GitHub version: ${st.sha ? st.sha.slice(0, 7) : 'none'}`,
        `  last sync: ${r ? `${r.time.toLocaleTimeString()}: ${r.text}` : 'not since the app was opened'}`,
      ].join('\n');
    }).join('\n\n');
  }

  report() {
    const s = getSettings();
    const configured = s.token && this.docs.some((d) => parseGitHubUrl(s[d.urlKey]));
    const dirty = this.docs.some((d) => d.state.dirty);
    let state, label;
    if (!configured) [state, label] = ['off', 'Sync is not set up yet (see settings)'];
    else if (this.running) [state, label] = ['syncing', 'Syncing…'];
    else if (this.error) [state, label] = ['error', `Sync failed: ${this.error}`];
    else if (dirty && !navigator.onLine) [state, label] = ['offline', 'Offline; changes are saved on this device and will be pushed later'];
    else if (dirty) [state, label] = ['pending', 'Changes saved on this device, not yet pushed to GitHub'];
    else [state, label] = ['ok', 'Everything is pushed to GitHub'];
    this.onStatus(state, label);
  }
}
