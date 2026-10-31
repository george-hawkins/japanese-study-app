// Three-way merge for documents made of named lists of one-line items
// (e.g. corrections / maybe / done).
//
// `base` is the version both sides started from (the last one this device
// synced), `local` this device's version and `remote` GitHub's. Every edit the
// app makes (add, edit, delete, move between lists, mark done) changes which
// list an item text is in, so the merge decides each item's final list:
//
// - changed on one side only: take that side's change;
// - changed the same way on both: take it;
// - changed differently on both (rare): never lose the item; if only one side
//   still has it, keep it there, and if both moved it, prefer this device.
//
// An edit is "remove the old text, add the new one". Order: items that newly
// arrived in a list go at the top (this device's first, as new items are added
// at the top), followed by the rest in GitHub's order. Identical lines within a
// document are treated as one item.

const norm = (items) => items.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

export function merge3(base, local, remote, keys) {
  const lists = (doc) => Object.fromEntries(keys.map((k) => [k, norm(doc?.[k] ?? [])]));
  const [b, l, r] = [lists(base), lists(local), lists(remote)];
  const where = (doc) => {
    const m = new Map();
    for (const k of keys) for (const t of doc[k]) if (!m.has(t)) m.set(t, k);
    return m;
  };
  const [B, L, R] = [where(b), where(l), where(r)];

  const final = new Map();
  for (const t of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
    const [bk, lk, rk] = [B.get(t), L.get(t), R.get(t)];
    const k = lk === bk ? rk : rk === bk ? lk : lk === rk ? lk : (lk ?? rk);
    if (k) final.set(t, k);
  }

  const result = {};
  for (const k of keys) {
    const out = [];
    const seen = new Set();
    const take = (t) => {
      if (final.get(t) === k && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    };
    l[k].filter((t) => B.get(t) !== k).forEach(take); // arrived here on this device
    r[k].filter((t) => B.get(t) !== k).forEach(take); // arrived here on GitHub
    r[k].forEach(take);
    l[k].forEach(take);
    result[k] = out;
  }
  return result;
}
