---
summary: "CLI reference for `sendell browser` (profiles, tabs, actions, extension relay, remote serve)"
read_when:
  - You use `sendell browser` and want examples for common tasks
  - You want to control a remote browser via `browser.controlUrl`
  - You want to use the Chrome extension relay (attach/detach via toolbar button)
---

# `sendell browser`

Manage Sendell’s browser control server and run browser actions (tabs, snapshots, screenshots, navigation, clicks, typing).

Related:
- Browser tool + API: [Browser tool](/tools/browser)
- Chrome extension relay: [Chrome extension](/tools/chrome-extension)

## Common flags

- `--url <controlUrl>`: override `browser.controlUrl` for this command invocation.
- `--browser-profile <name>`: choose a browser profile (default comes from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
sendell browser --browser-profile chrome tabs
sendell browser --browser-profile sendell start
sendell browser --browser-profile sendell open https://example.com
sendell browser --browser-profile sendell snapshot
```

## Profiles

Profiles are named browser routing configs. In practice:
- `sendell`: launches/attaches to a dedicated Sendell-managed Chrome instance (isolated user data dir).
- `chrome`: controls your existing Chrome tab(s) via the Chrome extension relay.

```bash
sendell browser profiles
sendell browser create-profile --name work --color "#FF5A36"
sendell browser delete-profile --name work
```

Use a specific profile:

```bash
sendell browser --browser-profile work tabs
```

## Tabs

```bash
sendell browser tabs
sendell browser open https://docs.sendell.bot
sendell browser focus <targetId>
sendell browser close <targetId>
```

## Snapshot / screenshot / actions

Snapshot:

```bash
sendell browser snapshot
```

Screenshot:

```bash
sendell browser screenshot
```

Navigate/click/type (ref-based UI automation):

```bash
sendell browser navigate https://example.com
sendell browser click <ref>
sendell browser type <ref> "hello"
```

## Chrome extension relay (attach via toolbar button)

This mode lets the agent control an existing Chrome tab that you attach manually (it does not auto-attach).

Install the unpacked extension to a stable path:

```bash
sendell browser extension install
sendell browser extension path
```

Then Chrome → `chrome://extensions` → enable “Developer mode” → “Load unpacked” → select the printed folder.

Full guide: [Chrome extension](/tools/chrome-extension)

## Remote browser control (`sendell browser serve`)

If the Gateway runs on a different machine than the browser, run a standalone browser control server on the machine that runs Chrome:

```bash
sendell browser serve --bind 127.0.0.1 --port 18791 --token <token>
```

Then point the Gateway at it using `browser.controlUrl` + `browser.controlToken` (or `SENDELL_BROWSER_CONTROL_TOKEN`).

Security + TLS best-practices: [Browser tool](/tools/browser), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
