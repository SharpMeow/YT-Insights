# FOR_AGENTS

Agent deep-dive for YT Insights. Read [AGENTS.md](../AGENTS.md) first. Imperative sentences. Creator: Chaos / SharpMeow.

## Module ownership

| Module | File | Owns | Tear-down |
| --- | --- | --- | --- |
| Utils | `js/utils.js` | `getVideoId`, `getPlayerResponse`, `prMatchesCurrentVideo`, `onNavigate`, formatters, `waitFor`, `debounce` | n/a |
| Revenue | `js/revenue.js` | RPM estimate chip; wraps likes in `#yti-actions-stack` | `removeChip` |
| Chapters | `js/chapters.js` | Chapter panel; caption URL allowlist + `fetchCaptions` | `removePanel` |
| Heatmap | `js/heatmap.js` | Native or estimated heat overlay on progress bar | `removeOverlay` |
| Spam | `js/spam.js` | Soft-hide comments + toggle | `reset` |
| Viral | `js/viral.js` | Views/day strip under metadata (not title/actions) | `removeStrip` |
| Transcript | `js/transcript.js` | Caption search UI; calls `YTI.chapters.fetchCaptions` | `removeBox` |
| Boot | `js/main.js` | `tearDown`, `activate`, `scheduleActivate`, reinject observer | clears `featureTimers` then module removes |

Manifest script order (dependencies first):

`utils.js` → `revenue.js` → `chapters.js` → `heatmap.js` → `spam.js` → `viral.js` → `transcript.js` → `main.js`

CSS entry in manifest must be `content.css` (same filename on disk).

## Data flow

```
URL ?v= /shorts/ID
  → YTI.utils.getVideoId()
  → YTI.utils.getPlayerResponse()   # live player API, then window, then script scan
  → YTI.utils.prMatchesCurrentVideo(pr)   # reject SPA leftovers
  → feature modules read views / captions / markers
  → inject DOM (ids prefixed yti-)
```

On navigate (`YTI.utils.onNavigate`):

1. `scheduleActivate` clears `navTimers` + `featureTimers`.
2. If URL id ≠ `activeVideoId`, call `tearDown` immediately (run tokens++, remove nodes, unwrap stack).
3. Activate at ~150ms and ~1200ms (player response often lags navigate).
4. Staggered feature timeouts re-call `getVideoId()` before `run`.

## Revenue placement rules

- Anchor: `#actions` / like-button hosts under watch metadata.
- Never `#title`, never owner/subscribe row.
- Wrap host in `#yti-actions-stack` (column, `align-items: flex-end`, `width: auto`).
- Chip is first child of stack (visually above likes), right-aligned muted text.
- Tooltip is fixed on `document.body`, not inside the flex row.

## Caption allowlist

Only in `YTI.chapters.fetchCaptions`:

- Protocol `https:`
- Host is YouTube (`youtube.com`, `www.youtube.com`, `m.youtube.com`, or `*.youtube.com`)
- Prefer timedtext / api timedtext paths; reject surprising hosts
- Prefer `fmt=json3` when missing

Transcript and heatmap must reuse this helper. Do not add a second caption fetch path.

## Agent test checklist

After any SPA, placement, or timer change:

1. Run `for f in js/*.js; do node --check "$f"; done`.
2. Load unpacked; open a watch URL; chip appears above likes, not on the title.
3. Hover chip: tooltip shows model breakdown and estimate wording.
4. Click a related video: old chip/chapters/strip disappear; new data matches new URL.
5. Rapidly click 2-3 related videos: no duplicate stacks; no stale timer reinject.
6. Video with description chapters: panel lists them; seek works.
7. Video with captions: transcript search finds a phrase; click seeks.
8. Video with native most-replayed: do not fight native UI (native wins when visible).
9. Comments: obvious spam soft-hides; toggle restores.
10. With SponsorBlock installed: both UIs present; this extension still has no ad-skip UI.
11. Shorts URL: revenue-only path; no throw.

## Issue reports

Templates: `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`. Capture extension version, Chrome version, optional public video URL, steps, expected, actual, console errors.

## Pack / release

```sh
python3 scripts/pack.py
```

Tag `vX.Y.Z` only when `manifest.json` version is `X.Y.Z`. Do not push binary icons through text-only file APIs.
