---
summary: "CLI reference for `sendell agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `sendell agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
sendell agents list
sendell agents add work --workspace ~/sendell-work
sendell agents set-identity --workspace ~/sendell --from-identity
sendell agents set-identity --agent main --avatar avatars/sendell.png
sendell agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:
- Example path: `~/sendell/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:
- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
sendell agents set-identity --workspace ~/sendell --from-identity
```

Override fields explicitly:

```bash
sendell agents set-identity --agent main --name "Sendell" --emoji "🦞" --avatar avatars/sendell.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Sendell",
          theme: "spiritual guide",
          emoji: "🦞",
          avatar: "avatars/sendell.png"
        }
      }
    ]
  }
}
```
