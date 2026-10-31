// Minimal GitHub REST "contents" API client.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// https://github.com/OWNER/REPO/blob/BRANCH/PATH/TO/FILE.md
export function parseGitHubUrl(url) {
  const m = (url || '').trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^?#]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3], path: decodeURIComponent(m[4]) };
}

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
const repoUrl = (loc) => `${API}/repos/${loc.owner}/${loc.repo}`;
const contentsUrl = (loc) => `${repoUrl(loc)}/contents/${loc.path.split('/').map(encodeURIComponent).join('/')}`;

// A 404 is returned (not thrown) when `allow404` is set, since it then means
// "doesn't exist"; any other failure throws with GitHub's message.
async function request(url, { allow404 = false, ...options } = {}) {
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', ...options });
  } catch (e) {
    throw new GitHubError(0, navigator.onLine ? `network error (${e.message})` : 'offline');
  }
  if (r.ok || (allow404 && r.status === 404)) return r;
  let message = `${r.status} ${r.statusText}`;
  try {
    const j = await r.json();
    if (j.message) message = `${r.status}: ${j.message}`;
  } catch { /* not JSON */ }
  throw new GitHubError(r.status, message);
}

export async function getRepo(loc, token) {
  const r = await request(repoUrl(loc), { headers: headers(token), allow404: true });
  return r.status === 404 ? null : r.json();
}

export async function branchExists(loc, token) {
  const r = await request(`${repoUrl(loc)}/branches/${encodeURIComponent(loc.branch)}`, { headers: headers(token), allow404: true });
  return r.status !== 404;
}

// Returns { sha, text }, or null if the file doesn't exist.
export async function getFile(loc, token) {
  const r = await request(`${contentsUrl(loc)}?ref=${encodeURIComponent(loc.branch)}`, { headers: headers(token), allow404: true });
  if (r.status === 404) return null;
  const j = await r.json();
  return { sha: j.sha, text: decodeBase64(j.content) };
}

// Creates a commit; `sha` must be the current blob sha (null to create the
// file). GitHub rejects the write if the file has changed since. Returns the new sha.
export async function putFile(loc, token, text, sha, message, { keepalive = false } = {}) {
  let branch = loc.branch;
  if (!sha) {
    // Creating a file. In a repo with no commits yet, naming the branch fails
    // (it doesn't exist until the first commit), so leave it out when it's the
    // default branch, which is where GitHub then puts the commit anyway.
    const repo = await getRepo(loc, token);
    if (repo?.default_branch === branch) branch = undefined;
  }
  const body = JSON.stringify({ message, content: encodeBase64(text), ...(branch ? { branch } : {}), ...(sha ? { sha } : {}) });
  const options = { method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' }, body };
  let r;
  try {
    // keepalive lets the request outlive the page (e.g. when the app is
    // swiped away) but is limited to 64 KB, so fall back to a normal request.
    r = await request(contentsUrl(loc), { ...options, keepalive });
  } catch (e) {
    if (!keepalive || e.status !== 0) throw e;
    r = await request(contentsUrl(loc), options);
  }
  return (await r.json()).content.sha;
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
