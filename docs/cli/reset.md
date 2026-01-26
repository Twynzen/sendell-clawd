---
summary: "CLI reference for `sendell reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `sendell reset`

Reset local config/state (keeps the CLI installed).

```bash
sendell reset
sendell reset --dry-run
sendell reset --scope config+creds+sessions --yes --non-interactive
```

