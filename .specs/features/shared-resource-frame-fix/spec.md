# Bug real de navegação entre frames Specification

## Problem Statement

`SharedResourcePage` (visualização pública de uma apresentação publicada) navega entre frames
trocando o `initialElements` de `EditorSurface` sem remontá-lo. O `<Excalidraw/>` real só lê
`initialData` no mount — mudanças posteriores na prop são ignoradas pelo componente real. O teste
que deveria pegar isso usa um mock que relê a prop a cada render, então `PRZ-33` passa no unit e o
produto real fica preso no primeiro frame. Achado do Verifier de R17
(`editor-stability/validation.md` Gap 3), registrado como dívida aberta em
`platform-maturity/remediation-roadmap.md` e no handoff de `.specs/STATE.md`.

## Goals

- [ ] Navegar entre frames de uma apresentação publicada muda o que o visitante vê no canvas
- [ ] O comentário em `EditorSurface.tsx` que documenta a premissa errada é corrigido
- [ ] O teste unitário que fixa a premissa errada é corrigido para fixar o contrato real
- [ ] Existe uma prova ponta a ponta contra o `<Excalidraw/>` real, não o mock, que este defeito
      especificamente reprovaria se reintroduzido

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| `PresenterModePage` | Usa um modelo diferente — uma única cena contínua e `scrollToFrame` via handle imperativo (AD-010). Nunca troca `initialElements` após o mount; não tem este bug. |
| Preservar estado local do canvas entre frames | `viewModeEnabled` é sempre `true` nas duas ramificações de `SharedResourcePage` — não há edição local para preservar, então remontar é seguro sem ressalva. |
| Mudar o formato de `EditorSurfaceHandle` ou adicionar um método imperativo de troca de cena | O bug pede que o remount aconteça; não pede uma API nova. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Mecanismo de correção | `key` estável por frame (`frame.id`) na chamada de `<EditorSurface>` dentro de `renderCanvas`, forçando o React a desmontar/remontar a cada troca de frame | É a correção mínima e correta: `viewModeEnabled` é sempre `true` aqui, então não há custo de perder edição local; remontar é exatamente o que o `<Excalidraw/>` real precisa para reler `initialData` | y |
| Alcance do teste ponta a ponta | Novo teste Playwright em `apps/web/e2e/` abrindo uma apresentação publicada real com 2+ frames e comparando o SVG/conteúdo renderizado entre frames, sem mock do Excalidraw | É a única forma de provar a mudança real de cena — todo teste unitário deste componente usa o mock, que é exatamente o que escondeu o bug original | y |

**Open questions:** none — resolvidas acima.

---

## User Stories

### P1: A apresentação pública navega de verdade ⭐ MVP

**User Story**: Como visitante de uma apresentação publicada sem sessão, quero que avançar/voltar
frame realmente troque o que vejo no canvas, para acompanhar a apresentação como ela foi montada.

**Why P1**: É um defeito confirmado em produção, não uma lacuna de cobertura — o recurso publicado
não funciona.

**Acceptance Criteria**:

1. WHEN o visitante navega de um frame para outro (linear, `prev`/`next`, ou via link de navegação
   do protótipo) THEN o sistema SHALL remontar a superfície do canvas de modo que o conteúdo
   renderizado reflita os elementos recortados do frame de destino
2. The sistema SHALL nunca depender apenas da mudança de uma prop para atualizar a cena de uma
   instância de `<Excalidraw/>` já montada — todo consumidor que precisa de uma cena inicial nova
   após o mount SHALL forçar remount via `key` estável
3. WHILE a apresentação publicada tem um único frame o sistema SHALL continuar montando o canvas
   normalmente, sem remount adicional (nada navega)
4. WHEN um teste exercita `EditorSurface` com o `<Excalidraw/>` real (não mockado) e troca de frame
   via remount THEN o sistema SHALL mostrar elementos diferentes por frame, prova que nenhum mock
   pode fornecer

**Independent Test**: publicar uma apresentação com 2+ frames, abrir o link público, navegar para o
próximo frame, e ver o canvas mudar de conteúdo (não apenas o indicador de posição).

---

## Edge Cases

- IF a apresentação publicada tem exatamente um frame THEN o sistema SHALL montar o canvas uma vez, sem qualquer remount subsequente
- WHEN o visitante usa um link de navegação do protótipo para pular fora da ordem linear THEN o sistema SHALL remontar do mesmo jeito que a navegação linear (mesmo mecanismo, mesma `key`)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SRF-01 | P1: A apresentação pública navega de verdade | Tasks | Pending |
| SRF-02 | P1: A apresentação pública navega de verdade | Tasks | Pending |
| SRF-03 | P1: A apresentação pública navega de verdade | Tasks | Pending |
| SRF-04 | P1: A apresentação pública navega de verdade | Tasks | Pending |

**Coverage:** 4 total, 4 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] Um e2e contra o `<Excalidraw/>` real prova que o conteúdo do canvas muda por frame
- [ ] `EditorSurface.tsx` não documenta mais uma premissa que o componente real não cumpre
- [ ] `EditorSurface.spec.tsx` não fixa mais o comportamento errado como contrato
- [ ] `make ci` passa
