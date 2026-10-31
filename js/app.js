import { load, save } from './store.js';
import { SyncedDoc, Syncer } from './sync.js';
import { parseList, serializeList, emptyList, mergeList3, parseSections, serializeSections, emptySections, mergeSections3 } from './markdown.js';
import { initKanji } from './kanji.js';
import { initCorrections } from './corrections.js';
import { initSettings } from './settings.js';
import { notify, showHelp } from './ui.js';

const kanjiDoc = new SyncedDoc('kanji', {
  urlKey: 'forgottenUrl', empty: emptyList, parse: parseList, serialize: serializeList, merge3: mergeList3,
  count: (d) => d.items.length,
});
const correctionsDoc = new SyncedDoc('corrections', {
  urlKey: 'correctionsUrl', empty: emptySections, parse: parseSections, serialize: serializeSections, merge3: mergeSections3,
  count: (d) => d.corrections.length + d.maybe.length + d.done.length,
});

const statusBtn = document.getElementById('sync-status');
// Line icons: a cloud plus a state mark.
const CLOUD = 'M7.5 19h9.5a4.5 4.5 0 0 0 .9-8.9A6 6 0 0 0 6.3 9.6 4.75 4.75 0 0 0 7.5 19z';
const MARKS = {
  ok: 'M9.4 14.3l1.9 1.9 3.7-3.9',
  pending: 'M12 16.8v-5M9.8 13.8L12 11.6l2.2 2.2',
  syncing: 'M12 16.8v-5M9.8 13.8L12 11.6l2.2 2.2',
  offline: 'M4.5 4.5l15 15',
  off: 'M4.5 4.5l15 15',
  error: 'M12 11.4v3M12 17v.01',
};
const icon = (state) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CLOUD}"/><path d="${MARKS[state]}"/></svg>`;
let statusLabel = '';
const syncer = new Syncer([kanjiDoc, correctionsDoc], {
  notify,
  onStatus(state, label) {
    statusBtn.innerHTML = icon(state);
    statusBtn.className = `icon-btn ${state}`;
    statusBtn.title = statusLabel = label;
    statusBtn.setAttribute('aria-label', label);
  },
});
statusBtn.addEventListener('click', () => {
  notify(statusLabel);
  syncer.sync();
});
document.getElementById('help-btn').addEventListener('click', () => showHelp(document.getElementById('help')));

const pages = {
  kanji: initKanji(kanjiDoc),
  corrections: initCorrections(correctionsDoc),
  settings: initSettings(syncer),
};

function show(name) {
  if (!pages[name]) name = 'kanji';
  for (const p of Object.keys(pages)) document.getElementById(`page-${p}`).classList.toggle('active', p === name);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.page === name);
  save('page', name);
  pages[name].onShow?.();
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => show(t.dataset.page));
show(load('page', 'kanji'));

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
syncer.start();
