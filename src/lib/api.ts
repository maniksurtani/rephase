import type { Account, AppData, FlightLookupResult } from './types';
import { isAppData } from './store';

export interface AuthConfig {
  googleClientId: string | null;
  syncAvailable: boolean;
  flightLookupAvailable?: boolean;
  flightProvider?: 'aerodatabox';
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const signal = options?.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(18000)])
    : AbortSignal.timeout(18000);
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    signal,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      'Account services are unavailable. Check your connection and try again.',
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      (payload as { error?: string })?.error ?? 'The request could not be completed.',
      response.status,
    );
  return payload as T;
}
export async function getConfig(): Promise<AuthConfig> {
  try {
    return await api<AuthConfig>('/api/config');
  } catch {
    return { googleClientId: null, syncAvailable: false };
  }
}
export async function getAccount(): Promise<Account | null> {
  try {
    return await api<Account>('/api/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export async function getCloudState(
  accountId: string,
): Promise<{ data: AppData | null; revision: number }> {
  const result = await api<{ data: unknown; revision: number }>('/api/state', {
    headers: { 'X-Rephase-Account': accountId },
  });
  if (result.data !== null && !isAppData(result.data))
    throw new Error('Cloud data has an unsupported format. The local copy has been preserved.');
  return result as { data: AppData | null; revision: number };
}
export const putCloudState = (data: AppData, revision: number, accountId: string) =>
  api<{ revision: number }>('/api/state', {
    method: 'PUT',
    headers: { 'X-Rephase-Account': accountId },
    body: JSON.stringify({ data, revision }),
  });
export const deleteCloudState = (accountId: string) =>
  api<{ revision: number }>('/api/state', {
    method: 'DELETE',
    headers: { 'X-Rephase-Account': accountId },
  });
export const logout = () => api('/api/auth/logout', { method: 'POST' });
export function lookupFlight(
  accountId: string,
  flightNumber: string,
  date: string,
  departureAirport?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ flightNumber, date });
  if (departureAirport) query.set('departureAirport', departureAirport);
  return api<FlightLookupResult>(`/api/flights?${query}`, {
    headers: { 'X-Rephase-Account': accountId },
    signal,
  });
}
