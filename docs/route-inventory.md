# Inventário de rotas

Gerado por `repo-tools audit`. Não editar à mão.

- Rotas registradas: 82
- Com consumidor de UI (`consumed`): 4
- Pendentes de produto (`pending-product`): 78
- Consumidores órfãos (`orphan-consumer`): 0

## consumed (4)

| Método | Path | Registrada em | Consumida por |
| --- | --- | --- | --- |
| GET | `/me` | `apps/server/src/modules/auth/routes.ts` | `apps/web/src/diagram/DiagramEditorPage.tsx` |
| GET | `/diagrams/:id/bootstrap` | `apps/server/src/modules/diagram-sync/routes.ts` | `apps/web/src/sync/syncClient.ts` |
| POST | `/diagrams/:id/operations:batch` | `apps/server/src/modules/diagram-sync/routes.ts` | `apps/web/src/sync/syncClient.ts` |
| GET | `/diagrams/:id/operations` | `apps/server/src/modules/diagram-sync/routes.ts` | `apps/web/src/sync/syncClient.ts` |

## pending-product (78)

| Método | Path | Registrada em |
| --- | --- | --- |
| GET | `/health/live` | `apps/server/src/core/server.ts` |
| GET | `/health/ready` | `apps/server/src/core/server.ts` |
| GET | `/metrics` | `apps/server/src/core/server.ts` |
| POST | `/diagrams/:id/ai/runs` | `apps/server/src/modules/ai-engine/routes.ts` |
| POST | `/ai/runs/:runRef` | `apps/server/src/modules/ai-engine/routes.ts` |
| GET | `/admin/ai-providers` | `apps/server/src/modules/ai-provider/routes.ts` |
| POST | `/admin/ai-providers` | `apps/server/src/modules/ai-provider/routes.ts` |
| PATCH | `/admin/ai-providers/:id` | `apps/server/src/modules/ai-provider/routes.ts` |
| POST | `/admin/ai-providers/:id(^[^:]+):test` | `apps/server/src/modules/ai-provider/routes.ts` |
| POST | `/diagrams/:id/assets:initiate` | `apps/server/src/modules/asset/routes.ts` |
| POST | `/diagrams/:id/assets/:assetId(^[^:]+):complete` | `apps/server/src/modules/asset/routes.ts` |
| POST | `/auth/login` | `apps/server/src/modules/auth/routes.ts` |
| POST | `/auth/logout` | `apps/server/src/modules/auth/routes.ts` |
| POST | `/auth/refresh` | `apps/server/src/modules/auth/routes.ts` |
| POST | `/diagrams/:id/ws-ticket` | `apps/server/src/modules/auth/routes.ts` |
| GET | `/auth/oidc/login` | `apps/server/src/modules/auth/routes.ts` |
| GET | `/auth/oidc/callback` | `apps/server/src/modules/auth/routes.ts` |
| POST | `/diagrams/:id/comments` | `apps/server/src/modules/comment/routes.ts` |
| GET | `/diagrams/:id/comments` | `apps/server/src/modules/comment/routes.ts` |
| PATCH | `/diagrams/:id/comments/:commentId` | `apps/server/src/modules/comment/routes.ts` |
| POST | `/diagrams/:id/specs:generate` | `apps/server/src/modules/docgen/routes.ts` |
| GET | `/diagrams/:id/specs` | `apps/server/src/modules/docgen/routes.ts` |
| POST | `/diagrams/:id/specs/:version(^[^:]+):regenerate-section` | `apps/server/src/modules/docgen/routes.ts` |
| POST | `/diagrams/:id/exports` | `apps/server/src/modules/export/routes.ts` |
| POST | `/diagrams/:id/bundle` | `apps/server/src/modules/export/routes.ts` |
| POST | `/projects/:id/import` | `apps/server/src/modules/export/routes.ts` |
| POST | `/workspaces/:id/bundles` | `apps/server/src/modules/export/routes.ts` |
| POST | `/projects/:id/import:format` | `apps/server/src/modules/interop/routes.ts` |
| POST | `/diagrams/:id/export:format` | `apps/server/src/modules/interop/routes.ts` |
| GET | `/libraries` | `apps/server/src/modules/library/routes.ts` |
| GET | `/diagrams/:id/elements/:elementId/metadata` | `apps/server/src/modules/library/routes.ts` |
| PATCH | `/diagrams/:id/elements/:elementId/metadata` | `apps/server/src/modules/library/routes.ts` |
| GET | `/diagrams/:id/inventory` | `apps/server/src/modules/library/routes.ts` |
| GET | `/diagrams/:id/lint` | `apps/server/src/modules/lint/routes.ts` |
| POST | `/presentations/:id(^[^:]+):publish` | `apps/server/src/modules/presentation/publishRoutes.ts` |
| GET | `/presentations/:id/published` | `apps/server/src/modules/presentation/publishRoutes.ts` |
| POST | `/presentations/:id(^[^:]+):export-pdf` | `apps/server/src/modules/presentation/publishRoutes.ts` |
| POST | `/presentations` | `apps/server/src/modules/presentation/routes.ts` |
| GET | `/presentations` | `apps/server/src/modules/presentation/routes.ts` |
| GET | `/presentations/:id` | `apps/server/src/modules/presentation/routes.ts` |
| PATCH | `/presentations/:id` | `apps/server/src/modules/presentation/routes.ts` |
| POST | `/presentations/:id/frames` | `apps/server/src/modules/presentation/routes.ts` |
| PATCH | `/presentations/:id/frames` | `apps/server/src/modules/presentation/routes.ts` |
| PATCH | `/presentations/:id/frames/:frameId` | `apps/server/src/modules/presentation/routes.ts` |
| DELETE | `/presentations/:id/frames/:frameId` | `apps/server/src/modules/presentation/routes.ts` |
| POST | `/diagrams/:id/share-links` | `apps/server/src/modules/share/routes.ts` |
| POST | `/presentations/:id/share-links` | `apps/server/src/modules/share/routes.ts` |
| GET | `/share/:token` | `apps/server/src/modules/share/routes.ts` |
| POST | `/share-links/:id(^[^:]+):revoke` | `apps/server/src/modules/share/routes.ts` |
| POST | `/diagrams/:id/snapshots` | `apps/server/src/modules/snapshot/routes.ts` |
| GET | `/diagrams/:id/snapshots` | `apps/server/src/modules/snapshot/routes.ts` |
| POST | `/diagrams/:id/snapshots/:snapshotId(^[^:]+):restore` | `apps/server/src/modules/snapshot/routes.ts` |
| GET | `/diagrams/:id/diff` | `apps/server/src/modules/snapshot/routes.ts` |
| GET | `/workspaces/:id/webhooks` | `apps/server/src/modules/webhook/routes.ts` |
| POST | `/workspaces/:id/webhooks` | `apps/server/src/modules/webhook/routes.ts` |
| PATCH | `/workspaces/:id/webhooks/:webhookId` | `apps/server/src/modules/webhook/routes.ts` |
| DELETE | `/workspaces/:id/webhooks/:webhookId` | `apps/server/src/modules/webhook/routes.ts` |
| PATCH | `/workspaces/:id/webhooks/:webhookId(^[^:]+):rotate-secret` | `apps/server/src/modules/webhook/routes.ts` |
| GET | `/projects` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| POST | `/projects` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| GET | `/projects/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| PATCH | `/projects/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| DELETE | `/projects/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| GET | `/diagrams` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| POST | `/diagrams` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| GET | `/diagrams/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| PATCH | `/diagrams/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| DELETE | `/diagrams/:id` | `apps/server/src/modules/workspace/project-diagram-routes.ts` |
| GET | `/workspaces` | `apps/server/src/modules/workspace/routes.ts` |
| POST | `/workspaces` | `apps/server/src/modules/workspace/routes.ts` |
| GET | `/workspaces/:id` | `apps/server/src/modules/workspace/routes.ts` |
| PATCH | `/workspaces/:id` | `apps/server/src/modules/workspace/routes.ts` |
| DELETE | `/workspaces/:id` | `apps/server/src/modules/workspace/routes.ts` |
| GET | `/workspaces/:id/members` | `apps/server/src/modules/workspace/routes.ts` |
| POST | `/workspaces/:id/members` | `apps/server/src/modules/workspace/routes.ts` |
| PATCH | `/workspaces/:id/members/:userId` | `apps/server/src/modules/workspace/routes.ts` |
| DELETE | `/workspaces/:id/members/:userId` | `apps/server/src/modules/workspace/routes.ts` |
| GET | `/ws/diagrams/:diagramId` | `apps/server/src/modules/ws-gateway/routes.ts` |

## orphan-consumer (0)

| Endpoint | Chamado em |
| --- | --- |
