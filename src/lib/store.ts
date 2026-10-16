import { openDB } from 'idb';
import type { Account, AppData } from './types';
import { isAppData } from './validation';
export { isAppData } from './validation';

export interface SyncSnapshot {
  data: AppData | null;
  revision: number;
}
const validRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const keyFor = (accountId: string | null) => (accountId ? `account:${accountId}` : 'guest');
const db = () =>
  openDB('rephase', 1, {
    upgrade(database) {
      database.createObjectStore('state');
    },
  });
const writes = new Map<string, Promise<void>>();
// Serialize by namespace. The call captures its payload immediately; an older
// asynchronous transaction cannot commit after a later edit on this tab.
function write(namespace: string, operation: () => Promise<void>): Promise<void> {
  const next = (writes.get(namespace) ?? Promise.resolve()).catch(() => {}).then(operation);
  writes.set(namespace, next);
  void next
    .finally(() => {
      if (writes.get(namespace) === next) writes.delete(namespace);
    })
    .catch(() => {});
  return next;
}
async function afterWrites(namespace: string): Promise<void> {
  await writes.get(namespace)?.catch(() => {});
}
export async function loadData(accountId: string | null): Promise<AppData | null> {
  await afterWrites(keyFor(accountId));
  const database = await db();
  try {
    const data: unknown = await database.get('state', keyFor(accountId));
    if (data === undefined) return null;
    if (!isAppData(data))
      throw new Error(
        'Saved data has an unsupported format. Export or clear this device’s data before starting again.',
      );
    return data;
  } finally {
    database.close();
  }
}
export function saveData(accountId: string | null, data: AppData): Promise<void> {
  if (!isAppData(data))
    return Promise.reject(
      new Error('The data could not be saved because it has an invalid format.'),
    );
  const copy = structuredClone(data);
  return write(keyFor(accountId), async () => {
    const database = await db();
    try {
      const transaction = database.transaction('state', 'readwrite');
      await transaction.store.put(copy, keyFor(accountId));
      await transaction.done;
    } finally {
      database.close();
    }
  });
}
export function clearData(accountId: string | null): Promise<void> {
  return write(keyFor(accountId), async () => {
    const database = await db();
    try {
      const transaction = database.transaction('state', 'readwrite');
      await transaction.store.delete(keyFor(accountId));
      await transaction.store.delete(`revision:${keyFor(accountId)}`);
      await transaction.store.delete(`snapshot:${keyFor(accountId)}`);
      if (accountId) await transaction.store.put(true, `syncPaused:${keyFor(accountId)}`);
      await transaction.done;
    } finally {
      database.close();
    }
  });
}
export async function loadSyncSnapshot(accountId: string): Promise<SyncSnapshot | null> {
  await afterWrites(keyFor(accountId));
  const database = await db();
  try {
    const snapshot: unknown = await database.get('state', `snapshot:${keyFor(accountId)}`);
    if (snapshot === undefined) return null;
    const value = snapshot as Partial<SyncSnapshot> | null;
    if (
      !value ||
      !validRevision(value.revision) ||
      !(value.data === null || isAppData(value.data))
    ) {
      throw new Error(
        'Saved sync history has an unsupported format. The device copy is preserved.',
      );
    }
    return value as SyncSnapshot;
  } finally {
    database.close();
  }
}
// A local display/namespace pointer only. Never an API credential.
export async function loadLastAccount(): Promise<Account | null> {
  await afterWrites('metadata');
  const database = await db();
  try {
    const account = (await database.get('state', 'lastAccount')) as Account | undefined;
    return account &&
      typeof account.id === 'string' &&
      account.id.length > 0 &&
      account.id.length <= 255 &&
      typeof account.name === 'string' &&
      account.name.length <= 200 &&
      typeof account.email === 'string' &&
      account.email.length <= 320
      ? account
      : null;
  } finally {
    database.close();
  }
}
export function saveLastAccount(account: Account | null): Promise<void> {
  const copy = account ? structuredClone(account) : null;
  return write('metadata', async () => {
    const database = await db();
    try {
      const transaction = database.transaction('state', 'readwrite');
      if (copy) await transaction.store.put(copy, 'lastAccount');
      else await transaction.store.delete('lastAccount');
      await transaction.done;
    } finally {
      database.close();
    }
  });
}
