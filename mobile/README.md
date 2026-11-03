# Rephase for iOS and Android

A native Flutter app alongside the React web app. Today, the day timeline, multi-flight trips, Lounge Explorer and Profile use Flutter widgets. Planning and lounge matching run offline using the same bundled TypeScript code and datasets as the web application.

## Mac setup

[Homebrew](https://brew.sh/) is the simplest option for a local Flutter SDK. Install Flutter, Node 24 LTS and CocoaPods:

```bash
brew install --cask flutter
brew install node@24 cocoapods
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

Add that `export PATH=…` line to `~/.zshrc` to select Node 24 in future terminal sessions. Flutter includes Dart; a separate Dart installation is unnecessary. CocoaPods is still required by the app's WebView plugin, even though other iOS dependencies use Swift Package Manager.

Install the full **Xcode** app from the Mac App Store and open it once to accept its license and finish setup. With Xcode at its default location, select it and install the iOS Simulator runtime:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS
open -a DeviceHub
flutter doctor -v
```

Xcode 27.2 uses **DeviceHub** to manage simulated devices. On older Xcode versions, launch the simulator app with `open -a Simulator` instead.

For Android, also install [Android Studio and its SDK/emulator](https://docs.flutter.dev/platform-integration/android/setup), then run `flutter doctor --android-licenses`. iOS targets 15.5+, Android targets API 24+ with a current Android System WebView. Follow any remaining toolchain setup reported by `flutter doctor -v`; the [Flutter iOS setup guide](https://docs.flutter.dev/platform-integration/ios/setup) covers Xcode and simulator configuration.

### Version compatibility

| Tool    | Verified in CI                             | Other local versions                                                                                                                                                           |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flutter | **3.47.7 stable**, bundled Dart **3.13.5** | **3.47.9 stable**, bundled Dart **3.13.7**, satisfies the locked SDK constraints and is expected to work. It has not been tested by this project's CI.                         |
| Node    | **24.x LTS**                               | **25.9.0** satisfies the current dependency engine requirements and may work, but Node 25 is non-LTS and reached end of life on **1 June 2026**. Use Node 24 for this project. |

Android uses **Gradle 9.3.1**, which supports running on **Java 25**, including Android Studio Rabbit 2's bundled Java 25.0.4. Android CI also uses Java 25. The Android Gradle plugin remains 8.13.2 and Kotlin remains 2.4.0; the app's Java/Kotlin bytecode target remains 17. Flutter normally selects Android Studio's bundled JDK; `flutter doctor -v` shows the actual Java path/version in use. You do not need a separate JDK installation when that bundled JDK works. See [Gradle's Java compatibility table](https://docs.gradle.org/9.3.1/userguide/compatibility.html#java_runtime).

The Flutter framework revision verified by CI remains `abaf9c523780a608bd46686fd5e53740a07077f8`. These are the project's tested versions, rather than exact-version restrictions in the local launcher. See the [Flutter SDK archive](https://docs.flutter.dev/install/archive) and [Node release schedule](https://github.com/nodejs/Release#release-schedule) for release details.

Homebrew installs its current Flutter release (3.47.9 as of 3 November 2026); it does not select this repository's exact CI version. To reproduce CI, download the matching macOS SDK from the Flutter archive into a separate directory, choosing Apple Silicon or Intel as appropriate. Select it for the launcher with `FLUTTER_BIN`, for example:

```bash
FLUTTER_BIN="$HOME/development/flutter-3.47.7/bin/flutter" npm run mobile:check
```

Run that command from the repository root after `npm ci`. If you work on several Flutter projects, a version manager such as [FVM](https://fvm.app/) is another option; its SDK executable can also be passed through `FLUTTER_BIN`. To check a local Flutter 3.47.9 installation before launching, use `flutter --version`, `node --version` and `npm run mobile:check`.

## Run locally

From the repository root:

```bash
npm ci
npm run mobile -- run
```

The launcher rebuilds the offline engine, resolves the locked Flutter dependencies and launches a connected device or simulator. To choose a device:

```bash
flutter devices
npm run mobile -- run -d DEVICE_ID
```

The app starts in guest mode; no Google, flight-provider or Cloudflare credentials are needed to enter a trip manually, explore the example, generate a plan or evaluate the bundled lounge guides. An existing signed-in account loads the same preferences and trips as the web app after native Google sign-in is configured.

Useful commands:

```bash
npm run mobile:check              # Format, analyze and Flutter tests
npm run mobile:apk                # Installable Android debug APK
npm run mobile -- ios            # Unsigned iOS Simulator build; macOS/Xcode
npm run mobile:engine             # Rebuild only the offline engine
node scripts/check-mobile-engine.mjs  # Exact engine parity in Chromium
```

Android output: `mobile/build/app/outputs/flutter-apk/app-debug.apk`. Install with `adb install -r mobile/build/app/outputs/flutter-apk/app-debug.apk`. This is a development build, not a Play Store release. Release builds deliberately require a private signing configuration; start from `android/key.properties.example`.

On a Mac, `npm run mobile -- ios` prepares an unsigned Simulator build. For a connected iPhone, open `mobile/ios/Runner.xcworkspace` in Xcode, select Runner → Signing & Capabilities → your development team, then launch with `npm run mobile -- run -d DEVICE_ID`. The phone must trust the developer and have Developer Mode enabled. The Simulator needs no signing team.

To select a nonstandard SDK path, set `FLUTTER_BIN=/path/to/flutter/bin/flutter`. Generated bundles, native build products, local OAuth configuration, signing files and device credentials are ignored by Git.

## Configure Google sign-in

Use the **same Google Cloud project** as the existing web OAuth client. Neither Firebase nor a new backend service is required. The native ID token targets the existing web client; the Worker separately verifies the native presenting client.

1. Copy `mobile/config.example.json` to **`mobile/config.json`**. Keep `API_ORIGIN` as `https://rephase.surtani.org`. `GOOGLE_SERVER_CLIENT_ID` can remain empty: the app reads the existing web client ID from `/api/config`.
2. In Google Cloud Console → APIs & Services → Credentials, create an **Android OAuth client** for package **`org.surtani.rephase`**. Register the SHA-1 of the certificate signing the installed build. For local debug builds, run `./gradlew signingReport` from `mobile/android` after installing the JDK/Android SDK. A CI-generated debug APK has its own debug certificate; use its fingerprint or a deliberately shared development signing key when testing Google login on that APK. Production signing needs a separate registered fingerprint.
3. Create an **iOS OAuth client** with bundle identifier **`org.surtani.rephase`**. Put its public client ID into `GOOGLE_IOS_CLIENT_ID` in `mobile/config.json`. The launcher generates the reversed callback scheme in the ignored `ios/Flutter/Google.xcconfig`; no client secret or Firebase configuration is needed. Use the launcher after changing this value, rather than launching Flutter directly with stale native callback settings.
4. Add the two native OAuth client IDs, separated by commas, to the GitHub **production environment variable** `GOOGLE_MOBILE_CLIENT_IDS`. Keep the existing `GOOGLE_CLIENT_ID` set to the web client. Redeploy the Worker through the existing verified-release workflow. Missing/invalid native configuration leaves native exchange disabled; browser sign-in remains unchanged.
5. Rebuild the app and use Profile → Continue with Google. Verify the account, shared trip/preferences, automatic saves, sign-out and account switching on real devices. Google consent-screen test-user restrictions still apply if your OAuth project is in testing.

The API key used for flight lookup stays in the Worker. Never put `RAPIDAPI_KEY`, Cloudflare API tokens, Google ID tokens or session credentials in mobile configuration. The example contains public OAuth IDs only.

## Architecture and storage

- `lib/features/`: native Today, Plan, Trips, Lounges and Profile views.
- `lib/app_controller.dart`: application state, lifecycle/clock refresh, account boundaries and automatic saves.
- `lib/data/`: immutable JSON views, atomic per-account offline files, secure native sessions, Google SDK and HTTP adapters.
- `lib/engine/`: serialized, bounded calls to a computation-only headless system WebView. Its self-contained HTML/JavaScript blocks network access, navigation and remote code. The visible application is Flutter.
- `src/mobile/bridge.ts`: the typed boundary to existing planning, timezone, timeline, lounge, validation, merge and calendar functions.
- `scripts/build-mobile-engine.mjs`: bundles the engine, airport catalog, lounge guides and preserved upstream notices. Generated assets are rebuilt rather than checked into Git.

The system WebView supplies the standard JavaScript/Intl timezone runtime on both platforms. This avoids maintaining a second circadian model and keeps calculations off the Flutter widget tree. Saved inputs remain schema 1, including unknown fields from newer web releases. Clock-only updates reuse the existing numerical plan.

If the OS stops the embedded JavaScript process, pending work fails promptly and the next request starts a fresh offline runtime. Invalid transport responses and timeouts also reset it; ordinary input-validation errors retain the existing runtime.

Opaque app-session credentials live in Keychain/Keystore. Guest and each account have separate app-private offline JSON files; guest data is not automatically imported into an account. Cloud saves use the existing revision-checked API and shared merge function. Offline edits remain pending locally; unresolved conflicts require a choice rather than an overwrite. Native logout revokes its app session. Google SDK ID tokens retain their standard Google expiry semantics.

## Verification and distribution

The Mobile checks workflow runs Flutter formatting, analysis and focused widget/data tests, verifies the compiled JavaScript planner against the web engine, builds an Android debug APK, compiles an unsigned iOS Simulator app on macOS and runs the offline engine integration tests inside WKWebView. No production OAuth, provider or signing secrets are supplied to these checks. The debug APK is attached to the Android workflow job.

The iOS job compiles its integration app once and runs that binary through the official Flutter driver. Connection startup has a three-minute limit. A timeout while Flutter is explicitly waiting for the VM service permits one restart of the selected simulator and one retry, provided no driver connection or test execution has been observed. Explicit command failures, assertions, cancellation and runtime hangs never trigger a retry. After connection, the runtime has its own three-minute limit. Each attempt's complete driver output is streamed to the job and retained with simulator diagnostics in the `rephase-ios-runtime-…` artifact for 14 days, including successful recovery attempts.

For the real embedded runtime on an emulator/device:

```bash
npm run mobile:engine
cd mobile
flutter drive --no-dds --driver=test_driver/integration_test.dart \
  --target=integration_test/offline_engine_test.dart -d DEVICE_ID
```

This exercises on-device planning, clock refresh and DST gap/fold handling. Automated account/provider tests use controlled responses; real native Google login, account reconnection and dated flight lookup need owner acceptance. CI compilation does not establish physical-device behavior.

iPhone installation needs a Mac/Xcode and an Apple development signing team, or a signed TestFlight build. App Store/Play Store publication is a separate step: choose final signing/distribution, privacy declarations and store assets, and review Apple's login requirements before public distribution. No store upload or signed release is performed by this workflow.
