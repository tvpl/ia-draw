---
"@arch-canvas/editor-adapter": patch
---

`EditorSurface` só emite `onSelectionChange` quando o conjunto de ids selecionados muda de fato, e mantém o handle imperativo e o `initialData` referencialmente estáveis. A emissão incondicional fechava um ciclo de render com qualquer consumidor que elevasse a seleção para estado, abortando a rota do editor com o erro React #185 (ESTB-01..04, ESTB-06).
