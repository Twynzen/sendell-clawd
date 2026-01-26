---
summary: "CLI reference for `sendell plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
---

# `sendell plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:
- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
sendell plugins list
sendell plugins info <id>
sendell plugins enable <id>
sendell plugins disable <id>
sendell plugins doctor
sendell plugins update <id>
sendell plugins update --all
```

Bundled plugins ship with Sendell but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `sendell.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
sendell plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
sendell plugins install -l ./my-plugin
```

### Update

```bash
sendell plugins update <id>
sendell plugins update --all
sendell plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
