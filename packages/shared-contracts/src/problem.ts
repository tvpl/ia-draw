import { z } from 'zod';

/** RFC 9457 problem details media type. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string().min(1),
  status: z.int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export function problem(
  status: number,
  title: string,
  extra: Partial<Omit<ProblemDetails, 'status' | 'title'>> = {},
): ProblemDetails {
  return problemDetailsSchema.parse({ status, title, ...extra });
}
