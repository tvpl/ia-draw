---
"@arch-canvas/editor-adapter": patch
---

Fixes `EditorSurface`'s `scrollToFrame` (presentation-mode/T2, PRZ-37): when the given `elementId` no longer matches anything in the current scene, it now falls back to fitting the whole local scene instead of doing nothing — matching the spec's documented "show everything rather than an empty crop" fallback and the same heuristic `cropSceneForFrame` already used client-side. `elementId: null` is unchanged, still a true no-op.
