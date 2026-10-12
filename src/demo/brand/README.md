# YiKe brand assets

The user supplied `E:/TranslatorApp/图标.svg`: two overlapping speech bubbles containing A and a Chinese text symbol. The original file is retained unchanged. This is supplied app artwork, not an external stock-icon dependency.

- `yike-app.svg` preserves the original drawing, transparent canvas and embedded provenance metadata. Only the independent bottom-right watermark group at `translate(855,972) scale(1)` was removed at the user's request. No crop or replacement patch was applied.
- An identical cleaned export is saved as `E:/TranslatorApp/图标-无水印.svg`.
- `../BrandMark.tsx` redraws the same motif as small outline geometry using `currentColor`. Main navigation and the hover-navigation setting use this mark. Earlier checkpoints also used it in the retired Capsule floating launcher. Functional icons retain their meanings.
- `demo.html` uses the cleaned full-color SVG as its favicon. Production native/tray/executable icons are unchanged pending integration acceptance.
- Raster inspection evidence is in [the demo guide](../../../docs/DESIGN_DEMO.md). Full-page visual acceptance remains pending.

Original SHA-256: `de457c514fdf87e46c3a892d46fa4b0ef3a29d026d1a3b23dc89d7c12fc3cb13`.

Cleaned SHA-256: `9bce4b72846c231a23d9cf88d6d682921a16ddce2523e0bc0d7f86480b0630f7`.
