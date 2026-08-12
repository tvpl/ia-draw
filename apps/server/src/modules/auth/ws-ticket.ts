import { diagrams, projects, workspaceMembers, wsTickets } from '@arch-canvas/database';
import type { Role } from '@arch-canvas/auth';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './db.js';
import { generateOpaqueToken, hashToken } from './tokens.js';

export interface DiagramMembership {
  workspaceId: string;
  role: Role;
}

/**
 * Resolves whether `userId` belongs to the workspace that owns `diagramId`,
 * joining diagram -> project -> workspace_members. Returns `null` when the
 * diagram doesn't exist OR the user has no membership row for its
 * workspace — the two cases are indistinguishable by design (IDOR, T18).
 */
export async function resolveDiagramMembership(
  db: Db,
  diagramId: string,
  userId: string,
): Promise<DiagramMembership | null> {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId, role: workspaceMembers.role })
    .from(diagrams)
    .innerJoin(projects, eq(diagrams.projectId, projects.id))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(diagrams.id, diagramId));

  return row ?? null;
}

/** Single-use WebSocket handshake ticket TTL (design.md Tech Decisions: "Token de uso único TTL 30 s"). */
export const WS_TICKET_TTL_MS = 30_000;

export interface WsTicketIssue {
  ticket: string;
  expiresAt: Date;
}

export interface WsTicketClaim {
  userId: string;
  diagramId: string;
}

/** Issues a 30s single-use ticket for `userId` to open a WebSocket session on `diagramId`. */
export async function issueWsTicket(db: Db, userId: string, diagramId: string): Promise<WsTicketIssue> {
  const ticket = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + WS_TICKET_TTL_MS);
  await db.insert(wsTickets).values({
    tokenHash: hashToken(ticket),
    userId,
    diagramId,
    expiresAt,
  });
  return { ticket, expiresAt };
}

/**
 * Consumes `ticket` atomically: a single `UPDATE ... WHERE used_at IS NULL
 * AND expires_at > now() RETURNING` marks it used, so two concurrent
 * consume attempts for the same ticket can never both succeed (T15) and an
 * expired ticket is never marked used (and never consumable) either.
 */
export async function consumeWsTicket(db: Db, ticket: string): Promise<WsTicketClaim | null> {
  const tokenHash = hashToken(ticket);
  const [row] = await db
    .update(wsTickets)
    .set({ usedAt: new Date() })
    .where(and(eq(wsTickets.tokenHash, tokenHash), isNull(wsTickets.usedAt), gt(wsTickets.expiresAt, new Date())))
    .returning({ userId: wsTickets.userId, diagramId: wsTickets.diagramId });

  return row ?? null;
}
