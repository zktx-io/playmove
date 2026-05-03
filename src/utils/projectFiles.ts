import type { FileMap, LoadedProject, ProjectSource } from '../types';

const MAX_VISIBLE_FILES = 5;

interface NormalizeResult {
  files: FileMap;
  packageRoot: string;
}

export function createLoadedProject(
  source: ProjectSource,
  files: FileMap,
  packageRoot = '',
): LoadedProject {
  const normalized = normalizeMovePackageFiles(files);
  return {
    source,
    files: normalized.files,
    packageRoot: packageRoot || normalized.packageRoot,
  };
}

export function normalizeMovePackageFiles(files: FileMap): NormalizeResult {
  const cleanFiles = normalizePaths(files);
  const moveTomls = Object.keys(cleanFiles).filter(
    (path) => path === 'Move.toml' || path.endsWith('/Move.toml'),
  );

  if (moveTomls.length === 0) {
    throw new Error(
      'Move.toml not found — this does not look like a Move package.',
    );
  }

  if (moveTomls.length > 1) {
    const candidates = moveTomls
      .map((path) =>
        path === 'Move.toml' ? '.' : path.replace(/\/Move\.toml$/, ''),
      )
      .slice(0, 6)
      .join(', ');
    throw new Error(
      `Multiple Move packages found (${candidates}). Paste a GitHub URL for one package path.`,
    );
  }

  const moveTomlPath = moveTomls[0];
  const packageRoot =
    moveTomlPath === 'Move.toml'
      ? ''
      : moveTomlPath.slice(0, -'/Move.toml'.length);
  const prefix = packageRoot ? `${packageRoot}/` : '';
  const packageFiles: FileMap = {};

  for (const [path, content] of Object.entries(cleanFiles)) {
    if (!prefix) {
      packageFiles[path] = content;
      continue;
    }

    if (path === packageRoot) continue;
    if (path.startsWith(prefix)) {
      packageFiles[path.slice(prefix.length)] = content;
    }
  }

  return { files: packageFiles, packageRoot };
}

export function getBuildFiles(files: FileMap): FileMap {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => isBuildInputPath(path)),
  );
}

export function getVisibleFilePaths(files: FileMap): string[] {
  const paths = sortPaths(Object.keys(files));
  const priority = [
    'Move.toml',
    ...paths.filter(
      (path) => path.startsWith('sources/') && path.endsWith('.move'),
    ),
    ...paths.filter((path) => /^readme(\.md)?$/i.test(path)),
    ...paths.filter(
      (path) => path.endsWith('.move') && !path.startsWith('sources/'),
    ),
    ...paths.filter(
      (path) =>
        path.endsWith('.toml') &&
        path !== 'Move.toml' &&
        path !== 'Published.toml',
    ),
    ...paths,
  ];

  return [...new Set(priority)]
    .filter((path) => path in files)
    .slice(0, MAX_VISIBLE_FILES);
}

export function getInitialFilePath(files: FileMap): string {
  const visible = getVisibleFilePaths(files);
  return (
    visible.find(
      (path) => path.startsWith('sources/') && path.endsWith('.move'),
    ) ??
    visible.find((path) => path.endsWith('.move')) ??
    visible.find((path) => path === 'Move.toml') ??
    visible[0] ??
    ''
  );
}

export function countHiddenFiles(
  files: FileMap,
  visiblePaths: string[],
): number {
  return Math.max(0, Object.keys(files).length - visiblePaths.length);
}

function normalizePaths(files: FileMap): FileMap {
  const normalized: FileMap = {};

  for (const [rawPath, content] of Object.entries(files)) {
    const path = rawPath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^\.\/+/, '');

    if (!path || path.split('/').some((part) => part === '..')) {
      throw new Error(`Invalid file path in package: ${rawPath}`);
    }

    if (path in normalized) {
      throw new Error(`Duplicate file path after normalization: ${path}`);
    }

    normalized[path] = content;
  }

  return normalized;
}

function isBuildInputPath(path: string): boolean {
  return (
    path === 'Move.toml' ||
    path === 'Move.lock' ||
    path === 'Published.toml' ||
    path.endsWith('.move')
  );
}

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.localeCompare(b);
  });
}
