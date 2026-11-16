# iOS beta distribution with TestFlight

[Publish iOS beta](https://github.com/maniksurtani/rephase/actions/workflows/ios-beta.yml) follows the working [Zerocal TestFlight workflow](https://github.com/maniksurtani/zerocal/blob/main/.github/workflows/ios-testflight.yml): an unsigned Flutter archive, manual signing at export, and Apple's `altool` for validation/upload. It runs **manually on main**, never on a push. The bundle ID is **`app.rephase.Rephase`**, including the capital `R`; the installed name is **Rephase**.

[Unsigned release validation passed](https://github.com/maniksurtani/rephase/actions/runs/43862210377) on macOS 15 / Xcode 26.3 for version 0.1.0 (1.1). Signing and upload remain pending owner credentials.

There are three modes:

| Mode | What it does | Required configuration |
| --- | --- | --- |
| `validate` | Checks code/planner and compiles an unsigned device archive; verifies identity, version and icons | No Apple credentials; Google IDs optional (guest build) |
| `build` (default) | Also signs, exports and verifies the IPA; does not upload | Distribution certificate, Rephase profile and both Google client IDs |
| `upload` | Also validates with Apple and uploads to App Store Connect | All of the above, plus the App Store Connect team API key |

Rephase is a public repository: unlike private Zerocal, this workflow does not attach IPAs or archives to public Actions artifacts. `build` is a signing check; installable betas are distributed through TestFlight in `upload` mode. Apple processes the upload asynchronously; a green upload job means Apple accepted the upload, not that beta review or installation passed.

## If Zerocal already publishes successfully

1. In Apple Developer, register **`app.rephase.Rephase`** and create its **App Store Connect distribution profile** using the same Apple Distribution certificate as Zerocal. In App Store Connect, create the Rephase app record for this bundle ID.
2. Create an **iOS OAuth client** for this bundle ID in Google Cloud project **`rephase-514702`**. Add its client ID to the production Worker's `GOOGLE_MOBILE_CLIENT_IDS`, preserving the working Android client, and redeploy the Worker. Reuse Rephase's existing web OAuth client as `GOOGLE_SERVER_CLIENT_ID`.
3. Open the GitHub **`ios-beta`** environment and add the six Apple secrets and two Google variables listed below. Five Apple values can be reused from Zerocal if both apps are on the same Apple team; **the provisioning profile must be new and specific to Rephase**.
4. Run **Publish iOS beta → upload**, version **0.1.0**. After processing, add What to Test and assign testers in App Store Connect → Rephase → TestFlight.

GitHub does not let anyone retrieve stored secret values, including repository administrators. Copy the original saved `.p12`, password and `.p8` credentials into Rephase's environment; this workspace cannot extract them from Zerocal. If using organisation secrets, grant Rephase access instead. Do not regenerate or revoke Zerocal's working certificate just to add Rephase.

## 1. Apple app identity and testers

Use the same active paid Apple Developer membership/team as Zerocal if appropriate. Accept any pending Apple agreements.

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), register **App ID → App**, description **Rephase**, explicit bundle ID **`app.rephase.Rephase`**. A matching website domain is not required. Current reminders are local notifications: no APNs certificate or Push Notifications capability is needed.
2. In [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), choose **+ → New App**, platform iOS, name **Rephase** (or an available store name), primary language, this bundle ID and a unique SKU such as `rephase-ios`. The workflow identifies the app through the bundle ID; no numeric app ID variable is needed.
3. Under **TestFlight → Test Information**, fill in the beta description, feedback email, review contact and any requested privacy policy/review instructions. Explain guest planning and Google sign-in accurately.
4. Create an internal tester group for yourself if your App Store Connect role permits it. Create an **external** group, such as **Friends & Family**, for others. External testing requires Apple's beta review, particularly for the first build; friends need TestFlight invitations, not developer team access.

The app currently supports guest use and Google login. Check [Apple guideline 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services) when preparing external review; Sign in with Apple is not currently implemented. The workflow uploads only; it does not submit the app for public App Store release or automatically submit beta review.

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

This authorizes upload; the distribution `.p12` separately signs the app. No Apple ID password, Fastlane service or Firebase SDK is involved.

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

Commands without stdin prompt for the value. Never paste private keys/passwords into chat or commit them. The earlier untested workflow's `APPSTORE_*`, `IOS_DISTRIBUTION_CERTIFICATE_*`, `APPLE_TEAM_ID` and `TESTFLIGHT_GROUPS` settings are no longer used. Notes and group assignment now happen in App Store Connect, as with Zerocal.

## 6. Publish and install

In GitHub Actions, select **Publish iOS beta → Run workflow → main → upload**, version **0.1.0**, or run:

```bash
gh workflow run ios-beta.yml --repo maniksurtani/rephase --ref main \
  -f mode=upload -f version=0.1.0
```

Use `-f mode=validate` for unsigned compilation or `-f mode=build` for a signing-only check. The default `build` deliberately does not publish.

The workflow uses the same macOS 15 / latest-stable Xcode selection as Zerocal, Rephase's cached pinned Flutter SDK and locked Dart packages, and CocoaPods. It checks the offline planner and Flutter code, then builds one unsigned device archive and signs at export. The Flutter release build retains its pub phase to remove the development-only integration-test plugin from native registrants. It does not repeat the full web browser or native simulator suites. Temporary credentials/keychain/profile files are cleaned up even on failure.

The marketing version comes from the `version` input. Rephase preserves its existing **`workflow run number.attempt`** build numbering (for example `4.1`, then `4.2` on retry), rather than Zerocal's run-number-only scheme. New runs increase the number; reruns also get a fresh number. The archive and IPA must match both values and the bundle ID and contain compiled icons; the exported app's signature is verified before Apple's validation/upload. Don't rename/recreate the workflow or upload arbitrary local build numbers that leap ahead of its counter.

After Apple accepts the upload:

1. Wait for processing in **App Store Connect → Rephase → TestFlight**. Processing failures appear there or by email; workflow success is not a processing check.
2. Fill in **What to Test** and any requested compliance/test information. The app declares standard HTTPS/OS encryption only in its Info.plist; revisit that declaration if cryptography changes.
3. Assign the processed build to your internal group, or submit the external group for beta review and invite testers after approval. You can enable Apple's automatic distribution for your internal group.
4. Accept the invitation on an iPhone/iPad and install through Apple's **TestFlight**. Builds expire after **90 days**.
5. Verify Google sign-in, saved trips/settings, offline planning, timezone changes and reminder permission/delivery on a physical device.

If upload times out or a run fails after upload, inspect TestFlight first: Apple may already have received the build. Do not upload an identical version/build twice. Use a new run for the next release once you know the result.
