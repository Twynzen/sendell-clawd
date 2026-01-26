---
summary: "Uninstall Sendell completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Sendell from a machine
  - The gateway service is still running after uninstall
---

# Uninstall

Two paths:
- **Easy path** if `sendell` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
sendell uninstall
```

Non-interactive (automation / npx):

```bash
sendell uninstall --all --yes --non-interactive
npx -y sendell uninstall --all --yes --non-interactive
```

Manual steps (same result):

1) Stop the gateway service:

```bash
sendell gateway stop
```

2) Uninstall the gateway service (launchd/systemd/schtasks):

```bash
sendell gateway uninstall
```

3) Delete state + config:

```bash
rm -rf "${SENDELL_STATE_DIR:-$HOME/.sendell}"
```

If you set `SENDELL_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4) Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/sendell
```

5) Remove the CLI install (pick the one you used):

```bash
npm rm -g sendell
pnpm remove -g sendell
bun remove -g sendell
```

6) If you installed the macOS app:

```bash
rm -rf /Applications/Sendell.app
```

Notes:
- If you used profiles (`--profile` / `SENDELL_PROFILE`), repeat step 3 for each state dir (defaults are `~/.sendell-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `sendell` is missing.

### macOS (launchd)

Default label is `com.sendell.gateway` (or `com.sendell.<profile>`):

```bash
launchctl bootout gui/$UID/com.sendell.gateway
rm -f ~/Library/LaunchAgents/com.sendell.gateway.plist
```

If you used a profile, replace the label and plist name with `com.sendell.<profile>`.

### Linux (systemd user unit)

Default unit name is `sendell-gateway.service` (or `sendell-gateway-<profile>.service`):

```bash
systemctl --user disable --now sendell-gateway.service
rm -f ~/.config/systemd/user/sendell-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Sendell Gateway` (or `Sendell Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Sendell Gateway"
Remove-Item -Force "$env:USERPROFILE\.sendell\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.sendell-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://sendell.bot/install.sh` or `install.ps1`, the CLI was installed with `npm install -g sendell@latest`.
Remove it with `npm rm -g sendell` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `sendell ...` / `bun run sendell ...`):

1) Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2) Delete the repo directory.
3) Remove state + workspace as shown above.
