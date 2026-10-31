import { load, save } from './store.js';
import { parseGitHubUrl, getRepo, getFile, branchExists } from './github.js';

const DEFAULTS = { token: '', forgottenUrl: '', correctionsUrl: '' };

export const getSettings = () => ({ ...DEFAULTS, ...load('settings', {}) });

export function initSettings(syncer) {
  const $ = (id) => document.getElementById(id);
  const form = $('settings-form');
  const fields = { forgottenUrl: $('set-forgotten'), correctionsUrl: $('set-corrections'), token: $('set-token') };
  const result = $('set-result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value.trim()]));
    save('settings', s);
    result.textContent = 'Testing…';
    const lines = await Promise.all([
      test('Forgotten kanji', s.forgottenUrl, s.token),
      test('Corrections', s.correctionsUrl, s.token),
    ]);
    result.textContent = lines.join('\n');
    syncer.sync();
  });

  return {
    onShow() {
      const s = getSettings();
      for (const [k, el] of Object.entries(fields)) el.value = s[k];
      result.textContent = '';
    },
  };
}

async function test(label, url, token) {
  if (!url) return `${label}: not set`;
  const loc = parseGitHubUrl(url);
  if (!loc) return `${label}: ✗ expected https://github.com/OWNER/REPO/blob/BRANCH/PATH.md`;
  if (!token) return `${label}: ✗ no token`;
  try {
    const repo = await getRepo(loc, token);
    if (!repo) return `${label}: ✗ repository ${loc.owner}/${loc.repo} not found, or the token can't access it`;
    if (!(await branchExists(loc, token))) {
      if (repo.default_branch !== loc.branch) return `${label}: ✗ branch "${loc.branch}" doesn't exist (the default branch is "${repo.default_branch}")`;
      return `${label}: ✓ repository is empty; the first push will create ${loc.path}`;
    }
    const file = await getFile(loc, token);
    return `${label}: ✓ ${file ? 'file found' : "file doesn't exist yet; it will be created"}`;
  } catch (e) {
    return `${label}: ✗ ${e.message}`;
  }
}
