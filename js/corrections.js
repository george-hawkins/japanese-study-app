// Corrections: two editable lists ("Corrections" and "Maybe"). Swipe a row to
// mark it done (it moves to the hidden Done section of the file).

import { load, save } from './store.js';
import { el, gestures, menu, notify, debounce } from './ui.js';

const KEYS = ['corrections', 'maybe'];
const TITLES = { corrections: 'Corrections', maybe: 'Maybe' };

export function initCorrections(doc) {
  const parts = {};
  for (const key of KEYS) {
    const root = document.getElementById(`clist-${key}`);
    parts[key] = { list: root.querySelector('.list'), form: root.querySelector('form'), input: root.querySelector('form input'), count: root.querySelector('.count') };
  }
  const items = (key) => doc.data[key];
  let editing = null; // token identifying the row currently being edited

  // Rows left empty are dropped, except a row about to be edited.
  function render(focus = null) {
    editing = null;
    for (const key of KEYS) {
      const list = items(key);
      for (let j = list.length - 1; j >= 0; j--) {
        if (list[j].trim() || (focus && focus.key === key && focus.i === j)) continue;
        list.splice(j, 1);
        if (focus && focus.key === key && focus.i > j) focus.i--;
      }
      parts[key].list.replaceChildren(...list.map((text, i) => row(key, i, text)));
      parts[key].count.textContent = list.length || '';
    }
    if (focus) startEdit(focus.key, focus.i);
  }

  function row(key, i, text) {
    const li = el('li', 'row');
    const bg = el('div', 'row-bg');
    bg.setAttribute('aria-hidden', 'true');
    bg.append(el('span', 'seal', '済'), el('span', 'seal', '済'));
    const inner = el('div', 'row-inner', text);
    li.append(bg, inner);
    gestures(li, {
      slider: inner,
      onTap: () => startEdit(key, i),
      onLongPress: () => rowMenu(key, i),
      onSwipe: () => markDone(key, i),
    });
    return li;
  }

  function startEdit(key, i) {
    if (editing) {
      // Finish the previous edit first; this may drop rows above this one.
      const target = { key, i };
      render(target);
      return;
    }
    const li = parts[key].list.children[i];
    if (!li) return;
    const inner = li.querySelector('.row-inner');
    const form = el('form');
    const input = el('input');
    input.value = items(key)[i];
    input.enterKeyHint = 'enter';
    input.autocomplete = 'off';
    form.append(input);
    inner.replaceChildren(form);
    const token = { key, i };
    editing = token;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('input', () => {
      items(key)[i] = input.value;
      doc.changed();
    });
    // Enter: start a new line below, as in a textarea.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return input.blur();
      items(key).splice(i + 1, 0, '');
      doc.changed();
      render({ key, i: i + 1 });
    });
    input.addEventListener('blur', () => editing === token && render());
  }

  function markDone(key, i) {
    const [text] = items(key).splice(i, 1);
    if (text.trim()) doc.data.done.unshift(text.trim());
    doc.changed();
    render();
    if (!text.trim()) return;
    notify(`Done: ${text}`, {
      label: 'Undo',
      run() {
        const j = doc.data.done.indexOf(text.trim());
        if (j >= 0) doc.data.done.splice(j, 1);
        items(key).splice(Math.min(i, items(key).length), 0, text);
        doc.changed();
        render();
      },
    });
  }

  async function rowMenu(key, i) {
    const other = KEYS.find((k) => k !== key);
    const choice = await menu(items(key)[i], [
      [`Move to ${TITLES[other]}`, 'move'],
      ['Mark done', 'done'],
      ['Delete', 'delete', 'danger'],
      ['Cancel', null],
    ]);
    if (choice === 'done') return markDone(key, i);
    if (!choice) return;
    const [text] = items(key).splice(i, 1);
    if (choice === 'move') items(other).unshift(text);
    doc.changed();
    render();
  }

  for (const key of KEYS) {
    const { list, form, input } = parts[key];
    input.value = load(`draft:${key}`, '');
    input.addEventListener('input', () => save(`draft:${key}`, input.value));
    // New entries go at the top; focus stays so several can be typed in a row.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      items(key).unshift(text);
      doc.changed();
      render();
      list.scrollTop = 0;
      input.value = '';
      save(`draft:${key}`, '');
    });
    list.addEventListener('scroll', debounce(() => save(`scroll:${key}`, list.scrollTop), 150), { passive: true });
  }

  doc.on((kind) => kind === 'remote' && render());
  render();

  return {
    onShow() {
      for (const key of KEYS) parts[key].list.scrollTop = load(`scroll:${key}`, 0);
    },
  };
}
