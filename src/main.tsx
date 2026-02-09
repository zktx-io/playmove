import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from '@mysten/dapp-kit';
import '@mysten/dapp-kit/dist/index.css';

import './index.css';
import App from './App.tsx';

const { networkConfig } = createNetworkConfig({
  devnet: { url: 'https://fullnode.devnet.sui.io:443' },
  testnet: { url: 'https://fullnode.testnet.sui.io:443' },
  mainnet: { url: 'https://fullnode.mainnet.sui.io:443' },
});

const NETWORK_KEY = 'playmove_network';
const VALID_NETWORKS = ['devnet', 'testnet', 'mainnet'] as const;
type Network = (typeof VALID_NETWORKS)[number];

const saved = localStorage.getItem(NETWORK_KEY);
const defaultNetwork: Network =
  saved && VALID_NETWORKS.includes(saved as Network)
    ? (saved as Network)
    : 'testnet';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider
        networks={networkConfig}
        defaultNetwork={defaultNetwork}
      >
        <WalletProvider autoConnect>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
