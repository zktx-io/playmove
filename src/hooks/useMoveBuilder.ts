import { useState, useRef, useCallback, useEffect } from 'react';
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

/* ── Types ───────────────────────────────────────────── */

export type BuildResult = Awaited<ReturnType<typeof buildMovePackage>>;
export type BuildSuccess = BuildResult & {
  success: true;
  modules: string[];
  dependencies?: string[];
  digest?: string;
};

const MAX_LOG_LINES = 300;

export function useMoveBuilder(files: Record<string, string>) {
  // Build / deploy state
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildOk, setBuildOk] = useState<boolean | null>(null);
  const [compiled, setCompiled] = useState<BuildResult | null>(null);
  const [packageId, setPackageId] = useState('');
  const [txDigest, setTxDigest] = useState('');

  // Compiler
  const compilerRef = useRef<Promise<void> | null>(null);
  const versionRef = useRef<string | null>(null);

  // dApp Kit
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecute, isPending: isPublishing } =
    useSignAndExecuteTransaction();
  const { network } = useSuiClientContext();

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

  // Init compiler on mount — log version silently
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

  return {
    busy,
    logs,
    buildOk,
    compiled,
    packageId,
    txDigest,
    isPublishing,
    onBuild,
    onDeploy,
  };
}
