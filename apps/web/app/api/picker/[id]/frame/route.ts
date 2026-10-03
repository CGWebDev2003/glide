import { picker } from '@/lib/server/picker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Current screenshot of the preview (the client asks for the next one when this one is shown). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const image = await picker.use((await params).id, (s) => s.screenshot());
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  } catch {
    return new Response(null, { status: 502 });
  }
}
