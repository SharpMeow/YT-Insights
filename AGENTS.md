# AGENTS

YT Insights is a Chrome Manifest V3 content-script extension for `youtube.com` watch pages. There is no build step, no bundler, and no background service worker. Vanilla IIFE files attach to a shared `YTI` namespace. Humans opening a pull request follow `CONTRIBUTING.md`. This file is the contract for coding agents.

Created by **Chaos** ([SharpMeow](https://github.com/SharpMeow)).

## What this repo is

- Unpacked MV3 extension: load the repo root (folder with `manifest.json`).
- Features: estimated ad revenue, chapters, most-replayed heatmap, spam soft-hide, viral strip, transcript search.
- Coexists with SponsorBlock / YouTube Premium. **Never** add ad blocking or sponsor-skip UI.
- Revenue numbers are **estimates only**, not YouTube Analytics.

## Layout

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; content script order + `content.css` |
| `js/utils.js` | Shared helpers, SPA navigation, player-response access |
| `js/revenue.js` | Estimate chip above likes (`#yti-actions-stack`) |
| `js/chapters.js` | Chapters panel + caption fetch allowlist |
| `js/heatmap.js` | Progress-bar heatmap overlay |
| `js/spam.js` | Soft-hide spam comments |
| `js/viral.js` | Views/day strip under metadata |
| `js/transcript.js` | Caption search box |
| `js/main.js` | Boot, tearDown, staggered activate, reinject observer |
| `content.css` | All injected styles (filename must match manifest) |
| `icons/` | 16/48/128 PNGs |
| `scripts/pack.py` | Zip for release / Load unpacked |
| `.github/workflows/release.yml` | `workflow_dispatch` tag `vX.Y.Z` must match manifest |
| `.github/ISSUE_TEMPLATE/` | Bug report + feature request forms |
| `docs/` | Architecture, testing, threat model, agent deep-dive |

Deeper module map and SPA checklist: [docs/FOR_AGENTS.md](docs/FOR_AGENTS.md).

## Load and verify

1. `chrome://extensions` → Developer mode → **Load unpacked** → select this repo root.
2. Open `https://www.youtube.com/watch?v=…`.
3. Confirm: revenue text above likes (right), not in `#title`; viral strip under info; chapters/transcript near description; heatmap above scrubber when data exists.
4. SPA-click a related video. UI must clear and refill for the **new** id (no previous title/revenue).
5. Optional: install SponsorBlock and confirm both extensions work.

After edits: reload the extension card, then hard-refresh or SPA-navigate the watch tab.

```sh
for f in js/*.js; do node --check "$f"; done
python3 scripts/pack.py
```

## Hard constraints

- **No adblock.** No hiding or skipping ads or sponsors.
- **Coexist with SponsorBlock.** Do not fight it for DOM or player controls.
- **Revenue is ESTIMATE only.** Always label `est.` / estimate. Never claim payouts.
- **Never inject into `#title`.** Revenue sits above likes on the right via `#yti-actions-stack`.
- **SPA:** every delayed path must re-read `YTI.utils.getVideoId()` and only use a player response that passes `YTI.utils.prMatchesCurrentVideo(pr)`.
- **Tear down on navigate.** Clear timers, bump async run tokens, remove injected nodes, unwrap the actions stack.

## Security

- Caption fetches: allowlist `https` YouTube timedtext hosts only (`YTI.chapters.fetchCaptions`). Reject other hosts/paths.
- Escape HTML before any `innerHTML` sink (titles, captions, tooltips).
- Minimal permissions: content scripts + host access for `https://www.youtube.com/*` only. Do not add broad `<all_urls>`, cookies, or storage unless justified in SECURITY.md.
- No remote code. No analytics beacons.

## Pack and release

```sh
python3 scripts/pack.py   # writes dist/yt-insights-<version>.zip
```

Release: GitHub Actions `workflow_dispatch` with tag `vX.Y.Z` where `X.Y.Z` **equals** `manifest.json` `"version"`. Bump manifest + CHANGELOG in the same change as user-visible fixes.

Text-only `push_files` / MCP pushes cannot update binary `icons/*.png`. Use a path that preserves binaries, or leave icons untouched.

## Common pitfalls

- Stale `ytInitialPlayerResponse` / inline script JSON after related-video SPA. Always match URL id via `prMatchesCurrentVideo`.
- YouTube DOM churn: prefer resilient anchors (`#actions`, like-button hosts); never fall back to `#title` or `#owner`.
- `width: 100%` on the actions stack stretches the flex row into the sidebar and can clip the title. Keep stack `width: auto`.
- Duplicate activate ticks without clearing feature timers → double inject / races. `main.js` splits `navTimers` vs `featureTimers`.
- Leaving `retryTimer` alive after `removeChip` / `removeStrip` reinjects UI after tearDown.
- Async chapters/heatmap/transcript continuing after tearDown without bumping `runToken` on remove.

## Human docs

README, PRIVACY.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, and `docs/*` (ARCHITECTURE, TESTING, THREAT_MODEL, FOR_AGENTS).

## Bug reports

Use [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) (bug report / feature request). Include extension version, Chrome version, optional public video URL, steps, expected/actual, console errors.
