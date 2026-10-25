import type { Account, AppData } from './lib/types';
import type { AuthConfig } from './lib/api';

export interface AppProps {
  data: AppData;
  onChange: (data: AppData) => void;
  account: Account | null;
  authConfig: AuthConfig;
  saveStatus: string;
  accountReady: boolean;
  requiresSignIn: boolean;
  onGoogleSignIn: (account: Account) => void;
  onSignInError: (error: Error) => void;
  onSignOut: () => Promise<void>;
  onDeleteAccountData: () => Promise<void>;
  onClearLocal: () => Promise<void>;
  storageError: string | null;
}
