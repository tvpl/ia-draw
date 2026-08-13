import { randomUUID } from 'node:crypto';
import { can } from '@arch-canvas/auth';
import { parseOperationEnvelope } from '@arch-canvas/diagram-domain';
import {
  MAX_WS_MESSAGE_BYTES,
  parseWsMessage,
  WS_PROTOCOL_VERSION,
  type WsMessage,
  WsMessageParseError,
} from '@arch-canvas/shared-contracts';
import websocketPlugin from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { MetricsRegistry } from '../../core/metrics.js';
import { assertDeltaAssetsReady } from '../asset/index.js';
import type { Db } from '../auth/db.js';
import { consumeWsTicket } from '../auth/ws-ticket.js';
import { appendOperation } from '../diagram-sync/operations.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';
import type { JobQueue } from '../jobs/index.js';
import { type CompactionThresholds, enqueueCompaction, shouldCompact } from '../snapshot/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import {
  NullPresenceBroadcaster,
  type PresenceBroadcaster,
  type PresenceEvent,
} from './presence.js';
import './types.js';

export interface WsGatewayModuleDeps {
  db: Db;
  /** Same optional job-queue degrade already established by diagram-sync (VER-01) — omitted keeps automatic compaction inactive. */
  jobs?: JobQueue;
  compactionThresholds?: CompactionThresholds;
  /** Injectable so tests/production can swap in `InMemoryPresenceBroadcaster`/`RedisPresenceBroadcaster` (T74) — defaults to a no-op stub so this module works standalone before either exists. */
  presence?: PresenceBroadcaster;
  /** OBS-01 (T91) — observes the `mutation` case's ACK latency into the SAME histogram diagram-sync's `operations:batch` route observes into (labeled `transport: 'ws'` here). Optional, same degrade as every other observability seam in this codebase. */
  metrics?: MetricsRegistry;
}

/** RFC 6455 reserves 4000-4999 for private/application use. */
export const WS_CLOSE_PAYLOAD_TOO_LARGE = 4413;
export const WS_CLOSE_FORBIDDEN = 4403;

const wsParamsSchema = z.object({ diagramId: z.string().min(1) });
const wsQuerySchema = z.object({ ticket: z.string().min(1) });

function unauthorized(): never {
  throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}

function buildEnvelope(diagramId: string, type: string, payload: unknown) {
  return {
    protocolVersion: WS_PROTOCOL_VERSION,
    diagramId,
    messageId: randomUUID(),
    sentAt: new Date().toISOString(),
    type,
    payload,
  };
}

function send(socket: WebSocket, diagramId: string, type: string, payload: unknown): void {
  socket.send(JSON.stringify(buildEnvelope(diagramId, type, payload)));
}

/**
 * Consumes the single-use WS ticket (F1a, `consumeWsTicket`) as a
 * `preValidation` hook — this hook runs BEFORE the WS upgrade completes
 * (`@fastify/websocket`'s documented hook ordering: onRequest/preParsing/
 * preValidation/preHandler all run pre-upgrade), so an invalid/expired/
 * already-used ticket, or one minted for a different `diagramId`, never
 * reaches a WS upgrade at all: the client receives a plain HTTP 401 and the
 * connection is never opened, let alone sent a `hello`.
 */
function requireWsTicket(db: Db) {
  return async function requireWsTicketPreValidation(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const { diagramId } = wsParamsSchema.parse(request.params);
    const { ticket } = wsQuerySchema.parse(request.query);

    const claim = await consumeWsTicket(db, ticket);
    if (!claim || claim.diagramId !== diagramId) unauthorized();

    request.wsTicketClaim = claim;
  };
}

/**
 * Registers the ws-gateway module (T73, CLB-01/02) — `wss /ws/diagrams/:diagramId?ticket=`.
 * WebSocket is a SECOND TRANSPORT for the exact write path REST already
 * uses: `mutation` delegates to `appendOperation` (same function
 * `diagram-sync`'s `operations:batch` route calls) after the same RBAC
 * check (`resolveDiagramWorkspaceId`/`resolveWorkspaceRole`/`can`),
 * re-resolved fresh on every single message — never cached from connection
 * time, so a mid-session role downgrade (AUTH-05) rejects the very next
 * `mutation` without requiring a reconnect.
 */
export async function registerWsGatewayModule(
  app: FastifyInstance,
  deps: WsGatewayModuleDeps,
): Promise<void> {
  const { db, jobs, compactionThresholds, metrics } = deps;
  const presence = deps.presence ?? new NullPresenceBroadcaster();

  await app.register(websocketPlugin, {
    options: {
      // Generous headroom above the protocol's own 256 KB message limit
      // (enforced explicitly below via `parseWsMessage`, T72) — this is
      // only a defense-in-depth backstop against unbounded frame buffering,
      // never the primary size gate (that gate needs to run with a
      // specific, testable close code, not `ws`'s own default 1009
      // behavior at a much larger default threshold).
      maxPayload: MAX_WS_MESSAGE_BYTES * 4,
    },
  });

  app.get(
    '/ws/diagrams/:diagramId',
    { websocket: true, preValidation: requireWsTicket(db) },
    (socket, request) => {
      const claim = request.wsTicketClaim;
      // Defensive only — requireWsTicket always populates this before the
      // upgrade completes; a missing claim here would mean the upgrade
      // happened without going through preValidation at all.
      if (!claim) {
        socket.close(WS_CLOSE_FORBIDDEN, 'unauthorized');
        return;
      }

      const { diagramId, userId: actorId } = claim;

      send(socket, diagramId, 'hello', { userId: actorId, diagramId });

      // RFC 6455 readyState 1 == OPEN — checked as a plain number rather than
      // pulling in a value import of `ws`'s `WebSocket` class (this module only
      // needs the type) just for its `OPEN` constant.
      const WS_READY_STATE_OPEN = 1;

      // Relays another connection's `presence` broadcast (T73/T74's
      // `presence.publish`, possibly arriving from a DIFFERENT `apps/server`
      // process over Redis — T75) back out to THIS socket as an ordinary
      // `presence` wire message, so every other client watching the same
      // `diagramId` sees cursor/selection/status updates live. Never echoes
      // the sender's own event back to itself. `mutation_broadcast` events
      // are intentionally NOT relayed over the wire here — no CLB-01/02 AC in
      // this wave requires live mutation fan-out (reconnect + `sync_request`,
      // T76, is the documented convergence path), and inventing a new wire
      // message type for it would mean touching T72's schema, out of scope
      // for this task.
      const handlePresenceEvent = (event: PresenceEvent): void => {
        if (event.type !== 'presence_update') return;
        if (event.senderId === actorId) return;
        if (socket.readyState !== WS_READY_STATE_OPEN) return;
        send(socket, diagramId, 'presence', {
          cursor: event.cursor,
          selection: event.selection,
          status: event.status,
        });
      };
      const unsubscribePresence = presence.subscribe(diagramId, handlePresenceEvent);
      socket.on('close', () => {
        unsubscribePresence();
      });

      // Message handler is attached synchronously here (before any async
      // work below runs) per @fastify/websocket's own guidance, so no
      // message sent immediately after connecting can be silently dropped.
      socket.on('message', (raw: Buffer) => {
        void handleMessage(raw);
      });

      async function handleMessage(raw: Buffer): Promise<void> {
        let message: WsMessage;
        try {
          message = parseWsMessage(raw);
        } catch (error) {
          if (error instanceof WsMessageParseError && error.code === 'payload_too_large') {
            socket.close(WS_CLOSE_PAYLOAD_TOO_LARGE, 'payload too large');
            return;
          }
          // Any other malformed frame (bad JSON, unknown type, invalid
          // payload shape) is dropped silently rather than tearing down an
          // otherwise-healthy connection — mirrors REST's per-request (not
          // per-connection) error scoping.
          return;
        }

        switch (message.type) {
          case 'sync_request': {
            const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
            if (!workspaceId) {
              socket.close(WS_CLOSE_FORBIDDEN, 'diagram not found');
              return;
            }
            const role = await resolveWorkspaceRole(db, workspaceId, actorId);
            if (!role) {
              socket.close(WS_CLOSE_FORBIDDEN, 'diagram not found');
              return;
            }
            const decision = can({ role }, 'diagram:read', { workspaceId });
            if (!decision.allowed) {
              socket.close(WS_CLOSE_FORBIDDEN, 'forbidden');
              return;
            }

            const { scene, revision } = await loadDiagramScene(db, diagramId);
            send(socket, diagramId, 'sync_state', { scene, revision });
            return;
          }

          case 'mutation': {
            // Fresh RBAC resolution on EVERY mutation message — never cached
            // from connection time (AUTH-05: a mid-session role downgrade
            // must reject the very next mutation without a reconnect).
            const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
            const role = workspaceId ? await resolveWorkspaceRole(db, workspaceId, actorId) : null;
            const decision =
              role && workspaceId ? can({ role }, 'diagram:mutate', { workspaceId }) : null;

            if (!workspaceId || !role || !decision?.allowed) {
              send(socket, diagramId, 'mutation_rejected', {
                clientMutationId: message.payload.clientMutationId,
                reason: 'forbidden',
              });
              return;
            }

            let envelope: ReturnType<typeof parseOperationEnvelope>;
            try {
              envelope = parseOperationEnvelope({
                clientMutationId: message.payload.clientMutationId,
                baseRevision: message.payload.baseRevision,
                // Never trust an actorId from the wire — the WS mutation
                // payload schema (T72) doesn't even carry one; the
                // ticket-authenticated actor is the only source of truth,
                // exactly like REST's
                // `appendOperation(db, diagramId, user.id, envelope)` call.
                actorId,
                deltas: message.payload.deltas,
              });
            } catch (error) {
              send(socket, diagramId, 'mutation_rejected', {
                clientMutationId: message.payload.clientMutationId,
                reason: error instanceof Error ? error.message : 'invalid mutation',
              });
              return;
            }

            try {
              await assertDeltaAssetsReady(db, workspaceId, envelope.deltas);
            } catch (error) {
              send(socket, diagramId, 'mutation_rejected', {
                clientMutationId: message.payload.clientMutationId,
                reason: error instanceof Error ? error.message : 'asset not ready',
              });
              return;
            }

            // The SAME write path REST's `operations:batch` route uses —
            // zero LWW/validation logic duplicated here. OBS-01 (T91):
            // ACK latency for this WS transport — the counterpart
            // observation in diagram-sync's `operations:batch` route uses
            // the exact same histogram with `transport: 'rest'`.
            const ackStartedAt = process.hrtime.bigint();
            const result = await appendOperation(db, diagramId, actorId, envelope);
            metrics?.observeMutationAck('ws', Number(process.hrtime.bigint() - ackStartedAt) / 1e9);
            const ack = result.acks[0];
            if (ack) {
              send(socket, diagramId, 'mutation_ack', {
                clientMutationId: ack.clientMutationId,
                sequence: ack.sequence,
              });
            }

            try {
              await presence.publish(diagramId, {
                type: 'mutation_broadcast',
                clientMutationId: envelope.clientMutationId,
                actorId,
                deltas: envelope.deltas,
                sequence: ack?.sequence,
              });
            } catch (error) {
              // Presence is best-effort (AD-009) — a broadcast failure never
              // undoes the already-committed, already-ACKed mutation.
              request.log.warn(
                { err: error },
                'ws-gateway: presence.publish failed after mutation',
              );
            }

            if (jobs && (await shouldCompact(db, diagramId, compactionThresholds))) {
              await enqueueCompaction(jobs, diagramId);
            }
            return;
          }

          case 'presence': {
            try {
              await presence.publish(diagramId, {
                type: 'presence_update',
                senderId: actorId,
                cursor: message.payload.cursor,
                selection: message.payload.selection,
                status: message.payload.status,
              });
            } catch (error) {
              request.log.warn({ err: error }, 'ws-gateway: presence.publish failed');
            }
            return;
          }

          case 'ping': {
            send(socket, diagramId, 'pong', {});
            return;
          }

          default:
            // Every other message type (`hello`, `sync_state`, `mutation_ack`,
            // `mutation_rejected`, `comment_event`, `permission_changed`,
            // `server_draining`, `pong`) is server-to-client only in this
            // wave — a client sending one is ignored rather than closing the
            // connection over a harmless protocol misuse.
            return;
        }
      }
    },
  );
}
