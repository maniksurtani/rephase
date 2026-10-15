# Running and deploying Rephase

**Production is live at https://rephase.surtani.org**, deployed on 15 October 2026 using a Cloudflare Worker Custom Domain, static assets and D1. The original `0001`/`0002` database migrations and the hourly cache-purge schedule are applied. The owner has verified real Google sign-in; live flight lookup is disabled until `RAPIDAPI_KEY` is supplied. The revised account UX/automatic-saving update and additive `0003_google_avatar.sql` migration are being prepared for the next release, with acceptance still pending.

## Production configuration at rephase.surtani.org

Create a GitHub Actions environment named `production` at [repository environment settings](https://github.com/maniksurtani/rephase/settings/environments). Set these environment variables:

| Variable | Value |
|---|---|
| `PUBLIC_APP_ORIGIN` | `https://rephase.surtani.org` |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID of the D1 database named `rephase` |
| `GOOGLE_CLIENT_ID` | Your public Google OAuth Web application client ID |

Create the D1 database once through Cloudflare's dashboard or `npx wrangler d1 create rephase` after local login. Add `https://rephase.surtani.org` as an authorized JavaScript origin on the Google client, and `surtani.org` as its authorized domain where required by the Google branding/consent settings. This GIS flow uses no Google client secret or redirect URI.

Enter `CLOUDFLARE_API_TOKEN` directly as a `production` environment secret. Keep it out of chat and source control. An optional `RAPIDAPI_KEY` secret enables AeroDataBox flight lookup; manual flight entry works without it. The current workspace GitHub integration can push and dispatch workflows but cannot read or write Actions variables/secrets, so these settings require the repository owner's one-time setup.

Confirm `rephase.surtani.org` has no existing DNS record or service before the first run. A noninteractive Wrangler deployment can replace an existing origin or DNS assignment. The generated deployment config declares a Custom Domain, disables workers.dev/preview URLs for this target, and lets Cloudflare create DNS and HTTPS automatically. Do not create a manual CNAME for it.

Once settings are complete, run **Actions → Deploy to Cloudflare → Run workflow**, selecting `main`. The workflow runs checks, migrates D1, deploys assets/API, and verifies the public configuration. Leave `DEPLOY_ENABLED` unset for the first deployment; setting it to `true` later enables deployment on every main push.

The Worker upload, migrations, DNS and TLS succeeded. The deployment workflow's final public check is currently blocked because Cloudflare challenges GitHub-hosted runners: the separate verification run received HTTP 403, HTML and `cf-mitigated: challenge`. Public browser and guest/offline checks passed. This is a security-rule issue, not evidence of a failed upload or an unprovisioned domain. See the troubleshooting steps below before rerunning deployment.

Verification allows over three minutes for transient DNS/TLS or edge readiness failures, with a five-second timeout per request. A confirmed Cloudflare challenge instead stops immediately with a diagnostic and Security Events guidance. Neither case is silently treated as a successful check.

Production smoke checks passed: desktop and 390px mobile guest planning, unique date tiles, both airport clocks, meal advice, calendar export, all 24 offline assets, offline planner/Science, Science without JavaScript, and HTTP 401 for unauthenticated account/state APIs. These checks do not complete Google sign-in or spend provider credits. Manual deployment is always available; automatic main-push deployment depends on the repository variable `DEPLOY_ENABLED=true`.

## Account storage and the next migration

Signed-in preferences and trips live in D1 and save automatically after committed edits are debounced. IndexedDB is an offline cache with pending edits and revision merge metadata; it is not the authoritative account store. Guest data stays separate and is never automatically copied into an account. Older same-account edits with a saved baseline use three-way merging. Without that baseline, personal data can migrate once only into a never-initialized D1 account, excluding demonstration trips; existing server data and deletion tombstones are never blindly replaced. Transactional per-tab journals keep unsaved drafts recoverable when multiple tabs are used. Google’s official button opens Google directly, and the header avatar menu contains Sign out. No application starting-data chooser or manual sync step is required.

The next deployment applies `0003_google_avatar.sql` before publishing the updated Worker. It adds a nullable `users.picture` column and remains compatible with the previous Worker. Existing sessions keep working, but their avatar is populated by the next Google sign-in; users can sign out and sign in once if the fallback image remains. No additional secret, OAuth scope or Cloudflare resource is needed.

This account storage fits Cloudflare’s free tier for personal use and an initial audience. D1 currently allows **500 MB per database**, **5 GB per account**, **5 million row reads/day** and **100,000 row writes/day**. Workers allow **100,000 dynamic requests/day** on the free plan; static asset requests are free. Session verification, account operations, provider cache and quota records share these budgets. Debouncing avoids a write for every typed change, but database size and usage must still be monitored. Separate provider limits continue to apply. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Cloudflare challenges during verification

Run **Actions → Verify production → Run workflow** on `main` to check DNS, public HTTPS and API configuration without deploying or using a Cloudflare API token. This workflow does not change the Worker, D1 or security settings. Its diagnostics print only response categories, readiness booleans, allowlisted errors and a validated Cloudflare Ray ID when available. Configuration values and response bodies are not printed by the verifier.

Cloudflare's [`cf-mitigated: challenge` response header](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) identifies a browser challenge. It does not identify which product or rule issued it. In the Cloudflare dashboard, select **surtani.org → Security → Analytics → Events** (navigation may appear as **Security → Events**). Filter by host `rephase.surtani.org`, path `/api/config`, the verification time or its Ray ID. Expand the event and inspect **Service** and the matched rule. The initial diagnostic run was [38683737612](https://github.com/maniksurtani/rephase/actions/runs/38683737612), around 04:52 UTC on 15 October 2026.

If a custom WAF rule caused the challenge, exclude this exact public request from that rule. If a managed feature supports exceptions, create a custom **Skip** rule targeting only that feature, using:

```text
(http.host eq "rephase.surtani.org"
 and http.request.uri.path eq "/api/config"
 and http.request.method eq "GET")
```

Place a skip rule before any challenging custom rules it must skip, and keep matching-request logging enabled. This narrowly scoped endpoint contains public configuration; account and state APIs still require authentication. Do not skip all security products or allowlist the changing GitHub runner IP ranges.

**Bot Fight Mode is different:** the free product cannot be bypassed with WAF Skip rules. If that is the reported service, a scoped exception requires a product that supports one, such as Super Bot Fight Mode. Disabling free Bot Fight Mode affects the whole zone and is an explicit owner decision. Do not change unrelated zone protections to make the check pass.

After the relevant exception is configured, rerun **Verify production**, then **Deploy to Cloudflare**, and verify real Google sign-in and automatic account save/reload. The deployment token is intentionally scoped to Workers/D1; adjusting zone security belongs in the owner's Cloudflare dashboard.

## Start the app locally

Install **Node.js 22.13 or newer** with npm; Node 24 is used in CI. From the repository directory:

```sh
npm start
```

The launcher installs dependencies only if they are missing, builds if needed, creates `.dev.vars` with empty keys if that file does not exist, applies migrations to **local D1**, and starts both servers. It opens **http://localhost:5173** once the UI and API respond. The API also listens on **http://localhost:8787**. Stop them together with **Ctrl+C**. Existing `.dev.vars` values are preserved and credentials are never printed.

For a terminal without a desktop browser, use:

```sh
npm start -- --no-open
```

Useful variants:

```sh
# Browser-only app; Google account storage and live flight lookup require the Worker.
npm start -- --static --no-open

# Serve the built PWA and API from one local origin on port 8787.
npm start -- --production --no-open

# Use alternative ports without killing existing processes.
npm start -- --port 5174 --worker-port 8788 --no-open

npm start -- --help
```

If a port is occupied the launcher exits before setup. It does not stop another application's server. Servers bind to local loopback. In a remote workspace, forward port 5173, or 8787 in production mode, through your IDE/workspace and open the forwarded URL on your device. To test Google sign-in remotely with the launcher's local-origin defaults, use a localhost tunnel that preserves the registered `http://localhost:5173` origin (or port 8787 for production mode).

Local planning, trip editing, the science page and saved preferences work without credentials. To test Google sign-in, create a **Google OAuth Web application** client and add `http://localhost:5173` to its authorized JavaScript origins. For production-mode local testing, also add `http://localhost:8787`. Set its public client ID in `.dev.vars` and restart the launcher:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
ALLOWED_ORIGIN="http://localhost:5173"
RAPIDAPI_KEY=""
```

The launcher supplies the correct local origin when you choose another port. Register that origin in Google as well. This sign-in flow needs no Google client secret, redirect URL, Gmail access or Calendar access. Once a flight provider subscription is configured, its RapidAPI key belongs in the ignored `.dev.vars` file for local lookup; live lookup requires signing in.

## Connect an empty GitHub repository

Current workspace: the code is synced to [maniksurtani/rephase](https://github.com/maniksurtani/rephase). `origin` points to `git@github.com:maniksurtani/rephase.git`, and local `main` tracks `origin/main`. The initial push is complete. GitHub Actions checks run on pushes to `main`; production is live, and the deployment workflow runs manually or on main pushes when the repository variable `DEPLOY_ENABLED=true`.

Create an empty GitHub repository, choosing its name and visibility. Leave GitHub's README, license and `.gitignore` initialization options unchecked so the remote stays empty and can receive this repository's existing history.

For SSH authentication, add your SSH public key to GitHub. For HTTPS, sign in with `gh auth login` or a Git credential manager; GitHub does not accept your account password for Git pushes. Never put an access token in a remote URL.

The helper defaults to printing the exact commands, with no remote writes:

```sh
npm run github:remote -- --url https://github.com/YOUR_ACCOUNT/YOUR_REPO.git
# Alternatively: --url git@github.com:YOUR_ACCOUNT/YOUR_REPO.git
```

To verify the remote is empty and add `origin` **locally**:

```sh
npm run github:remote -- --url https://github.com/YOUR_ACCOUNT/YOUR_REPO.git --check-empty --configure
```

Then run the printed `git push -u origin main` command when you are ready to upload. The helper never pushes, force-pushes, creates a repository or replaces an existing different remote. The `Checks` workflow runs for pull requests and pushes to `main`; it installs locked dependencies, typechecks, tests, builds and runs Chromium browser scenarios. Pull-request checks receive no deployment or provider secrets.

## Move the complete Git history to your computer

The portable handoff uses `rephase.bundle`, a verified Git bundle containing the committed history at the time it was generated. It contains no ignored credentials, dependency directories, or local database state. Download the latest bundle, then run these commands from its directory on a computer with a working GitHub SSH key:

```sh
git clone rephase.bundle rephase-git
cd rephase-git
git remote set-url origin git@github.com:maniksurtani/rephase.git
git push -u origin main
```

Cloning the bundle sets `origin` to the bundle file initially, so the `set-url` command changes it to GitHub before pushing. This preserves the bundle's commits and the prepared workflows. Never paste a token into chat or a remote URL.

## Prepare Cloudflare and Google

Rephase uses one **Cloudflare Worker with static assets**, one **D1 database** for Google sessions, account data and the shared flight cache, and an hourly scheduled handler to purge expiring provider data. The planner remains in the browser. This is a Workers deployment, not a separate Pages project.

Static HTML keeps its explicit filename (`html_handling: none`), so `/science.html` has the same URL in the offline cache and on Cloudflare. SPA fallback handles the application routes.

After choosing the Cloudflare account, use Wrangler's login flow locally:

```sh
npx wrangler login
```

Create the D1 database when ready; this command creates a remote resource:

```sh
npx wrangler d1 create rephase
```

Keep the resulting database UUID for configuration. The all-zero UUID in the checked-in `wrangler.jsonc` is exclusively for local development. The deployment scripts generate an ignored `wrangler.deploy.json` from that base, so the repository retains its portable local configuration.

The selected origin is `https://rephase.surtani.org`. Deployment configuration derives its Custom Domain route from `PUBLIC_APP_ORIGIN`; Cloudflare manages DNS and the certificate. The domain must belong to an active Cloudflare zone in the selected account. A `*.workers.dev` origin remains supported for a separate deployment target; it enables workers.dev instead of a Custom Domain. Custom-domain deployments disable workers.dev and preview URLs. Use a standard-port HTTPS origin without a URL path or trailing slash.

Create a production Google OAuth **Web application** client, or add the production origin to the existing client's authorized JavaScript origins. Configure the Google consent screen audience for your intended users. Basic GIS sign-in using only OpenID/profile/email is exempt from the Testing test-user allowlist; Testing alone does not make the app private. A private beta needs an application allowlist or Cloudflare Access. The Google client ID is public configuration, while the Cloudflare API token and RapidAPI key are secrets.

## GitHub Actions deployment

Create a GitHub Actions environment named **production**. Optional required reviewers can make a deployment wait for approval; this project does not impose that setting. Configure the following repository or production-environment **variables**:

| Variable | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account's 32-character ID |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID returned by D1 creation |
| `PUBLIC_APP_ORIGIN` | Exact final HTTPS origin |
| `GOOGLE_CLIENT_ID` | Google OAuth Web application client ID |
| `FLIGHT_DAILY_LIMIT` | Optional per-account daily lookup limit; default 10, range 1–1000 |
| `FLIGHT_MONTHLY_LIMIT` | Optional per-account monthly lookup limit; default 40, range 1–10000 |
| `FLIGHT_GLOBAL_MONTHLY_LIMIT` | Optional total monthly outbound-provider budget; default 150, range 1–1000000 |

Add these production-environment **secrets**:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Authenticate Wrangler's deployment and remote D1 migrations |
| `RAPIDAPI_KEY` | Optional AeroDataBox/RapidAPI key; omit to leave live lookup unavailable |

Create a Cloudflare API token scoped to the selected account and the `surtani.org` zone. Current [Workers authorization guidance](https://developers.cloudflare.com/workers/authorization/workers/) uses product-level **Workers Admin** to create the first Worker, with **Editor** sufficient for subsequent updates; legacy **Workers Scripts Edit** tokens remain supported. Add **D1 Edit/Write** for migrations and **Zone → Workers Routes → Write/Edit** scoped only to `surtani.org` for the Custom Domain. Per-Worker roles currently do not support Custom Domains. No separate DNS Edit or SSL permission is needed: Cloudflare creates the DNS record and certificate. Account discovery permission is unnecessary because the scripts supply the explicit account ID. Dashboard labels can vary; see the [permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Custom Domain guidance](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

The workflow initially runs deployment only when you choose **Actions → Deploy to Cloudflare → Run workflow**, on the `main` branch. It validates all target settings, runs checks and browser scenarios, applies remote migrations, uploads the Worker/static bundle, optionally uploads the provider secret via Wrangler stdin, and checks the public configuration endpoint. Secrets are not written to configuration files, command-line arguments or logs.

After deciding to enable deployment on every push to `main`, set the **repository variable** `DEPLOY_ENABLED` to `true`. Leave it absent or set it to `false` for manual-only deployment. This switch must be a repository variable because the workflow evaluates it before loading an environment's variables. Restrict who can push to `main` or add branch protection as appropriate for your repository.

The hourly cache purge is enabled by the base Wrangler configuration. Set lookup budgets below your subscribed provider allowance, reserving capacity for uncached airport timezone requests and manual/provider usage outside this app. A cached flight result may still be outdated; users confirm retrieved times before applying them to a trip.

## Local deployment check and deployment

Create an ignored `.deployment.env` file containing only the public deployment settings:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your_32_character_account_id
CLOUDFLARE_D1_DATABASE_ID=your_database_uuid
PUBLIC_APP_ORIGIN=https://rephase.surtani.org
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Node's built-in env-file support makes these commands work across platforms:

```sh
node --env-file=.deployment.env scripts/check-deploy-config.mjs
node --env-file=.deployment.env scripts/configure-cloudflare.mjs
node --env-file=.deployment.env scripts/deploy.mjs --dry-run
```

The first command validates without writing anything. The second writes only ignored local configuration. The dry run builds and bundles locally; it does not apply remote migrations, upload secrets or deploy code. Install dependencies with `npm ci` first if necessary. Wrangler may read local settings while bundling; deployment configuration contains only explicitly allowed public variables.

For an actual deployment after account setup and login:

```sh
node --env-file=.deployment.env scripts/deploy.mjs --apply
```

This command applies remote D1 migrations **before** deploying. A failed code upload does not roll those migrations back; migrations should remain compatible with the prior Worker version. Wrangler may ask for confirmation when applying migrations in a local interactive terminal; CI applies them without that prompt. The API check confirms public configuration and, when a provider key was uploaded, that flight lookup is enabled. It does not test complete Google authentication or live provider coverage. Finish by signing in with a real Google account, checking the avatar/Sign out menu, saving and reloading preferences and a trip without a sync action, opening the same account on another device, testing a representative future flight when its key is configured, and loading a saved plan offline on desktop and mobile.

To add a provider key without recording it in a shell argument or file, use Wrangler's interactive secret prompt after configuration:

```sh
npx wrangler secret put RAPIDAPI_KEY --config wrangler.deploy.json
```

Existing Cloudflare secrets are preserved when a deployment omits `RAPIDAPI_KEY`; omitting the local variable does not delete an already configured secret. Remove it explicitly through Wrangler or Cloudflare if you want to disable live lookup. Never commit `.dev.vars`, `.deployment.env`, API tokens, provider credentials or account data.

## Authoritative setup references

- [Cloudflare Workers with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler D1 creation and migration commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Worker secret management](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare API token permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Cloudflare Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)
- [Cloudflare skip rules](https://developers.cloudflare.com/waf/custom-rules/skip/) and [supported skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)
- [Bot Fight Mode limitations](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/#rules) and [Super Bot Fight Mode exceptions](https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/#configure-exceptions-to-super-bot-fight-mode)
