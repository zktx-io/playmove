import type { ReactNode } from 'react';
import { useRef } from 'react';
import { ConnectModal } from '@mysten/dapp-kit-react/ui';
import type { DAppKitConnectModal } from '@mysten/dapp-kit-core/web';

interface WalletConnectModalTriggerProps {
  children: ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
}

export function WalletConnectModalTrigger({
  children,
  className,
  title,
  disabled,
}: WalletConnectModalTriggerProps) {
  const modalRef = useRef<DAppKitConnectModal | null>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => modalRef.current?.show()}
        title={title}
        disabled={disabled}
      >
        {children}
      </button>
      <ConnectModal ref={modalRef} />
    </>
  );
}
