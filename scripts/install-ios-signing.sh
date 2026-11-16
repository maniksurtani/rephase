#!/usr/bin/env bash
# Adapted from maniksurtani/zerocal's tool/ios/install_signing.sh.
set -euo pipefail
: "${IOS_DISTRIBUTION_P12_PASSWORD:?Missing distribution p12 password}"
: "${RUNNER_TEMP:?Run on the GitHub Actions macOS runner}"
umask 077
signing_dir="$RUNNER_TEMP/rephase-ios-beta"
keychain="$signing_dir/signing.keychain-db"
keychain_password=$(openssl rand -hex 32)
echo "::add-mask::$keychain_password"
# Save the search list before creating a keychain, which can modify that list.
python3 - <<'PY'
import json, os, pathlib, shlex, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP']) / 'rephase-ios-beta'
existing = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
(root / 'keychain-search-list.json').write_text(json.dumps(existing))
PY
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing_dir/distribution.p12" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -k "$keychain" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null
# Retain existing keychains and Apple's intermediate certificate trust chain.
python3 - <<'PY'
import json, os, pathlib, subprocess
root = pathlib.Path(os.environ['RUNNER_TEMP']) / 'rephase-ios-beta'
existing = json.loads((root / 'keychain-search-list.json').read_text())
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', str(root / 'signing.keychain-db'), *existing], check=True)
PY
python3 scripts/prepare-ios-beta.py --export-options
