#!/usr/bin/env python3
"""Build one edition of the Daily Brief.

Fetches every free RSS source in feeds.json, de-duplicates stories that several
outlets cover, ranks them (coverage x source weight x freshness), keeps the top
50 per section, adds today's personal picks from content/*.json, and writes
data/latest.json plus a dated copy under data/archive/.
"""
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import socket
import sys
import urllib.parse

import feedparser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
UA = "Mozilla/5.0 (compatible; DailyBrief/1.0)"
PER_SECTION = 50
ARCHIVE_KEEP = 14
socket.setdefaulttimeout(20)

# How old an item may be, in hours. Blogs and video channels publish less often.
MAX_AGE = {"cloud": 24 * 7, "learn": 24 * 14, "videos": 24 * 10, "devops": 24 * 5}
DEFAULT_MAX_AGE = 72
STOP = set("a an the of to in on for and or is are was were be with at by from as its it this that after over new says say vs "
           "price prices specs spec launch launches launched india indian today date sale check expected details features latest "
           "news live update updates know what how why will report reports first top best more amid out up".split())


def gnews_url(q, lang="en"):
    qs = urllib.parse.quote_plus(f"{q} when:1d")
    if lang == "hi":
        return f"https://news.google.com/rss/search?q={qs}&hl=hi&gl=IN&ceid=IN:hi"
    return f"https://news.google.com/rss/search?q={qs}&hl=en-IN&gl=IN&ceid=IN:en"


def clean(text, limit=220):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def image_of(e):
    for key in ("media_thumbnail", "media_content"):
        for m in e.get(key, []) or []:
            if m.get("url"):
                return m["url"]
    for l in e.get("links", []):
        if l.get("type", "").startswith("image/"):
            return l.get("href")
    m = re.search(r'<img[^>]+src="([^"]+)"', e.get("summary", "") or "")
    return html.unescape(m.group(1)) if m else None


def when(e):
    for key in ("published_parsed", "updated_parsed"):
        t = e.get(key)
        if t:
            return dt.datetime(*t[:6], tzinfo=dt.timezone.utc)
    return None


def fetch(src):
    try:
        d = feedparser.parse(src["url"], agent=UA)
    except Exception as ex:  # network errors must never stop the build
        return src, [], str(ex)
    feed_title = clean(d.feed.get("title", ""), 60)
    items = []
    for e in d.entries[:60]:
        title = clean(e.get("title", ""), 200)
        link = e.get("link")
        if not title or not link:
            continue
        source = src.get("source") or feed_title
        if "news.google.com" in src["url"]:
            # Google News titles end with " - Publisher"; the <source> element names it too
            publisher = (e.get("source") or {}).get("title") if isinstance(e.get("source"), dict) else None
            m = re.match(r"^(.*) - ([^-]{2,60})$", title)
            if m:
                title = m.group(1).strip()
            if publisher and publisher.startswith("http"):
                publisher = None
            source = publisher or (m.group(2).strip() if m else "Google News")
            summary = ""
        else:
            summary = clean(e.get("summary", ""))
        src_href = (e.get("source") or {}).get("href") if isinstance(e.get("source"), dict) else None
        item = {
            "domain": urllib.parse.urlparse(src_href or link).netloc.replace("www.", ""),
            "title": title,
            "link": link,
            "source": source,
            "published": (when(e) or dt.datetime.now(dt.timezone.utc)).isoformat(),
            "summary": summary if summary.lower() != title.lower() else "",
            "image": image_of(e),
            "lang": src.get("lang", "en"),
        }
        if "youtube.com/feeds" in src["url"]:
            item["video"] = e.get("yt_videoid")
            item["image"] = item["image"] or (f"https://i.ytimg.com/vi/{item['video']}/hqdefault.jpg" if item["video"] else None)
        if src.get("kind") == "trends":
            item["traffic"] = e.get("ht_approx_traffic")
            news = e.get("ht_news_item_url")
            item["link"] = news or f"https://www.google.com/search?q={urllib.parse.quote_plus(title)}"
            item["summary"] = clean(e.get("ht_news_item_title", ""))
            item["image"] = e.get("ht_picture") or item["image"]
        items.append(item)
    status = getattr(d, "status", None)
    err = None if items else f"no items (HTTP {status})"
    return src, items, err


def tokens(title):
    words = re.findall(r"[\w']+", title.lower())
    return {w for w in words if w not in STOP and len(w) > 2}


def rank(section, fetched, now, junk=None):
    max_age = dt.timedelta(hours=MAX_AGE.get(section["id"], DEFAULT_MAX_AGE))
    clusters = []  # each: {"items": [...], "tok": set, "w": float}
    order_kept = section.get("kind") == "video"
    for src, items in fetched:
        for pos, it in enumerate(items):
            age = now - dt.datetime.fromisoformat(it["published"])
            if age > max_age or (junk and junk.search(it["title"])):
                continue
            tok = tokens(it["title"])
            # Trends keep Google's own order; position 0 is hottest.
            base = src.get("w", 1.0) * (2.0 - pos / 30 if src.get("kind") == "trends" else 1.0)
            for c in ([] if order_kept else clusters):
                inter = len(tok & c["tok"])
                if tok and inter / max(1, min(len(tok), len(c["tok"]))) >= 0.6 and inter >= 3:
                    c["items"].append(it)
                    c["w"] += base * 0.8
                    c["sources"].add(it["source"])
                    break
            else:
                clusters.append({"items": [it], "tok": tok, "w": base, "sources": {it["source"]}})
    if not order_kept:
        clusters = merge_similar(clusters)
    out = []
    for c in clusters:
        lead = max(c["items"], key=lambda i: (bool(i["summary"]), bool(i["image"])))
        newest = max(dt.datetime.fromisoformat(i["published"]) for i in c["items"])
        hours = (now - newest).total_seconds() / 3600
        freshness = 0.5 ** (hours / (24 if section["id"] in MAX_AGE else 12))
        score = c["w"] * (1 + 0.5 * (len(c["sources"]) - 1)) * (0.35 + freshness)
        entry = dict(lead)
        entry["published"] = newest.isoformat()
        entry["coverage"] = len(c["sources"])
        entry["also"] = [{"source": i["source"], "link": i["link"]} for i in c["items"] if i is not lead][:4]
        entry["score"] = round(score, 3)
        out.append(entry)
    out.sort(key=lambda e: e["score"], reverse=True)
    if order_kept:
        # newest first, at most 4 per channel so one busy channel can't fill the list
        out.sort(key=lambda e: e["published"], reverse=True)
        per = {}
        out = [e for e in out if per.setdefault(e["source"], []).append(e) or len(per[e["source"]]) <= 4]
    return out[:PER_SECTION]


def merge_similar(clusters, threshold=0.45):
    """Second pass: fold paraphrased headlines of the same story together."""
    clusters.sort(key=lambda c: c["w"], reverse=True)
    kept = []
    for c in clusters:
        for k in kept:
            inter = len(c["tok"] & k["tok"])
            if inter >= 3 and inter / max(1, min(len(c["tok"]), len(k["tok"]))) >= threshold:
                k["items"].extend(c["items"])
                k["w"] += c["w"] * 0.8
                k["sources"] |= c["sources"]
                k["tok"] |= c["tok"]
                break
        else:
            kept.append(c)
    return kept


def digest(own, others, limit=PER_SECTION, per_origin=4):
    """Top stories: the section's own picks plus the leading stories of every news section,
    with at most `per_origin` from any one section in the first 20 so no single topic dominates."""
    pool = [(it, "top") for it in own]
    for origin, items in others.items():
        pool.extend((it, origin) for it in items[:6])
    seen, out, counts = [], [], {}
    for it, origin in sorted(pool, key=lambda p: (p[0]["coverage"], p[0]["score"]), reverse=True):
        tok = tokens(it["title"])
        if any(len(tok & t) >= 3 and len(tok & t) / max(1, min(len(tok), len(t))) >= 0.45 for t in seen):
            continue
        if len(out) < 20 and origin != "top" and counts.get(origin, 0) >= per_origin:
            continue
        seen.append(tok)
        counts[origin] = counts.get(origin, 0) + 1
        out.append(it)
    return out[:limit]


def personal_picks(day):
    """Pick today's entries from each content library, rotating by day of year."""
    picks = {}
    cdir = os.path.join(ROOT, "content")
    for name in sorted(os.listdir(cdir)):
        if not name.endswith(".json"):
            continue
        lib = json.load(open(os.path.join(cdir, name), encoding="utf-8"))
        for key, entries in lib["lists"].items():
            if not entries:
                continue
            n = lib.get("per_day", {}).get(key, 1)
            start = (day * n) % len(entries)
            picks[key] = [entries[(start + i) % len(entries)] for i in range(n)]
    return picks


def main():
    cfg = json.load(open(os.path.join(ROOT, "scripts", "feeds.json"), encoding="utf-8"))
    now = dt.datetime.now(dt.timezone.utc)
    local = now.astimezone(IST)
    edition = "morning" if local.hour < 14 else "evening"

    jobs = []
    for s in cfg["sections"]:
        for f in s["feeds"]:
            jobs.append((s["id"], f))
        for q in s.get("gnews", []):
            jobs.append((s["id"], {"url": gnews_url(q), "w": 0.85}))
        for q in s.get("gnews_hi", []):
            jobs.append((s["id"], {"url": gnews_url(q, "hi"), "w": 0.85, "lang": "hi"}))

    by_section, errors = {}, []
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(fetch, f): sid for sid, f in jobs}
        for fut in cf.as_completed(futs):
            src, items, err = fut.result()
            by_section.setdefault(futs[fut], []).append((src, items))
            if err:
                errors.append({"url": src["url"], "error": err})

    junk = re.compile(cfg["junk"]) if cfg.get("junk") else None
    ranked = {s["id"]: rank(s, by_section.get(s["id"], []), now, junk) for s in cfg["sections"]}
    news_ids = [s["id"] for s in cfg["sections"] if s["group"] in ("Tech", "World", "Local", "Life") and s["id"] not in ("top", "trending")]
    sections = []
    for s in cfg["sections"]:
        items = ranked[s["id"]]
        if s.get("digest"):
            items = digest(items, {i: ranked[i] for i in news_ids})
        sections.append({k: s[k] for k in ("id", "title", "icon", "group") if k in s} | {"note": s.get("note"), "items": items})

    doc = {
        "generated_at": now.isoformat(),
        "generated_local": local.strftime("%a %d %b %Y, %I:%M %p IST"),
        "edition": edition,
        "sections": sections,
        "personal": personal_picks(local.timetuple().tm_yday),
        "stats": {"sources": len(jobs), "failed": len(errors), "items": sum(len(s["items"]) for s in sections)},
        "errors": errors,
    }

    data = os.path.join(ROOT, "data")
    arch = os.path.join(data, "archive")
    os.makedirs(arch, exist_ok=True)
    stamp = f"{local:%Y-%m-%d}-{edition}"
    for path in (os.path.join(data, "latest.json"), os.path.join(arch, f"{stamp}.json")):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    files = sorted(f for f in os.listdir(arch) if f.endswith(".json"))
    for old in files[:-ARCHIVE_KEEP]:
        os.remove(os.path.join(arch, old))
    index = sorted((f[:-5] for f in os.listdir(arch) if f.endswith(".json")), reverse=True)
    with open(os.path.join(data, "archive.json"), "w") as fh:
        json.dump(index, fh)

    print(f"{stamp}: {doc['stats']['items']} items from {len(jobs)} sources, {len(errors)} failed")
    for s in sections:
        print(f"  {s['id']:<10} {len(s['items']):>3}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
