import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  FALLBACK_NETWORK,
  getStoredNetwork,
  GRPC_URLS,
  isSuiNetwork,
  NETWORKS,
} from './utils/networks';

export const defaultNetwork = getStoredNetwork();

export const dAppKit = createDAppKit({
  networks: NETWORKS,
  defaultNetwork,
  createClient: (network) =>
    new SuiGrpcClient({
      network: isSuiNetwork(network) ? network : FALLBACK_NETWORK,
      baseUrl: GRPC_URLS[isSuiNetwork(network) ? network : FALLBACK_NETWORK],
    }),
});

// Register for TypeScript autocomplete
declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
