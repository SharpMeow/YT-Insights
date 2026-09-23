# Changelog

## Unreleased

## 1.0.6 - 2026-09-22

- Theater mode: reinject after `ytd-watch-flexy` theater attribute flips so revenue/chapters/heatmap rebind.
- Fullscreen: tear down and hide all injected UI while YouTube/browser fullscreen is active; restore on exit.

## 1.0.5 - 2026-09-22

- Fixed SPA teardown races: clear revenue/viral retry timers on remove; bump async run tokens when panels/overlays/transcript boxes are removed; split nav vs feature timers so staggered runs cannot reinject after navigation.
- Fixed transcript search preferring a stale closed-over video id; wait for a player response that matches the URL before fetching captions.

## 1.0.4 - 2026-09-22

- Fixed SPA staleness: player response must match URL video id; delayed feature runs re-read `getVideoId()`; tear down immediately on navigation.
- Fixed revenue placement above likes (actions stack), right-aligned, without clipping the title or overflowing into the sidebar.

## 1.0.3 - 2026-09-22

- Security: allowlist YouTube timedtext hosts before credentialed caption fetches.
- Public GitHub release packaging (`scripts/pack.py`, release workflow).

## 1.0.2 - 2026-09-22

- Fixed revenue estimate placement: inject into `#actions` above the like/dislike controls, right-aligned, so the chip no longer competes with or clips the video title.

## 1.0.1 - 2026-09

- Style pass for metadata-native look (YouTube yt-spec text/colors, muted revenue and viral copy).
- Clearer **est.** labeling on revenue and estimated heatmap.

## 1.0.0 - 2026-09

- Added estimated ad revenue (multi-model RPM bands) on watch pages; Shorts use a lower band.
- Added chapters panel: native → description timestamps → caption auto-split; copy chapters.
- Added most-replayed heatmap: native heat markers or caption-density estimate.
- Added spam comment soft-hide with recoverable toggle.
- Added viral views/day strip under description/info metadata.
- Added transcript search with seek-on-click.
- Added SPA reinjection via `yt-navigate-finish` and MutationObserver.
- Manifest V3 content scripts limited to `https://www.youtube.com/*`.
