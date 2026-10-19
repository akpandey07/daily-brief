#!/usr/bin/env python3
"""Copy the previous editions from the live site so the archive survives without committing data to git."""
import json, os, sys, urllib.request

base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
arch = os.path.join(root, "data", "archive")
os.makedirs(arch, exist_ok=True)
if not base:
    sys.exit(0)
try:
    names = json.load(urllib.request.urlopen(f"{base}/data/archive.json", timeout=20))
except Exception as ex:  # first run, or site not up yet
    print(f"no archive to restore: {ex}")
    sys.exit(0)
for n in names:
    try:
        body = urllib.request.urlopen(f"{base}/data/archive/{n}.json", timeout=20).read()
        open(os.path.join(arch, f"{n}.json"), "wb").write(body)
    except Exception as ex:
        print(f"skip {n}: {ex}")
print(f"restored {len(names)} editions")
