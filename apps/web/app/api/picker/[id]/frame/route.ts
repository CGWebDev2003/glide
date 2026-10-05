import { picker } from '@/lib/server/picker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Long poll for the next preview frame: answers as soon as the page shows
 * something newer than `?after=<seq>` (204 if nothing changed for a while).
 * The marks of the action targets for this frame come in `x-frame-rects`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = picker.get((await params).id);
    if (!session) return new Response(null, { status: 404 });
    const after = Number(new URL(req.url).searchParams.get('after')) || 0;
    const frame = await session.nextFrame(after);
    if (!frame) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return new Response(new Uint8Array(frame.image), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'x-frame-seq': String(frame.seq),
        'x-frame-rects': JSON.stringify(frame.rects),
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
