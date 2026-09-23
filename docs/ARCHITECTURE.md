# Architecture

YT Insights is a Chrome Manifest V3 **content-script** extension. There is no background service worker in v1 and no build step. Scripts listed in `manifest.json` load in order on `https://www.youtube.com/*` and attach to a shared `YTI` namespace.

Revenue figures are **estimates** — client-side RPM bands, not YouTube Analytics.

## Modules

| File | Responsibility |
| --- | --- |
| `js/utils.js` | SPA helpers, video id, player response / initial data access, formatting, seek, debounce, navigate hooks. |
| `js/revenue.js` | Multi-model RPM estimate; injects muted text above likes on `#actions` (right-aligned); hover breakdown. |
| `js/chapters.js` | Native chapters → description timestamps → caption auto-split; panel + copy. |
| `js/heatmap.js` | Native heat markers or caption-density estimate above the progress bar. |
| `js/spam.js` | Comment MutationObserver; soft-hide + recoverable toggle. |
| `js/viral.js` | Views/day + velocity blurb under metadata (never title/actions). |
| `js/transcript.js` | Caption search UI; seek on result click. |
| `js/main.js` | Boot, tear-down, staggered activate, reinject observer. |
| `content.css` | `yti-` styles using YouTube yt-spec tokens where practical. |

## SPA flow

YouTube is a single-page app. `utils` listens for `yt-navigate-finish` (and related id changes). `main.js` tears down on video change, then staggers feature `run` calls. A MutationObserver calls each module’s `ensurePresent()` so YouTube DOM rebuilds do not leave missing UI. Shorts use a revenue-only path.

## Inject points

| Feature | Primary anchors |
| --- | --- |
| Revenue | `#actions` / `ytd-watch-metadata #actions` (and actions-inner fallbacks). First child of the actions column; must not attach to `#title`. |
| Viral | Description / watch-info metadata; explicitly avoids `#actions` and title. |
| Chapters | Near `#description-inline-expander` / watch metadata (`yti-chapters-panel`). |
| Transcript | Prefer below chapters; else description anchors (`yti-transcript-box`). |
| Heatmap | Above progress / player bar chrome. |
| Spam | Comment thread containers. |

## Data sources

Player response (`ytInitialPlayerResponse` / `getPlayerResponse()`), DOM fallbacks for views and dates, description text, YouTube timedtext URLs for captions, and comment DOM for spam scoring (in memory only).

## RPM models (`revenue.js`)

| Model | Role |
| --- | --- |
| `socialBlade` | Wide public-facing band |
| `industry` | Mid long-form band |
| `cpmProxy` | Rough CPM × creator share × monetized-playback proxy |
| `shorts` | Lower Shorts band when Shorts detected |

Displayed range aggregates active lows/highs; always labeled **est.** Not claimed accurate.

## Coexistence

Does not mutate ad iframes, does not call SponsorBlock APIs, and does not implement skip segments.
