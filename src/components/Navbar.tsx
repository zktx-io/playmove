import { useMemo, useState } from "react";
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import "./Navbar.css";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const account = useCurrentAccount();
  const { mutate: disconnect, isPending } = useDisconnectWallet();

  const label = useMemo(() => {
    if (!account) return null;
    return formatAddress(account.address);
  }, [account]);

  return (
    <nav className="navbar">
      <a href="/">
        <img src="/logo.png" alt="PlayMove" className="navbar__logo" />
      </a>

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
            <svg className="navbar__auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg className="navbar__auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 12L21 12" />
                  <path d="M16 15L13.087 12.087C13.039 12.039 13.039 11.961 13.087 11.913L16 9" />
                  <path d="M16 5V4.5C16 3.67157 15.3284 3 14.5 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H14.5C15.3284 21 16 20.3284 16 19.5V19" />
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
