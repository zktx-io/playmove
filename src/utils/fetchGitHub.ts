/**
 * Fetch a Move project from a GitHub repository.
 *
 * Supports URLs like:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch/path/to/package
 *
 * Uses the GitHub Contents API (recursive) and falls back to the
 * Trees API when repository size is manageable.
 */

const GH_TOKEN_KEY = 'gh_token';
const API = 'https://api.github.com';

/* ── URL parsing ─────────────────────────────────────── */

interface GitHubRef {
  owner: string;
  repo: string;
  ref: string; // branch / tag — defaults to HEAD
  path: string; // sub-path inside the repo ('' = root)
}

/**
 * Parse a GitHub URL into owner / repo / ref / path.
 *
 * Examples:
 *   https://github.com/MystenLabs/sui                          → ref='', path=''
 *   https://github.com/MystenLabs/sui/tree/main/examples/move  → ref='main', path='examples/move'
 */
export function parseGitHubUrl(raw: string): GitHubRef {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new Error('Invalid GitHub URL — expected github.com/owner/repo');
  }
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts.length < 2) {
    throw new Error('Invalid GitHub URL — expected github.com/owner/repo');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');

  // github.com/owner/repo/tree/branch/optional/path
  if (parts[2] === 'tree' && parts.length >= 4) {
    const ref = parts[3];
    const path = parts.slice(4).join('/');
    return { owner, repo, ref, path };
  }

  return { owner, repo, ref: '', path: '' };
}

/* ── Helpers ─────────────────────────────────────────── */

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghFetch<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        'GitHub API rate limit exceeded. Add a token (🔑) to increase the limit.',
      );
    }
    if (res.status === 404) {
      throw new Error('Repository or path not found (404).');
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* ── Types from GitHub API ───────────────────────────── */

interface GHTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface GHTreeResponse {
  sha: string;
  url: string;
  tree: GHTreeItem[];
  truncated: boolean;
}

interface GHContentsItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
  size: number;
}

/* ── Core fetcher ────────────────────────────────────── */

export type FileMap = Record<string, string>;

export interface FetchGitHubResult {
  files: FileMap;
  repoName: string;
}

/**
 * Fetch all text files under the given GitHub path.
 *
 * Strategy:
 * 1. Resolve the default branch if no ref is given.
 * 2. Try the Git Trees API (recursive) — fast, single request.
 *    If truncated, fall back to the Contents API (one request per dir).
 * 3. Fetch each blob's content. Skip binary files and files > 512 KB.
 */
export async function fetchGitHubProject(
  rawUrl: string,
  onLog?: (msg: string) => void,
): Promise<FetchGitHubResult> {
  const token = localStorage.getItem(GH_TOKEN_KEY) ?? undefined;
  const log = onLog ?? (() => {});

  const { owner, repo, ref: refHint, path: subPath } = parseGitHubUrl(rawUrl);
  log(`📦 Repo: ${owner}/${repo}`);
  if (subPath) log(`📁 Path: ${subPath}`);

  // 1. Resolve branch
  let branch = refHint;
  if (!branch) {
    log('🔍 Resolving default branch…');
    const meta = await ghFetch<{ default_branch: string }>(
      `${API}/repos/${owner}/${repo}`,
      token,
    );
    branch = meta.default_branch;
  }
  log(`🌿 Branch: ${branch}`);

  // 2. Try Trees API (recursive)
  let fileMap: FileMap;
  try {
    fileMap = await fetchViaTree(owner, repo, branch, subPath, token, log);
  } catch {
    log('⚠️ Trees API failed, falling back to Contents API…');
    fileMap = await fetchViaContents(owner, repo, branch, subPath, token, log);
  }

  const count = Object.keys(fileMap).length;
  if (count === 0) {
    throw new Error('No files found — is the path correct?');
  }

  // Validate: must contain Move.toml
  const hasMoveToml = Object.keys(fileMap).some(
    (p) => p === 'Move.toml' || p.endsWith('/Move.toml'),
  );
  if (!hasMoveToml) {
    throw new Error(
      'Move.toml not found — this does not look like a Move package.',
    );
  }

  log(`✅ Fetched ${count} files`);

  return { files: fileMap, repoName: repo };
}

/* ── Strategy A: Git Trees (recursive, fast) ─────────── */

async function fetchViaTree(
  owner: string,
  repo: string,
  branch: string,
  subPath: string,
  token: string | undefined,
  log: (msg: string) => void,
): Promise<FileMap> {
  log('⬇️  Fetching file tree…');
  const tree = await ghFetch<GHTreeResponse>(
    `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token,
  );

  if (tree.truncated) {
    throw new Error('Tree truncated');
  }

  // Filter to blobs under subPath prefix
  const prefix = subPath ? subPath + '/' : '';
  const blobs = tree.tree.filter(
    (item) =>
      item.type === 'blob' &&
      (prefix ? item.path.startsWith(prefix) : true) &&
      (item.size ?? 0) < 512_000 &&
      !isBinary(item.path),
  );

  log(`📄 ${blobs.length} files to download`);

  // Fetch all blob contents in parallel (batched)
  const fileMap: FileMap = {};
  const BATCH = 10;
  for (let i = 0; i < blobs.length; i += BATCH) {
    const batch = blobs.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (blob) => {
        const raw = await fetchRawFile(owner, repo, branch, blob.path, token);
        const relative = prefix ? blob.path.slice(prefix.length) : blob.path;
        return { relative, raw };
      }),
    );
    for (const { relative, raw } of results) {
      fileMap[relative] = raw;
    }
  }

  return fileMap;
}

/* ── Strategy B: Contents API (fallback) ─────────────── */

async function fetchViaContents(
  owner: string,
  repo: string,
  branch: string,
  subPath: string,
  token: string | undefined,
  log: (msg: string) => void,
): Promise<FileMap> {
  const fileMap: FileMap = {};

  async function walk(dirPath: string) {
    const url = `${API}/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
    const items = await ghFetch<GHContentsItem[]>(url, token);

    for (const item of items) {
      if (item.type === 'dir') {
        await walk(item.path);
      } else if (
        item.type === 'file' &&
        item.download_url &&
        item.size < 512_000 &&
        !isBinary(item.path)
      ) {
        const raw = await fetchRawFile(owner, repo, branch, item.path, token);
        const prefix = subPath ? subPath + '/' : '';
        const relative = prefix ? item.path.slice(prefix.length) : item.path;
        fileMap[relative] = raw;
      }
    }
  }

  log('⬇️  Fetching files via Contents API…');
  await walk(subPath);
  return fileMap;
}

/* ── Raw file download ───────────────────────────────── */

async function fetchRawFile(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  token?: string,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  }
  return res.text();
}

/* ── Binary detection ────────────────────────────────── */

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.zip',
  '.tar',
  '.gz',
  '.wasm',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

function isBinary(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXT.has(path.slice(dot).toLowerCase());
}
