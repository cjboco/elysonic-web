# Elysonic website

A static, single-page site for Elysonic on macOS. Open `index.html` directly or run `python3 -m http.server 4173 --bind 127.0.0.1` in this directory and visit `http://127.0.0.1:4173`. There is no build step.

The logo and application icon come from Elysonic. The WebP images are screenshots of the running desktop app. The Album Journey photo credit and license appear with its screenshot. Album art appears in the context of the app screenshots.

## Pre-release website check (2026-11-27)

Before publishing a release update to `elysonic.com`:

1. Render desktop (`1440x900`) and narrow mobile (`320px`, `390x844`) views and check header fit, dark-mode parity across every `<picture>` source, and interactive states (`Retro sci-fi` palette disable, Discovery Dial 5 steps, lightbox `<dialog>`).
2. Keep Simple Core features in the Top Half (`#basics`, `#sound`, `#care`, `#cost`) and Advanced / Power features (10-band EQ, online lookups, AI, MCP) below `#ready-for-power`.
3. Verify every "included" claim against `scripts/package-mac.sh` and `scripts/publish-release.sh` (only promise files installed by `Elysonic-macOS.pkg`).
4. Keep fonts and `assets/og-card.png` self-hosted with zero third-party network requests on page load, and remove unused files from `assets/` whenever screenshots are replaced.
