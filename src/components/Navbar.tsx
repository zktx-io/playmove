import { useMemo, useState } from 'react';
import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from '@mysten/dapp-kit';
import './Navbar.css';

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface NavbarProps {
  onHome?: () => void;
}

export function Navbar({ onHome }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const account = useCurrentAccount();
  const { mutate: disconnect, isPending } = useDisconnectWallet();

  const label = useMemo(() => {
    if (!account) return null;
    return formatAddress(account.address);
  }, [account]);

  return (
    <nav className="navbar">
      <button type="button" className="navbar__home-btn" onClick={onHome}>
        <img src="/navbar.png" alt="PlayMove" className="navbar__logo" />
      </button>

      <div className="navbar__right">
        {account && (
          <span className="navbar__address" title={account.address}>
            {label}
          </span>
        )}

        {account ? (
          <button
            type="button"
            className="navbar__auth-btn"
            onClick={() => disconnect()}
            disabled={isPending}
            title="Logout"
          >
            <svg
              className="navbar__auth-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12L13 12" />
              <path d="M18 15L20.913 12.087C20.961 12.039 20.961 11.961 20.913 11.913L18 9" />
              <path d="M16 5V4.5C16 3.67157 15.3284 3 14.5 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H14.5C15.3284 21 16 20.3284 16 19.5V19" />
            </svg>
          </button>
        ) : (
          <ConnectModal
            trigger={
              <button
                type="button"
                className="navbar__auth-btn"
                onClick={() => setOpen(true)}
                title="Login"
              >
                <svg
                  className="navbar__auth-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 -960 960 960"
                  fill="currentColor"
                >
                  <path d="M200-200v-560 560Zm0 80q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v100h-80v-100H200v560h560v-100h80v100q0 33-23.5 56.5T760-120H200Zm320-160q-33 0-56.5-23.5T440-360v-240q0-33 23.5-56.5T520-680h280q33 0 56.5 23.5T880-600v240q0 33-23.5 56.5T800-280H520Zm280-80v-240H520v240h280Zm-160-60q25 0 42.5-17.5T700-480q0-25-17.5-42.5T640-540q-25 0-42.5 17.5T580-480q0 25 17.5 42.5T640-420Z" />
                </svg>
              </button>
            }
            open={open}
            onOpenChange={setOpen}
          />
        )}
      </div>
    </nav>
  );
}
