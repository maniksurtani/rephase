import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Extract only public IDs. Firebase API keys and other services are not needed
// for App Distribution and must not be copied into our release configuration.
export function firebaseAppConfig(document, expectedProject, expectedNumber) {
  const project = document?.project_info;
  if (project?.project_id !== expectedProject || !/^\d+$/.test(project?.project_number ?? ''))
    throw new Error('The Firebase file must belong to the requested Google Cloud project.');
  if (expectedNumber && project.project_number !== expectedNumber)
    throw new Error('The Firebase project number does not match Google Cloud.');
  const clients = (document.client ?? []).filter(
    (client) => client.client_info?.android_client_info?.package_name === 'app.rephase.Rephase',
  );
  if (clients.length !== 1)
    throw new Error('Select a Firebase file with exactly one app.rephase.Rephase Android app.');
  const client = clients[0];
  const appId = client.client_info.mobilesdk_app_id;
  if (!new RegExp(`^1:${project.project_number}:android:[a-f0-9]+$`, 'i').test(appId ?? ''))
    throw new Error('The Firebase Android app ID does not match the project.');
  const webIds = [
    ...new Set(
      [
        ...(client.oauth_client ?? []),
        ...(client.services?.appinvite_service?.other_platform_oauth_client ?? []),
      ]
        .filter((oauth) => oauth.client_type === 3)
        .map((oauth) => oauth.client_id),
    ),
  ];
  if (
    webIds.length !== 1 ||
    !new RegExp(`^${project.project_number}-[a-zA-Z0-9_-]+\\.apps\\.googleusercontent\\.com$`).test(
      webIds[0] ?? '',
    )
  )
    throw new Error(
      'The Firebase file must identify one unambiguous web OAuth client in this project.',
    );
  return { appId, webClientId: webIds[0] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, project, number] = process.argv.slice(2);
  if (!file || !project)
    throw new Error(
      'Usage: node scripts/firebase-app-config.mjs GOOGLE_SERVICES_JSON PROJECT_ID [PROJECT_NUMBER]',
    );
  const config = firebaseAppConfig(JSON.parse(await readFile(file, 'utf8')), project, number);
  // Both IDs are validated above; this is data for Bash read, never shell code.
  console.log(`${config.appId} ${config.webClientId}`);
}
