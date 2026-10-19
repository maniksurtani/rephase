import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import {
  handleApi,
  hashMobileToken,
  hashToken,
  verifyMobileGoogleCredential,
  type Env,
} from '../worker/index';
import { d1For } from './support/d1';

const ORIGIN = 'https://rephase.example';
const NOW = 1_800_000_000_000;
const WEB_ID = 'web-example.apps.googleusercontent.com';
const IOS_ID = 'ios-example.apps.googleusercontent.com';
const ANDROID_ID = 'android-example.apps.googleusercontent.com';
const ACCOUNT = { id: 'native-user', name: 'Traveler', email: 'traveler@example.com' };
const OTHER = { id: 'other-user', name: 'Other traveler', email: 'other@example.com' };
const BROWSER_TOKEN = 'a'.repeat(64);
const DATA = {
  schemaVersion: 1,
  preferences: DEFAULT_PREFERENCES,
  trips: [],
  selectedTripId: null,
};

function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const bearer = (token: string, accountId = ACCOUNT.id) => ({
  Authorization: `Bearer ${token}`,
  'X-Rephase-Account': accountId,
});

describe('native Google token verification', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
  });
  const signed = (
    claims: JWTPayload = {},
    options: { audience?: string; issuer?: string; expiry?: string } = {},
  ) =>
    new SignJWT({
      sub: ACCOUNT.id,
      azp: IOS_ID,
      name: ACCOUNT.name,
      email: ACCOUNT.email,
      picture: 'https://lh3.googleusercontent.com/a/avatar',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience(options.audience ?? WEB_ID)
      .setIssuer(options.issuer ?? 'https://accounts.google.com')
      .setIssuedAt()
      .setExpirationTime(options.expiry ?? '1h')
      .sign(keys.privateKey);
  const verify = (token: string) =>
    verifyMobileGoogleCredential(token, WEB_ID, [IOS_ID, ANDROID_ID], async () => keys.publicKey);

  it('accepts the server audience with an explicitly allowed native presenter and no browser nonce', async () => {
    const identity = await verify(await signed());
    expect(identity).toMatchObject({
      ...ACCOUNT,
      picture: 'https://lh3.googleusercontent.com/a/avatar',
    });
  });

  it.each([
    { claims: { azp: WEB_ID } },
    { claims: { azp: 'untrusted.apps.googleusercontent.com' } },
    { claims: { azp: undefined } },
    { claims: { sub: '' } },
    { options: { audience: IOS_ID } },
    { options: { issuer: 'https://malicious.example' } },
    { options: { expiry: '-1m' } },
  ])(
    'rejects invalid presenter, identity, audience, issuer or expiry: %j',
    async ({ claims, options }) => {
      await expect(verify(await signed(claims, options))).rejects.toThrow();
    },
  );

  it('rejects a forged signature and strips unsafe avatar URLs', async () => {
    const otherKeys = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: ACCOUNT.id, azp: IOS_ID })
      .setProtectedHeader({ alg: 'RS256' })
      .setAudience(WEB_ID)
      .setIssuer('https://accounts.google.com')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherKeys.privateKey);
    await expect(verify(forged)).rejects.toThrow();
    expect(
      await verify(await signed({ picture: 'https://attacker.example/avatar' })),
    ).not.toHaveProperty('picture');
  });
});

describe('native account API isolation', () => {
  let sqlite: DatabaseSync;
  let env: Env;
  const verifyMobileToken = vi.fn(async () => ACCOUNT);
  const invoke = (req: Request, overrides: Partial<Env> = {}) =>
    handleApi(req, { ...env, ...overrides }, { now: () => NOW, verifyMobileToken });
  const exchange = (credential = 'fresh-native-google-id-token') =>
    invoke(request('/api/mobile/auth/google', 'POST', { credential }));
  async function signIn() {
    const result = await exchange();
    expect(result.status).toBe(200);
    return (await result.json()) as { account: typeof ACCOUNT; token: string; expiresAt: string };
  }

  beforeEach(async () => {
    sqlite = new DatabaseSync(':memory:');
    for (const migration of ['0001_accounts.sql', '0003_google_avatar.sql'])
      sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    env = {
      DB: d1For(sqlite),
      GOOGLE_CLIENT_ID: WEB_ID,
      GOOGLE_MOBILE_CLIENT_IDS: `${IOS_ID}, ${ANDROID_ID}`,
    };
    for (const account of [ACCOUNT, OTHER])
      sqlite
        .prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)')
        .run(account.id, account.name, account.email);
    sqlite
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(await hashToken(BROWSER_TOKEN), OTHER.id, NOW / 1000 + 600);
    verifyMobileToken.mockClear();
  });
  afterEach(() => sqlite.close());

  it('creates a revocable hashed bearer session without browser cookies or private claims', async () => {
    const result = await exchange();
    expect(result.headers.has('Set-Cookie')).toBe(false);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    const session = (await result.json()) as {
      account: typeof ACCOUNT;
      token: string;
      expiresAt: string;
    };
    expect(session.account).toEqual(ACCOUNT);
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
    expect(session.expiresAt).toBe(new Date(NOW + 7 * 24 * 3600_000).toISOString());
    expect(verifyMobileToken).toHaveBeenCalledWith('fresh-native-google-id-token', WEB_ID, [
      IOS_ID,
      ANDROID_ID,
    ]);
    expect(
      sqlite
        .prepare('SELECT user_id FROM sessions WHERE token_hash = ?')
        .get(await hashMobileToken(session.token)),
    ).toEqual({ user_id: ACCOUNT.id });
    expect(
      sqlite
        .prepare('SELECT token_hash FROM sessions WHERE token_hash IN (?, ?)')
        .all(session.token, await hashToken(session.token)),
    ).toEqual([]);
    expect(
      await (await invoke(request('/api/me', 'GET', undefined, bearer(session.token)))).json(),
    ).toEqual(ACCOUNT);
  });

  it.each([
    undefined,
    '',
    '*',
    `${IOS_ID},`,
    WEB_ID,
    'https://private.example/token',
    `${IOS_ID},${WEB_ID}`,
  ])('disables native exchange for absent or invalid allowlists: %s', async (allowlist) => {
    expect(
      (
        await invoke(request('/api/mobile/auth/google', 'POST', { credential: 'token' }), {
          GOOGLE_MOBILE_CLIENT_IDS: allowlist,
        })
      ).status,
    ).toBe(503);
    expect(verifyMobileToken).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials but allows legitimate cached SDK credentials without consuming browser challenges', async () => {
    sqlite
      .prepare(
        'INSERT INTO auth_challenges (challenge_hash, nonce_hash, expires_at) VALUES (?, ?, ?)',
      )
      .run('browser-challenge', 'browser-nonce', NOW / 1000 + 300);
    verifyMobileToken.mockRejectedValueOnce(new Error('Invalid signature'));
    expect((await exchange('invalid-google-token')).status).toBe(401);
    const first = await signIn();
    const second = await signIn();
    expect(second.token).not.toBe(first.token);
    expect(verifyMobileToken).toHaveBeenCalledTimes(3);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(ACCOUNT.id),
    ).toEqual({ count: 2 });
    expect(sqlite.prepare('SELECT * FROM auth_challenges').all()).toEqual([
      {
        challenge_hash: 'browser-challenge',
        nonce_hash: 'browser-nonce',
        expires_at: NOW / 1000 + 300,
      },
    ]);
  });

  it('keeps browser tokens and native tokens unusable in the other authentication channel', async () => {
    const { token } = await signIn();
    expect((await invoke(request('/api/me', 'GET', undefined, bearer(BROWSER_TOKEN)))).status).toBe(
      401,
    );
    expect(
      (
        await invoke(
          request('/api/me', 'GET', undefined, { Cookie: `__Host-rephase_session=${token}` }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await invoke(
          request('/api/me', 'GET', undefined, {
            ...bearer(token),
            Cookie: `__Host-rephase_session=${BROWSER_TOKEN}`,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      await (
        await invoke(
          request('/api/me', 'GET', undefined, {
            Cookie: `__Host-rephase_session=${BROWSER_TOKEN}`,
          }),
        )
      ).json(),
    ).toEqual(OTHER);
  });

  it('preserves browser Origin and nonce protections while rejecting native requests from browser contexts', async () => {
    for (const headers of [
      { Origin: ORIGIN },
      { 'Sec-Fetch-Site': 'same-origin' },
      { Cookie: `__Host-rephase_session=${BROWSER_TOKEN}` },
    ]) {
      expect(
        (await invoke(request('/api/mobile/auth/google', 'POST', { credential: 'token' }, headers)))
          .status,
      ).toBe(403);
    }
    for (const headers of [{}, { Origin: 'https://evil.example' }]) {
      expect(
        (await invoke(request('/api/auth/google', 'POST', { credential: 'token' }, headers)))
          .status,
      ).toBe(403);
      expect(
        (
          await invoke(
            request(
              '/api/state',
              'PUT',
              { data: DATA, revision: 0 },
              {
                ...headers,
                Cookie: `__Host-rephase_session=${BROWSER_TOKEN}`,
                'X-Rephase-Account': OTHER.id,
              },
            ),
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await invoke(
          request('/api/auth/google', 'POST', { credential: 'token' }, { Origin: ORIGIN }),
        )
      ).status,
    ).toBe(401);
    const { token } = await signIn();
    expect(
      (
        await invoke(
          request(
            '/api/state',
            'PUT',
            { data: DATA, revision: 0 },
            { ...bearer(token), Origin: ORIGIN },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await invoke(
          request('/api/me', 'GET', undefined, {
            ...bearer(token),
            'Sec-Fetch-Site': 'cross-site',
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('keeps state revisions and account guards for native reads, saves and deletion', async () => {
    const { token } = await signIn();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect(
        (
          await invoke(
            request(
              '/api/state',
              method,
              method === 'PUT' ? { data: DATA, revision: 0 } : undefined,
              bearer(token, OTHER.id),
            ),
          )
        ).status,
      ).toBe(403);
    }
    const saved = await invoke(
      request('/api/state', 'PUT', { data: DATA, revision: 0 }, bearer(token)),
    );
    expect(await saved.json()).toEqual({ revision: 1 });
    expect(
      await (await invoke(request('/api/state', 'GET', undefined, bearer(token)))).json(),
    ).toEqual({ data: DATA, revision: 1 });
    expect(
      (await invoke(request('/api/state', 'PUT', { data: DATA, revision: 0 }, bearer(token))))
        .status,
    ).toBe(409);
    expect(
      sqlite.prepare('SELECT data FROM user_state WHERE user_id = ?').get(OTHER.id),
    ).toBeUndefined();
    expect(
      await (await invoke(request('/api/state', 'DELETE', undefined, bearer(token)))).json(),
    ).toEqual({ revision: 2 });
  });

  it('requires a native session and expected account before flight-query validation or provider spending', async () => {
    const { token } = await signIn();
    expect(
      (await invoke(request('/api/flights', 'GET', undefined, bearer(token, OTHER.id)))).status,
    ).toBe(403);
    expect((await invoke(request('/api/flights', 'GET', undefined, bearer(token)))).status).toBe(
      400,
    );
    expect(
      (await invoke(request('/api/flights', 'GET', undefined, bearer(BROWSER_TOKEN)))).status,
    ).toBe(401);
  });

  it('revokes only the native session on logout and rejects it after expiration', async () => {
    const { token } = await signIn();
    const expired = await handleApi(request('/api/me', 'GET', undefined, bearer(token)), env, {
      now: () => NOW + 8 * 24 * 3600_000,
    });
    expect(expired.status).toBe(401);
    expect(
      (await invoke(request('/api/mobile/auth/logout', 'POST', undefined, bearer(BROWSER_TOKEN))))
        .status,
    ).toBe(200);
    expect(
      await (
        await invoke(
          request('/api/me', 'GET', undefined, {
            Cookie: `__Host-rephase_session=${BROWSER_TOKEN}`,
          }),
        )
      ).json(),
    ).toEqual(OTHER);
    const logout = await invoke(
      request('/api/mobile/auth/logout', 'POST', undefined, bearer(token)),
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.has('Set-Cookie')).toBe(false);
    expect((await invoke(request('/api/me', 'GET', undefined, bearer(token)))).status).toBe(401);
    expect(
      (await invoke(request('/api/mobile/auth/logout', 'POST', undefined, bearer(token)))).status,
    ).toBe(200);
    const signedInAgain = await signIn();
    expect(signedInAgain.token).not.toBe(token);
    expect(
      (await invoke(request('/api/me', 'GET', undefined, bearer(signedInAgain.token)))).status,
    ).toBe(200);
  });
});
