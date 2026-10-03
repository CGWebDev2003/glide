import { jobs } from '@/lib/server/jobs';
import { json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = await jobs.get((await params).id);
  return job ? json(job) : json({ error: 'not found' }, 404);
}

/** Cancels a queued/running job, or deletes a finished one (incl. video). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await jobs.get(id);
  if (!job) return json({ error: 'not found' }, 404);
  const ok = job.status === 'queued' || job.status === 'running' ? await jobs.cancel(id) : await jobs.remove(id);
  return ok ? json({ ok: true }) : json({ error: 'nicht möglich' }, 409);
}
