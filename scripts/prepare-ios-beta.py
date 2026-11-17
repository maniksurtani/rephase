"""Prepare CI app configuration and App Store export options (stdlib only).

Uses Zerocal's unsigned-archive / signed-export approach. Apple credentials
never enter the checkout or the app's public Dart configuration.
"""

import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

BUNDLE_ID = "app.rephase.Rephase"
ROOT = Path(__file__).resolve().parent.parent
PROFILE_DIRS = (
    "Library/MobileDevice/Provisioning Profiles",
    "Library/Developer/Xcode/UserData/Provisioning Profiles",
)


def configuration(env):
    def required(name, pattern=None):
        value = env.get(name, "")
        if not value.strip() or (pattern and not re.fullmatch(pattern, value)):
            raise ValueError(f"Set a valid {name} in the ios-beta GitHub environment.")
        return value

    mode = required("IOS_MODE", r"validate|build|upload")
    version = required("IOS_VERSION", r"[0-9]+\.[0-9]+\.[0-9]+")
    # Match Android/Zerocal. A rerun keeps its number; publish new builds in new runs.
    run = required("GITHUB_RUN_NUMBER", r"[1-9][0-9]{0,3}")
    signing = {}
    if mode != "validate":
        required("IOS_DISTRIBUTION_P12_PASSWORD")
        for field, filename in (("IOS_DISTRIBUTION_P12_BASE64", "distribution.p12"),
                                ("IOS_PROVISIONING_PROFILE_BASE64", "profile.mobileprovision")):
            try:
                data = base64.b64decode("".join(required(field).split()), validate=True)
            except (ValueError, base64.binascii.Error) as error:
                raise ValueError(f"{field} must contain a base64-encoded file.") from error
            if not 1000 <= len(data) <= 512_000:
                raise ValueError(f"{field} is not a valid-sized signing file.")
            signing[filename] = data
    if mode == "upload":
        required("APP_STORE_CONNECT_KEY_ID", r"[A-Z0-9]{10}")
        required("APP_STORE_CONNECT_ISSUER_ID", r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
        key = required("APP_STORE_CONNECT_PRIVATE_KEY")
        if not key.strip().startswith("-----BEGIN PRIVATE KEY-----"):
            raise ValueError("APP_STORE_CONNECT_PRIVATE_KEY must contain the downloaded .p8 text.")
    public = {}
    for name in ("GOOGLE_SERVER_CLIENT_ID", "GOOGLE_IOS_CLIENT_ID"):
        if mode != "validate" or env.get(name):
            public[name] = required(name, r"[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com")
    origin = env.get("API_ORIGIN") or "https://rephase.surtani.org"
    url = urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or "\n" in origin or "\r" in origin):
        raise ValueError("API_ORIGIN must be an exact HTTPS origin without a trailing slash.")
    public["API_ORIGIN"] = origin
    return signing, public, version, run


def validate_profile(profile, now=None):
    """Reject development/ad-hoc/wildcard profiles before compiling."""
    teams = profile.get("TeamIdentifier", [])
    if len(teams) != 1 or not re.fullmatch(r"[A-Z0-9]{10}", teams[0]):
        raise ValueError("The profile must contain exactly one Apple Team ID.")
    team = teams[0]
    entitlements = profile.get("Entitlements", {})
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    valid_ids = [f"{prefix}.{BUNDLE_ID}" for prefix in prefixes]
    if (entitlements.get("com.apple.developer.team-identifier") != team
            or entitlements.get("application-identifier") not in valid_ids):
        raise ValueError(f"The profile must belong to its Apple team and exactly {BUNDLE_ID}.")
    if (entitlements.get("get-task-allow") is not False
            or "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices")
            or not profile.get("DeveloperCertificates")):
        raise ValueError("Use an App Store Connect distribution profile, not development/ad-hoc/enterprise.")
    expiry = profile.get("ExpirationDate")
    now = now or dt.datetime.now(dt.timezone.utc)
    if not isinstance(expiry, dt.datetime) or expiry.replace(tzinfo=dt.timezone.utc) <= now:
        raise ValueError("The provisioning profile has expired or has no expiry.")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", uuid):
        raise ValueError("The provisioning profile has no valid UUID.")
    return team, uuid


def export_options(profile, identity_output, now=None):
    team, uuid = validate_profile(profile, now)
    # Match public certificate fingerprints, never display names (as in Zerocal).
    certificates = {hashlib.sha1(cert).hexdigest().upper() for cert in profile["DeveloperCertificates"]}
    identities = {match.upper() for match in re.findall(
        r'^\s*\d+\) ([0-9A-Fa-f]{40})\s+"', identity_output, re.MULTILINE
    )}
    if not identities:
        raise ValueError("No valid signing identity: check the p12 private key, certificate expiry and Apple trust chain.")
    matching = identities & certificates
    if len(matching) != 1:
        raise ValueError("The profile must match exactly one imported distribution identity. "
                         "Regenerate the Rephase profile using the certificate exported in the p12.")
    return {
        "method": "app-store-connect", "destination": "export", "teamID": team,
        "signingStyle": "manual", "signingCertificate": matching.pop(),
        "provisioningProfiles": {BUNDLE_ID: uuid}, "manageAppVersionAndBuildNumber": False,
        "stripSwiftSymbols": True, "uploadSymbols": True,
    }


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Refuse to overwrite a developer's local configuration.
    with path.open("xb") as file:
        os.chmod(path, 0o600)
        file.write(data)


def prepare(env, root=ROOT):
    if sys.platform != "darwin" or not env.get("RUNNER_TEMP") or not env.get("GITHUB_ENV"):
        raise ValueError("Run preparation on the macOS GitHub Actions runner.")
    signing, public, version, build = configuration(env)
    private_dir = Path(env["RUNNER_TEMP"]) / "rephase-ios-beta"
    private_dir.mkdir(mode=0o700)
    for filename, data in signing.items():
        private_write(private_dir / filename, data)
    private_write(root / "mobile/config.json", json.dumps(public).encode())
    if public.get("GOOGLE_IOS_CLIENT_ID"):
        reverse = ".".join(reversed(public["GOOGLE_IOS_CLIENT_ID"].split(".")))
        private_write(root / "mobile/ios/Flutter/Google.xcconfig",
                      f"REPHASE_GOOGLE_REVERSED_CLIENT_ID = {reverse}\n".encode())
    with open(env["GITHUB_ENV"], "a") as file:
        file.write(f"BETA_BUILD_NUMBER={build}\n")
    print(f"Prepared {BUNDLE_ID} {version} ({build}), mode {env['IOS_MODE']}.")


def prepare_export(env):
    private_dir = Path(env["RUNNER_TEMP"]) / "rephase-ios-beta"
    profile_bytes = (private_dir / "profile.mobileprovision").read_bytes()
    decoded = subprocess.check_output(["security", "cms", "-D", "-i",
                                       str(private_dir / "profile.mobileprovision")])
    identities = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning",
                                          str(private_dir / "signing.keychain-db")], text=True)
    options = export_options(plistlib.loads(decoded), identities)
    for directory in PROFILE_DIRS:
        private_write(Path.home() / directory / "rephase-ios-beta.mobileprovision", profile_bytes)
    private_write(private_dir / "ExportOptions.plist", plistlib.dumps(options))
    print("Validated Rephase App Store profile and matching distribution certificate.")


def cleanup(env, root=ROOT):
    if not env.get("RUNNER_TEMP"):
        raise ValueError("Cleanup requires RUNNER_TEMP.")
    private_dir = Path(env["RUNNER_TEMP"]) / "rephase-ios-beta"
    # Nothing to remove if this workflow never got as far as preparation.
    if not private_dir.exists():
        return
    try:
        saved = private_dir / "keychain-search-list.json"
        if saved.exists():
            subprocess.run(["security", "list-keychains", "-d", "user", "-s",
                            *json.loads(saved.read_text())], check=True)
    finally:
        keychain = private_dir / "signing.keychain-db"
        if keychain.exists():
            subprocess.run(["security", "delete-keychain", str(keychain)], check=False)
        for relative in ("mobile/config.json", "mobile/ios/Flutter/Google.xcconfig"):
            (root / relative).unlink(missing_ok=True)
        for directory in PROFILE_DIRS:
            (Path.home() / directory / "rephase-ios-beta.mobileprovision").unlink(missing_ok=True)
        shutil.rmtree(private_dir)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--cleanup"]:
            cleanup(os.environ)
        elif sys.argv[1:] == ["--export-options"]:
            prepare_export(os.environ)
        elif not sys.argv[1:]:
            prepare(os.environ)
        else:
            raise ValueError("Usage: prepare-ios-beta.py [--export-options|--cleanup]")
    except (ValueError, OSError, subprocess.CalledProcessError, plistlib.InvalidFileException) as error:
        # Do not print subprocess output: signing tools may include private material.
        print(f"iOS beta preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
