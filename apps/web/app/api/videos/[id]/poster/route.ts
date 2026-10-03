import { readFile } from 'node:fs/promises';
import { jobs } from '@/lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = await jobs.get((await params).id);
  const file = job && job.status === 'done' ? jobs.videoPath(job) : null;
  if (!file) return new Response('not found', { status: 404 });
  try {
    const img = await readFile(`${file}.jpg`);
    return new Response(new Uint8Array(img), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' },
    });
  } catch {
    return new Response('no poster', { status: 404 });
  }
}
