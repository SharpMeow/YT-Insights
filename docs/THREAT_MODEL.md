# Threat model

Content scripts run on a hostile, third-party DOM (`youtube.com`) that includes untrusted user content (comments, captions, titles, descriptions).

## Trust boundaries

| Zone | Trust |
| --- | --- |
| Extension isolated world (MV3 content scripts) | Ours — still treat page strings as untrusted |
| YouTube page JS / DOM | Untrusted |
| Caption timedtext / comments / titles / descriptions | Untrusted data |
| Chrome extension APIs | Trusted platform; v1 uses almost none beyond content scripts |

## Notes

| Concern | Mitigation intent |
| --- | --- |
| XSS via `innerHTML` | Escape dynamic strings (`escapeHtml`) or prefer `textContent` |
| Malicious captions / comments | Parse as data; do not `eval` or inject raw HTML from timedtext |
| Privilege creep | Minimal host permission — YouTube only |
| Isolated world | Do not expose privileged functions on `window` for the page to call |
| Information disclosure | No telemetry; no project servers; no `chrome.storage` of PII in v1 |

## Out of scope

YouTube’s own bugs, browser bugs, malicious forks that add network telemetry, and revenue estimate inaccuracy (product limitation, not a security boundary).

See [SECURITY.md](../SECURITY.md) and [PRIVACY.md](../PRIVACY.md).
