import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Dialog } from './components/Dialog';
import { createInitialData } from './lib/defaults';
import { loadData, loadLastAccount } from './lib/store';
import { getConfig, logout, type AuthConfig } from './lib/api';
import { AccountPersistence, type PersistenceState } from './lib/account-persistence';
import type { Account } from './lib/types';
import './root.css';
import './fonts.css';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation could not be completed.';

function Root() {
  const [controller, setController] = useState<AccountPersistence | null>(null);
  const [state, setState] = useState<PersistenceState | null>(null);
  const [config, setConfig] = useState<AuthConfig>({ googleClientId: null, syncAvailable: false });
  const [conflictVisible, setConflictVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AccountPersistence | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      let storageError: string | null = null;
      let guest;
      try {
        guest = (await loadData(null)) ?? createInitialData();
      } catch (error) {
        guest = createInitialData();
        storageError = `Device data could not be opened. ${message(error)}`;
      }
      let cachedAccount: Account | null = null;
      try {
        cachedAccount = await loadLastAccount();
      } catch {
        /* Optional display metadata, never an authentication credential. */
      }
      if (!active) return;
      const next = new AccountPersistence({ account: null, data: guest, storageError });
      controllerRef.current = next;
      if (cachedAccount) await next.restoreCachedAccount(cachedAccount);
      if (!active) {
        next.dispose();
        return;
      }
      unsubscribe = next.subscribe(setState);
      setState(next.getSnapshot());
      setController(next);
    })();
    return () => {
      active = false;
      unsubscribe?.();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!controller) return;
    let active = true;
    const refresh = async () => {
      const settings = await getConfig();
      if (!active) return;
      setConfig(settings);
      if (settings.syncAvailable) await controller.refresh();
      else controller.unavailable();
    };
    void refresh();
    const resume = () => {
      void refresh();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) resume();
    }, 5 * 60_000);
    return () => {
      active = false;
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.clearInterval(poll);
    };
  }, [controller]);
  useEffect(() => {
    if (state?.conflict) setConflictVisible(true);
  }, [state?.conflict]);

  const signedIn = useCallback((account: Account) => {
    void controllerRef.current?.openAccount(account);
  }, []);
  const signInError = useCallback((error: Error) => {
    controllerRef.current?.signInError(error);
  }, []);
  const signOut = async () => {
    if (!controller || busy) return;
    setBusy(true);
    try {
      await logout();
      await controller.signedOut();
    } catch (error) {
      controller.signInError(new Error(`Sign-out could not complete. ${message(error)}`));
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const closeConflict = useCallback(() => {
    setConflictVisible(false);
  }, []);
  const resolveConflict = async (source: 'account' | 'device') => {
    if (!controller || busy) return;
    setBusy(true);
    try {
      await controller.useConflictCopy(source);
    } finally {
      setBusy(false);
    }
  };
  if (!state || !controller)
    return (
      <div className="startup">
        <strong>Rephase</strong>
        <span>Opening your saved rhythm…</span>
      </div>
    );
  return (
    <>
      <App
        data={state.data}
        onChange={controller.change}
        account={state.account}
        authConfig={config}
        saveStatus={state.saveStatus}
        accountReady={state.accountReady}
        storageError={state.storageError}
        onGoogleSignIn={signedIn}
        onSignInError={signInError}
        onSignOut={signOut}
        onDeleteAccountData={controller.deleteAccountData}
        onClearLocal={controller.clearLocal}
      />
      {state.conflict && !conflictVisible && (
        <button
          className="button primary root-review-changes"
          onClick={() => setConflictVisible(true)}
        >
          Review changes
        </button>
      )}
      {state.conflict && conflictVisible && (
        <Dialog
          title="Choose which changes to keep"
          onClose={closeConflict}
          backdropClassName="root-backdrop"
          className="root-dialog"
        >
          <h2>Choose which changes to keep</h2>
          <p>
            The same information changed on another device. Your edits are preserved until you
            choose.
          </p>
          <p className="small-copy">{state.conflict.reasons.slice(0, 4).join('; ')}</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void resolveConflict('account')}
          >
            Use saved account version
          </button>
          <button disabled={busy} onClick={() => void resolveConflict('device')}>
            Keep this device’s changes
          </button>
          <button disabled={busy} onClick={closeConflict}>
            Decide later
          </button>
        </Dialog>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Root />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* App remains usable without offline cache. */
    });
  });
}
