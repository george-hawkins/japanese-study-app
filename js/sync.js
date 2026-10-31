// Local-first documents with best-effort sync to GitHub.
//
// Every change is written to localStorage immediately; that alone guarantees
// nothing is lost. Pushing to GitHub (one commit per push) happens when the app
// is backgrounded, after PUSH_DELAY without further edits, or on request.
// If the file on GitHub has changed and there are no unpushed local edits,
// GitHub's version is taken. If both have changed, the user is asked which to
// keep (or to decide later, in which case nothing is pushed and they're only
// asked again when they sync by hand).

import { load, save } from './store.js';
import { parseGitHubUrl, getFile, putFile } from './github.js';
import { getSettings } from './settings.js';

const PUSH_DELAY = 60_000;
const PULL_INTERVAL = 30_000;

export class SyncedDoc {
  constructor(name, { urlKey, empty, parse, serialize, merge, count }) {
    Object.assign(this, { name, urlKey, parse, serialize, merge, count });
    this.state = load(`doc:${name}`, null) ?? { data: empty(), dirty: false, sha: null, syncedUrl: null, rev: 0 };
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
  constructor(docs, { onStatus, notify, askConflict }) {
    Object.assign(this, { docs, onStatus, notify, askConflict });
    this.running = null;
    this.again = null; // options for a sync requested while one was running
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.sync({ quick: true });
      else if (Date.now() - this.lastPull > PULL_INTERVAL) this.sync();
    });
    window.addEventListener('online', () => this.sync());
    window.addEventListener('offline', () => this.report());
    this.sync();
  }

  // quick: push dirty docs only, without first checking GitHub (used when the
  // app is being backgrounded and may be frozen or killed at any moment).
  // manual: the user asked for this sync, so ask again about deferred conflicts.
  sync({ quick = false, manual = false } = {}) {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = { manual: manual || !!this.again?.manual };
      return this.running;
    }
    this.running = (async () => {
      let opts = { quick, manual };
      while (opts) {
        this.again = null;
        this.report();
        await this.syncAll(opts);
        opts = this.again;
      }
    })().finally(() => {
      this.running = null;
      this.report();
    });
    this.report();
    return this.running;
  }

  async syncAll({ quick, manual }) {
    const settings = getSettings();
    const errors = [];
    for (const d of this.docs) {
      if (quick && (!d.state.dirty || d.state.conflict)) continue;
      try {
        const text = await this.syncDoc(d, settings, quick, manual);
        this.results[d.name] = { time: new Date(), text };
      } catch (e) {
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

  async syncDoc(doc, settings, quick, manual) {
    const url = settings[doc.urlKey];
    const loc = parseGitHubUrl(url);
    if (!loc || !settings.token) return 'not configured';
    const st = doc.state;
    let missing = false; // file doesn't exist on GitHub yet
    const file = loc.path.split('/').pop();

    if (quick) {
      if (st.syncedUrl !== url) return 'skipped (first sync not done yet)';
    } else {
      const remote = await getFile(loc, settings.token);
      const remoteSha = remote?.sha ?? null;
      missing = !remote;
      if (st.syncedUrl !== url) {
        // First sync with this file: combine rather than overwrite anything.
        if (remote) {
          const parsed = doc.parse(remote.text);
          if (st.dirty) {
            st.data = doc.merge(st.data, parsed);
            this.notify(`Combined this device's entries with ${file} on GitHub`);
          } else {
            st.data = parsed;
          }
          doc.emit('remote');
        }
        st.syncedUrl = url;
        st.sha = remoteSha;
        doc.persist();
      } else if (remoteSha !== st.sha) {
        if (!st.dirty && remote) {
          // The safe case: changed on GitHub only.
          st.data = doc.parse(remote.text);
          st.sha = remoteSha;
          doc.persist();
          doc.emit('remote');
          return `took GitHub's version of ${file}`;
        }
        if (st.dirty && remote) {
          // Changed on both sides.
          if (st.conflict === remoteSha && !manual) return 'conflict: waiting for you to choose (tap the cloud)';
          const choice = await this.askConflict(file);
          if (choice === 'remote') {
            st.data = doc.parse(remote.text);
            st.dirty = false;
            st.conflict = null;
            st.sha = remoteSha;
            doc.persist();
            doc.emit('remote');
            return `took GitHub's version of ${file}`;
          }
          if (choice !== 'local') {
            st.conflict = remoteSha;
            doc.persist();
            return 'conflict: waiting for you to choose (tap the cloud)';
          }
        }
        // Keeping the local version (or the file was deleted on GitHub).
        st.conflict = null;
        st.sha = remoteSha;
        doc.persist();
      }
    }

    // Create missing files even when there's nothing new, so a working setup
    // is visible on GitHub straight away.
    if (!st.dirty && !missing) return 'up to date';
    const rev = st.rev;
    const sha = await putFile(loc, settings.token, doc.serialize(st.data), st.sha, `Update ${file} from Daruma`, { keepalive: quick });
    st.sha = sha;
    if (st.rev === rev) st.dirty = false; // unless edited during the push
    st.conflict = null;
    doc.persist();
    return `${missing ? 'created' : 'pushed'} ${file} (${sha.slice(0, 7)})`;
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
        `  last known GitHub version: ${st.sha ? st.sha.slice(0, 7) : 'none'}`,
        `  last sync: ${r ? `${r.time.toLocaleTimeString()}: ${r.text}` : 'not since the app was opened'}`,
      ].join('\n');
    }).join('\n\n');
  }

  report() {
    const s = getSettings();
    const configured = s.token && this.docs.some((d) => parseGitHubUrl(s[d.urlKey]));
    const dirty = this.docs.some((d) => d.state.dirty);
    const conflicts = this.docs.filter((d) => d.state.conflict).map((d) => d.state.syncedUrl.split('/').pop());
    let state, label;
    if (!configured) [state, label] = ['off', 'Sync is not set up yet (see settings)'];
    else if (this.running) [state, label] = ['syncing', 'Syncing…'];
    else if (conflicts.length) [state, label] = ['error', `${conflicts.join(' and ')} changed both here and on GitHub. Tap the cloud to choose which to keep.`];
    else if (this.error) [state, label] = ['error', `Sync failed: ${this.error}`];
    else if (dirty && !navigator.onLine) [state, label] = ['offline', 'Offline; changes are saved on this device and will be pushed later'];
    else if (dirty) [state, label] = ['pending', 'Changes saved on this device, not yet pushed to GitHub'];
    else [state, label] = ['ok', 'Everything is pushed to GitHub'];
    this.onStatus(state, label);
  }
}
