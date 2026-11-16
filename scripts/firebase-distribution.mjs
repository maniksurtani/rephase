import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inspect tester groups before expensive builds, or retry distribution of an
// already uploaded release. Never download the APK or print bearer download URLs.
export async function firebaseDistribution(env, request = fetch, log = console.log) {
  const appId = env.FIREBASE_APP_ID;
  const appMatch = /^1:(\d+):android:[a-f0-9]+$/i.exec(appId ?? '');
  const groupAlias = env.FIREBASE_TESTER_GROUP || 'friends-family';
  const releaseId = env.FIREBASE_RELEASE_ID || '';
  if (
    !appMatch ||
    !/^[a-z0-9-]+$/.test(groupAlias) ||
    (releaseId && !/^[a-z0-9]+$/.test(releaseId))
  )
    throw new Error('Use a Firebase Android App ID, one group alias, and an optional release ID.');
  if (!env.FIREBASE_ACCESS_TOKEN) throw new Error('Firebase authentication is required.');
  const projectPath = `projects/${appMatch[1]}`;
  const api = async (path, body) => {
    const response = await request(`https://firebaseappdistribution.googleapis.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${env.FIREBASE_ACCESS_TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(
        `Firebase ${body ? 'distribution' : 'lookup'} failed (HTTP ${response.status}).`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  };
  const groups = [];
  let pageToken = '';
  do {
    const page = await api(
      `${projectPath}/groups?${new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) })}`,
    );
    groups.push(...(page.groups ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  const group = groups.find((value) => value.name === `${projectPath}/groups/${groupAlias}`);
  if (!group) {
    // Group labels/counts only; never enumerate tester email addresses.
    log(
      `Available Firebase groups: ${JSON.stringify(groups.map((value) => ({ alias: value.name.split('/').at(-1), name: value.displayName, testers: value.testerCount ?? 0 })))}`,
    );
    throw new Error(
      `Firebase group '${groupAlias}' does not exist. Use its alias, not its display name.`,
    );
  }
  log(`Firebase group '${groupAlias}' exists (${group.testerCount ?? 0} testers).`);
  if (!group.testerCount) throw new Error(`Add testers to '${groupAlias}' before distributing.`);
  if (!releaseId) return { groupAlias };
  const releasePath = `${projectPath}/apps/${appId}/releases/${releaseId}`;
  const release = await api(releasePath);
  await api(`${releasePath}:distribute`, { groupAliases: [groupAlias] });
  // Construct an authenticated tester link rather than forwarding API response URLs.
  const testerUrl = `https://appdistribution.firebase.google.com/testerapps/${appId}/releases/${releaseId}`;
  log(
    `Distributed existing release ${release.displayVersion} (${release.buildVersion}) to '${groupAlias}'.`,
  );
  log(`Install using the invited Google account: ${testerUrl}`);
  return { groupAlias, testerUrl };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await firebaseDistribution(process.env);
  if (result.testerUrl && process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Distributed to ${result.groupAlias}: [Install beta](${result.testerUrl})\n`,
    );
}
