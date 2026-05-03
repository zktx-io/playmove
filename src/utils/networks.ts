import type { SuiClientTypes } from '@mysten/sui/client';

const NETWORK_VALUES = ['devnet', 'testnet', 'mainnet'] as const;
export type SuiNetwork = (typeof NETWORK_VALUES)[number];
export const NETWORKS: SuiNetwork[] = [...NETWORK_VALUES];

export const PLAYMOVE_NETWORK_KEY = 'playmove_network';

export const GRPC_URLS: Record<SuiNetwork, string> = {
  devnet: 'https://fullnode.devnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
};

export const EXPLORER_BASE_URLS: Record<SuiNetwork, string> = {
  devnet: 'https://suiscan.xyz/devnet',
  testnet: 'https://suiscan.xyz/testnet',
  mainnet: 'https://suiscan.xyz/mainnet',
};

export const FALLBACK_NETWORK: SuiNetwork = 'testnet';

export function isSuiNetwork(value: string): value is SuiNetwork {
  return NETWORKS.includes(value as SuiNetwork);
}

export function getStoredNetwork(): SuiNetwork {
  try {
    const saved = localStorage.getItem(PLAYMOVE_NETWORK_KEY);
    return saved && isSuiNetwork(saved) ? saved : FALLBACK_NETWORK;
  } catch {
    return FALLBACK_NETWORK;
  }
}

export function storeNetwork(network: SuiNetwork) {
  try {
    localStorage.setItem(PLAYMOVE_NETWORK_KEY, network);
  } catch {
    /* localStorage is best-effort only */
  }
}

export function getExplorerBase(network: SuiClientTypes.Network): string {
  return isSuiNetwork(network)
    ? EXPLORER_BASE_URLS[network]
    : EXPLORER_BASE_URLS[FALLBACK_NETWORK];
}
