#!/usr/bin/env python3
"""Find or create one booted-ready simulator per wanted iPhone model (CI helper, macOS only).

    python3 Tools/ci_sims.py "iPhone 13" "iPhone 13 mini" ...

For every name: the device type must exist in the selected Xcode; the newest iOS runtime that supports it is used;
an existing available device of that name and runtime is reused, else one is created. Prints one line per model:
    OK|<udid>|<name>|<runtime name>
    MISSING|<name>|<reason>
"""
import json
import subprocess
import sys


def simctl(*args):
    return subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True)


def main(names):
    data = json.loads(simctl("list", "-j", "devicetypes", "runtimes", "devices").stdout)
    types = {t["name"]: t["identifier"] for t in data["devicetypes"]}
    runtimes = [r for r in data["runtimes"] if r.get("isAvailable") and r.get("platform", "iOS") == "iOS"]
    runtimes.sort(key=lambda r: [int(x) for x in r["version"].split(".")], reverse=True)
    for name in names:
        tid = types.get(name)
        if not tid:
            print(f"MISSING|{name}|no such device type in this Xcode")
            continue
        runtime = None
        for r in runtimes:
            supported = r.get("supportedDeviceTypes")
            if supported is None or any(s.get("identifier") == tid for s in supported):
                runtime = r
                break
        if not runtime:
            print(f"MISSING|{name}|no installed iOS runtime supports it")
            continue
        udid = None
        for d in data["devices"].get(runtime["identifier"], []):
            if d["name"] == name and d.get("isAvailable", True):
                udid = d["udid"]
                break
        if not udid:
            res = simctl("create", name, tid, runtime["identifier"])
            if res.returncode != 0:
                print(f"MISSING|{name}|simctl create failed: {res.stderr.strip()}")
                continue
            udid = res.stdout.strip()
        print(f"OK|{udid}|{name}|{runtime['name']}")


if __name__ == "__main__":
    main(sys.argv[1:])
