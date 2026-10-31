import { merge3 } from './merge.js';

// Conversion between the Markdown files on GitHub and the app's data.

const BULLET = /^\s*[*-]\s+(.*)$/;
const clean = (items) => items.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

// forgotten.md: a heading followed by a bullet list (newest first).

export const emptyList = () => ({ header: '# Forgotten kanji', items: [] });

export function parseList(md) {
  const header = [];
  const items = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(BULLET);
    if (m) items.push(m[1]);
    else if (!items.length) header.push(line);
  }
  return { header: header.join('\n').trim() || emptyList().header, items: clean(items) };
}

export function serializeList(doc) {
  const items = clean(doc.items).map((t) => `* ${t}`);
  return [doc.header, '', ...items].join('\n') + '\n';
}

// Three-way merge (see merge.js); the header can only be changed on GitHub.
export const mergeList3 = (base, local, remote) => ({ header: remote.header, ...merge3(base, local, remote, ['items']) });

// corrections.md: "## Corrections", "## Maybe" and "## Done" bullet lists. Any
// text before the first section, and any unknown sections, are kept verbatim.

const SECTIONS = [['corrections', 'Corrections'], ['maybe', 'Maybe'], ['done', 'Done']];

export const emptySections = () => ({ preamble: '', corrections: [], maybe: [], done: [], extra: [] });

export function parseSections(md) {
  const doc = emptySections();
  const preamble = [];
  let current = preamble;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*?)\s*$/);
    if (h) {
      const known = SECTIONS.find(([, title]) => title.toLowerCase() === h[1].toLowerCase());
      if (known) {
        current = doc[known[0]];
      } else {
        current = [];
        doc.extra.push({ title: h[1], lines: current });
      }
      continue;
    }
    if (current === preamble || doc.extra.some((x) => x.lines === current)) {
      current.push(line);
    } else {
      const m = line.match(BULLET);
      if (m) current.push(m[1]);
    }
  }
  doc.preamble = preamble.join('\n').trim();
  for (const [key] of SECTIONS) doc[key] = clean(doc[key]);
  for (const x of doc.extra) x.lines = x.lines.join('\n').trim().split('\n');
  return doc;
}

export function serializeSections(doc) {
  const parts = [];
  if (doc.preamble) parts.push(doc.preamble);
  for (const [key, title] of SECTIONS) {
    const items = clean(doc[key]).map((t) => `* ${t}`);
    parts.push([`## ${title}`, ...(items.length ? ['', ...items] : [])].join('\n'));
  }
  for (const x of doc.extra) parts.push([`## ${x.title}`, '', ...x.lines].join('\n').trim());
  return parts.join('\n\n') + '\n';
}

// Three-way merge (see merge.js); the preamble and any unknown sections can
// only be changed on GitHub.
export const mergeSections3 = (base, local, remote) => ({
  preamble: remote.preamble,
  extra: remote.extra,
  ...merge3(base, local, remote, SECTIONS.map(([key]) => key)),
});
