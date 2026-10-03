import { jobs } from '@/lib/server/jobs';
import { errorResponse, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json(await jobs.list());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { config?: Record<string, unknown>; name?: string; projectId?: string };
    if (!body.config || typeof body.config !== 'object') return json({ error: 'config fehlt' }, 400);
    const job = await jobs.enqueue({ config: body.config, name: body.name, projectId: body.projectId });
    return json(job, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
