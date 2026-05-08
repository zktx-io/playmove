/**
 * Fetch a Move project from a GitHub repository.
 *
 * Supports URLs like:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch/path/to/package
 *
 * Uses the Move builder's GitHub fetcher so imported packages keep the git
 * source metadata needed for local dependency resolution during builds.
 */

import {
  fetchMovePackageFromGitHub,
  GitHubMovePackageFetcher,
  type FetchedMovePackage,
  type MovePackageGitSource,
} from '@zktx.io/sui-move-builder';
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

interface GHRefItem {
  ref: string;
}

/* ── Core fetcher ────────────────────────────────────── */

export type FileMap = Record<string, string>;

export interface FetchGitHubResult {
  files: FileMap;
  repoName: string;
  packageRoot: string;
  rootGit: MovePackageGitSource;
}

export interface FetchGitHubOptions {
  signal?: AbortSignal;
}

/**
 * Fetch all text files under the given GitHub path.
 *
 * Strategy:
 * 1. Resolve the default branch if no ref is given.
 * 2. Resolve tree URLs that use branch/tag names with slashes.
 * 3. Ask the Move builder GitHub fetcher for package files only.
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

  throwIfAborted(signal);

  log('⬇️  Fetching package files…');
  const git = `https://github.com/${owner}/${repo}.git`;
  const fetched = await fetchMovePackageInput({
    owner,
    repo,
    git,
    branch,
    subPath,
    token,
  });

  throwIfAborted(signal);

  const count = Object.keys(fetched.files).length;
  if (count === 0) {
    throw new Error('No files found — is the path correct?');
  }

  const normalized = normalizeMovePackageFiles(fetched.files);
  const packageRoot = joinGitPath(subPath, normalized.packageRoot);
  const rootGit: MovePackageGitSource = {
    ...fetched.rootGit,
    ...(packageRoot ? { subdir: packageRoot } : {}),
  };

  log(`✅ Fetched ${Object.keys(normalized.files).length} package files`);

  return {
    files: normalized.files,
    repoName: repo,
    packageRoot,
    rootGit,
  };
}

async function fetchMovePackageInput({
  owner,
  repo,
  git,
  branch,
  subPath,
  token,
}: {
  owner: string;
  repo: string;
  git: string;
  branch: string;
  subPath: string;
  token: string | undefined;
}): Promise<FetchedMovePackage> {
  if (!branch.includes('/')) {
    return fetchMovePackageFromGitHub(
      `https://github.com/${owner}/${repo}/tree/${branch}${subPath ? `/${subPath}` : ''}`,
      { githubToken: token },
    );
  }

  const fetcher = new GitHubMovePackageFetcher(token);
  return {
    files: await fetcher.fetch(git, branch, subPath || undefined),
    rootGit: {
      git,
      rev: branch,
      ...(subPath ? { subdir: subPath } : {}),
    },
  };
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

function joinGitPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('GitHub import cancelled', 'AbortError');
  }
}
