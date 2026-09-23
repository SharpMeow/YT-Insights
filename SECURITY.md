# Security

This extension runs content scripts on `https://www.youtube.com/*` only. Dynamic strings from the page, captions, and comments should be inserted with `textContent` or HTML-escaping — not as raw publisher HTML. It does not load remote executable code, collect credentials, call a developer backend, or remove browser security warnings.

Report a security problem privately through GitHub's **Report a vulnerability** option when available. If it is unavailable, open an issue asking for a private reporting channel without posting exploit details, credentials, private URLs, or personal data. Ordinary layout breakage and estimate inaccuracy can be public issues.

Only the latest version is supported. YouTube's DOM is hostile and changes often; treat page content as untrusted. Do not grant extra permissions to forks that request broad host access, storage sync, or unrelated origins without a documented reason. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
