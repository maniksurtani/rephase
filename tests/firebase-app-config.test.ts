import { describe, expect, it } from 'vitest';
import { firebaseAppConfig } from '../scripts/firebase-app-config.mjs';

const web = { client_type: 3, client_id: '123456789-web.apps.googleusercontent.com' };
function fixture() {
  return {
    project_info: { project_id: 'rephase-example', project_number: '123456789' },
    client: [
      {
        client_info: {
          mobilesdk_app_id: '1:123456789:android:abc123',
          android_client_info: { package_name: 'app.rephase.Rephase' },
        },
        api_key: [{ current_key: 'DO-NOT-COPY-THIS-KEY' }],
        oauth_client: [
          web,
          { client_type: 1, client_id: '123456789-android.apps.googleusercontent.com' },
        ],
        services: { appinvite_service: { other_platform_oauth_client: [web] } },
      },
    ],
  };
}

describe('Firebase setup import', () => {
  it('extracts only public IDs and deduplicates the repeated web client', () => {
    const result = firebaseAppConfig(fixture(), 'rephase-example', '123456789');
    expect(result).toEqual({ appId: '1:123456789:android:abc123', webClientId: web.client_id });
    expect(JSON.stringify(result)).not.toContain('DO-NOT-COPY');
  });

  it('rejects a different project, package or app ID before configuring cloud access', () => {
    expect(() => firebaseAppConfig(fixture(), 'another-project', '123456789')).toThrow(/project/);
    expect(() => firebaseAppConfig(fixture(), 'rephase-example', '999')).toThrow(/number/);
    const wrongPackage = fixture();
    wrongPackage.client[0].client_info.android_client_info.package_name = 'app.rephase.Other';
    expect(() => firebaseAppConfig(wrongPackage, 'rephase-example')).toThrow(/app.rephase.Rephase/);
    const wrongApp = fixture();
    wrongApp.client[0].client_info.mobilesdk_app_id = '1:999:android:abc123';
    expect(() => firebaseAppConfig(wrongApp, 'rephase-example')).toThrow(/app ID/);
  });

  it('does not guess between web clients or use an Android client as the server audience', () => {
    const document = fixture();
    document.client[0].oauth_client.push({
      client_type: 3,
      client_id: '123456789-another.apps.googleusercontent.com',
    });
    expect(() => firebaseAppConfig(document, 'rephase-example')).toThrow(/unambiguous/);
    document.client[0].oauth_client = [
      { client_type: 1, client_id: '123456789-android.apps.googleusercontent.com' },
    ];
    document.client[0].services.appinvite_service.other_platform_oauth_client = [];
    expect(() => firebaseAppConfig(document, 'rephase-example')).toThrow(/web OAuth/);
  });
});
