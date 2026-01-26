---
summary: "CLI reference for `sendell config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `sendell config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `sendell configure`).

## Examples

```bash
sendell config get browser.executablePath
sendell config set browser.executablePath "/usr/bin/google-chrome"
sendell config set agents.defaults.heartbeat.every "2h"
sendell config set agents.list[0].tools.exec.node "node-id-or-name"
sendell config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
sendell config get agents.defaults.workspace
sendell config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
sendell config get agents.list
sendell config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
sendell config set agents.defaults.heartbeat.every "0m"
sendell config set gateway.port 19001 --json
sendell config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
