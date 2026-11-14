# Android beta distribution

Android betas use Firebase App Distribution and the manual **Publish Android beta** workflow. The package stays `org.surtani.rephase`, using the existing Cloudflare backend and live account data. Firebase hosts the APK and manages invitations; this flow needs no Firebase SDK, Firebase Authentication, Analytics or Google Play account. iOS/TestFlight comes later.

## 1. Enable Firebase

1. Open [Firebase Console](https://console.firebase.google.com/). Add Firebase to the **existing Google Cloud project** containing Rephase's web Google OAuth client. Select that existing project instead of creating another Google Cloud project. Analytics is optional and unnecessary here. App Distribution is a no-cost Firebase product.
2. In Project settings → General → Your apps, add an **Android** app: package **`org.surtani.rephase`**, nickname **Rephase Android**. Use the existing app if already registered. Leave the optional SHA-1 field blank for now; step 4 registers the release certificate.
3. Skip SDK integration and downloading `google-services.json`. Note the **Firebase App ID** (`1:123456789:android:abcdef...`) and the **Project ID** (a name, not the project number).
4. Open **App Distribution**, complete its setup if prompted, and create a tester group with alias **`friends-family`**. Add your email and your friends/family. The workflow will upload the first release; you need not upload a debug build to get started.

## 2. Connect GitHub to Firebase

1. In [GitHub repository environments](https://github.com/maniksurtani/rephase/settings/environments), create **`android-beta`**. Restrict its deployment branches to **main**. A required reviewer is optional for this manually triggered workflow.
2. Install [GitHub CLI](https://cli.github.com/) and [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) on your Mac if needed, then authenticate:

   ```bash
   gh auth login
   gcloud auth login
   ```

3. From the repository root, pull the workflow and run the setup script, replacing `YOUR_PROJECT_ID`:

   ```bash
   git pull --ff-only
   bash scripts/configure-android-beta.sh YOUR_PROJECT_ID
   ```

   Your Google account needs permission to enable APIs and manage IAM, service accounts and Workload Identity Federation. Project owners normally have this; an organization may require an administrator to run this step.

   The script creates a dedicated service account with Firebase App Distribution Admin permissions, and OIDC trust restricted to this repository's immutable IDs, main branch, beta workflow and environment. It creates no downloadable Google service-account key. It sets four public GitHub environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_WORKLOAD_IDENTITY_PROVIDER`, and `FIREBASE_TESTER_GROUP`. It can be rerun to update this dedicated setup. IAM changes can take several minutes to propagate.

4. Add two more **variables** to the **android-beta** environment:

   | Variable | Value |
   | --- | --- |
   | `FIREBASE_APP_ID` | Firebase Android app ID from step 1 |
   | `GOOGLE_SERVER_CLIENT_ID` | Existing **web** OAuth client ID; copy `GOOGLE_CLIENT_ID` from the GitHub **production** environment |

   These are public IDs. Do not put an OAuth client secret or flight-provider key in the app configuration.

## 3. Generate the signing key once

Create it outside the repository on your Mac. Keep an encrypted backup of the file and password; the same key is needed for future beta updates.

```bash
mkdir -p "$HOME/.rephase-signing"
chmod 700 "$HOME/.rephase-signing"
keytool -genkeypair -v -storetype PKCS12 \
  -keystore "$HOME/.rephase-signing/rephase-release.p12" \
  -alias rephase -keyalg RSA -keysize 3072 -validity 10000
chmod 600 "$HOME/.rephase-signing/rephase-release.p12"
```

`keytool` prompts for a password and certificate identity details. The PKCS12 store and key use the same password. If `keytool` is unavailable, use Android Studio's bundled executable, usually `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`, quoting the full path. Do not generate a new key for each release.

Upload the file without printing its contents:

```bash
base64 < "$HOME/.rephase-signing/rephase-release.p12" | \
  gh secret set ANDROID_KEYSTORE_BASE64 --repo maniksurtani/rephase --env android-beta
gh secret set ANDROID_KEYSTORE_PASSWORD --repo maniksurtani/rephase --env android-beta
```

The second command prompts for the password without putting it in shell history. These are the only two signing secrets. The workflow expects alias `rephase` and the same password for store and key; temporary signing files are removed after the run. Never paste the file, its base64 contents or password into chat.

## 4. Enable Google login for the release certificate

1. Show the **public** signing-certificate fingerprints:

   ```bash
   keytool -list -v -keystore "$HOME/.rephase-signing/rephase-release.p12" -alias rephase
   ```

2. In Google Cloud → APIs & Services → Credentials, create an **Android OAuth client** for package **`org.surtani.rephase`** and the **SHA-1** above. Name it **Rephase Android beta**. Use an existing client if that exact package/certificate pair is already registered. The debug certificate is different.
3. Append the new Android client ID to the comma-separated **`GOOGLE_MOBILE_CLIENT_IDS`** variable in GitHub's **production** environment. Preserve existing Android/iOS client IDs. `GOOGLE_CLIENT_ID` stays the web client ID.
4. Run **Deploy to Cloudflare** on main to activate the allowlist. This uses the existing verified-release workflow and updates the backend configuration; it does not publish the APK.
5. Check Google OAuth's audience settings if friends get an access-denied message. Firebase group membership and Google OAuth test-user restrictions are separate. A consent screen in Testing with scopes subject to test-user restrictions needs those testers added there too.

## 5. Publish and install

1. Open [GitHub Actions](https://github.com/maniksurtani/rephase/actions) → **Publish Android beta** → **Run workflow**, select **main**, and enter brief notes about what to test.
2. The workflow validates settings before compiling, checks the bundled offline planner and Flutter code/tests, builds the actual release app, verifies its signature, then uploads it to `friends-family`. It does not repeat the full web-browser suite or iOS builds. Ordinary pushes do not distribute apps.
3. Testers accept Firebase's email invitation with the invited Google account and install on Android. Android may require permission for that browser/tester app to install unknown apps. Updates are distributed through Firebase, not Google Play automatic updates. Firebase builds are available for 150 days.
4. If a locally built debug app is already installed, its different signing key prevents an in-place update. Ensure account changes are saved, then uninstall the debug app and install the beta. Uninstalling removes device-only/guest data. Subsequent beta updates retain data because the key and package stay the same.
5. Check first launch, Google login, an existing trip, flight lookup, offline planning and notification permissions/reminders. This beta uses the same live account data as the website.

The workflow records the commit, increasing build number, APK checksum and notes. Builds use seconds since 2020, including reruns, and publishing is serialized. Correct configuration and rerun if necessary. The native integration-test APK is never distributed; signed APKs are delivered through Firebase rather than public GitHub artifacts.

Firebase uploading, installation and release-certificate Google login require the setup above and must be checked with your actual account/device. For a later Google Play release, explicitly plan Play App Signing and certificate continuity; retain the signing-key backup.

References: [Firebase CLI distribution](https://firebase.google.com/docs/app-distribution/android/distribute-cli), [service-account authentication](https://firebase.google.com/docs/app-distribution/authenticate-service-account?platform=android), [GitHub OIDC authentication](https://github.com/google-github-actions/auth).
