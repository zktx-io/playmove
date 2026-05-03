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

import { getGitHubToken } from './githubToken';
import { normalizeMovePackageFiles } from './projectFiles';

const API = 'https://api.github.com';

/* ── URL parsing ─────────────────────────────────────── */

interface GitHubRef {
  owner: string;
  repo: string;
  ref: string; // branch / tag — defaults to HEAD
  path: string; // sub-path inside the repo ('' = root)
  treeParts: string[];
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
    const treeParts = parts.slice(3);
    const ref = treeParts[0] ?? '';
    const path = treeParts.slice(1).join('/');
    return { owner, repo, ref, path, treeParts };
  }

  return { owner, repo, ref: '', path: '', treeParts: [] };
}

/* ── Helpers ─────────────────────────────────────────── */

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghFetch<T>(
  url: string,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { headers: headers(token), signal });
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

interface GHRefItem {
  ref: string;
}

/* ── Core fetcher ────────────────────────────────────── */

export type FileMap = Record<string, string>;

export interface FetchGitHubResult {
  files: FileMap;
  repoName: string;
  packageRoot: string;
}

export interface FetchGitHubOptions {
  signal?: AbortSignal;
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
  options: FetchGitHubOptions = {},
): Promise<FetchGitHubResult> {
  const token = getGitHubToken();
  const log = onLog ?? (() => {});
  const { signal } = options;

  const parsed = parseGitHubUrl(rawUrl);
  const { owner, repo } = parsed;
  log(`📦 Repo: ${owner}/${repo}`);

  // 1. Resolve branch
  let branch = parsed.ref;
  let subPath = parsed.path;
  if (parsed.treeParts.length) {
    const resolved = await resolveTreeRefAndPath(
      owner,
      repo,
      parsed.treeParts,
      token,
      signal,
    );
    branch = resolved.ref;
    subPath = resolved.path;
  } else {
    log('🔍 Resolving default branch…');
    const meta = await ghFetch<{ default_branch: string }>(
      `${API}/repos/${owner}/${repo}`,
      token,
      signal,
    );
    branch = meta.default_branch;
  }

  if (subPath) log(`📁 Path: ${subPath}`);
  log(`🌿 Branch: ${branch}`);

  // 2. Try Trees API (recursive)
  let fileMap: FileMap;
  try {
    fileMap = await fetchViaTree(
      owner,
      repo,
      branch,
      subPath,
      token,
      log,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    log('⚠️ Trees API failed, falling back to Contents API…');
    fileMap = await fetchViaContents(
      owner,
      repo,
      branch,
      subPath,
      token,
      log,
      signal,
    );
  }

  const count = Object.keys(fileMap).length;
  if (count === 0) {
    throw new Error('No files found — is the path correct?');
  }

  const normalized = normalizeMovePackageFiles(fileMap);

  log(`✅ Fetched ${Object.keys(normalized.files).length} package files`);

  return {
    files: normalized.files,
    repoName: repo,
    packageRoot: normalized.packageRoot,
  };
}

/* ── Strategy A: Git Trees (recursive, fast) ─────────── */

async function fetchViaTree(
  owner: string,
  repo: string,
  branch: string,
  subPath: string,
  token: string | undefined,
  log: (msg: string) => void,
  signal?: AbortSignal,
): Promise<FileMap> {
  log('⬇️  Fetching file tree…');
  const tree = await ghFetch<GHTreeResponse>(
    `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token,
    signal,
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
        const raw = await fetchRawFile(
          owner,
          repo,
          branch,
          blob.path,
          token,
          signal,
        );
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
  signal?: AbortSignal,
): Promise<FileMap> {
  const fileMap: FileMap = {};

  async function walk(dirPath: string) {
    const url = `${API}/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
    const items = await ghFetch<GHContentsItem[]>(url, token, signal);

    for (const item of items) {
      if (item.type === 'dir') {
        await walk(item.path);
      } else if (
        item.type === 'file' &&
        item.download_url &&
        item.size < 512_000 &&
        !isBinary(item.path)
      ) {
        const raw = await fetchRawFile(
          owner,
          repo,
          branch,
          item.path,
          token,
          signal,
        );
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
  signal?: AbortSignal,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  }
  return res.text();
}

async function resolveTreeRefAndPath(
  owner: string,
  repo: string,
  treeParts: string[],
  token: string | undefined,
  signal?: AbortSignal,
): Promise<{ ref: string; path: string }> {
  const first = treeParts[0];
  const joined = treeParts.join('/');
  const refs = await Promise.all([
    fetchMatchingRefs(owner, repo, 'heads', first, token, signal),
    fetchMatchingRefs(owner, repo, 'tags', first, token, signal),
  ]);
  const candidates = refs
    .flat()
    .map((ref) => ref.ref.replace(/^refs\/(heads|tags)\//, ''))
    .filter((ref) => joined === ref || joined.startsWith(`${ref}/`))
    .sort((a, b) => b.length - a.length);

  const ref = candidates[0] ?? first;
  const path = treeParts.slice(ref.split('/').length).join('/');
  return { ref, path };
}

async function fetchMatchingRefs(
  owner: string,
  repo: string,
  namespace: 'heads' | 'tags',
  prefix: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<GHRefItem[]> {
  try {
    return await ghFetch<GHRefItem[]>(
      `${API}/repos/${owner}/${repo}/git/matching-refs/${namespace}/${prefix}`,
      token,
      signal,
    );
  } catch {
    return [];
  }
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
