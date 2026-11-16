"""Verify the archive and exported app before TestFlight upload."""

import hashlib
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

BUNDLE_ID = "app.rephase.Rephase"


def verify_info(info, expected_build, expected_version):
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise ValueError("The app has an unexpected bundle identifier.")
    if info.get("CFBundleVersion") != expected_build:
        raise ValueError("The app does not contain this workflow's build number.")
    if info.get("CFBundleShortVersionString") != expected_version:
        raise ValueError("The app does not contain the requested marketing version.")
    icons = info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {})
    if icons.get("CFBundleIconName") != "AppIcon":
        raise ValueError("The app is missing its primary AppIcon declaration.")


def verify_archive(path, expected_build, expected_version):
    apps = list((path / "Products/Applications").glob("*.app"))
    if len(apps) != 1:
        raise ValueError("Expected exactly one archived app.")
    verify_info(plistlib.loads((apps[0] / "Info.plist").read_bytes()), expected_build, expected_version)
    if not (apps[0] / "Assets.car").is_file():
        raise ValueError("The archive is missing its compiled app icons.")


def verify_ipa(path, expected_build, expected_version):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist()
                 if name.startswith("Payload/") and name.endswith(".app/Info.plist")
                 and name.count("/") == 2]
        if len(names) != 1:
            raise ValueError("Expected exactly one exported app.")
        verify_info(plistlib.loads(archive.read(names[0])), expected_build, expected_version)
        app_dir = names[0].removesuffix("Info.plist")
        for required in ("embedded.mobileprovision", "Assets.car"):
            if app_dir + required not in archive.namelist():
                raise ValueError(f"The IPA is missing {required}.")
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_exported_signature(path):
    # ditto preserves the executable permissions/symlinks of Apple's IPA format.
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["ditto", "-x", "-k", str(path), directory], check=True)
        apps = list((Path(directory) / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise ValueError("Expected exactly one exported app to verify.")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(apps[0])], check=True)


if __name__ == "__main__":
    build, version = os.environ["BETA_BUILD_NUMBER"], os.environ["IOS_VERSION"]
    if sys.argv[1:] == ["--archive"]:
        verify_archive(Path("mobile/build/ios/archive/Runner.xcarchive"), build, version)
        print(f"Verified unsigned archive: {BUNDLE_ID} {version} ({build}).")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"Verified archive: {BUNDLE_ID} **{version} ({build})**\n\n"
                          f"Commit: {os.environ['GITHUB_SHA']}\n\n")
    elif not sys.argv[1:]:
        paths = list(Path("mobile/build/ios/ipa").glob("*.ipa"))
        if len(paths) != 1:
            raise SystemExit("Expected exactly one signed IPA from xcodebuild -exportArchive.")
        path = paths[0].resolve()
        digest = verify_ipa(path, build, version)
        verify_exported_signature(path)
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"path={path}\n")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"Verified exported IPA signature. SHA-256: `{digest}`\n\n")
    else:
        raise SystemExit("Usage: verify-ios-beta.py [--archive]")
