# Privacy

YT Insights has no analytics, accounts, ads, tracking service, or developer-operated backend. It does not send video metadata, captions, or comments to an AI service. All executable code is bundled with the extension.

## What stays on your device

- Revenue estimates, chapter derivation, heatmap synthesis, spam scoring, and transcript search run in the content script on the current YouTube tab.
- In-memory caches (for example caption cues for the active video) live for the page / SPA session and are cleared on navigation tear-down or when the tab closes.
- v1 does not use `chrome.storage` for personal data. No sync of viewing history, comments, or captions to extension storage.

## When data leaves your device

Caption and timedtext requests go to YouTube URLs already exposed by the player/page, using the same browser session YouTube already has. There is no third-party caption proxy and no project server.

Opening YouTube itself sends ordinary requests to Google under YouTube's policies. This extension does not open archive providers, search engines, or affiliate links on your behalf.

## Permissions

| Permission | Purpose |
| --- | --- |
| `host_permissions` / content script match: `https://www.youtube.com/*` | Inject watch-page UI, read player metadata and DOM already shown on YouTube, and fetch timedtext when the player exposes it. |

No `storage`, `tabs`, `webRequest`, `scripting` beyond the declared content scripts, or `<all_urls>` permission.

Uninstalling the extension removes its content scripts. Browser history and YouTube cookies are managed by Chrome and YouTube.
