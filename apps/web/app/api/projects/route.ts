import { listProjects, saveProject } from '@/lib/server/projects';
import { errorResponse, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json(await listProjects());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; name?: string; config?: Record<string, unknown> };
    if (!body.name?.trim()) return json({ error: 'Name fehlt' }, 400);
    if (!body.config || typeof body.config !== 'object') return json({ error: 'config fehlt' }, 400);
    return json(await saveProject({ id: body.id, name: body.name.trim(), config: body.config }), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
