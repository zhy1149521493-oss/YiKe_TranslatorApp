# Changelog

## 1.2.0 — 2026-10-13

- Integrate Poetry, Workbench and Classic presentations with shared themes and Settings-only style selection, preserving real translation controllers and task state.
- Add native drawer clipping, draggable branding, stationary Poetry folding and portrait reading layout with responsive editors and compact recognition controls.
- Unify rectangular auxiliary chrome, shared opacity and actual-edge docking for unequal window sizes; preserve classic actions and independent audio-source close behavior.
- Save main pinning with a geometry-preserving Z-order operation. Serialize and atomically merge preference changes, restore local-model/audio/sensitivity fields, and flush main/floating writers before normal exit.
- Move engine and hidden-window preparation off the first-frame path; wait for frontend readiness on first use and bound local model discovery retries.
- Repair translation races, late callbacks, audio-source/history isolation, the audio-engine lock lifecycle, silent WASAPI packets, split UTF-8 API streams, subtitle deduplication and capture bounds.
- Standardize all application manifests and About on 1.2.0. Distribute only the standard Lite ZIP and SHA-256 checksum from this release onward; retain historical Full assets. Clarify the separate Ollama requirement for Lite local translation.

The integration baseline passes 120 frontend and 38 Rust tests, release compilation and focused native checks; see [acceptance](WINDOW_BEHAVIOR.md#candidate-acceptance). Packaging and upgrade procedures are in [RELEASES.md](RELEASES.md).
