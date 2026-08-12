# TranslatorApp — Local Translation Assistant (dev source)

A fully offline Windows desktop translation app (Tauri 2 + React 19 + TypeScript + Ollama).

This repository holds the **dev source code**. Read `AGENTS.md` for the project memory protocol before changing anything.

## Two folders — know the difference

| Folder | Role | Portable? |
|---|---|---|
| **this repo** (`translator-app`) | dev source: `src/`, `src-tauri/`, build config | No — on a new machine you must `npm install` and rebuild |
| **runtime folder** | the built, ready-to-run app (exe + dlls + models + `docs/`) | Yes — copy the whole folder to any drive and it runs; delete it and it is uninstalled |

On this machine the runtime folder is `E:\TranslatorApp`. On any other machine it can live anywhere — nothing in this repo hard-codes that path.

## Layout

```
translator-app/                 ← this repo (dev source)
├── src/              React frontend
├── src-tauri/        Rust backend
├── index.html        HTML entry
├── package.json      frontend dependencies
└── vite.config.ts    Vite config
```

## Docs

Project memory lives next to the runtime app, **not** in this repo:

- `docs/` and `REASONIX.md` are inside the runtime folder (e.g. `E:\TranslatorApp\docs\`)
- `规划表.txt` — development plan (Chinese), also in the runtime folder

Read `docs/README.md` and `docs/CURRENT_STATE.md` before touching code, and update docs after meaningful changes (see `AGENTS.md`).

## Run / Build

```bash
# Development
npm install
npm run tauri dev

# Compile Rust only
cd src-tauri && cargo check

# Build release
npm run tauri build
```

## Notes

- Portable green delivery: no installer; the runtime folder is self-contained.
- Fully offline: no feature depends on the internet.
- Git commit identity for this repo: `Reasonix <reasonix@local>`.
