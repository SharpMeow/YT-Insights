# Testing

There is no automated browser suite in v1. Use load-unpacked manual checks.

## Syntax

```sh
node --check js/*.js
```

## Manual checklist

1. Load unpacked; open a `/watch?v=…` URL.
2. Confirm revenue chip above likes, right-aligned; title not clipped.
3. Confirm viral strip under description/info metadata only.
4. SPA-navigate to another video without full reload; UI tears down and reinjects.
5. Video with native chapters vs description timestamps vs captions-only.
6. Heatmap: native markers when present; otherwise **est.** badge.
7. Comments: spam toggle when matches exist; show restores comments.
8. Transcript search seek; missing captions empty state.
9. Shorts: revenue-only; no broken watch-only panels.
10. With SponsorBlock installed: both usable; no ad-DOM fights.

Update this list when adding features or CI.
