---
"@arch-canvas/auth": patch
---

`reviewer` passa a conceder `comment:resolve` e `viewer` deixa de concedê-lo. Enquanto os dois papéis tinham conjuntos de grants idênticos, os cinco papéis eram na prática três e a ordenação `editor > reviewer > viewer` era decorativa (RBAC-02/03/04, AD-016).
