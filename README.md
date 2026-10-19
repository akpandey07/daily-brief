# Daily Brief

A free, installable news app for iPhone and Android. Twice a day (about 06:00 and 18:00 IST) a GitHub Actions job reads around 90 free RSS sources, merges stories that several outlets cover, ranks them, and publishes the top 50 per section to GitHub Pages.

**Sections:** Top stories, AI, Cloud (AWS/Azure/GCP), DevOps/SRE/Platform, Events & certifications, World politics, India (English + Hindi), Bengaluru, Trending, Cars, Deals, Travel, Food, Sports, What to watch, Music, Tech videos. The **You** tab adds a daily word, jokes, meeting tips, health and habit tips, child and family activities (under 6), home DIY, beauty and vastu, plus habit trackers.

**Cost:** nothing. GitHub Pages and Actions are free for public repositories, and all sources are free RSS feeds.

## Install on a phone
- **iPhone:** open the link in Safari → Share → Add to Home Screen.
- **Android:** open the link in Chrome → ⋮ → Install app.

## Privacy
Settings, the child's name, saved stories, read marks and habit ticks are stored only in the phone's browser storage. Nothing is collected.

## Change things
- **Sources and sections:** `scripts/feeds.json` (RSS feeds and Google News search queries).
- **Daily tips, jokes, activities:** `content/*.json`. Each list rotates one entry per day.
- **Run locally:** `pip install feedparser && python3 scripts/build.py && python3 -m http.server`, then open http://localhost:8000.
- **App code changes:** bump `CACHE` in `sw.js` (for example `daily-brief-v2`) so installed phones pick up the new version.
- **Refresh now:** GitHub → Actions → "Build and publish edition" → Run workflow.

## Limits
- X (Twitter) has no free feed, so "Trending" uses Google Trends India and Reddit instead.
- Netflix, Prime and Spotify have no free public charts; "What to watch" and "Music" come from entertainment news.
- GitHub may pause scheduled runs in a repository with no activity for 60 days; it emails a warning and one click re-enables them.
- Headlines and short summaries link to the original publisher; full articles are on their sites.
