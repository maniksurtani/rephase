# iOS beta distribution with TestFlight

[Publish iOS beta](https://github.com/maniksurtani/rephase/actions/workflows/ios-beta.yml) follows the working [Zerocal TestFlight workflow](https://github.com/maniksurtani/zerocal/blob/main/.github/workflows/ios-testflight.yml): an unsigned Flutter archive, manual signing at export, and Apple's `altool` for upload. It runs **manually on main**, never on a push. The bundle ID is **`app.rephase.Rephase`**, including the capital `R`; the installed name is **Rephase**.

[Unsigned release validation passed](https://github.com/maniksurtani/rephase/actions/runs/43862210377) on macOS 15 / Xcode 26.3 for version 0.1.0 (1.1). [The first signed upload](https://github.com/maniksurtani/rephase/actions/runs/43866920093) published 0.1.0 (2.1), and the owner confirmed it works. Subsequent releases use plain integer workflow run numbers as described below.

There are four modes:

| Mode | What it does | Required configuration |
| --- | --- | --- |
| `validate` | Checks code/planner and compiles an unsigned device archive; verifies identity, version and icons | No Apple credentials; Google IDs optional (guest build) |
| `build` (default) | Also signs, exports and verifies the IPA; does not upload | Distribution certificate, Rephase profile and both Google client IDs |
| `upload` | Uploads, waits for processing, submits beta review when required and assigns `friends-family` | All of the above, plus an App Manager team API key |
| `distribute` | Assigns an already uploaded version/build; no compilation or upload | Team API key, exact `version` and `existing_build` |

Rephase is a public repository: unlike private Zerocal, this workflow does not attach IPAs or archives to public Actions artifacts. `build` is a signing check; installable betas are distributed through TestFlight in `upload` mode. Apple processes the upload asynchronously; a green upload job means Apple accepted the upload, not that beta review or installation passed.

**Before-upload retries rebuild native binaries.** GitHub discards the job runner and its files when a job ends. The publishing workflow retains no IPA/archive, and native validation retains diagnostics and dependency locks, not the simulator app. Re-running either job therefore recompiles it; only the verified shared engine and successful exact-commit checks can be reused. After a successful Apple upload, use the distribution-only retry below to avoid another build. If native validation is failing, finish that check before starting another signing build.

## If Zerocal already publishes successfully

1. In Apple Developer, register **`app.rephase.Rephase`** and create its **App Store Connect distribution profile** using the same Apple Distribution certificate as Zerocal. In App Store Connect, create the Rephase app record for this bundle ID.
2. Create an **iOS OAuth client** for this bundle ID in Google Cloud project **`rephase-514702`**. Add its client ID to the production Worker's `GOOGLE_MOBILE_CLIENT_IDS`, preserving the working Android client, and redeploy the Worker. Reuse Rephase's existing web OAuth client as `GOOGLE_SERVER_CLIENT_ID`.
3. Open the GitHub **`ios-beta`** environment and add the six Apple secrets and two Google variables listed below. Five Apple values can be reused from Zerocal if both apps are on the same Apple team; **the provisioning profile must be new and specific to Rephase**.
4. Run **Publish iOS beta → upload**, version **0.1.0**. Enter `release_notes` for What to Test. The workflow assigns the processed build to `friends-family` automatically.

GitHub does not let anyone retrieve stored secret values, including repository administrators. Copy the original saved `.p12`, password and `.p8` credentials into Rephase's environment; this workspace cannot extract them from Zerocal. If using organisation secrets, grant Rephase access instead. Do not regenerate or revoke Zerocal's working certificate just to add Rephase.

## 1. Apple app identity and testers

Use the same active paid Apple Developer membership/team as Zerocal if appropriate. Accept any pending Apple agreements.

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), register **App ID → App**, description **Rephase**, explicit bundle ID **`app.rephase.Rephase`**. A matching website domain is not required. Current reminders are local notifications: no APNs certificate or Push Notifications capability is needed.
2. In [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), choose **+ → New App**, platform iOS, name **Rephase** (or an available store name), primary language, this bundle ID and a unique SKU such as `rephase-ios`. The workflow identifies the app through the bundle ID; no numeric app ID variable is needed.
3. Under **TestFlight → Test Information**, fill in the beta description, feedback email, review contact and any requested privacy policy/review instructions. Explain guest planning and Google sign-in accurately.
4. Create an internal tester group for yourself if your App Store Connect role permits it. Create an **external** group named exactly **`friends-family`** and add your friends/family testers to it. External testing requires Apple's beta review, particularly for the first build; friends need TestFlight invitations, not developer team access.

The app currently supports guest use and Google login. Check [Apple guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services) when preparing external review; Sign in with Apple is not currently implemented. The workflow submits beta review when Apple requires it and enables automatic tester notification after approval. It does not submit a public App Store release or create/change tester memberships.

## 2. Rephase Google login

1. Select **`rephase-514702`** in [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?project=rephase-514702).
2. Create an **iOS** client named **Rephase iOS**, bundle ID **`app.rephase.Rephase`**. Supply your Apple Team ID if requested. An optional App Store ID can be filled in from the app record.
3. Set `ios-beta` variable `GOOGLE_IOS_CLIENT_ID` to that ID. Set `GOOGLE_SERVER_CLIENT_ID` to Rephase's existing **web** client ID from the same project, matching production `GOOGLE_CLIENT_ID` and Android's server client ID. Do not use Zerocal's OAuth configuration.
4. Add the iOS client ID to the production environment variable `GOOGLE_MOBILE_CLIENT_IDS`, separated by a comma from the existing Android ID. Preserve supported clients. Run **Deploy to Cloudflare** on main to apply it.
5. For local iOS testing, put the two IDs in ignored `mobile/config.json`, then use `npm run mobile -- run`. The launcher/CI generates the Google callback URL scheme from the iOS ID.

A changed bundle ID is a separate installation. Existing `app.rephase.Rephase` installs retain their identity. The old `org.surtani.rephase` app's guest data and reminder permissions do not migrate; signed-in account data is loaded from the same backend.

## 3. Certificate and provisioning profile

Reuse Zerocal's **Apple Distribution certificate with its private key**, if valid and owned by the same team. The certificate can sign more than one app; a profile cannot.

If an export is needed, open **Keychain Access → My Certificates**, expand the distribution certificate to check the private key is present, then export both as a password-protected `.p12`. If no usable certificate exists, generate a CSR in Keychain Access, create an Apple Distribution certificate in Apple Developer, download/install it, and export it with the private key. Store the `.p12` and password securely outside the repository.

In Apple Developer → **Profiles**, create an **App Store Connect** profile (older UI: App Store), select **`app.rephase.Rephase`**, and select that exact distribution certificate. Name it **Rephase TestFlight** and download the `.mobileprovision` file. Development, Ad Hoc and Enterprise profiles will be rejected. No tester device UDIDs are needed.

CI derives the Team ID from the profile and compares its certificate fingerprints with valid identities in a temporary keychain before compiling. It rejects expired profiles, other app IDs, or a profile signed for a different certificate. Renew expired credentials by replacing the matching secrets.

## 4. App Store Connect API key

Reuse Zerocal's **team API key**, Key ID and Issuer ID if its team/role authorizes Rephase uploads. Otherwise, in [Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api), create a team key with **App Manager** role. Record its Key ID and Issuer ID, and download the `.p8` file (available only once).

This authorizes upload, beta review and external-group assignment; the distribution `.p12` separately signs the app. No Apple ID password, Fastlane service or Firebase SDK is involved.

## 5. GitHub environment

Open **`ios-beta`** in [Rephase's environments](https://github.com/maniksurtani/rephase/settings/environments). The first validation run created this environment. Restrict deployment branches to **main**; optionally require your review before accessing credentials. The workflow independently requires main.

Add these **secrets**, with exactly the same names as Zerocal:

| Secret | Source |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 of the Apple Distribution `.p12`; reusable from Zerocal |
| `IOS_DISTRIBUTION_P12_PASSWORD` | That `.p12` export password |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64 of the new **Rephase** App Store Connect profile |
| `APP_STORE_CONNECT_KEY_ID` | Team API Key ID, reusable from Zerocal |
| `APP_STORE_CONNECT_ISSUER_ID` | Team API Issuer UUID, reusable from Zerocal |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Original multiline `.p8` text, reusable from Zerocal; **not base64** |

Add these **variables**:

| Variable | Value |
| --- | --- |
| `GOOGLE_SERVER_CLIENT_ID` | Rephase web client ID, matching production `GOOGLE_CLIENT_ID` |
| `GOOGLE_IOS_CLIENT_ID` | Rephase iOS client for `app.rephase.Rephase` |
| `API_ORIGIN` | Optional; defaults to `https://rephase.surtani.org` |

For example, on your Mac with `gh auth login` complete (adjust filenames):

```bash
base64 < "$HOME/.rephase-signing/distribution.p12" | \
  gh secret set IOS_DISTRIBUTION_P12_BASE64 --repo maniksurtani/rephase --env ios-beta
gh secret set IOS_DISTRIBUTION_P12_PASSWORD --repo maniksurtani/rephase --env ios-beta
base64 < "$HOME/.rephase-signing/Rephase_TestFlight.mobileprovision" | \
  gh secret set IOS_PROVISIONING_PROFILE_BASE64 --repo maniksurtani/rephase --env ios-beta
gh secret set APP_STORE_CONNECT_KEY_ID --repo maniksurtani/rephase --env ios-beta
gh secret set APP_STORE_CONNECT_ISSUER_ID --repo maniksurtani/rephase --env ios-beta
gh secret set APP_STORE_CONNECT_PRIVATE_KEY --repo maniksurtani/rephase --env ios-beta \
  < "$HOME/.rephase-signing/AuthKey_KEYID.p8"
gh variable set GOOGLE_SERVER_CLIENT_ID --repo maniksurtani/rephase --env ios-beta
gh variable set GOOGLE_IOS_CLIENT_ID --repo maniksurtani/rephase --env ios-beta
```

Commands without stdin prompt for the value. Never paste private keys/passwords into chat or commit them. The earlier untested workflow's `APPSTORE_*`, `IOS_DISTRIBUTION_CERTIFICATE_*`, `APPLE_TEAM_ID` and `TESTFLIGHT_GROUPS` settings are no longer used. The `release_notes` input sets What to Test; group assignment uses the existing team key and the fixed `friends-family` group. No new secret or group variable is required.

## 6. Publish and install

In GitHub Actions, select **Publish iOS beta → Run workflow → main → upload**, version **0.1.0**, or run:

```bash
gh workflow run ios-beta.yml --repo maniksurtani/rephase --ref main \
  -f mode=upload -f version=0.1.0 \
  -f 'release_notes=Please test the updated trip planner.'
```

Use `-f mode=validate` for unsigned compilation or `-f mode=build` for a signing-only check. The default `build` deliberately does not publish.

The workflow uses the same macOS 15 / latest-stable Xcode selection as Zerocal, Rephase's cached pinned Flutter SDK and locked Dart packages, and CocoaPods. Preparation reuses or starts Checks, Mobile checks and Native runtime checks for the exact main commit. It downloads the verified mobile engine and licenses, validates their manifest/checksums, then builds one unsigned device archive and signs at export while native tests run. The Flutter release build retains its pub phase to remove the development-only integration-test plugin from native registrants. Release compilation does not repeat unit, widget or Chromium parity tests. The upload gate requires successful web/mobile checks and the iOS native job for this exact commit; a failure or advancing main blocks upload. Checks absent because of push path filters are started automatically. The simulator and release use the same CocoaPods configuration. Temporary credentials/keychain/profile files are cleaned up even on failure.

The marketing version comes from the `version` input. Android and iOS both use their own **GitHub workflow run number** as a plain integer, matching Zerocal (for example `3`, then `4`). Their counters are independent and may differ; validation-only, signing-only and failed runs can leave gaps. **Re-run jobs** retains the same number. Use **Run workflow** on the latest main for each new published build, especially if Apple has already received the previous upload. The archive and IPA must match the requested version/build and bundle ID and contain compiled icons; the exported app's signature is verified before Apple's upload validation. Don't rename/recreate the workflow, publish old runs after a newer release, or upload arbitrary local build numbers that leap ahead of its counter. The iOS helper accepts run numbers 1–9999 to fit Apple's first build-number component; plan a numbering migration before that limit.

The first uploaded beta was `2.1` under the previous run/attempt scheme. Build `3` is newer and updates normally through TestFlight; no iOS reinstall is needed. Existing Android timestamp builds need a [one-time reinstall](DISTRIBUTION.md#one-time-transition-from-timestamp-build-numbers).

After Apple accepts the upload, the macOS job cleans up and a small **Linux distribution job**:

1. Waits up to 30 minutes for the exact marketing version/build to finish processing.
2. Sets English **What to Test** from `release_notes` and enables automatic tester notification.
3. Submits beta review if the build is ready for submission, then assigns it to **`friends-family`**, preserving other groups and locales.
4. Reports whether Apple review remains pending. Assignment does not bypass Apple review or guarantee immediate availability. Missing review contact/test information or export-compliance answers must be completed in App Store Connect; the workflow reports Apple's error.

Accept the invitation on an iPhone/iPad and install through **TestFlight**. Builds expire after 90 days. Verify Google sign-in, saved trips/settings, offline planning, timezone changes and reminder permission/delivery on a physical device.

If processing or assignment fails after a successful upload, **re-run only the failed distribution job**, or use `distribute` mode with the exact existing version/build:

```bash
gh workflow run ios-beta.yml --repo maniksurtani/rephase --ref main \
  -f mode=distribute -f version=0.1.0 -f existing_build=6 \
  -f 'release_notes=Please test trip planning and reminders.'
```

This path does not access signing files, rebuild, upload again, or consume a macOS runner. It still consumes a workflow run number, so the next new build number can have a gap. If the upload itself times out, inspect App Store Connect first: Apple may already have received it. Do not upload the same version/build again. Distribution never guesses the latest build.
