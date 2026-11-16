import { describe, expect, it, vi } from 'vitest';
import { firebaseDistribution } from '../scripts/firebase-distribution.mjs';

const env = {
  FIREBASE_APP_ID: '1:123:android:abc',
  FIREBASE_TESTER_GROUP: 'friends-family',
  FIREBASE_ACCESS_TOKEN: 'private-test-token',
};
const group = {
  name: 'projects/123/groups/friends-family',
  displayName: 'Friends & Family',
  testerCount: 2,
};
const response = (value: unknown) => new Response(JSON.stringify(value));

describe('Firebase group readiness and distribution retry', () => {
  it('follows pagination when checking an existing populated group without distributing', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ groups: [], nextPageToken: 'next page' }))
      .mockResolvedValueOnce(response({ groups: [group] }));
    await expect(firebaseDistribution(env, request, vi.fn())).resolves.toEqual({
      groupAlias: 'friends-family',
    });
    expect(request.mock.calls[1][0]).toContain('pageToken=next+page');
    expect(request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('rejects missing or empty groups before uploading/building and lists only safe metadata', async () => {
    const log = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValue(
        response({
          groups: [
            {
              ...group,
              name: 'projects/123/groups/friends-and-family',
              ignored: 'private@example.com',
            },
          ],
        }),
      );
    await expect(
      firebaseDistribution({ ...env, FIREBASE_RELEASE_ID: 'release1' }, request, log),
    ).rejects.toThrow(/does not exist/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(' ')).toContain('friends-and-family');
    expect(log.mock.calls.flat().join(' ')).not.toContain('private@example.com');
    request.mockResolvedValue(response({ groups: [{ ...group, testerCount: 0 }] }));
    await expect(firebaseDistribution(env, request, vi.fn())).rejects.toThrow(/Add testers/);
  });

  it('distributes the existing release only to the selected group and never logs its bearer URL', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ groups: [group] }))
      .mockResolvedValueOnce(
        response({
          displayVersion: '0.1.0',
          buildVersion: '123',
          binaryDownloadUri: 'https://private.invalid/?token=SECRET',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const log = vi.fn();
    const result = await firebaseDistribution(
      { ...env, FIREBASE_RELEASE_ID: 'release1' },
      request,
      log,
    );
    expect(request.mock.calls[2][0]).toBe(
      'https://firebaseappdistribution.googleapis.com/v1/projects/123/apps/1:123:android:abc/releases/release1:distribute',
    );
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ groupAliases: ['friends-family'] });
    expect(result.testerUrl).toContain('/releases/release1');
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/SECRET|private-test-token/);
  });

  it('preserves API failures and rejects malformed release paths before any request', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(
      firebaseDistribution({ ...env, FIREBASE_RELEASE_ID: '../another' }, request, vi.fn()),
    ).rejects.toThrow(/optional release/);
    expect(request).not.toHaveBeenCalled();
    await expect(firebaseDistribution(env, request, vi.fn())).rejects.toThrow(/HTTP 403/);
  });
});
