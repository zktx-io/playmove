import { useState, useRef, useCallback, useEffect } from 'react';
import {
  useCurrentAccount,
  useCurrentClient,
  useCurrentNetwork,
  useDAppKit,
} from '@mysten/dapp-kit-react';
import type { SuiClientTypes } from '@mysten/sui/client';
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
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const [isPublishing, setIsPublishing] = useState(false);
  const network = useCurrentNetwork();

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

  const onDeploy = async () => {
    if (!compiled || !account) return;
    if (!('modules' in compiled) || !(compiled as BuildSuccess).modules.length)
      return;

    setPackageId('');
    setTxDigest('');
    setIsPublishing(true);
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

    try {
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      // gRPC result is a discriminated union: check $kind before accessing fields
      const digest =
        res.$kind === 'Transaction'
          ? res.Transaction.digest
          : res.FailedTransaction?.digest ?? '';
      if (!digest) {
        addLog('❌ Transaction failed (no digest)');
        return;
      }
      addLog(`📜 Tx digest: ${digest}`);
      setTxDigest(digest);
      try {
        // waitForTransaction: core API include 스타일 (2.x) — showObjectChanges 사용 불가
        // effects: true 필수 — changedObjects 읽기 위해 필요 (section 4.5)
        const txb = await suiClient.waitForTransaction({
          digest,
          include: { transaction: true, effects: true },
        });
        const txData =
          txb.$kind === 'Transaction' ? txb.Transaction : txb.FailedTransaction;
        // 2.x: 최상위 objectChanges 없음 — effects.changedObjects를 idOperation으로 필터링
        // ChangedObject.objectId는 최상위 필드 (outputState 아님)
        const changedObjects: SuiClientTypes.ChangedObject[] =
          txData.effects?.changedObjects ?? [];
        // 패키지 publish 시 idOperation === 'Created' && outputState === 'PackageWrite'
        const createdPkg = changedObjects.find(
          (o) => o.idOperation === 'Created' && o.outputState === 'PackageWrite',
        )?.objectId;
        if (createdPkg) {
          addLog(`📦 Package ID: ${createdPkg}`);
          setPackageId(createdPkg);
        }
      } catch (e) {
        addLog(`⚠️ Lookup failed: ${String(e)}`);
      }
    } catch (e) {
      addLog(`❌ Publish failed: ${String(e)}`);
    } finally {
      setIsPublishing(false);
    }
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
