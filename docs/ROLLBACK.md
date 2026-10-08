# Local checkpoints and rollback

The stable repair checkpoint is the Git tag `checkpoint/core-repairs-2026-10-08` and branch `archive/core-repairs-2026-10-08`. It includes the eight audited logic repairs, theme-aware scrollbars, regression tests and developer documentation. These references are local; no changes have been pushed to GitHub.

## Run the stable repair build

Exit YiKe through its tray menu first (the application enforces one instance), then run `E:/TranslatorApp/译刻-修复版.exe`. Keep it beside the existing runtime resources. Its SHA-256 is `02E8179D578C3516C4A8092982BA015A70E6087268C9F52289FD6E0474D0C940`. The original `E:/TranslatorApp/译刻.exe` is also retained, but does not contain these repairs.

The portable executables share `config.json` and model resources in their directory. Do not delete or replace those resources to switch builds. Before editing configuration manually, make a private local backup; it can contain plaintext API keys and must not be committed.

## Restore or inspect the source checkpoint

From `E:/TranslatorApp-dev`, inspect the checkpoint without changing the current checkout:

```powershell
git show --stat checkpoint/core-repairs-2026-10-08
git diff checkpoint/core-repairs-2026-10-08
```

For a separate source checkout, leaving current work untouched:

```powershell
git worktree add --detach E:/TranslatorApp-repair-checkpoint checkpoint/core-repairs-2026-10-08
```

Install dependencies and build as described in [the developer guide](README.md). Avoid `git reset --hard` when the working tree contains changes you want to retain.
