// All project sites under george-hawkins.github.io share one origin (and so one
// localStorage), so every key is prefixed.
const PREFIX = 'daruma:';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}
