import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getPinnedSuiMoveVersion,
  initMovePackageBuilder,
  prepareMovePackagePublish,
  updateMovePackagePublication,
} from '@zktx.io/sui-move-builder';
import type {
  MovePackageGitSource,
  MovePackageProgressEvent,
  MovePackagePublishSuccess as CompilerBuildSuccess,
} from '@zktx.io/sui-move-builder';
import type { FileMap } from '../types';
import { getGitHubToken } from '../utils/githubToken';
import { getBuildFiles } from '../utils/projectFiles';
import {
  FALLBACK_NETWORK,
  isSuiNetwork,
  type SuiNetwork,
} from '../utils/networks';

export type BuildResultState =
  | { status: 'idle' }
  | { status: 'running' }
  | {
      status: 'success';
      compiled: CompilerBuildSuccess;
      elapsedSeconds: string;
      files: FileMap;
    }
  | { status: 'failure'; error: string };

export type DeployResultState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'success'; digest: string; packageId: string; files: FileMap }
  | { status: 'failure'; error: string; digest?: string; files: FileMap };

const MAX_LOG_LINES = 300;

interface MoveBuilderOptions {
  rootGit?: MovePackageGitSource;
  onFilesUpdated?: (files: FileMap) => void;
}

export function useMoveBuilder(
  files: FileMap,
  { rootGit, onFilesUpdated }: MoveBuilderOptions = {},
) {
  const [logs, setLogs] = useState<string[]>([]);
  const [buildResult, setBuildResult] = useState<BuildResultState>({
    status: 'idle',
  });
  const [deployResult, setDeployResult] = useState<DeployResultState>({
    status: 'idle',
  });

  const compilerRef = useRef<Promise<void> | null>(null);
  const versionRef = useRef<string | null>(null);

  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const currentNetwork = useCurrentNetwork();
  const network: SuiNetwork = isSuiNetwork(currentNetwork)
    ? currentNetwork
    : FALLBACK_NETWORK;

  const buildFiles = useMemo(() => getBuildFiles(files), [files]);

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
    let canceled = false;
    (async () => {
      if (!compilerRef.current) {
        compilerRef.current = initMovePackageBuilder();
      }
      try {
        await compilerRef.current;
      } catch {
        return;
      }
      if (canceled) return;
      try {
        const version = versionRef.current ?? (await getPinnedSuiMoveVersion());
        versionRef.current = version;
        const ts = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, `[${ts}] 📌 Compiler ready — ${version}`]);
      } catch {
        /* version read failure is non-fatal */
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const onBuildAndDeploy = async () => {
    addLog('── ── ── ── ──');
    addLog('🚀 Build & Deploy started');
    setBuildResult({ status: 'running' });
    setDeployResult({ status: 'idle' });

    if (!account) {
      const error = 'Connect wallet before deploying';
      addLog(`❌ ${error}`);
      setBuildResult({ status: 'idle' });
      setDeployResult({ status: 'failure', error, files });
      return;
    }

    const compiled = await buildPublishPayload();
    if (!compiled) return;

    await publishCompiledPackage(compiled);
  };

  const buildPublishPayload =
    async (): Promise<CompilerBuildSuccess | null> => {
      const start = performance.now();
      try {
        if (!compilerRef.current) {
          compilerRef.current = initMovePackageBuilder();
        }
        await compilerRef.current;

        const result = await prepareMovePackagePublish({
          files: buildFiles,
          ...(rootGit ? { rootGit } : {}),
          githubToken: getGitHubToken(),
          silenceWarnings: false,
          ansiColor: true,
          network,
          onProgress: (ev: MovePackageProgressEvent) => {
            switch (ev.type) {
              case 'resolve_start':
                addLog('📦 Resolving dependencies…');
                break;
              case 'resolve_dep':
                addLog(
                  `  dep [${ev.current}/${ev.total}]: ${ev.name} (${ev.source})`,
                );
                break;
              case 'resolve_complete':
                addLog(`Dependencies resolved (${ev.count})`);
                break;
              case 'fetch_failed':
                addLog(`⚠️ ${ev.dependencyName}: ${ev.error}`);
                break;
              case 'compile_start':
                addLog('🔨 Compiling…');
                break;
              case 'compile_complete':
                addLog('Compilation complete');
                break;
              case 'lockfile_generate':
                addLog('📝 Writing Move.lock…');
                break;
              default:
                break;
            }
          },
        });

        const elapsedSeconds = ((performance.now() - start) / 1000).toFixed(1);

        if ('error' in result) {
          addLog('❌ Build failed');
          addLog(result.error || 'Unknown error');
          setBuildResult({
            status: 'failure',
            error: result.error || 'Unknown error',
          });
          return null;
        }

        addLog(`✅ Build succeeded in ${elapsedSeconds}s`);
        addLog(
          `🧩 Package ready: ${result.modules.length} ${pluralize(
            result.modules.length,
            'module',
          )}`,
        );
        if (result.warnings) addLog(`⚠️ ${result.warnings}`);
        setBuildResult({
          status: 'success',
          compiled: result,
          elapsedSeconds,
          files,
        });
        return result;
      } catch (e) {
        const error = formatError(e);
        addLog(`❌ ${error}`);
        setBuildResult({ status: 'failure', error });
        return null;
      }
    };

  const publishCompiledPackage = async (compiled: CompilerBuildSuccess) => {
    if (!account) {
      return;
    }

    if (!compiled.modules.length) return;

    setDeployResult({ status: 'publishing' });
    addLog('🚀 Publishing…');

    const tx = new Transaction();
    const modules = compiled.modules.map((module) =>
      Array.from(fromBase64(module)),
    );
    const [upgradeCap] = tx.publish({
      modules,
      dependencies: compiled.dependencies,
    });
    tx.transferObjects([upgradeCap], tx.pure.address(account.address));

    try {
      const signed = await dAppKit.signAndExecuteTransaction({
        transaction: tx,
      });
      const signedTx = getTransactionData(signed);
      const digest = signedTx?.digest ?? '';

      if (!digest) {
        failDeploy('Transaction failed before a digest was returned');
        return;
      }

      addLog(`📜 Tx digest: ${digest}`);

      if (signed.$kind === 'FailedTransaction') {
        failDeploy(formatStatusError(signedTx?.status), digest);
        return;
      }

      const waited = await suiClient.core.waitForTransaction({
        digest,
        include: { transaction: true, effects: true, objectTypes: true },
      });
      const txData = getTransactionData(waited);

      if (!txData || !txData.status.success) {
        failDeploy(formatStatusError(txData?.status), digest);
        return;
      }

      const createdPackageId = findPublishedPackageId(
        txData.effects?.changedObjects ?? [],
      );

      if (!createdPackageId) {
        failDeploy(
          'Published transaction finished, but package ID was not found',
          digest,
        );
        return;
      }

      addLog(`📦 Package ID: ${createdPackageId}`);
      const deployedFiles = await updatePublicationFiles({
        files,
        compiled,
        transactionResult: waited,
        network,
        addLog,
        onFilesUpdated,
        getChainIdentifier: () => suiClient.core.getChainIdentifier(),
      });

      setDeployResult({
        status: 'success',
        digest,
        packageId: createdPackageId,
        files: deployedFiles,
      });
    } catch (e) {
      failDeploy(formatError(e));
    }
  };

  const failDeploy = (error: string, digest?: string) => {
    addLog(`❌ Publish failed: ${error}`);
    setDeployResult({ status: 'failure', error, digest, files });
  };

  const freshBuildResult =
    buildResult.status === 'success' && buildResult.files !== files
      ? ({ status: 'idle' } satisfies BuildResultState)
      : buildResult;
  const freshDeployResult =
    (deployResult.status === 'success' || deployResult.status === 'failure') &&
    deployResult.files !== files
      ? ({ status: 'idle' } satisfies DeployResultState)
      : deployResult;

  return {
    logs,
    buildResult: freshBuildResult,
    deployResult: freshDeployResult,
    isBuilding: freshBuildResult.status === 'running',
    isPublishing: freshDeployResult.status === 'publishing',
    onBuildAndDeploy,
  };
}

function getTransactionData<Include extends SuiClientTypes.TransactionInclude>(
  result: SuiClientTypes.TransactionResult<Include>,
) {
  return result.$kind === 'Transaction'
    ? result.Transaction
    : result.FailedTransaction;
}

function findPublishedPackageId(
  changedObjects: SuiClientTypes.ChangedObject[],
): string | undefined {
  return changedObjects.find(
    (object) =>
      object.idOperation === 'Created' && object.outputState === 'PackageWrite',
  )?.objectId;
}

async function updatePublicationFiles({
  files,
  compiled,
  transactionResult,
  network,
  addLog,
  onFilesUpdated,
  getChainIdentifier,
}: {
  files: FileMap;
  compiled: CompilerBuildSuccess;
  transactionResult: SuiClientTypes.TransactionResult<{
    transaction: true;
    effects: true;
    objectTypes: true;
  }>;
  network: SuiNetwork;
  addLog: (msg: string) => void;
  onFilesUpdated?: (files: FileMap) => void;
  getChainIdentifier: () => Promise<{ chainIdentifier: string }>;
}): Promise<FileMap> {
  const filesWithLock: FileMap = {
    ...files,
    'Move.lock': compiled.moveLock,
  };
  if (compiled.publishedToml) {
    filesWithLock['Published.toml'] = compiled.publishedToml;
  }

  try {
    const { chainIdentifier } = await getChainIdentifier();
    const updated = await updateMovePackagePublication({
      files: filesWithLock,
      prepared: compiled,
      result: transactionResult,
      network,
      chainId: chainIdentifier,
    });

    if ('error' in updated) {
      addLog(`⚠️ Publication files not updated: ${updated.error}`);
      return files;
    }

    onFilesUpdated?.(updated.files);
    addLog('📝 Publication files updated');
    return updated.files;
  } catch (error) {
    addLog(`⚠️ Publication files not updated: ${formatError(error)}`);
    return files;
  }
}

function pluralize(count: number, label: string): string {
  return count === 1 ? label : `${label}s`;
}

function formatStatusError(
  status: SuiClientTypes.ExecutionStatus | undefined,
): string {
  if (!status) return 'Transaction failed';
  if (status.success) return 'Transaction failed';
  return formatError(status.error);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
