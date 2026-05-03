import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import {
  useCurrentAccount,
  useCurrentNetwork,
  useDAppKit,
} from '@mysten/dapp-kit-react';
import { useMoveBuilder } from '../hooks/useMoveBuilder';
import type { DeployResultState } from '../hooks/useMoveBuilder';
import type { Project } from '../types';
import { WalletConnectModalTrigger } from './WalletConnectModalTrigger';
import {
  countHiddenFiles,
  getInitialFilePath,
  getVisibleFilePaths,
} from '../utils/projectFiles';
import {
  FALLBACK_NETWORK,
  getExplorerBase,
  isSuiNetwork,
  NETWORKS,
  storeNetwork,
} from '../utils/networks';
import './Playground.css';

type AnsiColorMap = Record<number, string>;
/* eslint-disable-next-line no-control-regex */
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

interface PlaygroundProps {
  project: Project;
}

export function Playground({ project }: PlaygroundProps) {
  const [files, setFiles] = useState(project.files);
  const [selectedPath, setSelectedPath] = useState(() =>
    getInitialFilePath(project.files),
  );
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const {
    logs,
    deployResult,
    isBuilding,
    isPublishing,
    canDeploy,
    onBuild,
    onDeploy,
  } = useMoveBuilder(files);

  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const currentNetwork = useCurrentNetwork();
  const network = isSuiNetwork(currentNetwork)
    ? currentNetwork
    : FALLBACK_NETWORK;
  const explorerBase = getExplorerBase(network);

  const visiblePaths = useMemo(() => getVisibleFilePaths(files), [files]);
  const hiddenCount = useMemo(
    () => countHiddenFiles(files, visiblePaths),
    [files, visiblePaths],
  );
  const activePath =
    selectedPath && selectedPath in files
      ? selectedPath
      : getInitialFilePath(files);

  useEffect(() => {
    if (showLogs) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

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
    if (activePath.endsWith('.move')) return moveExt;
    if (activePath.endsWith('.toml')) return tomlExt;
    return baseExt;
  }, [activePath, moveExt, tomlExt, baseExt]);

  const handleBuild = () => {
    setShowLogs(true);
    onBuild();
  };

  const handleDeploy = () => {
    setShowLogs(true);
    onDeploy();
  };

  const handleNetworkChange = (value: string) => {
    if (!isSuiNetwork(value)) return;
    dAppKit.switchNetwork(value);
    storeNetwork(value);
  };

  return (
    <div className="playground">
      <div className="playground__tabs" aria-label="Project files">
        {visiblePaths.map((path) => (
          <button
            key={path}
            type="button"
            className={`playground__tab ${
              path === activePath ? 'playground__tab--active' : ''
            }`}
            onClick={() => setSelectedPath(path)}
            title={path}
          >
            {path}
          </button>
        ))}
        {hiddenCount > 0 && (
          <span
            className="playground__tab playground__tab--hidden"
            title="Included in build"
          >
            +{hiddenCount} files
          </span>
        )}
      </div>

      <div className="playground__body">
        <div className="playground__editor">
          <CodeMirror
            value={files[activePath] ?? ''}
            height="100%"
            extensions={extensions}
            theme={editorTheme}
            onChange={(value) =>
              setFiles((prev) => ({ ...prev, [activePath]: value }))
            }
          />
        </div>
      </div>

      <BuildConsole
        showLogs={showLogs}
        logs={logs}
        deployResult={deployResult}
        explorerBase={explorerBase}
        logEndRef={logEndRef}
      />

      <div className="playground__actions">
        <button
          type="button"
          className="playground__btn playground__btn--toggle"
          onClick={() => setShowLogs((value) => !value)}
          title={showLogs ? 'Hide console' : 'Show console'}
        >
          <img src="/terminal.svg" alt="" className="playground__btn-icon" />
        </button>
        <div className="playground__spacer" />
        <select
          className="playground__network-select"
          value={network}
          onChange={(event) => handleNetworkChange(event.target.value)}
          disabled={isBuilding || isPublishing}
        >
          {NETWORKS.map((networkOption) => (
            <option key={networkOption} value={networkOption}>
              {labelNetwork(networkOption)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="playground__btn playground__btn--build"
          onClick={handleBuild}
          disabled={isBuilding || isPublishing}
        >
          {isBuilding ? '⏳ Building…' : '▶ Build'}
        </button>
        {account ? (
          <button
            type="button"
            className="playground__btn playground__btn--deploy"
            onClick={handleDeploy}
            disabled={!canDeploy || isBuilding || isPublishing}
          >
            {isPublishing ? '⏳ Deploying…' : '🚀 Deploy'}
          </button>
        ) : (
          <WalletConnectModalTrigger className="playground__btn playground__btn--deploy">
            Connect Wallet
          </WalletConnectModalTrigger>
        )}
      </div>
    </div>
  );
}

function BuildConsole({
  showLogs,
  logs,
  deployResult,
  explorerBase,
  logEndRef,
}: {
  showLogs: boolean;
  logs: string[];
  deployResult: DeployResultState;
  explorerBase: string;
  logEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className={`playground__console ${
        showLogs ? 'playground__console--open' : ''
      }`}
    >
      <div className="playground__console-body">
        {logs.map((line, index) => (
          <div key={`${index}-${line}`} className="playground__console-line">
            {renderAnsi(line, ANSI_COLORS)}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
      <DeployInfo deployResult={deployResult} explorerBase={explorerBase} />
    </div>
  );
}

function DeployInfo({
  deployResult,
  explorerBase,
}: {
  deployResult: DeployResultState;
  explorerBase: string;
}) {
  if (deployResult.status !== 'success' && deployResult.status !== 'failure') {
    return null;
  }

  const digest = deployResult.digest;
  const packageId =
    deployResult.status === 'success' ? deployResult.packageId : undefined;

  return (
    <div className="playground__deploy-info">
      <div className="playground__deploy-status">
        {deployResult.status === 'success' ? '✅ Deployed' : '❌ Deploy failed'}
      </div>
      {packageId && (
        <DeployInfoRow
          label="Package ID"
          value={packageId}
          href={`${explorerBase}/object/${packageId}`}
        />
      )}
      {digest && (
        <DeployInfoRow
          label="Digest"
          value={digest}
          href={`${explorerBase}/tx/${digest}`}
        />
      )}
    </div>
  );
}

function DeployInfoRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <div className="playground__deploy-row">
      <span className="playground__deploy-label">{label}</span>
      <code className="playground__deploy-value">{value}</code>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="playground__deploy-link"
      >
        View ↗
      </a>
    </div>
  );
}

function renderAnsi(text: string, colorMap: AnsiColorMap): ReactNode[] {
  const nodes: ReactNode[] = [];
  let currentColor: string | null = null;
  let isBold = false;
  let lastIndex = 0;
  let key = 0;

  const flush = (chunk: string) => {
    if (!chunk) return;
    const style: CSSProperties = {};
    if (currentColor) style.color = currentColor;
    if (isBold) style.fontWeight = 600;
    chunk.split('\n').forEach((part, index, parts) => {
      if (part) {
        nodes.push(
          <span key={`a-${key++}`} style={style}>
            {part}
          </span>,
        );
      }
      if (index < parts.length - 1) nodes.push(<br key={`b-${key++}`} />);
    });
  };

  for (const match of text.matchAll(ANSI_REGEX)) {
    const index = match.index ?? 0;
    flush(text.slice(lastIndex, index));
    const codes = (match[0].slice(2, -1) || '0').split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentColor = null;
        isBold = false;
      } else if (code === 1) isBold = true;
      else if (code === 22) isBold = false;
      else if (code === 39) currentColor = null;
      else if (colorMap[code]) currentColor = colorMap[code];
    }
    lastIndex = index + match[0].length;
  }
  flush(text.slice(lastIndex));
  return nodes;
}

function labelNetwork(network: string): string {
  return `${network.slice(0, 1).toUpperCase()}${network.slice(1)}`;
}
