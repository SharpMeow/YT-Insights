# Contributing

The extension itself has no build step and no npm dependencies. Load it unpacked from the folder that contains `manifest.json`.

```sh
node --check js/*.js
```

Keep changes focused. Describe the user-visible outcome. Prefer escaping or `textContent` for any string from the page, captions, or comments. Never add remote executable code, telemetry, a developer backend, ad blocking, or broad host permissions without prior discussion.

Test on real `/watch` pages: revenue chip right-aligned above likes without clipping the title; SPA navigation between videos (`yt-navigate-finish`); native vs description vs caption chapters; heatmap native vs **est.**; spam toggle recoverability; transcript empty state; Shorts revenue-only path; coexistence with SponsorBlock when installed.

Match existing style: vanilla ES, IIFE modules on the shared `YTI` namespace, `yti-` CSS prefixes, `utils.js` first and `main.js` last in `manifest.json`. No minification required for pull requests.

Keep `manifest.json` version aligned with [CHANGELOG.md](CHANGELOG.md). Include permission changes in [PRIVACY.md](PRIVACY.md). Update screenshots under `docs/` if the visible interface changes materially. Use the project name or the creator's pseudonym, **Chaos**, in public attribution — not unrelated personal framing.
