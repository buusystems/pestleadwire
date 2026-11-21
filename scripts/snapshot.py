#!/usr/bin/env python3
"""Build data/snapshot.json for the landing page from the PestLeadWire app's own feeds.

    python3 scripts/snapshot.py [--app ~/code/pestleadwire-app] [--days 14]

Pulls every public inspection feed (free, no Google), keeps the last N days, and writes
per-market counts and, for every ZIP within reach of a feed, how many businesses were cited
within RADIUS miles plus the three nearest as examples. Phones, record ids and
portal links are left out: the page is a teaser, the list is the product.
"""
import argparse
import datetime
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument("--app", default=os.path.expanduser("~/code/pestleadwire-app"))
ap.add_argument("--days", type=int, default=14)
ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "snapshot.json"))
args = ap.parse_args()
sys.path.insert(0, os.path.join(args.app, "app"))
import geo, sources  # noqa: E402

def short(s, n=150):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


today = datetime.date.today()


def pull(src):
    try:
        leads = src.fetch(args.days + src.publish_lag_days, today)
        print(f"{src.id:28} {len(leads):5}", file=sys.stderr)
        return leads
    except Exception as e:
        print(f"{src.id:28} FAILED {e}", file=sys.stderr)
        return []


with ThreadPoolExecutor(8) as ex:
    leads = [l for batch in ex.map(pull, sources.all_sources()) for l in batch]

# One row per business (two feeds can overlap).
seen, uniq = set(), []
for l in sorted(leads, key=lambda l: l.get("inspection_date") or "", reverse=True):
    if l["key"] not in seen:
        seen.add(l["key"])
        uniq.append(l)

RADIUS = 10  # miles: what "near your ZIP" means on the page
markets = {}
for mid, m in sources.MARKETS.items():
    markets[mid] = {"label": m.label, "state": m.state, "count": 0}
for l in uniq:
    if l.get("market") in markets:
        markets[l["market"]]["count"] += 1

# Grid of placed leads, newest first within each cell.
CELL = 0.25
grid = {}
for i, l in enumerate(uniq):
    if l.get("lat") is None or l.get("lon") is None:  # some feeds carry no coordinates: use the ZIP's centre
        zp = geo.zip_point(l.get("zip"))
        l["lat"], l["lon"] = zp if zp else (None, None)
    if l.get("lat") is not None and l.get("lon") is not None:
        grid.setdefault((int(l["lat"] // CELL), int(l["lon"] // CELL)), []).append(i)


def within(pt):
    ci, cj = int(pt[0] // CELL), int(pt[1] // CELL)
    out = []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for i in grid.get((ci + di, cj + dj), ()):
                d = geo.miles(pt, (uniq[i]["lat"], uniq[i]["lon"]))
                if d is not None and d <= RADIUS:
                    out.append((d, i))
    return sorted(out)  # (miles, index), nearest first


geo.zip_point("00000")
examples, ex_index, zips = [], {}, {}
for z, pt in geo._ZIPS.items():
    pt = tuple(pt)
    m = sources.nearest_market(pt)
    if not m:
        continue
    near = within(pt)
    ex = []
    for d, i in near[:3]:
        if i not in ex_index:
            l = uniq[i]
            ex_index[i] = len(examples)
            examples.append({"name": short(l["name"], 60), "city": (l.get("city") or "").title(), "date": l["inspection_date"][:10], "type": short(l.get("facility_type") or "", 40),
                             "found": short((l.get("findings") or [""])[0])})
        ex.append([ex_index[i], round(d, 1)])
    zips[z] = [m.id, len(near), ex]

out = {
    "asof": today.isoformat(),
    "days": args.days,
    "total": len(uniq),
    "markets": markets,
    "radius": RADIUS,
    "zips": zips,
    "examples": examples,
    "states": sorted({m["state"] for m in markets.values()}),
}
os.makedirs(os.path.dirname(args.out), exist_ok=True)
with open(args.out, "w") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"{len(uniq)} businesses, {len(zips)} covered ZIPs, {len(examples)} examples -> {args.out}",
      file=sys.stderr)
