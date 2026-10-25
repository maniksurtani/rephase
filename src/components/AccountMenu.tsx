import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, LogOut, UserRound } from 'lucide-react';
import type { Account } from '../lib/types';
import { GoogleSignInButton } from './GoogleSignInButton';

export function AccountAvatar({ account }: { account: Account | null }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const initials =
    account?.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'R';
  return account?.picture && failedPicture !== account.picture ? (
    <img
      className="account-avatar-image"
      src={account.picture}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailedPicture(account.picture ?? null)}
    />
  ) : account ? (
    <span aria-hidden="true">{initials}</span>
  ) : (
    <UserRound size={19} aria-hidden="true" />
  );
}

export function AccountMenu({
  account,
  clientId,
  onProfile,
  onGoogleSignIn,
  onSignInError,
  onSignOut,
}: {
  account: Account | null;
  clientId: string | null;
  onProfile: () => void;
  onGoogleSignIn: (account: Account) => void;
  onSignInError: (error: Error) => void;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    setOpen(false);
    setError(null);
  }, [account?.id]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="account-menu"
      ref={container}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      {account ? (
        <button
          ref={trigger}
          type="button"
          className={`topbar-avatar ${account.picture ? 'has-picture' : ''}`}
          aria-label={`${account.name}'s account menu`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {busy ? <LoaderCircle size={19} className="spin" /> : <AccountAvatar account={account} />}
        </button>
      ) : clientId ? (
        <GoogleSignInButton
          clientId={clientId}
          onSuccess={onGoogleSignIn}
          onError={onSignInError}
          compact
        />
      ) : (
        <button
          type="button"
          className="topbar-avatar"
          aria-label="Open your profile"
          onClick={onProfile}
        >
          <UserRound size={19} />
        </button>
      )}
      {open && account && (
        <div className="account-dropdown">
          <div className="account-menu-identity">
            <strong>{account.name}</strong>
            <span>{account.email}</span>
          </div>
          <div
            id={menuId}
            role="menu"
            aria-label="Your account"
            ref={menu}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                trigger.current?.focus();
                return;
              }
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not(:disabled)',
                ) ?? [],
              );
              if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
                return;
              event.preventDefault();
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const target =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[target]?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={busy}
              onClick={() => {
                onProfile();
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <UserRound size={17} />
              Settings
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={busy}
              onClick={() => void act(onSignOut)}
            >
              <LogOut size={17} />
              Sign out
            </button>
          </div>
          {error && (
            <p className="account-menu-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {!open && error && (
        <p className="account-menu-error standalone" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
