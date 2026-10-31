// Small shared UI helpers: snackbar, dialogs and row gestures.

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

let snackTimer = null;

export function notify(message, action = null, ms = 5000) {
  const bar = document.getElementById('snackbar');
  const btn = document.getElementById('snackbar-action');
  document.getElementById('snackbar-text').textContent = message;
  btn.textContent = action ? action.label : '';
  btn.onclick = () => {
    bar.hidden = true;
    action?.run();
  };
  bar.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (bar.hidden = true), ms);
}

const dialog = () => document.getElementById('dialog');

function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = dialog();
    let value = null;
    const done = (v) => {
      value = v;
      dlg.close();
    };
    dlg.replaceChildren();
    build(dlg, done);
    dlg.onclose = () => resolve(value);
    dlg.onclick = (e) => e.target === dlg && dlg.close(); // backdrop tap
    dlg.showModal();
  });
}

// items: [[label, value, className?], ...]. Resolves to the chosen value or null.
export function menu(title, items) {
  return openDialog((dlg, done) => {
    dlg.append(el('p', 'dlg-title', title));
    for (const [label, value, cls] of items) {
      const b = el('button', `dlg-btn ${cls || ''}`, label);
      b.onclick = () => done(value);
      dlg.append(b);
    }
  });
}

export function promptText(title, initial) {
  return openDialog((dlg, done) => {
    const form = el('form');
    const input = el('input', 'dlg-input');
    input.value = initial;
    const row = el('div', 'dlg-row');
    const cancel = el('button', 'dlg-btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => done(null);
    row.append(cancel, el('button', 'dlg-btn', 'Save'));
    form.append(el('p', 'dlg-title', title), input, row);
    form.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    dlg.append(form);
    setTimeout(() => input.focus());
  });
}

// Tap, long-press and (optionally) horizontal swipe on a list row. The row
// should have `touch-action: pan-y` so vertical scrolling still works.
export function gestures(row, { onTap, onLongPress, onSwipe, slider }) {
  let id = null, x0 = 0, y0 = 0, dx = 0, mode = null, timer = null;

  row.addEventListener('pointerdown', (e) => {
    if (id !== null || e.button > 0 || e.target.closest('input')) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    mode = null;
    timer = setTimeout(() => {
      if (mode) return;
      mode = 'long';
      navigator.vibrate?.(20);
      onLongPress?.();
    }, 500);
  });

  row.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!mode) {
      if (onSwipe && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
        mode = 'swipe';
        clearTimeout(timer);
        row.setPointerCapture(id);
        slider.style.transition = 'none';
      } else if (Math.hypot(mx, my) > 10) {
        mode = 'move';
        clearTimeout(timer);
      }
    }
    if (mode === 'swipe') {
      dx = mx;
      slider.style.transform = `translateX(${dx}px)`;
    }
  });

  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    clearTimeout(timer);
    if (mode === 'swipe') {
      slider.style.transition = '';
      if (e.type === 'pointerup' && Math.abs(dx) > row.clientWidth * 0.3) {
        slider.style.transform = `translateX(${Math.sign(dx) * 110}%)`;
        setTimeout(onSwipe, 150);
      } else {
        slider.style.transform = '';
      }
    } else if (!mode && e.type === 'pointerup') {
      onTap?.();
    }
    mode = null;
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
