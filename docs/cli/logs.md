---
summary: "CLI reference for `sendell logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
---

# `sendell logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:
- Logging overview: [Logging](/logging)

## Examples

```bash
sendell logs
sendell logs --follow
sendell logs --json
sendell logs --limit 500
```

