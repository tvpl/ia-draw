---
"@arch-canvas/editor-adapter": patch
---

Adds an optional `viewModeEnabled` prop to `EditorSurface` (R11, SHR-18), passed straight through to `<Excalidraw/>` so a caller can disable local editing on the canvas. Omitting it keeps Excalidraw's own default, so every existing consumer is unchanged.
