"""Prepare a manually signed TestFlight build using only the Python standard library."""

import base64
import datetime as dt
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

    team = required("APPLE_TEAM_ID", r"[A-Z0-9]{10}")
    required("APPSTORE_API_KEY_ID", r"[A-Z0-9]{10}")
    required("APPSTORE_ISSUER_ID", r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
    key = required("APPSTORE_API_PRIVATE_KEY")
    if not key.strip().startswith("-----BEGIN PRIVATE KEY-----"):
        raise ValueError("APPSTORE_API_PRIVATE_KEY must contain the downloaded .p8 text.")
    required("IOS_DISTRIBUTION_CERTIFICATE_PASSWORD")
    for field in ("IOS_DISTRIBUTION_CERTIFICATE_BASE64", "IOS_PROVISIONING_PROFILE_BASE64"):
        try:
            data = base64.b64decode("".join(required(field).split()), validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise ValueError(f"{field} must contain a base64-encoded file.") from error
        if not 1000 <= len(data) <= 512_000:
            raise ValueError(f"{field} is not a valid-sized signing file.")
    profile = data
    public = {}
    for name in ("GOOGLE_SERVER_CLIENT_ID", "GOOGLE_IOS_CLIENT_ID"):
        public[name] = required(name, r"[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com")
    origin = env.get("API_ORIGIN") or "https://rephase.surtani.org"
    url = urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or "\n" in origin or "\r" in origin):
        raise ValueError("API_ORIGIN must be an exact HTTPS origin without a trailing slash.")
    public["API_ORIGIN"] = origin
    run = int(required("GITHUB_RUN_NUMBER", r"[1-9][0-9]{0,3}"))
    attempt = int(required("GITHUB_RUN_ATTEMPT", r"[1-9][0-9]?"))
    return team, profile, public, f"{run}.{attempt}"


def validate_profile(profile, team, now=None):
    """Reject development/ad-hoc/wildcard profiles before compiling on a paid runner."""
    entitlements = profile.get("Entitlements", {})
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    valid_ids = [f"{prefix}.{BUNDLE_ID}" for prefix in prefixes]
    if (profile.get("TeamIdentifier") != [team]
            or entitlements.get("com.apple.developer.team-identifier") != team
            or entitlements.get("application-identifier") not in valid_ids):
        raise ValueError(f"The profile must belong to APPLE_TEAM_ID and exactly {BUNDLE_ID}.")
    if (entitlements.get("get-task-allow") is not False
            or "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices")
            or not profile.get("DeveloperCertificates")):
        raise ValueError("Use an App Store Connect distribution profile, not development/ad-hoc/enterprise.")
    expiry = profile.get("ExpirationDate")
    now = now or dt.datetime.now(dt.timezone.utc)
    if not isinstance(expiry, dt.datetime) or expiry.replace(tzinfo=dt.timezone.utc) <= now:
        raise ValueError("The provisioning profile has expired or has no expiry.")
    uuid = profile.get("UUID", "")
    if not re.fullmatch(r"[a-fA-F0-9-]{36}", uuid):
        raise ValueError("The provisioning profile has no valid UUID.")
    return uuid


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Refuse to overwrite a developer's local configuration.
    with path.open("xb") as file:
        os.chmod(path, 0o600)
        file.write(data)


def prepare(env, root=ROOT):
    if sys.platform != "darwin" or not env.get("RUNNER_TEMP") or not env.get("GITHUB_ENV"):
        raise ValueError("Run signing preparation on the macOS GitHub Actions runner.")
    team, profile_bytes, public, build = configuration(env)
    private_dir = Path(env["RUNNER_TEMP"]) / "rephase-ios-beta"
    private_dir.mkdir(mode=0o700)
    source = private_dir / "profile.mobileprovision"
    private_write(source, profile_bytes)
    decoded = subprocess.run(
        ["security", "cms", "-D", "-i", str(source)], capture_output=True, check=True
    ).stdout
    uuid = validate_profile(plistlib.loads(decoded), team)
    for directory in PROFILE_DIRS:
        private_write(Path.home() / directory / "rephase-ios-beta.mobileprovision", profile_bytes)
    private_write(root / "mobile/config.json", json.dumps(public).encode())
    reverse = ".".join(reversed(public["GOOGLE_IOS_CLIENT_ID"].split(".")))
    private_write(root / "mobile/ios/Flutter/Google.xcconfig",
                  f"REPHASE_GOOGLE_REVERSED_CLIENT_ID = {reverse}\n".encode())
    private_write(root / "mobile/ios/Flutter/BetaSigning.xcconfig", (
        f"DEVELOPMENT_TEAM = {team}\nCODE_SIGN_STYLE = Manual\n"
        f"CODE_SIGN_IDENTITY = Apple Distribution\nPROVISIONING_PROFILE_SPECIFIER = {uuid}\n"
    ).encode())
    private_write(private_dir / "ExportOptions.plist", plistlib.dumps({
        "method": "app-store-connect", "teamID": team, "signingStyle": "manual",
        "signingCertificate": "Apple Distribution", "provisioningProfiles": {BUNDLE_ID: uuid},
        "manageAppVersionAndBuildNumber": False, "uploadSymbols": True,
    }))
    with open(env["GITHUB_ENV"], "a") as file:
        file.write(f"BETA_BUILD_NUMBER={build}\n")
    print(f"Prepared {BUNDLE_ID} TestFlight build {build}.")


def cleanup(env, root=ROOT):
    if not env.get("RUNNER_TEMP"):
        raise ValueError("Cleanup requires RUNNER_TEMP.")
    for relative in ("mobile/config.json", "mobile/ios/Flutter/Google.xcconfig",
                     "mobile/ios/Flutter/BetaSigning.xcconfig"):
        (root / relative).unlink(missing_ok=True)
    for directory in PROFILE_DIRS:
        (Path.home() / directory / "rephase-ios-beta.mobileprovision").unlink(missing_ok=True)
    shutil.rmtree(Path(env["RUNNER_TEMP"]) / "rephase-ios-beta", ignore_errors=True)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--cleanup"]:
            cleanup(os.environ)
        elif not sys.argv[1:]:
            prepare(os.environ)
        else:
            raise ValueError("Usage: prepare-ios-beta.py [--cleanup]")
    except (ValueError, OSError, subprocess.CalledProcessError, plistlib.InvalidFileException) as error:
        # Do not print subprocess output: signing tools may include private material.
        print(f"iOS beta preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
