## [Unreleased]

### Security
- Allowlist YouTube timedtext hosts before credentialed caption fetches.

# Changelog

## Unreleased

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
