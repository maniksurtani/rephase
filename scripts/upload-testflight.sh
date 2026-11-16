#!/usr/bin/env bash
# Same Apple CLI upload path as maniksurtani/zerocal.
set -euo pipefail
: "${APP_STORE_CONNECT_KEY_ID:?Missing App Store Connect team API key ID}"
: "${APP_STORE_CONNECT_ISSUER_ID:?Missing App Store Connect issuer ID}"
: "${APP_STORE_CONNECT_PRIVATE_KEY:?Missing App Store Connect p8 private key}"
: "${IPA_PATH:?Missing verified IPA path}"
: "${RUNNER_TEMP:?Run on the GitHub Actions macOS runner}"
umask 077
export API_PRIVATE_KEYS_DIR="$RUNNER_TEMP/rephase-ios-beta/api-keys"
python3 - <<'PY'
import os, pathlib, re
key_id = os.environ['APP_STORE_CONNECT_KEY_ID']
if not re.fullmatch(r'[A-Z0-9]{10}', key_id):
    raise SystemExit('Invalid API key ID')
directory = pathlib.Path(os.environ['API_PRIVATE_KEYS_DIR'])
directory.mkdir(mode=0o700)
(directory / f'AuthKey_{key_id}.p8').write_text(os.environ['APP_STORE_CONNECT_PRIVATE_KEY'])
PY
xcrun altool --validate-app --type ios --file "$IPA_PATH" \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
xcrun altool --upload-app --type ios --file "$IPA_PATH" \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
printf '%s\n' 'Upload accepted by App Store Connect. Processing and tester assignment happen in TestFlight.' >> "$GITHUB_STEP_SUMMARY"
