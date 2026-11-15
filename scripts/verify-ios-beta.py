"""Check the exported package, not only the Xcode project, before upload."""

import hashlib
import os
from pathlib import Path
import plistlib
import zipfile


def verify_ipa(path, expected_build):
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist()
                 if name.startswith("Payload/") and name.endswith(".app/Info.plist")
                 and name.count("/") == 2]
        if len(names) != 1:
            raise ValueError("Expected exactly one exported app.")
        info = plistlib.loads(archive.read(names[0]))
        if info.get("CFBundleIdentifier") != "app.rephase.Rephase":
            raise ValueError("The IPA has an unexpected bundle identifier.")
        if info.get("CFBundleVersion") != expected_build:
            raise ValueError("The IPA does not contain this workflow's build number.")
        app_dir = names[0].removesuffix("Info.plist")
        if app_dir + "embedded.mobileprovision" not in archive.namelist():
            raise ValueError("The IPA is missing its distribution profile.")
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


if __name__ == "__main__":
    paths = list(Path("mobile/build/ios/ipa").glob("*.ipa"))
    if len(paths) != 1:
        raise SystemExit("Expected exactly one signed IPA from flutter build ipa.")
    path = paths[0].resolve()
    digest = verify_ipa(path, os.environ["BETA_BUILD_NUMBER"])
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"path={path}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"app.rephase.Rephase · build {os.environ['BETA_BUILD_NUMBER']}\n\n"
                      f"Commit: {os.environ['GITHUB_SHA']}\n\nSHA-256: `{digest}`\n")
