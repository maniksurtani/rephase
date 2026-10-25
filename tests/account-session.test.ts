import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getAccount, getCloudState } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('account response classification', () => {
  it.each([401, 403])(
    'does not treat an HTML %i response as an expired session',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('<html>Service temporarily unavailable</html>', {
              status,
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
      );
      // Both identity verification and account reads must retain the distinction.
      const identityError = await getAccount().catch((error) => error);
      const stateError = await getCloudState('alice').catch((error) => error);
      for (const error of [identityError, stateError]) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status, serviceUnavailable: true });
      }
    },
  );

  it('still requires authentication for an actual API rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Your session has expired.' }, { status: 401 })),
    );
    expect(await getAccount()).toBeNull();
    await expect(getCloudState('alice')).rejects.toMatchObject({
      status: 401,
      serviceUnavailable: false,
    });
  });
});
