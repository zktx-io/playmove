import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const GRPC_URLS = {
    devnet: 'https://fullnode.devnet.sui.io:443',
    testnet: 'https://fullnode.testnet.sui.io:443',
    mainnet: 'https://fullnode.mainnet.sui.io:443',
} as const;

type Network = keyof typeof GRPC_URLS;

const VALID_NETWORKS = Object.keys(GRPC_URLS) as Network[];

const saved = localStorage.getItem('playmove_network') as Network | null;
export const defaultNetwork: Network =
    saved && VALID_NETWORKS.includes(saved) ? saved : 'testnet';

export const dAppKit = createDAppKit({
    networks: ['devnet', 'testnet', 'mainnet'] as const,
    createClient: (network: string) =>
        new SuiGrpcClient({
            network: network as Network,
            baseUrl: GRPC_URLS[network as Network],
        }),
});

// Register for TypeScript autocomplete
declare module '@mysten/dapp-kit-react' {
    interface Register {
        dAppKit: typeof dAppKit;
    }
}
