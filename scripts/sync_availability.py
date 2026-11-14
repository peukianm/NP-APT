#!/usr/bin/env python3
"""Export privacy-safe blocked dates from a Booking.com iCal feed.

Only ISO dates and a sync timestamp enter the public JSON; reservation
summaries, guest names, descriptions, UIDs and the feed URL remain private.
"""
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Athens")
OUT = Path("availability.json")
HORIZON = 240
MAX_FEED_BYTES = 2_000_000

def unfold(ical):
    result = []
    for line in ical.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if (line.startswith(" ") or line.startswith("\t")) and result:
            result[-1] += line[1:]
        else:
            result.append(line)
    return result

def parse_date(value, field):
    raw = value.split(":", 1)[-1].strip()
    if len(raw) == 8 and raw.isdigit():
        return dt.datetime.strptime(raw, "%Y%m%d").date()
    if raw.endswith("Z"):
        instant = dt.datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        return instant.astimezone(TZ).date()
    if "T" in raw:
        instant = dt.datetime.strptime(raw, "%Y%m%dT%H%M%S")
        tzid = next((p.split("=", 1)[1] for p in field.split(";") if p.startswith("TZID=")), "Europe/Athens")
        try:
            local_tz = ZoneInfo(tzid)
        except (KeyError, ValueError):
            raise ValueError("Unknown event timezone")
        return instant.replace(tzinfo=local_tz).astimezone(TZ).date()
    raise ValueError("Unsupported date format in feed")

def blocks_from_feed(text):
    dates = set()
    in_event = False
    props = {}
    saw_events = 0
    today = dt.datetime.now(TZ).date()
    max_date = today + dt.timedelta(days=HORIZON)
    for line in unfold(text):
        if line == "BEGIN:VEVENT":
            if in_event:
                raise ValueError("Nested VEVENT")
            in_event, props = True, {}
        elif line == "END:VEVENT":
            if not in_event:
                raise ValueError("Unmatched VEVENT")
            in_event = False
            saw_events += 1
            if props.get("STATUS", "").upper() == "CANCELLED" or props.get("TRANSP", "").upper() == "TRANSPARENT":
                continue
            if "RRULE" in props or "RDATE" in props:
                raise ValueError("Recurring events require explicit handling")
            if "DTSTART" not in props or "DTEND" not in props:
                raise ValueError("VEVENT is missing DTSTART or DTEND")
            start = parse_date(props["DTSTART"][1], props["DTSTART"][0])
            end = parse_date(props["DTEND"][1], props["DTEND"][0])
            if end <= start:
                raise ValueError("Invalid blocked interval")
            cursor = max(start, today)
            while cursor < min(end, max_date):
                dates.add(cursor.isoformat())
                cursor += dt.timedelta(days=1)
        elif in_event and ":" in line:
            field, value = line.split(":", 1)
            key = field.split(";", 1)[0].upper()
            if key in ("DTSTART", "DTEND"):
                props[key] = (field, value)
            elif key in ("STATUS", "TRANSP", "RRULE", "RDATE"):
                props[key] = value
    if in_event:
        raise ValueError("Truncated VEVENT")
    return sorted(dates), saw_events

def main():
    url = os.environ.get("BOOKING_ICAL_URL", "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "ical.booking.com" or parsed.username or parsed.password:
        raise ValueError("BOOKING_ICAL_URL secret must be a valid https://ical.booking.com link")
    req = urllib.request.Request(url, headers={"User-Agent": "TogetherHomeAvailabilitySync/1.0", "Accept": "text/calendar"})
    with urllib.request.urlopen(req, timeout=25) as response:
        if urllib.parse.urlparse(response.geturl()).hostname != "ical.booking.com":
            raise ValueError("Unexpected calendar redirect")
        data = response.read(MAX_FEED_BYTES + 1)
    if len(data) > MAX_FEED_BYTES:
        raise ValueError("Calendar feed too large")
    feed = data.decode("utf-8-sig", errors="strict")
    if "BEGIN:VCALENDAR" not in feed or "END:VCALENDAR" not in feed:
        raise ValueError("Invalid iCalendar feed")
    blocked, count = blocks_from_feed(feed)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    result = {
        "schemaVersion": 1,
        "source": "Booking.com iCal",
        "lastUpdated": now.isoformat().replace("+00:00", "Z"),
        "horizonDays": HORIZON,
        "blockedDates": blocked,
        "notice": "Indicative only; confirm availability with the booking provider."
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated availability.json: {len(blocked)} blocked days across {count} events; no private event details published")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not print raw exception string: could contain the secret URL.
        print("Calendar sync failed. Inspect configuration or iCal feed.", file=sys.stderr)
        sys.exit(1)
