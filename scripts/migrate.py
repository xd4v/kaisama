#!/usr/bin/env python3
"""
Melt the wide "Kai - history.csv" export into flat BabyLog `log` rows.

Each source row can encode several events sharing one timestamp
(Date + Start time, Europe/Paris):

  Temp            -> temp event   (value = °C,  unit = C)
  Pipi = yes      -> pee event
  Caca = yes      -> poop event
  Sein / Milk min -> feed event   (subtype = left-boob/right-boob,
                                    value = minutes, unit = min)
  Soins           -> soin event   (subtype = the cell text)

Output columns match the `log` tab exactly:
  id | timestamp | date | type | subtype | value | unit | note

The output has NO header row, so you can paste it straight below the
existing header in the sheet without a stray line. See the printed
instructions after running.

Usage:
  python3 scripts/migrate.py ["Kai - history.csv"] ["Kai - log-import.csv"]
"""
import csv
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Europe/Paris timezone → UTC. Try zoneinfo (handles DST); the data window here
# is all CEST (June–July), so fall back to a fixed +02:00 if tzdata is missing.
try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
    def to_utc_iso(date_str, hhmm):
        dt = datetime.strptime(f"{date_str} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=PARIS)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
except Exception:
    CEST = timezone(timedelta(hours=2))
    def to_utc_iso(date_str, hhmm):
        dt = datetime.strptime(f"{date_str} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=CEST)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

SIDE = {"left": "left-boob", "right": "right-boob"}


def minutes_between(start, end):
    a = datetime.strptime(start, "%H:%M")
    b = datetime.strptime(end, "%H:%M")
    diff = int((b - a).total_seconds() // 60)
    if diff < 0:              # crossed midnight
        diff += 24 * 60
    return diff


def melt_row(row):
    """Return a list of (type, subtype, value, unit) events for one source row."""
    g = lambda k: (row.get(k) or "").strip()
    events = []

    temp = g("Temp")
    if temp:
        events.append(("temp", "", temp, "C"))

    if g("Pipi").lower() == "yes":
        events.append(("pee", "", "", ""))
    if g("Caca").lower() == "yes":
        events.append(("poop", "", "", ""))

    sein = g("Sein").lower()
    milk = g("Milk minutes")
    end = g("End time")
    if sein or milk:
        subtype = SIDE.get(sein, "")
        value, unit = "", ""
        if milk:
            value, unit = milk, "min"
        elif end and g("Start time"):
            value, unit = str(minutes_between(g("Start time"), end)), "min"
        events.append(("feed", subtype, value, unit))

    soins = g("Soins")
    if soins:
        events.append(("soin", soins.lower(), "", ""))

    return events


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "Kai - history.csv"
    dst = sys.argv[2] if len(sys.argv) > 2 else "Kai - log-import.csv"

    out_rows = []
    skipped = []          # rows that produced no events (ambiguous)
    counts = {}

    with open(src, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):   # row 2 = first data row in the file
            date = (row.get("Date") or "").strip()
            start = (row.get("Start time") or "").strip()
            if not date or not start:
                skipped.append((i, "missing date/start"))
                continue
            events = melt_row(row)
            if not events:
                skipped.append((i, "no event data"))
                continue
            ts = to_utc_iso(date, start)
            for (etype, subtype, value, unit) in events:
                out_rows.append([str(uuid.uuid4()), ts, date, etype, subtype, value, unit, ""])
                counts[etype] = counts.get(etype, 0) + 1

    with open(dst, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(out_rows)

    print(f"Wrote {len(out_rows)} log rows to: {dst}")
    print("By type: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    if skipped:
        print(f"\nSkipped {len(skipped)} source row(s) (no clear event) — review these:")
        for line, why in skipped:
            print(f"  line {line}: {why}")
    print(
        "\nImport: open the sheet, click the first empty cell in column A "
        "(below your header/existing rows), then File isn't needed — just paste "
        f"the contents of '{dst}'. Columns are already in log order: "
        "id | timestamp | date | type | subtype | value | unit | note.\n"
        "Optional: after pasting, Data → Sort range by column C (date) to keep it tidy."
    )


if __name__ == "__main__":
    main()
