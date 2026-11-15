# iOS beta distribution with TestFlight

The **Publish iOS beta** GitHub Actions workflow builds `app.rephase.Rephase` and uploads it to TestFlight. It runs manually on **main**, never on a push. The installed name is **Rephase**. It uses the same Cloudflare backend and accounts as Android/web. You need an active paid Apple Developer Program membership; an ordinary Apple ID or free Xcode signing cannot distribute through TestFlight.

The workflow uses pinned Apple-Actions for certificate import and TestFlight uploading, Flutter for archiving/export, and Python's standard library for configuration/profile validation. No Fastlane service, Firebase SDK or Apple account password is needed. No IPA is attached to this public repository's Actions artifacts.

## 1. Create the Apple app identity

1. Enrol at [Apple Developer Program](https://developer.apple.com/programs/enroll/) and wait until membership is active. Accept any pending agreements in Developer/App Store Connect.
2. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), register an **App ID → App**, description **Rephase**, explicit bundle ID **`app.rephase.Rephase`**. Preserve the capital `R` everywhere. There is no need to own a matching website domain to use this identifier, but it must be available to your team.
3. Record the **Team ID** from your Apple membership details. This is not the App Store Connect Issuer ID or numeric app ID.
4. Our current app uses local notifications. It needs no APNs certificate or Push Notifications capability for those reminders.

This identity is permanent once distributed. The old `org.surtani.rephase` app is a different installation: save account edits before switching. Signing in to the same Google account loads server-side trips/settings; guest data and local notification permissions do not automatically transfer. Disable reminders in the old app or uninstall it after saving, to avoid duplicate notifications.

## 2. Register Google login in the new Google Cloud project

1. Select **`rephase-514702`** in [Google Auth Platform](https://console.cloud.google.com/auth/clients?project=rephase-514702).
2. Create an **iOS** OAuth client, name **Rephase iOS**, bundle ID **`app.rephase.Rephase`**. Supply the Apple Team ID if requested. An App Store ID, when requested as optional, can be filled in after creating the app record.
3. Copy the new iOS client ID. Use the **web OAuth client from this same project** as the server client ID.
4. In GitHub's **production** environment, set `GOOGLE_CLIENT_ID` to the new web client ID and `GOOGLE_MOBILE_CLIENT_IDS` to the comma-separated new Android/iOS client IDs. Preserve other clients still deliberately supported. An Android client belongs to the package/certificate pair and also needs recreating for `app.rephase.Rephase`.
5. Run **Deploy to Cloudflare** on main to apply that configuration. Configure the web client with JavaScript origin `https://rephase.surtani.org`; the GIS browser flow needs no redirect URI/client secret.
6. For local iOS runs update `mobile/config.json` with `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_SERVER_CLIENT_ID`, then use `npm run mobile -- run`. The launcher regenerates the Google callback URL scheme. CI generates that scheme from the same IDs.

Changing which Google Cloud project owns OAuth clients does not migrate a user's identity. If you plan to delete the actual Google account containing your Rephase trips, arrange a data migration before deleting it.

## 3. Create the App Store Connect record and test information

1. Open [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), click **+ → New App**.
2. Select iOS, name **Rephase** (or an available store name), primary language, bundle ID **`app.rephase.Rephase`**, and a unique SKU such as **`rephase-ios`**. Record the numeric Apple app ID for your reference; this workflow discovers the app from its bundle ID.
3. Under **TestFlight → Test Information**, complete the **Beta App Description**, **Feedback Email**, primary language/localization, and any requested privacy policy URL. The upload action checks this information before uploading when it waits for processing.
4. Complete beta review contact information and review instructions. Describe guest planning and Google sign-in accurately; if the reviewer must sign in to exercise a feature, provide an accessible review path/account using Apple's requested fields. Do not submit your personal account credentials.
5. Create an internal tester group for yourself if you have an eligible App Store Connect role. Create an **external** group named **Friends & Family** for other testers. They need only the TestFlight app and invitations, not access to your Apple developer team.

External testing requires Apple's beta review (particularly the first build). Apple may ask for changes, including login-policy compliance. Review [guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services): this app currently supports Google sign-in and guest use, not Sign in with Apple; do not assume that will satisfy every review. Upload success is not approval. Internal testing can be used first while review requirements are resolved.

## 4. Create an Apple Distribution certificate and profile

On your Mac:

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**. Enter your email/name and save the CSR to disk.
2. In Apple Developer → **Certificates**, create an **Apple Distribution** certificate using the CSR. Download the `.cer` and open it to install it in Keychain Access. Reuse a valid existing Apple Distribution certificate if you have its private key.
3. Under **My Certificates**, expand the certificate and confirm its private key is present. Export the certificate **with its private key** as `rephase-ios-distribution.p12`. Set a strong export password and keep an encrypted backup. This is separate from Android's `.p12` signing key.
4. In Apple Developer → **Profiles**, create an **App Store Connect** distribution profile (older UI may say App Store), select **`app.rephase.Rephase`**, then the same Apple Distribution certificate. Name it **Rephase TestFlight** and download the `.mobileprovision` file. Do not choose Development, Ad Hoc or Enterprise.
5. Store both files outside the repository, for example under `$HOME/.rephase-signing/`.

No tester device UDIDs are needed for TestFlight. Certificates/profiles expire: replace the relevant GitHub secrets when renewed. CI rejects an expired profile, incorrect team/app ID, or development/ad-hoc profile before compiling.

## 5. Create the App Store Connect API key

1. In [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api), request API access if prompted.
2. Create a **Team API key**, name **Rephase GitHub**, role **App Manager**. This workflow uses a team key with an Issuer ID, not an individual key.
3. Record its **Key ID** and **Issuer ID**. Download `AuthKey_KEYID.p8` and keep it securely; Apple allows one download. This API key authorizes upload/metadata/group operations. The distribution certificate separately signs the app.

## 6. Configure GitHub

Create **`ios-beta`** in [repository environments](https://github.com/maniksurtani/rephase/settings/environments), restrict deployment branches to **main**, and optionally require your review before a run accesses signing credentials.

Add these **environment variables**:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `APPSTORE_API_KEY_ID` | App Store Connect team API Key ID |
| `APPSTORE_ISSUER_ID` | App Store Connect Issuer UUID |
| `GOOGLE_SERVER_CLIENT_ID` | New project's **web** OAuth client ID, same as production `GOOGLE_CLIENT_ID` |
| `GOOGLE_IOS_CLIENT_ID` | New project's iOS client for `app.rephase.Rephase` |
| `TESTFLIGHT_GROUPS` | Optional exact group names, separated by commas; initially your internal group, later `Friends & Family` |
| `API_ORIGIN` | Optional; defaults to `https://rephase.surtani.org` |

If `TESTFLIGHT_GROUPS` is blank, the build uploads with release notes and you assign groups in App Store Connect. With groups set, the uploader assigns them after processing and submits external beta review when Apple reports it is ready. Complete review information first. It cannot bypass approval.

Add these **environment secrets**, using GitHub CLI on your Mac (adjust filenames):

```bash
gh auth login
base64 < "$HOME/.rephase-signing/rephase-ios-distribution.p12" | \
  gh secret set IOS_DISTRIBUTION_CERTIFICATE_BASE64 --repo maniksurtani/rephase --env ios-beta
gh secret set IOS_DISTRIBUTION_CERTIFICATE_PASSWORD --repo maniksurtani/rephase --env ios-beta
base64 < "$HOME/.rephase-signing/Rephase_TestFlight.mobileprovision" | \
  gh secret set IOS_PROVISIONING_PROFILE_BASE64 --repo maniksurtani/rephase --env ios-beta
gh secret set APPSTORE_API_PRIVATE_KEY --repo maniksurtani/rephase --env ios-beta \
  < "$HOME/.rephase-signing/AuthKey_KEYID.p8"
```

The certificate password is entered at the prompt. The API secret is the original multiline `.p8` contents, **not base64**. The certificate/profile secrets are base64. Never paste private keys/passwords into chat or commit them.

## 7. Publish and install

1. Pull main and confirm your backend already accepts the new Google clients.
2. In GitHub Actions select **Publish iOS beta → Run workflow → main** and enter **What to Test** notes. This is the only publishing trigger; ordinary pushes do not publish.
3. CI validates configuration, installs the signing profile/certificate in a temporary keychain, verifies the offline planner, runs Flutter checks, archives/exports the release app, checks the IPA's bundle ID/build, then uploads to TestFlight. It reuses the existing SDK caches and does not repeat the full web-browser suite or simulator suite. Temporary signing configuration, profiles and keychain are cleaned up.
4. The workflow waits up to 25 minutes in the upload/processing step to attach release notes and groups. If Apple takes longer, first inspect TestFlight: the upload may already have succeeded. Finish notes/group assignment there, or start a **new workflow run** for a new build; don't blindly re-upload the same build number.
5. Once available/approved, accept the email invitation on your iPhone/iPad, install Apple's **TestFlight**, and install Rephase. TestFlight builds expire after **90 days**. Testers can enable automatic beta updates in TestFlight.
6. Check fresh Google sign-in, existing trips, flight lookup, offline planning, notification permission/scheduling, and sign-out. These use live production account data.

The app version comes from `mobile/pubspec.yaml`. iOS build numbers use `GITHUB_RUN_NUMBER.GITHUB_RUN_ATTEMPT` (for example `12.1`), within Apple's component limits. Start new runs for releases; rerunning an older workflow after newer builds were uploaded can produce an out-of-order number. Android has its own version-code sequence.

## Backend domain changes

`app.rephase.Rephase` stays the same when the website moves. Update the Cloudflare custom domain and web OAuth origins, then set `API_ORIGIN` in **both** mobile publishing environments and rebuild. Keep the old backend endpoint operating for installed builds until users update; the app's API origin is compiled into each release.

## Verification status

Local tests validate setup configuration, profile restrictions and exported-package checks. Actual iOS release signing/upload and device Google login require your Apple credentials and have not been performed by preparing this workflow. Simulator/runtime CI checks are separate from signed device distribution.

References: [Flutter iOS deployment](https://docs.flutter.dev/deployment/ios), [Apple upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/), [pinned upload action](https://github.com/Apple-Actions/upload-testflight-build/tree/665328adbecbc3ad929d3da710696d928b8a7ba9).
