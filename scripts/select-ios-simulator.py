"""Select an installed iPhone runtime matching the selected Xcode simulator SDK."""

import json
import re
import sys


def select_simulator(devices, sdk):
    version = re.fullmatch(r"(\d+)\.(\d+)(?:\.\d+)?", sdk.strip())
    if not version:
        raise ValueError("Xcode returned an invalid iOS simulator SDK version.")
    expected = tuple(map(int, version.groups()))
    candidates = []
    for runtime, group in devices.get("devices", {}).items():
        match = re.search(r"\.iOS-(\d+)-(\d+)(?:-\d+)?$", runtime)
        if match and tuple(map(int, match.groups())) == expected:
            candidates.extend(device for device in group
                              if device.get("isAvailable") and device.get("name", "").startswith("iPhone"))
    if not candidates:
        raise ValueError(f"Install an iOS {expected[0]}.{expected[1]} iPhone simulator for the selected Xcode SDK; older runtimes are not a fallback.")
    return next((device for device in candidates if device.get("state") == "Booted"), candidates[0])["udid"]


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Usage: select-ios-simulator.py <SDK version> < simctl-devices.json")
        print(select_simulator(json.load(sys.stdin), sys.argv[1]))
    except (ValueError, KeyError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
