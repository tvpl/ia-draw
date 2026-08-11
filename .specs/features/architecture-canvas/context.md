# Architecture Canvas Context

**Gathered:** 2026-08-11
**Spec:** `.specs/features/architecture-canvas/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Plataforma self-hosted e server-first de diagramas de arquitetura e prototipagem sobre `@excalidraw/excalidraw`, com persistência durável em PostgreSQL/MinIO (browser nunca é fonte da verdade), geração e edição de diagramas por IA via ferramentas de domínio com preview/aprovação/undo, biblioteca semântica, apresentação com protótipos navegáveis e export local completo. Documento-fonte detalhado: `docs/product-spec.md`.

---

## Implementation Decisions

### Modelo de sincronização e persistência

- Op-log LWW nativo do Excalidraw: mutações de domínio por elemento usando `version`/`versionNonce` + `reconcileElements`, gravadas em `diagram_operations` (delta JSON legível, não binário).
- Yjs CRDT descartado para o MVP; reconsiderar por ADR apenas se co-edição textual granular no mesmo elemento se tornar requisito real.
- Consequência no modelo de dados: `yjs_update`/`yjs_state` substituídos por `elements_delta_json`/`scene_json_key`.

### Ordem do roadmap (AI-first)

- F0 fundação → F1 persistência server-first → F2 IA geradora (inclui biblioteca + semântica) → F3 docs/apresentação/protótipos → F4 realtime multiplayer → F5 hardening.
- Colaboração realtime (presença, multi-node, Redis) explicitamente adiada para F4; comentários assíncronos chegam antes, em F3.

### Topologia de deploy do MVP

- Monólito modular: um processo Node (`apps/server`) com módulos REST, WebSocket e jobs (pg-boss sobre PostgreSQL).
- Fronteiras preservadas nos packages do monorepo (`editor-adapter`, `diagram-domain`, `diagram-ir`, `ai-tools`, …) para split futuro sem retrabalho.
- Compose MVP: proxy, server, web, postgres, minio, minio-init, migrate. Redis entra apenas no profile/fase realtime.

### Prototipagem (escolha do usuário: protótipos navegáveis)

- Kit de wireframes low-fi (telas, botões, inputs, listas) como biblioteca, inserível manualmente e por IA.
- Links de navegação elemento→frame clicáveis no modo apresentação, simulando navegação entre telas.
- Entra como parte da F3 (apresentação); registrado em `presentation_frames.nav_links_json`.

### Geração por IA (decisão do agente, apresentada e não contestada)

- IR declarativa `diagram-ir/v1` (JSON Schema versionado) como artefato central: LLM emite IR, servidor valida, resolve biblioteca por `stable_key` e compila com layout determinístico (ELK layered / grid cloud-C4 / swimlanes).
- Tool calls incrementais ficam para edições; geração de novo é one-shot IR.
- Métricas geométricas determinísticas (overlaps, crossings, labels truncados) rodando em CI com provider mock.

### Agent's Discretion

- Escolha final entre ELK.js e Dagre (ou ambos por preset) — decidir no Design com spike.
- Rota de renderização server-side (`exportToSvg` + resvg/sharp vs Chromium headless) — spike na F0 decide; registrar ADR.
- Estrutura interna de módulos do `apps/server`, esquema exato de migrations e detalhes do protocolo WebSocket.
- Formato interno do bundle `.zip` de export local (dentro do requisito: cena + assets + metadados + specs + manifest de checksums).

### Declined / Undiscussed Gray Areas → Assumptions

Registradas na tabela Assumptions & Open Questions do spec.md com default + rationale (Confirmed? = n):

- Renderização server-side (exportToSvg + resvg; fallback Chromium).
- Fila de jobs MVP (pg-boss, sem Redis).
- Busca (PostgreSQL FTS + pg_trgm).
- Licenciamento dos ícones AWS (pack oficial com atribuição).
- Limiar de aprovação de patch de IA (remoções / >50 elementos / fora da seleção).
- Licença/marca do produto (a definir; não bloqueia scaffold).

---

## Specific References

- Documento-fonte completo do product owner: `docs/product-spec.md` (emendado por AD-001..AD-006).
- Comportamento de colaboração de referência: o próprio app oficial do Excalidraw (LWW por `version`/`versionNonce`), mas com persistência corporativa própria — nunca o backend de demonstração.
- Requisito enfatizado pelo usuário: "IA para gerar de forma prática e de extrema qualidade diagramas técnicos e de negócio" e "não dependa de browser para salvar nada; se eu quiser salvar local, eu possa".

---

## Deferred Ideas

- Yjs CRDT para co-edição textual granular (ADR futura, se necessário).
- PlantUML import/export (após Mermaid/Structurizr).
- TOTP local, marketplace de plugins, descoberta automática de cloud, apps nativos (out of scope do documento-fonte).
- Geração de diagramas por API/CI sem LLM usando `diagram-ir` diretamente (a IR habilita; priorizar depois da F2).
