import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Account, AppData } from '../src/lib/types';
import { validateAppData } from './validation';
import {
  FlightApiError,
  lookupFlights,
  purgeFlightData,
  validateFlightQuery,
  type FlightDependencies,
  type FlightEnv,
} from './flights';

export interface Env extends FlightEnv {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  /** Exact browser origin; needed for the localhost Vite reverse proxy. */
  ALLOWED_ORIGIN?: string;
  ASSETS?: Fetcher;
}

interface GoogleIdentity extends Account {}
interface ChallengeRow {
  nonce_hash: string;
  expires_at: number;
}
interface SessionRow extends Omit<Account, 'picture'> {
  picture: string | null;
  expires_at: number;
}
interface StateRow {
  data: string;
  revision: number;
}
interface Dependencies extends FlightDependencies {
  now?: () => number;
  verifyToken?: typeof verifyGoogleCredential;
}

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const CHALLENGE_SECONDS = 300;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STATE_BYTES = 256 * 1024;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Avatar URLs come from a verified Google claim and must remain on Google's image hosts. */
function googlePicture(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Signature verification is mandatory; decoding a browser credential is never authentication. */
export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  nonceHash: string,
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(credential, keys, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
    maxTokenAge: '10m',
    clockTolerance: 5,
  });
  if (
    typeof payload.nonce !== 'string' ||
    (await hashToken(payload.nonce)) !== nonceHash ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.sub.length > 255
  ) {
    throw new Error('Invalid credential');
  }
  const picture = googlePicture(payload.picture);
  return {
    id: payload.sub,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : 'Google account',
    email: typeof payload.email === 'string' ? payload.email.slice(0, 320) : '',
    ...(picture ? { picture } : {}),
  };
}

function cookieName(kind: 'session' | 'challenge', request: Request): string {
  return `${new URL(request.url).protocol === 'https:' ? '__Host-' : ''}rephase_${kind}`;
}

function requireSecureTransport(request: Request): void {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ApiError(400, 'Account access requires HTTPS.');
  }
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const equal = part.indexOf('=');
    if (equal >= 0 && part.slice(0, equal).trim() === name) return part.slice(equal + 1).trim();
  }
  return null;
}

function makeCookie(
  request: Request,
  kind: 'session' | 'challenge',
  value: string,
  seconds: number,
): string {
  const secure = new URL(request.url).protocol === 'https:';
  // Plain cookies are permitted only on localhost development requests, never remote HTTP.
  requireSecureTransport(request);
  return `${cookieName(kind, request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}

function response(data: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
  return new Response(JSON.stringify(data), { status, headers });
}

function requireDatabase(env: Env): D1Database {
  if (!env.DB) throw new ApiError(503, 'Account storage is not configured.');
  return env.DB;
}

function checkOrigin(request: Request, env: Env): void {
  const expected = env.ALLOWED_ORIGIN?.trim() || new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  // SameSite cookies alone do not protect against same-site cross-origin requests.
  if (origin !== expected) throw new ApiError(403, 'Request origin is not allowed.');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, 'Cross-site requests are not allowed.');
  }
}

async function jsonBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    throw new ApiError(415, 'Send JSON with Content-Type: application/json.');
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > limit)
    throw new ApiError(413, 'Request is too large.');
  if (!request.body) throw new ApiError(400, 'A JSON request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, 'Request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'Request must contain a valid JSON object.');
  }
}

async function accountFor(request: Request, db: D1Database, now: number): Promise<Account> {
  const token = readCookie(request, cookieName('session', request));
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, 'Sign in to access your saved data.');
  const account = await db
    .prepare(
      'SELECT u.id, u.name, u.email, u.picture, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(await hashToken(token), now)
    .first<SessionRow>();
  if (!account) throw new ApiError(401, 'Your session has expired. Sign in again.');
  const picture = googlePicture(account.picture);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    ...(picture ? { picture } : {}),
  };
}

/** Exported for focused route tests without deploying or contacting a Google account. */
export async function handleApi(
  request: Request,
  env: Env,
  dependencies: Dependencies = {},
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const now = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
  try {
    if (path !== '/api/config') requireSecureTransport(request);
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) checkOrigin(request, env);
    if (path === '/api/config' && request.method === 'GET') {
      const googleClientId = env.GOOGLE_CLIENT_ID?.trim() || null;
      return response({
        googleClientId,
        syncAvailable: Boolean(googleClientId && env.DB),
        flightLookupAvailable: Boolean(googleClientId && env.DB && env.RAPIDAPI_KEY?.trim()),
        flightProvider: 'aerodatabox',
      });
    }
    if (path === '/api/auth/challenge' && request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID?.trim())
        throw new ApiError(
          503,
          'Google sign-in is not configured. Add GOOGLE_CLIENT_ID to the Worker.',
        );
      const db = requireDatabase(env);
      const existing = readCookie(request, cookieName('challenge', request));
      const existingHash =
        existing && /^[a-f0-9]{64}$/.test(existing) ? await hashToken(existing) : null;
      if (existingHash) {
        // Tabs share this HttpOnly cookie. Reuse an unconsumed challenge so a
        // background button refresh cannot invalidate another tab's Google popup.
        // Domain-separated hashing derives the nonce without exposing the cookie.
        const nonce = await hashToken(`rephase-google-nonce:${existing}`);
        const renewed = await db
          .prepare(
            'UPDATE auth_challenges SET expires_at = MAX(expires_at, ?) WHERE challenge_hash = ? AND nonce_hash = ? AND expires_at > ?',
          )
          .bind(now + CHALLENGE_SECONDS, existingHash, await hashToken(nonce), now)
          .run();
        if (renewed.meta.changes === 1) {
          return response({ nonce }, 200, [
            makeCookie(request, 'challenge', existing!, CHALLENGE_SECONDS),
          ]);
        }
      }
      const challenge = randomToken();
      const nonce = await hashToken(`rephase-google-nonce:${challenge}`);
      const setCookie = makeCookie(request, 'challenge', challenge, CHALLENGE_SECONDS);
      const statements = [
        db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(now),
      ];
      if (existingHash) {
        statements.push(
          db.prepare('DELETE FROM auth_challenges WHERE challenge_hash = ?').bind(existingHash),
        );
      }
      statements.push(
        db
          .prepare(
            'INSERT INTO auth_challenges (challenge_hash, nonce_hash, expires_at) VALUES (?, ?, ?)',
          )
          .bind(await hashToken(challenge), await hashToken(nonce), now + CHALLENGE_SECONDS),
      );
      await db.batch(statements);
      return response({ nonce }, 200, [setCookie]);
    }
    if (path === '/api/auth/google' && request.method === 'POST') {
      const clientId = env.GOOGLE_CLIENT_ID?.trim();
      if (!clientId)
        throw new ApiError(
          503,
          'Google sign-in is not configured. Add GOOGLE_CLIENT_ID to the Worker.',
        );
      const db = requireDatabase(env);
      const body = await jsonBody(request, 16 * 1024);
      if (
        Object.keys(body).length !== 1 ||
        typeof body.credential !== 'string' ||
        body.credential.length > 12 * 1024
      ) {
        throw new ApiError(400, 'A Google credential is required.');
      }
      const challenge = readCookie(request, cookieName('challenge', request));
      if (!challenge || !/^[a-f0-9]{64}$/.test(challenge))
        throw new ApiError(401, 'Start a new Google sign-in.');
      const challengeHash = await hashToken(challenge);
      const row = await db
        .prepare(
          'SELECT nonce_hash, expires_at FROM auth_challenges WHERE challenge_hash = ? AND expires_at > ?',
        )
        .bind(challengeHash, now)
        .first<ChallengeRow>();
      if (!row) throw new ApiError(401, 'Sign-in expired. Start a new Google sign-in.');
      let identity: GoogleIdentity;
      try {
        identity = await (dependencies.verifyToken ?? verifyGoogleCredential)(
          body.credential,
          clientId,
          row.nonce_hash,
        );
      } catch {
        throw new ApiError(401, 'Google credential could not be verified. Try signing in again.');
      }
      // Atomic consumption prevents concurrent replays of an otherwise valid Google token.
      const consumed = await db
        .prepare('DELETE FROM auth_challenges WHERE challenge_hash = ? AND expires_at > ?')
        .bind(challengeHash, now)
        .run();
      if (consumed.meta.changes !== 1)
        throw new ApiError(401, 'This sign-in has already been used. Start a new sign-in.');
      const token = randomToken();
      const setCookie = makeCookie(request, 'session', token, SESSION_SECONDS);
      await db.batch([
        db
          .prepare(
            'INSERT INTO users (id, name, email, picture) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, picture = excluded.picture',
          )
          .bind(identity.id, identity.name, identity.email, identity.picture ?? null),
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
        db
          .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .bind(await hashToken(token), identity.id, now + SESSION_SECONDS),
      ]);
      return response(identity, 200, [setCookie, makeCookie(request, 'challenge', '', 0)]);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const db = requireDatabase(env);
      const token = readCookie(request, cookieName('session', request));
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        await db
          .prepare('DELETE FROM sessions WHERE token_hash = ?')
          .bind(await hashToken(token))
          .run();
      }
      const challenge = readCookie(request, cookieName('challenge', request));
      if (challenge && /^[a-f0-9]{64}$/.test(challenge)) {
        await db
          .prepare('DELETE FROM auth_challenges WHERE challenge_hash = ?')
          .bind(await hashToken(challenge))
          .run();
      }
      return response({}, 200, [
        makeCookie(request, 'session', '', 0),
        makeCookie(request, 'challenge', '', 0),
      ]);
    }
    if (path === '/api/me' && request.method === 'GET') {
      return response(await accountFor(request, requireDatabase(env), now));
    }
    if (path === '/api/flights' && request.method === 'GET') {
      const db = requireDatabase(env);
      const account = await accountFor(request, db, now);
      if (request.headers.get('X-Rephase-Account') !== account.id) {
        throw new ApiError(
          403,
          'Your signed-in account changed. Sign in again before looking up flights.',
        );
      }
      // This GET can spend provider credits. Custom account headers and origin
      // checks prevent a foreign page from spending another account's budget.
      if (request.headers.has('Origin') || request.headers.get('Sec-Fetch-Site') === 'cross-site')
        checkOrigin(request, env);
      const query = validateFlightQuery(new URL(request.url), now);
      return response(await lookupFlights(query, db, env, account.id, now, dependencies));
    }
    if (path === '/api/state' && ['GET', 'PUT', 'DELETE'].includes(request.method)) {
      const db = requireDatabase(env);
      const account = await accountFor(request, db, now);
      // The browser cookie is shared between tabs. Bind this operation to the
      // account the requesting tab expects so an intervening sign-in cannot
      // read, overwrite, or erase a different account's state.
      if (request.headers.get('X-Rephase-Account') !== account.id) {
        throw new ApiError(
          403,
          'Your signed-in account changed. Sign in again before accessing saved data.',
        );
      }
      if (request.method === 'GET') {
        const row = await db
          .prepare('SELECT data, revision FROM user_state WHERE user_id = ?')
          .bind(account.id)
          .first<StateRow>();
        return response({
          data: row ? (JSON.parse(row.data) as AppData) : null,
          revision: row?.revision ?? 0,
        });
      }
      if (request.method === 'DELETE') {
        // Keep only a null-data revision marker so deletion/recreation cannot let
        // a stale device overwrite newly saved state using an old revision.
        const tombstone = await db
          .prepare(
            "INSERT INTO user_state (user_id, data, revision, updated_at) VALUES (?, 'null', 1, ?) ON CONFLICT(user_id) DO UPDATE SET data = 'null', revision = user_state.revision + 1, updated_at = excluded.updated_at RETURNING revision",
          )
          .bind(account.id, now)
          .first<{ revision: number }>();
        return response({ revision: tombstone!.revision });
      }
      const body = await jsonBody(request, STATE_BYTES);
      if (
        Object.keys(body).length !== 2 ||
        !Object.hasOwn(body, 'data') ||
        !Object.hasOwn(body, 'revision') ||
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        (body.revision as number) > 2_147_483_646
      ) {
        throw new ApiError(400, 'Provide app data and its current revision.');
      }
      const error = validateAppData(body.data);
      if (error) throw new ApiError(400, error);
      const revision = body.revision as number;
      const data = JSON.stringify(body.data);
      const result =
        revision === 0
          ? await db
              .prepare(
                'INSERT OR IGNORE INTO user_state (user_id, data, revision, updated_at) VALUES (?, ?, 1, ?)',
              )
              .bind(account.id, data, now)
              .run()
          : await db
              .prepare(
                'UPDATE user_state SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?',
              )
              .bind(data, now, account.id, revision)
              .run();
      if (result.meta.changes !== 1)
        throw new ApiError(
          409,
          'Your saved data changed on another device. Reload the saved version before saving.',
        );
      return response({ revision: revision + 1 });
    }
    const methods: Record<string, string[]> = {
      '/api/config': ['GET'],
      '/api/auth/challenge': ['GET'],
      '/api/auth/google': ['POST'],
      '/api/auth/logout': ['POST'],
      '/api/me': ['GET'],
      '/api/state': ['GET', 'PUT', 'DELETE'],
      '/api/flights': ['GET'],
    };
    if (methods[path]) {
      const result = response({ error: 'Method not allowed.' }, 405);
      result.headers.set('Allow', methods[path].join(', '));
      return result;
    }
    return response({ error: 'API endpoint not found.' }, 404);
  } catch (error) {
    if (error instanceof ApiError || error instanceof FlightApiError)
      return response({ error: error.message }, error.status);
    // Never include Google credentials, session tokens, SQL, or private state in an error response/log.
    return response(
      {
        error: 'Account storage is unavailable. Check the Worker configuration and D1 migrations.',
      },
      503,
    );
  }
}

export default {
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    if (env.DB) await purgeFlightData(env.DB, Math.floor(event.scheduledTime / 1000));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS
      ? env.ASSETS.fetch(request)
      : new Response('Static assets are not built. Run npm run build.', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
