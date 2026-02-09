import { useState } from 'react';
import type { Project } from '../types';
import './Playground.css';

interface PlaygroundProps {
  project: Project;
  onBack: () => void;
}

export function Playground({ project, onBack }: PlaygroundProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [buildResult, setBuildResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const file = project.files[activeIdx];

  const handleBuild = () => {
    // TODO: integrate @zktx.io/sui-move-builder/lite
    setBuildResult({ ok: true, message: 'Build succeeded (stub)' });
  };

  const handleDeploy = () => {
    // TODO: integrate dapp-kit signAndExecuteTransaction
    setBuildResult({ ok: true, message: 'Deploy not yet implemented' });
  };

  return (
    <div className="playground">
      {/* File tabs */}
      <div className="playground__tabs">
        {project.files.map((f, i) => (
          <button
            key={f.path}
            className={`playground__tab ${i === activeIdx ? 'playground__tab--active' : ''}`}
            onClick={() => setActiveIdx(i)}
          >
            {f.path.split('/').pop()}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="playground__editor">
        {/* TODO: replace with CodeMirror */}
        <pre
          style={{
            padding: '1rem',
            margin: 0,
            height: '100%',
            overflow: 'auto',
            fontSize: '0.85rem',
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          {file?.content ?? ''}
        </pre>
      </div>

      {/* Result card */}
      {buildResult && (
        <div className="playground__result">
          <span
            className={`playground__result-badge ${
              buildResult.ok
                ? 'playground__result-badge--success'
                : 'playground__result-badge--error'
            }`}
          >
            {buildResult.ok ? '✅' : '❌'} {buildResult.message}
          </span>
        </div>
      )}

      {/* Action bar */}
      <div className="playground__actions">
        <button
          className="playground__btn playground__btn--back"
          onClick={onBack}
        >
          ← Back
        </button>
        <div className="playground__spacer" />
        <button
          className="playground__btn playground__btn--build"
          onClick={handleBuild}
        >
          ▶ Build
        </button>
        <button
          className="playground__btn playground__btn--deploy"
          onClick={handleDeploy}
        >
          🚀 Deploy
        </button>
      </div>
    </div>
  );
}
