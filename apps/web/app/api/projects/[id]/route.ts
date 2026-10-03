import { deleteProject, getProject } from '@/lib/server/projects';
import { json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const p = await getProject((await params).id);
  return p ? json(p) : json({ error: 'not found' }, 404);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return (await deleteProject((await params).id)) ? json({ ok: true }) : json({ error: 'not found' }, 404);
}
