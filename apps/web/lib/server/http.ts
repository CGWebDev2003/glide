import 'server-only';

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export function errorResponse(e: unknown): Response {
  if (e instanceof Error && e.name === 'ConfigError') return json({ error: e.message }, 400);
  if (e instanceof SyntaxError) return json({ error: 'Ungültiges JSON' }, 400);
  return json({ error: e instanceof Error ? e.message : String(e) }, 500);
}
