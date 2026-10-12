# Local checkpoints and rollback

The stable repair checkpoint is the Git tag `checkpoint/core-repairs-2026-10-08` and branch `archive/core-repairs-2026-10-08`. It includes the eight audited logic repairs, theme-aware scrollbars, regression tests and developer documentation. These references are local; no changes have been pushed to GitHub.

The repair commit is `994ddfa73ffc825e28b212b6c86695389264cdf8`. An independent complete-history Git bundle is stored at `E:/TranslatorApp/archives/core-repairs-2026-10-08/source.bundle`. Its refs were verified with `git bundle verify`.

## Icon-only installation

The approved clay Windows file icons are installed with original executables preserved under `E:/TranslatorApp/archives/clay-icon-2026-10-12/originals/`. The earlier checksum below applies to the pre-icon repair build; use the icon archive manifest for current hashes. Source assets live on the isolated `ui/clay-app-icon` branch. See [icon scope, validation and rollback](ICONS.md).

## Switch the UI only

In `译刻-工作台版.exe`, click **Classic interface** in the title bar (or Settings > General > Interface layout > Classic). Input, translations and settings are retained. Click **Workbench interface** to return. This does not require restarting or replacing files. See [the workbench guide](WORKBENCH.md).

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

If the original checkout is unavailable, recover from the independent archive into a new directory:

```powershell
git clone -b archive/core-repairs-2026-10-08 E:/TranslatorApp/archives/core-repairs-2026-10-08/source.bundle E:/TranslatorApp-recovered
```

The archive contains source/history, not runtime models or private configuration. Those remain in the portable installation. The redesigned source is kept on the local `ui/workbench-redesign` branch and tagged `checkpoint/workbench-2026-10-08` after verification. Its independent Git bundle and executable checksum manifest are in `E:/TranslatorApp/archives/workbench-2026-10-08/`.
