import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import type { D1Database } from '@cloudflare/workers-types';
import type { AppData } from '../src/lib/types';
import { handleApi, hashToken, verifyGoogleCredential, type Env } from '../worker/index';
import { validateAppData } from '../worker/validation';

const ORIGIN = 'https://rephase.example';
const NOW = 1_800_000_000_000;
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const SESSION_A = 'a'.repeat(64);
const SESSION_B = 'b'.repeat(64);
const ACCOUNT_A = { id: 'google-user-a', name: 'Traveler A', email: 'a@example.com' };
const ACCOUNT_B = { id: 'google-user-b', name: 'Traveler B', email: 'b@example.com' };
const validData: AppData = {
  schemaVersion: 1,
  preferences: {
    homeTimeZone: 'America/Los_Angeles', chronotype: 'intermediate', usualBedtime: '23:00', usualWakeTime: '07:00',
    preferredBedtime: '23:00', preferredWakeTime: '07:00', sleepHours: 8, sleepAnchor: 'wake', caffeine: true,
    melatonin: false, melatoninAcknowledged: false, preparationDays: 3,
  },
  trips: [{
    id: 'trip-a', name: 'London', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z',
    legs: [{
      id: 'leg-a', flightNumber: 'BA286', departureAirport: 'SFO', arrivalAirport: 'LHR',
      departureDateTime: '2026-11-05T20:00', arrivalDateTime: '2026-11-06T14:00',
      departureTimeZone: 'America/Los_Angeles', arrivalTimeZone: 'Europe/London', stayAfter: 'destination', strategy: 'adapt',
      travelClass: 'economy', lieFlat: false,
    }],
  }],
  selectedTripId: 'trip-a',
};

/** Real SQLite queries exercise account isolation and conditional writes. */
function d1For(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
}

function request(path: string, method = 'GET', body?: unknown, cookie?: string, origin = ORIGIN): Request {
  const headers = new Headers();
  if (method !== 'GET') headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (path === '/api/state' && cookie) {
    headers.set('X-Rephase-Account', cookie.includes(SESSION_B) ? ACCOUNT_B.id : ACCOUNT_A.id);
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const accountCookie = (token: string) => `__Host-rephase_session=${token}`;
const cookieValue = (response: Response, name: string) => response.headers.getSetCookie()
  .find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

describe('Worker account API', () => {
  let sqlite: DatabaseSync;
  let env: Env;
  const invoke = (req: Request, overrides: Partial<Env> = {}) => handleApi(req, { ...env, ...overrides }, { now: () => NOW });

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
    env = { DB: d1For(sqlite), GOOGLE_CLIENT_ID: CLIENT_ID };
    for (const [account, token] of [[ACCOUNT_A, SESSION_A], [ACCOUNT_B, SESSION_B]] as const) {
      sqlite.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(account.id, account.name, account.email);
      sqlite.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(await hashToken(token), account.id, NOW / 1000 + 600);
    }
    // Apply the new migration after seeding legacy accounts and their sessions.
    sqlite.exec(readFileSync(new URL('../migrations/0003_google_avatar.sql', import.meta.url), 'utf8'));
  });
  afterEach(() => sqlite.close());

  it('reports absent Google setup without simulating authentication', async () => {
    const config = await invoke(request('/api/config'), { GOOGLE_CLIENT_ID: '' });
    expect(await config.json()).toEqual({ googleClientId: null, syncAvailable: false, flightLookupAvailable: false, flightProvider: 'aerodatabox' });
    const login = await invoke(request('/api/auth/google', 'POST', { credential: 'fake' }), { GOOGLE_CLIENT_ID: '' });
    expect(login.status).toBe(503);
    expect(login.headers.has('Set-Cookie')).toBe(false);
  });

  it('requires a live opaque session and returns only that account', async () => {
    expect((await invoke(request('/api/me'))).status).toBe(401);
    expect((await invoke(request('/api/me', 'GET', undefined, accountCookie('c'.repeat(64))))).status).toBe(401);
    const me = await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)));
    expect(await me.json()).toEqual(ACCOUNT_A);
    const expired = await handleApi(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)), env,
      { now: () => NOW + 601_000 });
    expect(expired.status).toBe(401);
  });

  it('binds the Google nonce to a cookie, stores hashes, and consumes a challenge only once', async () => {
    const challengeResponse = await invoke(request('/api/auth/challenge'));
    const { nonce } = await challengeResponse.json() as { nonce: string };
    const challenge = cookieValue(challengeResponse, '__Host-rephase_challenge')!;
    const stored = sqlite.prepare('SELECT challenge_hash, nonce_hash FROM auth_challenges').get();
    expect(stored).toEqual({ challenge_hash: await hashToken(challenge), nonce_hash: await hashToken(nonce) });
    expect(challengeResponse.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(challengeResponse.headers.get('Set-Cookie')).toContain('Secure');
    const verifyToken = vi.fn(async () => ACCOUNT_A);
    const req = () => request('/api/auth/google', 'POST', { credential: 'signed-google-token' }, `__Host-rephase_challenge=${challenge}`);
    const login = await handleApi(req(), env, { now: () => NOW, verifyToken });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual(ACCOUNT_A);
    expect(verifyToken).toHaveBeenCalledWith('signed-google-token', CLIENT_ID, await hashToken(nonce));
    const token = cookieValue(login, '__Host-rephase_session')!;
    expect(sqlite.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(await hashToken(token))).toBeTruthy();
    expect(sqlite.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(token)).toBeUndefined();
    expect((await handleApi(req(), env, { now: () => NOW, verifyToken })).status).toBe(401);
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('reuses an unconsumed challenge across tabs without invalidating an open Google popup', async () => {
    const first = await invoke(request('/api/auth/challenge'));
    const challenge = cookieValue(first, '__Host-rephase_challenge')!;
    const { nonce } = await first.json() as { nonce: string };
    const challengeCookie = `__Host-rephase_challenge=${challenge}`;
    const refreshed = await handleApi(request('/api/auth/challenge', 'GET', undefined, challengeCookie), env,
      { now: () => NOW + 240_000 });
    expect(refreshed.status).toBe(200);
    expect(cookieValue(refreshed, '__Host-rephase_challenge')).toBe(challenge);
    expect(await refreshed.json()).toEqual({ nonce });
    expect(sqlite.prepare('SELECT nonce_hash, expires_at FROM auth_challenges WHERE challenge_hash = ?')
      .get(await hashToken(challenge))).toEqual({ nonce_hash: await hashToken(nonce), expires_at: NOW / 1000 + 540 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_challenges').get()).toEqual({ count: 1 });
    expect(refreshed.headers.get('Set-Cookie')).toContain('Max-Age=300');

    // A popup started with the original nonce remains usable after another tab refreshes.
    const verifyToken = vi.fn(async () => ACCOUNT_A);
    const login = await handleApi(request('/api/auth/google', 'POST', { credential: 'original-popup-credential' }, challengeCookie),
      env, { now: () => NOW + 420_000, verifyToken });
    expect(login.status).toBe(200);
    expect(verifyToken).toHaveBeenCalledWith('original-popup-credential', CLIENT_ID, await hashToken(nonce));

    // Refreshing a consumed cookie must create a new challenge, never revive the old one.
    const next = await handleApi(request('/api/auth/challenge', 'GET', undefined, challengeCookie), env,
      { now: () => NOW + 421_000 });
    expect(cookieValue(next, '__Host-rephase_challenge')).not.toBe(challenge);
    expect(await next.json()).not.toEqual({ nonce });
    expect(sqlite.prepare('SELECT challenge_hash FROM auth_challenges WHERE challenge_hash = ?').get(await hashToken(challenge))).toBeUndefined();
    const replay = await handleApi(request('/api/auth/google', 'POST', { credential: 'original-popup-credential' }, challengeCookie),
      env, { now: () => NOW + 421_000, verifyToken });
    expect(replay.status).toBe(401);
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('replaces expired and legacy challenges rather than extending their validity', async () => {
    const first = await invoke(request('/api/auth/challenge'));
    const expiredChallenge = cookieValue(first, '__Host-rephase_challenge')!;
    const { nonce } = await first.json() as { nonce: string };
    const expired = await handleApi(request('/api/auth/challenge', 'GET', undefined, `__Host-rephase_challenge=${expiredChallenge}`),
      env, { now: () => NOW + 300_000 });
    expect(expired.status).toBe(200);
    expect(cookieValue(expired, '__Host-rephase_challenge')).not.toBe(expiredChallenge);
    expect(await expired.json()).not.toEqual({ nonce });
    expect(sqlite.prepare('SELECT challenge_hash FROM auth_challenges WHERE challenge_hash = ?').get(await hashToken(expiredChallenge))).toBeUndefined();

    const legacyChallenge = 'f'.repeat(64);
    const legacyNonce = 'legacy-independent-random-nonce';
    sqlite.prepare('INSERT INTO auth_challenges (challenge_hash, nonce_hash, expires_at) VALUES (?, ?, ?)')
      .run(await hashToken(legacyChallenge), await hashToken(legacyNonce), NOW / 1000 + 600);
    const replacement = await invoke(request('/api/auth/challenge', 'GET', undefined, `__Host-rephase_challenge=${legacyChallenge}`));
    expect(replacement.status).toBe(200);
    expect(cookieValue(replacement, '__Host-rephase_challenge')).not.toBe(legacyChallenge);
    expect(await replacement.json()).not.toEqual({ nonce: legacyNonce });
    expect(sqlite.prepare('SELECT challenge_hash FROM auth_challenges WHERE challenge_hash = ?').get(await hashToken(legacyChallenge))).toBeUndefined();
  });

  it('rejects unverifiable credentials and expired or absent login challenges', async () => {
    expect((await invoke(request('/api/auth/google', 'POST', { credential: 'token' }))).status).toBe(401);
    const challengeResponse = await invoke(request('/api/auth/challenge'));
    const challenge = cookieValue(challengeResponse, '__Host-rephase_challenge')!;
    const req = () => request('/api/auth/google', 'POST', { credential: 'token' }, `__Host-rephase_challenge=${challenge}`);
    const verifyToken = vi.fn(async () => { throw new Error('Bad signature'); });
    expect((await handleApi(req(), env, { now: () => NOW, verifyToken })).status).toBe(401);
    expect((await handleApi(req(), env, { now: () => NOW + 301_000, verifyToken })).status).toBe(401);
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('persists the verified Google avatar across sessions and updates only its account', async () => {
    const signIn = async (picture?: string) => {
      const challengeResponse = await invoke(request('/api/auth/challenge'));
      const challenge = cookieValue(challengeResponse, '__Host-rephase_challenge')!;
      const identity = { ...ACCOUNT_A, ...(picture ? { picture } : {}) };
      return handleApi(request('/api/auth/google', 'POST', { credential: 'signed-google-token' },
        `__Host-rephase_challenge=${challenge}`), env, { now: () => NOW, verifyToken: async () => identity });
    };
    const picture = 'https://lh3.googleusercontent.com/a/example-avatar=s96-c';
    const login = await signIn(picture);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ...ACCOUNT_A, picture });
    expect(sqlite.prepare('SELECT picture FROM users WHERE id = ?').get(ACCOUNT_A.id)).toEqual({ picture });
    const newToken = cookieValue(login, '__Host-rephase_session')!;
    for (const token of [SESSION_A, newToken]) {
      expect(await (await invoke(request('/api/me', 'GET', undefined, accountCookie(token)))).json())
        .toEqual({ ...ACCOUNT_A, picture });
    }
    expect(await (await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_B)))).json()).toEqual(ACCOUNT_B);
    const replacement = 'https://lh4.googleusercontent.com/a/replacement=s96-c';
    await signIn(replacement);
    expect(await (await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)))).json())
      .toEqual({ ...ACCOUNT_A, picture: replacement });
    await signIn();
    expect(await (await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)))).json()).toEqual(ACCOUNT_A);
    expect(sqlite.prepare('SELECT picture FROM users WHERE id = ?').get(ACCOUNT_A.id)).toEqual({ picture: null });
  });

  it('rejects cross-origin and missing-Origin mutations before storage changes', async () => {
    const foreign = request('/api/state', 'PUT', { data: validData, revision: 0 }, accountCookie(SESSION_A), 'https://evil.example');
    expect((await invoke(foreign)).status).toBe(403);
    const missing = request('/api/auth/logout', 'POST', undefined, accountCookie(SESSION_A));
    missing.headers.delete('Origin');
    expect((await invoke(missing)).status).toBe(403);
    const crossSite = request('/api/auth/logout', 'POST', undefined, accountCookie(SESSION_A));
    crossSite.headers.set('Sec-Fetch-Site', 'cross-site');
    expect((await invoke(crossSite)).status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 2 });
  });

  it('supports an explicitly configured localhost reverse proxy without insecure production cookies', async () => {
    const local = new Request('http://127.0.0.1:8787/api/auth/challenge');
    const challenge = await invoke(local, { ALLOWED_ORIGIN: 'http://localhost:5173' });
    expect(challenge.status).toBe(200);
    const localCookie = challenge.headers.getSetCookie()[0];
    expect(localCookie).toMatch(/^rephase_challenge=/);
    expect(localCookie).not.toContain('; Secure');
    const remoteHttp = await invoke(new Request('http://example.com/api/auth/challenge'));
    expect(remoteHttp.status).toBe(400);
  });

  it('isolates state ownership and prevents lost updates with atomic revisions', async () => {
    const put = (revision: number, data = validData, token = SESSION_A) => invoke(request('/api/state', 'PUT', { data, revision }, accountCookie(token)));
    expect(await (await put(0)).json()).toEqual({ revision: 1 });
    expect((await put(0)).status).toBe(409);
    const b = await invoke(request('/api/state', 'GET', undefined, accountCookie(SESSION_B)));
    expect(await b.json()).toEqual({ data: null, revision: 0 });
    const changed = structuredClone(validData);
    changed.preferences.caffeine = false;
    expect(await (await put(1, changed)).json()).toEqual({ revision: 2 });
    expect((await put(1)).status).toBe(409);
    const state = await invoke(request('/api/state', 'GET', undefined, accountCookie(SESSION_A)));
    expect(await state.json()).toEqual({ data: changed, revision: 2 });
  });

  it('deletes only the current account state while preserving sessions', async () => {
    for (const token of [SESSION_A, SESSION_B]) {
      await invoke(request('/api/state', 'PUT', { data: validData, revision: 0 }, accountCookie(token)));
    }
    const deleted = await invoke(request('/api/state', 'DELETE', undefined, accountCookie(SESSION_A)));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ revision: 2 });
    const own = await invoke(request('/api/state', 'GET', undefined, accountCookie(SESSION_A)));
    expect(await own.json()).toEqual({ data: null, revision: 2 });
    const stale = await invoke(request('/api/state', 'PUT', { data: validData, revision: 1 }, accountCookie(SESSION_A)));
    expect(stale.status).toBe(409);
    const other = await invoke(request('/api/state', 'GET', undefined, accountCookie(SESSION_B)));
    expect((await other.json() as { revision: number }).revision).toBe(1);
    expect((await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)))).status).toBe(200);
  });

  it('rejects cross-tab account changes and missing expected-account headers for every state method', async () => {
    await invoke(request('/api/state', 'PUT', { data: validData, revision: 0 }, accountCookie(SESSION_B)));
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const body = method === 'PUT' ? { data: validData, revision: 1 } : undefined;
      const changedAccount = request('/api/state', method, body, accountCookie(SESSION_B));
      changedAccount.headers.set('X-Rephase-Account', ACCOUNT_A.id);
      expect((await invoke(changedAccount)).status).toBe(403);
      const missingExpectedAccount = request('/api/state', method, body, accountCookie(SESSION_B));
      missingExpectedAccount.headers.delete('X-Rephase-Account');
      expect((await invoke(missingExpectedAccount)).status).toBe(403);
    }
    const state = await invoke(request('/api/state', 'GET', undefined, accountCookie(SESSION_B)));
    expect(await state.json()).toEqual({ data: validData, revision: 1 });
  });

  it('revokes sessions on logout rather than just clearing a browser cookie', async () => {
    const logout = await invoke(request('/api/auth/logout', 'POST', undefined, accountCookie(SESSION_A)));
    expect(logout.status).toBe(200);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_A)))).status).toBe(401);
    expect((await invoke(request('/api/me', 'GET', undefined, accountCookie(SESSION_B)))).status).toBe(200);
  });

  it('limits payloads, rejects non-JSON and cannot accept a client-selected owner', async () => {
    const noJson = request('/api/state', 'PUT', { data: validData, revision: 0 }, accountCookie(SESSION_A));
    noJson.headers.set('Content-Type', 'text/plain');
    expect((await invoke(noJson)).status).toBe(415);
    const oversized = request('/api/state', 'PUT', { data: 'x'.repeat(256 * 1024), revision: 0 }, accountCookie(SESSION_A));
    expect((await invoke(oversized)).status).toBe(413);
    const foreignOwner = request('/api/state', 'PUT', { data: validData, revision: 0, userId: ACCOUNT_B.id }, accountCookie(SESSION_A));
    expect((await invoke(foreignOwner)).status).toBe(400);
    const malformed = new Request(`${ORIGIN}/api/state`, { method: 'PUT', headers: {
      Origin: ORIGIN, Cookie: accountCookie(SESSION_A), 'Content-Type': 'application/json',
      'X-Rephase-Account': ACCOUNT_A.id,
    }, body: '{not json' });
    expect((await invoke(malformed)).status).toBe(400);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user_state').get()).toEqual({ count: 0 });
  });
});

describe('Google token cryptography', () => {
  it('accepts only HTTPS Google image URLs from a verified picture claim', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const nonce = 'avatar-claim-nonce';
    const nonceHash = await hashToken(nonce);
    const identity = { id: 'google-avatar-user', name: 'Traveler', email: 'traveler@example.com' };
    const verifyPicture = async (picture: unknown) => {
      const credential = await new SignJWT({
        sub: identity.id, name: identity.name, email: identity.email, picture, nonce,
        iss: 'https://accounts.google.com', aud: CLIENT_ID,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
      }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
      return verifyGoogleCredential(credential, CLIENT_ID, nonceHash, async () => publicKey);
    };
    for (const picture of ['https://lh3.googleusercontent.com/a/photo=s96-c', 'https://lh4.googleusercontent.com/a/photo?sz=96']) {
      expect(await verifyPicture(picture)).toEqual({ ...identity, picture });
    }
    for (const picture of [
      null, 123, {}, '', 'not a URL', '//lh3.googleusercontent.com/photo',
      'http://lh3.googleusercontent.com/photo', 'data:image/svg+xml,avatar', 'javascript:alert(1)',
      'https://googleusercontent.com.evil.example/photo', 'https://evilgoogleusercontent.com/photo',
      'https://lh3.googleusercontent.com@evil.example/photo', 'https://evil@lh3.googleusercontent.com/photo',
      'https://lh3.googleusercontent.com:444/photo', ' https://lh3.googleusercontent.com/photo',
      'https://lh3.googleusercontent.com/line\nbreak', `https://lh3.googleusercontent.com/${'x'.repeat(2048)}`,
    ]) {
      // A missing or unsuitable image must not prevent a valid account from signing in.
      expect(await verifyPicture(picture)).toEqual(identity);
    }
  });

  it('verifies signatures and claims rather than trusting decoded JWT fields', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const nonce = 'one-use-browser-nonce';
    const nonceHash = await hashToken(nonce);
    const token = (overrides: Record<string, unknown> = {}) => new SignJWT({
      sub: 'google-123', name: 'Traveler', email: 'traveler@example.com', nonce,
      iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, ...overrides,
    }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
    const resolveKey = async () => publicKey;
    const valid = await token();
    expect(await verifyGoogleCredential(valid, CLIENT_ID, nonceHash, resolveKey)).toEqual({
      id: 'google-123', name: 'Traveler', email: 'traveler@example.com',
    });
    await expect(verifyGoogleCredential(await token({ aud: 'someone-else' }), CLIENT_ID, nonceHash, resolveKey)).rejects.toThrow();
    await expect(verifyGoogleCredential(await token({ iss: 'https://evil.example' }), CLIENT_ID, nonceHash, resolveKey)).rejects.toThrow();
    await expect(verifyGoogleCredential(await token({ nonce: 'replayed-nonce' }), CLIENT_ID, nonceHash, resolveKey)).rejects.toThrow();
    await expect(verifyGoogleCredential(await token({ exp: Math.floor(Date.now() / 1000) - 60 }), CLIENT_ID, nonceHash, resolveKey)).rejects.toThrow();
    const [header, payload, signature] = valid.split('.');
    const forged = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(verifyGoogleCredential(forged, CLIENT_ID, nonceHash, resolveKey)).rejects.toThrow();
  });
});

describe('Saved state contract', () => {
  it('accepts legacy flights without cabin fields and validates cabin fields when present', () => {
    const legacy = structuredClone(validData);
    const leg = legacy.trips[0].legs[0] as unknown as Record<string, unknown>;
    delete leg.travelClass;
    delete leg.lieFlat;
    expect(validateAppData(legacy)).toBeNull();
    leg.travelClass = 'business';
    leg.lieFlat = true;
    expect(validateAppData(legacy)).toBeNull();
    leg.travelClass = 'invalid';
    expect(validateAppData(legacy)).toMatch(/flight details/);
    leg.travelClass = 'first';
    leg.lieFlat = 'yes';
    expect(validateAppData(legacy)).toMatch(/flight details/);
  });

  it('validates new planning preferences and owner-confirmed provider records', () => {
    const saved = structuredClone(validData);
    Object.assign(saved.preferences, { planningMode: 'model', autoSync: true, calendarAlarms: true });
    Object.assign(saved.trips[0].legs[0], { flightSource: 'aerodatabox', flightFetchedAt: '2026-10-14T10:00:00Z', providerRecordConfirmed: true, takeoffDateTime: '2026-11-05T20:20', landingDateTime: '2026-11-06T13:50', taxiOutMinutes: 20, taxiInMinutes: 10 });
    expect(validateAppData(saved)).toBeNull();
    saved.trips[0].legs[0].providerRecordConfirmed = false;
    expect(validateAppData(saved)).toMatch(/flight details/);
    saved.trips[0].legs[0].providerRecordConfirmed = true;
    saved.preferences.planningMode = 'invalid' as 'model';
    expect(validateAppData(saved)).toMatch(/preferences/);
    saved.preferences.planningMode = 'model';
    saved.trips[0].legs[0].taxiOutMinutes = 181;
    expect(validateAppData(saved)).toMatch(/flight details/);
  });

  it('validates bounded adherence records and rejects cross-trip references', () => {
    const saved = structuredClone(validData);
    saved.trips[0].adherence = [{ id: 'record-a', tripId: 'trip-a', actionId: 'sleep-action-a', type: 'sleep', scheduledStart: '2026-11-05T10:00:00Z', scheduledEnd: '2026-11-05T18:00:00Z', timeZone: 'America/Los_Angeles', status: 'partial', actualStart: '2026-11-05T11:00:00Z', actualEnd: '2026-11-05T17:00:00Z', recordedAt: '2026-11-05T18:00:00Z' }];
    expect(validateAppData(saved)).toBeNull();
    saved.trips[0].adherence[0].tripId = 'trip-other';
    expect(validateAppData(saved)).toMatch(/trip details/);
    saved.trips[0].adherence[0].tripId = 'trip-a';
    saved.trips[0].adherence[0].actualEnd = '2026-11-05T09:00:00Z';
    expect(validateAppData(saved)).toMatch(/trip details/);
    saved.trips[0].adherence[0].actualEnd = '2026-11-05T17:00:00Z';
    saved.trips[0].adherence[0].recordedAt = '2026-11-05T18:00:60Z';
    expect(validateAppData(saved)).toMatch(/trip details/);
  });

  it('rejects DST gaps, unchosen folds and contradictory actual flight times', () => {
    const saved = structuredClone(validData); const leg = saved.trips[0].legs[0];
    leg.departureDateTime = '2026-11-01T01:30'; leg.arrivalDateTime = '2026-11-01T19:30';
    expect(validateAppData(saved)).toMatch(/flight details/);
    leg.departureDisambiguation = 'later'; expect(validateAppData(saved)).toBeNull();
    leg.takeoffDateTime = '2026-11-01T00:30'; expect(validateAppData(saved)).toMatch(/flight details/);
    delete leg.takeoffDateTime; leg.departureDateTime = '2026-03-08T02:30'; leg.arrivalDateTime = '2026-03-08T19:30';
    expect(validateAppData(saved)).toMatch(/flight details/);
  });

  it('accepts full valid state and rejects invalid dates, zones, enums and references', () => {
    expect(validateAppData(validData)).toBeNull();
    const invalid = structuredClone(validData);
    invalid.trips[0].legs[0].departureDateTime = '2026-02-30T18:00';
    expect(validateAppData(invalid)).toMatch(/flight details/);
    invalid.trips[0].legs[0].departureDateTime = '2026-02-28T18:00';
    invalid.preferences.homeTimeZone = 'Imaginary/Zone';
    expect(validateAppData(invalid)).toMatch(/preferences/);
    invalid.preferences.homeTimeZone = 'UTC';
    invalid.trips[0].legs[0].departureDateTime = validData.trips[0].legs[0].departureDateTime;
    invalid.selectedTripId = 'missing-trip';
    expect(validateAppData(invalid)).toMatch(/selected trip/);
    expect(validateAppData({ ...validData, schemaVersion: 2 })).toMatch(/schema/);
    expect(validateAppData({ ...validData, userId: ACCOUNT_B.id })).toMatch(/schema/);
  });
});
