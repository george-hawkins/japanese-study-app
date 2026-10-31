import { load, save } from './store.js';
import { SyncedDoc, Syncer } from './sync.js';
import { parseList, serializeList, emptyList, mergeList, parseSections, serializeSections, emptySections, mergeSections } from './markdown.js';
import { initKanji } from './kanji.js';
import { initCorrections } from './corrections.js';
import { initSettings } from './settings.js';
import { notify } from './ui.js';

const kanjiDoc = new SyncedDoc('kanji', {
  urlKey: 'forgottenUrl', empty: emptyList, parse: parseList, serialize: serializeList, merge: mergeList,
});
const correctionsDoc = new SyncedDoc('corrections', {
  urlKey: 'correctionsUrl', empty: emptySections, parse: parseSections, serialize: serializeSections, merge: mergeSections,
});

const statusBtn = document.getElementById('sync-status');
const ICONS = { off: '⊘', ok: '✓', pending: '•', syncing: '↻', offline: '⚡︎', error: '⚠︎' };
let statusLabel = '';
const syncer = new Syncer([kanjiDoc, correctionsDoc], {
  notify,
  onStatus(state, label) {
    statusBtn.textContent = ICONS[state];
    statusBtn.className = `icon-btn ${state}`;
    statusBtn.title = statusLabel = label;
  },
});
statusBtn.addEventListener('click', () => {
  notify(statusLabel);
  syncer.sync();
});

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
