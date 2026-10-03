import { jobs } from '@/lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = jobs.preview((await params).id);
  if (!p) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(p.image), { headers: { 'content-type': p.mime, 'cache-control': 'no-store' } });
}
