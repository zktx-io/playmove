import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
  useSuiClientContext,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  buildMovePackage,
  getSuiMoveVersion,
  initMoveCompiler,
  resolveDependencies,
} from '@zktx.io/sui-move-builder/lite';

import type { Project } from '../types';
import './Playground.css';

/* ── Types ───────────────────────────────────────────── */

type BuildResult = Awaited<ReturnType<typeof buildMovePackage>>;
type BuildSuccess = BuildResult & {
  success: true;
  modules: string[];
  dependencies?: string[];
  digest?: string;
};

type AnsiColorMap = Record<number, string>;
const MAX_LOG_LINES = 300;

/* eslint-disable no-control-regex */
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const ANSI_COLORS: AnsiColorMap = {
  30: '#e2e8f0',
  31: '#f87171',
  32: '#4ade80',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#2dd4bf',
  37: '#cbd5f5',
  90: '#94a3b8',
  91: '#fca5a5',
  92: '#86efac',
  93: '#fde047',
  94: '#93c5fd',
  95: '#e9d5ff',
  96: '#5eead4',
  97: '#f8fafc',
};

/* ── ANSI renderer ───────────────────────────────────── */

function renderAnsi(text: string, colorMap: AnsiColorMap): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let currentColor: string | null = null;
  let isBold = false;
  let lastIndex = 0;
  let key = 0;

  const flush = (chunk: string) => {
    if (!chunk) return;
    const style: React.CSSProperties = {};
    if (currentColor) style.color = currentColor;
    if (isBold) style.fontWeight = 600;
    chunk.split('\n').forEach((part, i, arr) => {
      if (part) {
        nodes.push(
          <span key={`a-${key++}`} style={style}>
            {part}
          </span>,
        );
      }
      if (i < arr.length - 1) nodes.push(<br key={`b-${key++}`} />);
    });
  };

  for (const m of text.matchAll(ANSI_REGEX)) {
    const idx = m.index ?? 0;
    flush(text.slice(lastIndex, idx));
    const codes = (m[0].slice(2, -1) || '0').split(';').map(Number);
    for (const c of codes) {
      if (c === 0) {
        currentColor = null;
        isBold = false;
      } else if (c === 1) isBold = true;
      else if (c === 22) isBold = false;
      else if (c === 39) currentColor = null;
      else if (colorMap[c]) currentColor = colorMap[c];
    }
    lastIndex = idx + m[0].length;
  }
  flush(text.slice(lastIndex));
  return nodes;
}

/* ── Props ───────────────────────────────────────────── */

interface PlaygroundProps {
  project: Project;
}

/* ── Component ─────────────────────────────────────── */

export function Playground({ project }: PlaygroundProps) {
  // File state — convert ProjectFile[] to Record<path, content>
  const [files, setFiles] = useState<Record<string, string>>(() =>
    Object.fromEntries(project.files.map((f) => [f.path, f.content])),
  );
  const [selectedPath, setSelectedPath] = useState(() => {
    const paths = project.files.map((f) => f.path);
    return (
      paths.find((p) => p.endsWith('.move')) ??
      paths.find((p) => p === 'Move.toml') ??
      paths[0] ??
      ''
    );
  });

  // Build / deploy state
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildOk, setBuildOk] = useState<boolean | null>(null);
  const [compiled, setCompiled] = useState<BuildResult | null>(null);
  const [packageId, setPackageId] = useState('');
  const [txDigest, setTxDigest] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Compiler
  const compilerRef = useRef<Promise<void> | null>(null);
  const versionRef = useRef<string | null>(null);

  // dApp Kit
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending: isPublishing } =
    useSignAndExecuteTransaction();
  const { network, selectNetwork } = useSuiClientContext();

  const explorerBase =
    network === 'mainnet'
      ? 'https://suiscan.xyz/mainnet'
      : network === 'devnet'
        ? 'https://suiscan.xyz/devnet'
        : 'https://suiscan.xyz/testnet';

  /* ── CodeMirror theme (dark, matches playmove) ─────── */

  const editorTheme = useMemo(
    () =>
      EditorView.theme(
        {
          '&.cm-editor': {
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            borderRadius: '0',
          },
          '.cm-scroller': { backgroundColor: 'transparent' },
          '.cm-content': {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            lineHeight: '1.6',
            padding: '12px',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
          },
          '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
          '.cm-activeLineGutter': {
            backgroundColor: 'rgba(255,255,255,0.03)',
          },
          '.cm-selectionBackground': {
            backgroundColor: 'rgba(255,255,255,0.1)',
          },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' },
        },
        { dark: true },
      ),
    [],
  );

  const baseExt = useMemo(() => [EditorView.lineWrapping], []);
  const moveExt = useMemo(() => [rust(), ...baseExt], [baseExt]);
  const tomlExt = useMemo(() => [yaml(), ...baseExt], [baseExt]);
  const extensions = useMemo(() => {
    if (selectedPath.endsWith('.move')) return moveExt;
    if (selectedPath.endsWith('.toml')) return tomlExt;
    return baseExt;
  }, [selectedPath, moveExt, tomlExt, baseExt]);

  /* ── Log helper ────────────────────────────────────── */

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => {
      const next = [...prev, `[${ts}] ${msg}`];
      return next.length > MAX_LOG_LINES
        ? next.slice(next.length - MAX_LOG_LINES)
        : next;
    });
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Init compiler on mount — log version silently (console stays hidden)
  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!compilerRef.current) {
        compilerRef.current = initMoveCompiler();
      }
      try {
        await compilerRef.current;
      } catch {
        return;
      }
      if (canceled) return;
      try {
        const v = versionRef.current ?? (await getSuiMoveVersion());
        versionRef.current = v;
        const ts = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, `[${ts}] 📌 Compiler ready — ${v}`]);
      } catch {
        /* version read failure is non-fatal */
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  /* ── Build ─────────────────────────────────────────── */

  const onBuild = async () => {
    addLog('── ── ── ── ──');
    addLog('🚀 Build started');
    setBuildOk(null);
    setCompiled(null);
    setPackageId('');
    setTxDigest('');
    setBusy(true);
    setShowLogs(true);

    const start = performance.now();
    try {
      if (!compilerRef.current) {
        compilerRef.current = initMoveCompiler();
      }
      await compilerRef.current;

      addLog('📦 Resolving dependencies…');
      const resolved = await resolveDependencies({
        files,
        ansiColor: true,
        network: network as 'devnet' | 'testnet' | 'mainnet',
      });

      const sourceFiles = Object.fromEntries(
        Object.entries(files).filter(
          ([p]) => p === 'Move.toml' || p.endsWith('.move'),
        ),
      );

      addLog('🔨 Compiling…');
      const result = await buildMovePackage({
        files: sourceFiles,
        resolvedDependencies: resolved,
        silenceWarnings: false,
        ansiColor: true,
        network: network as 'devnet' | 'testnet' | 'mainnet',
        onProgress: (ev) => {
          switch (ev.type) {
            case 'resolve_dep':
              addLog(
                `  dep [${ev.current}/${ev.total}]: ${ev.name} (${ev.source})`,
              );
              break;
            case 'resolve_complete':
              addLog(`Dependencies resolved (${ev.count})`);
              break;
            case 'compile_complete':
              addLog('Compilation complete');
              break;
            default:
              break;
          }
        },
      });

      const elapsed = ((performance.now() - start) / 1000).toFixed(1);

      if ('error' in result) {
        addLog('❌ Build failed');
        addLog(result.error ?? 'Unknown error');
        setBuildOk(false);
      } else {
        addLog(`✅ Build succeeded in ${elapsed}s`);
        addLog(`Digest: ${result.digest ?? '-'}`);
        addLog(`Modules: ${result.modules.length}`);
        if (result.warnings) addLog(`⚠️ ${result.warnings}`);
        setBuildOk(true);
        setCompiled(result);
      }
    } catch (e) {
      addLog(`❌ ${String(e)}`);
      setBuildOk(false);
    } finally {
      setBusy(false);
    }
  };

  /* ── Deploy ────────────────────────────────────────── */

  const onDeploy = () => {
    if (!compiled || !account) return;
    if (!('modules' in compiled) || !(compiled as BuildSuccess).modules.length)
      return;

    setPackageId('');
    setTxDigest('');
    addLog('🚀 Publishing…');

    const tx = new Transaction();
    const modules = (compiled as BuildSuccess).modules.map(
      (m) => Array.from(fromBase64(m)) as number[],
    );
    const [upgradeCap] = tx.publish({
      modules,
      dependencies: (compiled as BuildSuccess).dependencies ?? [],
    });
    tx.transferObjects([upgradeCap], tx.pure.address(account.address));

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (res) => {
          addLog(`📜 Tx digest: ${res.digest}`);
          setTxDigest(res.digest);
          void (async () => {
            try {
              const txb = await suiClient.waitForTransaction({
                digest: res.digest,
                options: { showObjectChanges: true },
              });
              const pub = txb.objectChanges?.find(
                (c) => c.type === 'published',
              ) as { packageId?: string } | undefined;
              if (pub?.packageId) {
                addLog(`📦 Package ID: ${pub.packageId}`);
                setPackageId(pub.packageId);
              }
            } catch (e) {
              addLog(`⚠️ Lookup failed: ${String(e)}`);
            }
          })();
        },
        onError: (e) => {
          addLog(`❌ Publish failed: ${String(e)}`);
        },
      },
    );
  };

  /* ── Sorted file paths ─────────────────────────────── */

  const sortedPaths = useMemo(() => {
    const paths = Object.keys(files);
    return paths.sort((a, b) => {
      const aDepth = a.split('/').length;
      const bDepth = b.split('/').length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return a.localeCompare(b);
    });
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(sortedPaths), [sortedPaths]);

  /* ── Render ────────────────────────────────────────── */

  return (
    <div className="playground">
      {/* Mobile: file tabs with folder path */}
      <div className="playground__tabs">
        {sortedPaths.map((path) => (
          <button
            key={path}
            className={`playground__tab ${path === selectedPath ? 'playground__tab--active' : ''}`}
            onClick={() => setSelectedPath(path)}
            title={path}
          >
            {path}
          </button>
        ))}
      </div>

      {/* Sidebar + editor */}
      <div className="playground__body">
        <div className="playground__sidebar">
          <FileTree
            tree={fileTree}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        </div>
        <div className="playground__editor">
          <CodeMirror
            value={files[selectedPath] ?? ''}
            height="100%"
            extensions={extensions}
            theme={editorTheme}
            onChange={(value) =>
              setFiles((prev) => ({ ...prev, [selectedPath]: value }))
            }
          />
        </div>
      </div>

      {/* Console — slide open/close */}
      <div
        className={`playground__console ${showLogs ? 'playground__console--open' : ''}`}
      >
        <div className="playground__console-body">
          {logs.map((line, i) => (
            <div key={i} className="playground__console-line">
              {renderAnsi(line, ANSI_COLORS)}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
        {(packageId || txDigest) && (
          <div className="playground__deploy-info">
            {packageId && (
              <div className="playground__deploy-row">
                <span className="playground__deploy-label">Package ID</span>
                <code className="playground__deploy-value">{packageId}</code>
                <a
                  href={`${explorerBase}/object/${packageId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="playground__deploy-link"
                >
                  View ↗
                </a>
              </div>
            )}
            {txDigest && (
              <div className="playground__deploy-row">
                <span className="playground__deploy-label">Digest</span>
                <code className="playground__deploy-value">{txDigest}</code>
                <a
                  href={`${explorerBase}/tx/${txDigest}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="playground__deploy-link"
                >
                  View ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="playground__actions">
        <button
          className="playground__btn playground__btn--toggle"
          onClick={() => setShowLogs((v) => !v)}
          title={showLogs ? 'Hide console' : 'Show console'}
        >
          <img src="/terminal.svg" alt="" className="playground__btn-icon" />
        </button>
        <div className="playground__spacer" />
        <select
          className="playground__network-select"
          value={network}
          onChange={(e) => {
            selectNetwork(e.target.value);
            localStorage.setItem('playmove_network', e.target.value);
          }}
          disabled={busy}
        >
          <option value="devnet">Devnet</option>
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>
        <button
          className="playground__btn playground__btn--build"
          onClick={onBuild}
          disabled={busy}
        >
          {busy ? '⏳ Building…' : '▶ Build'}
        </button>
        <button
          className="playground__btn playground__btn--deploy"
          onClick={onDeploy}
          disabled={!compiled || !account || isPublishing || buildOk !== true}
        >
          {isPublishing ? '⏳ Deploying…' : '🚀 Deploy'}
        </button>
      </div>
    </div>
  );
}

/* ── File tree helpers ───────────────────────────────── */

type FileTreeNode = {
  name: string;
  path?: string;
  children?: FileTreeNode[];
};

function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const fullPath of paths) {
    const parts = fullPath.split('/');
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      let node = nodes.find((n) => n.name === name);
      if (!node) {
        node = { name, ...(isFile ? { path: fullPath } : { children: [] }) };
        nodes.push(node);
      }
      if (!isFile) nodes = node.children!;
    }
  }

  const sortTree = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      const aFile = Boolean(a.path);
      const bFile = Boolean(b.path);
      if (aFile !== bFile) return aFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortTree(n.children));
  };
  sortTree(root);
  return root;
}

function FileTree({
  tree,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  tree: FileTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {tree.map((node) => {
        const isFile = Boolean(node.path);
        const isSelected = node.path === selectedPath;
        return (
          <div key={node.path ?? `dir-${node.name}-${depth}`}>
            <div
              className={`playground__tree-item ${
                isFile ? 'playground__tree-file' : 'playground__tree-folder'
              } ${isSelected ? 'playground__tree-item--active' : ''}`}
              style={{ paddingLeft: 12 + depth * 14 }}
              onClick={() => node.path && onSelect(node.path)}
            >
              <span className="playground__tree-icon">
                {isFile ? '📄' : '📁'}
              </span>
              {node.name}
            </div>
            {node.children && (
              <FileTree
                tree={node.children}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
