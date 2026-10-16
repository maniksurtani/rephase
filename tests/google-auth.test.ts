import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/lib/types';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const ACCOUNT: Account = { id: 'google-user', name: 'Traveler', email: 'traveler@example.com' };
type AuthModule = typeof import('../src/lib/google-signin');
type InitializeOptions = Parameters<NonNullable<Window['google']>['accounts']['id']['initialize']>[0];
type ButtonOptions = Parameters<NonNullable<Window['google']>['accounts']['id']['renderButton']>[1];

/** A small DOM boundary; Google owns the button iframe, which these tests do not emulate. */
function buttonContainer(initialWidth = 280) {
  let width = initialWidth;
  const element = {
    isConnected: true,
    childElementCount: 0,
    replaceChildren: vi.fn(() => { element.childElementCount = 0; }),
    getBoundingClientRect: () => ({ width }),
  };
  return { element: element as unknown as HTMLElement, resize: (next: number) => { width = next; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('Google sign-in button lifecycle', () => {
  let auth: AuthModule;
  let initialize: ReturnType<typeof vi.fn<(options: InitializeOptions) => void>>;
  let renderButton: ReturnType<typeof vi.fn<(container: HTMLElement, options: ButtonOptions) => void>>;
  let disableAutoSelect: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let browser: EventTarget;
  let page: EventTarget & { visibilityState: string };
  const cleanups: (() => void)[] = [];

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
    initialize = vi.fn();
    renderButton = vi.fn((container) => { (container as unknown as { childElementCount: number }).childElementCount = 1; });
    disableAutoSelect = vi.fn();
    browser = Object.assign(new EventTarget(), {
      google: { accounts: { id: { initialize, renderButton, disableAutoSelect } } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', page);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ResizeObserver', undefined);
    let nonce = 0;
    fetchMock = vi.fn<typeof fetch>(async (path) => {
      if (path === '/api/auth/challenge') return jsonResponse({ nonce: `nonce-${++nonce}` });
      if (path === '/api/auth/google') return jsonResponse(ACCOUNT);
      throw new Error(`Unexpected request: ${String(path)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    auth = await import('../src/lib/google-signin');
  });

  afterEach(() => {
    for (const dispose of cleanups.splice(0)) dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path);
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('fetches the shared challenge inside a browser lock when cross-tab locking is available', async () => {
    let held = false;
    const requestLock = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      held = true;
      try { return await callback(); } finally { held = false; }
    });
    vi.stubGlobal('navigator', { locks: { request: requestLock } });
    fetchMock.mockImplementationOnce(async (path) => {
      expect(path).toBe('/api/auth/challenge');
      expect(held).toBe(true);
      return jsonResponse({ nonce: 'cross-tab-locked-nonce' });
    });
    cleanups.push(...await Promise.all([
      auth.mountGoogleButton(buttonContainer(48).element, CLIENT_ID, vi.fn(), vi.fn(), { compact: true }),
      auth.mountGoogleButton(buttonContainer().element, CLIENT_ID, vi.fn(), vi.fn()),
    ]));

    expect(requestLock).toHaveBeenCalledExactlyOnceWith('rephase-google-challenge', expect.any(Function));
    expect(callsTo('/api/auth/challenge')).toHaveLength(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][0].nonce).toBe('cross-tab-locked-nonce');
    expect(held).toBe(false);
  });

  it('shares a challenge between simultaneous header and page buttons, and exchanges a credential once', async () => {
    const header = buttonContainer(48);
    const pageButton = buttonContainer(260);
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();
    const onError = vi.fn();
    cleanups.push(...await Promise.all([
      auth.mountGoogleButton(header.element, CLIENT_ID, firstSuccess, onError, { compact: true }),
      auth.mountGoogleButton(pageButton.element, CLIENT_ID, secondSuccess, onError),
    ]));

    expect(callsTo('/api/auth/challenge')).toHaveLength(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][0]).toMatchObject({
      client_id: CLIENT_ID, nonce: 'nonce-1', ux_mode: 'popup',
      auto_select: false, use_fedcm_for_button: true, button_auto_select: false,
    });
    expect(new Set(renderButton.mock.calls.map(([container]) => container))).toEqual(new Set([header.element, pageButton.element]));

    // Duplicate SDK deliveries must not submit the one-use challenge twice.
    const callback = initialize.mock.calls[0][0].callback;
    callback({ credential: 'verified-google-credential' });
    callback({ credential: 'verified-google-credential' });
    await settle();
    expect(callsTo('/api/auth/google')).toHaveLength(1);
    expect(callsTo('/api/auth/google')[0][1]).toMatchObject({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ credential: 'verified-google-credential' }),
    });
    expect(firstSuccess).toHaveBeenCalledExactlyOnceWith(ACCOUNT);
    expect(secondSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(callsTo('/api/auth/challenge')).toHaveLength(2);
    expect(initialize.mock.calls.at(-1)![0].nonce).toBe('nonce-2');
  });

  it('does not let an earlier mount cleanup remove its replacement on the same container', async () => {
    const { element } = buttonContainer();
    const oldSuccess = vi.fn();
    const currentSuccess = vi.fn();
    const onError = vi.fn();
    const oldCleanup = await auth.mountGoogleButton(element, CLIENT_ID, oldSuccess, onError);
    cleanups.push(oldCleanup);
    const currentCleanup = await auth.mountGoogleButton(element, CLIENT_ID, currentSuccess, onError);
    cleanups.push(currentCleanup);
    const clearCount = vi.mocked(element.replaceChildren).mock.calls.length;

    oldCleanup();
    expect(element.childElementCount).toBe(1);
    expect(element.replaceChildren).toHaveBeenCalledTimes(clearCount);
    expect(disableAutoSelect).not.toHaveBeenCalled();
    initialize.mock.calls[0][0].callback({ credential: 'google-credential' });
    await settle();
    expect(currentSuccess).toHaveBeenCalledExactlyOnceWith(ACCOUNT);
    expect(oldSuccess).not.toHaveBeenCalled();

    currentCleanup();
    expect(element.childElementCount).toBe(0);
    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
    const challengeCount = callsTo('/api/auth/challenge').length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(callsTo('/api/auth/challenge')).toHaveLength(challengeCount);
  });

  it('keeps the challenge stable while the Google popup is open, then refreshes after its deadline', async () => {
    const { element } = buttonContainer();
    cleanups.push(await auth.mountGoogleButton(element, CLIENT_ID, vi.fn(), vi.fn()));
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 50_000);
    renderButton.mock.calls[0][1].click_listener();

    await vi.advanceTimersByTimeAsync(10_000); // Normal four-minute refresh is due.
    browser.dispatchEvent(new Event('focus'));
    await settle();
    expect(callsTo('/api/auth/challenge')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000); // Canceled popups are checked again without replacing the button.
    expect(callsTo('/api/auth/challenge')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(16_000);
    browser.dispatchEvent(new Event('focus'));
    await settle();
    expect(callsTo('/api/auth/challenge')).toHaveLength(2);
    expect(initialize.mock.calls.at(-1)![0].nonce).toBe('nonce-2');
  });

  it('measures popup challenge age from the request start when the network is slow', async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const mounting = auth.mountGoogleButton(buttonContainer().element, CLIENT_ID, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(15_000);
    pending.resolve(jsonResponse({ nonce: 'slow-nonce' }));
    cleanups.push(await mounting);
    renderButton.mock.calls[0][1].click_listener();
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 31_000);
    browser.dispatchEvent(new Event('focus'));
    await settle();
    expect(callsTo('/api/auth/challenge')).toHaveLength(2);
  });

  it('uses supported Google button options for compact, narrow and full-width containers', async () => {
    const compact = buttonContainer(280);
    const narrow = buttonContainer(150);
    const standard = buttonContainer(236.9);
    const wide = buttonContainer(500);
    for (const [container, options] of [[compact, { compact: true }], [narrow, {}], [standard, {}], [wide, {}]] as const) {
      cleanups.push(await auth.mountGoogleButton(container.element, CLIENT_ID, vi.fn(), vi.fn(), options));
    }
    const optionsFor = (element: HTMLElement) => renderButton.mock.calls.find(([container]) => container === element)![1];
    for (const container of [compact, narrow]) {
      expect(optionsFor(container.element)).toMatchObject({ type: 'icon', shape: 'circle', text: 'signin' });
      expect(optionsFor(container.element)).not.toHaveProperty('width');
    }
    expect(optionsFor(standard.element)).toMatchObject({ type: 'standard', shape: 'pill', text: 'signin', width: '236' });
    expect(optionsFor(wide.element).width).toBe('280');
  });

  it('resizes the Google button with its container without interrupting a pending popup', async () => {
    let notifyResize!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const container = buttonContainer(250);
    const dispose = await auth.mountGoogleButton(container.element, CLIENT_ID, vi.fn(), vi.fn());
    cleanups.push(dispose);
    container.resize(190);
    notifyResize();
    expect(renderButton.mock.calls.at(-1)![1]).toMatchObject({ type: 'standard', width: '190' });
    const count = renderButton.mock.calls.length;
    notifyResize();
    expect(renderButton).toHaveBeenCalledTimes(count);

    renderButton.mock.calls.at(-1)![1].click_listener();
    container.resize(140);
    notifyResize();
    expect(renderButton).toHaveBeenCalledTimes(count);
    initialize.mock.calls.at(-1)![0].callback({ credential: 'google-credential' });
    await settle();
    expect(renderButton.mock.calls.at(-1)![1]).toMatchObject({ type: 'icon', shape: 'circle' });
    dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns a useful account-service error for an HTML response and allows a new sign-in attempt', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    cleanups.push(await auth.mountGoogleButton(buttonContainer().element, CLIENT_ID, onSuccess, onError));
    fetchMock.mockImplementationOnce(async () => ({
      ok: false, status: 502,
      json: async () => { throw new SyntaxError('Unexpected token < in private upstream HTML'); },
    }) as unknown as Response);
    initialize.mock.calls[0][0].callback({ credential: 'google-credential' });
    await settle();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      message: 'Account services are unavailable. Check your connection and try again.', status: 502,
    });
    expect(callsTo('/api/auth/challenge')).toHaveLength(2);
    initialize.mock.calls.at(-1)![0].callback({ credential: 'new-google-credential' });
    await settle();
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(ACCOUNT);
  });
});
