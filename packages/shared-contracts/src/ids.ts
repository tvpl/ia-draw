import { z } from 'zod';

export const uuidSchema = z.uuid();

export const workspaceIdSchema = uuidSchema.brand<'WorkspaceId'>();
export const projectIdSchema = uuidSchema.brand<'ProjectId'>();
export const diagramIdSchema = uuidSchema.brand<'DiagramId'>();
export const userIdSchema = uuidSchema.brand<'UserId'>();

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type DiagramId = z.infer<typeof diagramIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
