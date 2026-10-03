import type { PickMode } from '@glide/core';
import { picker } from '@/lib/server/picker';
import { errorResponse, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Op =
  | { op: 'inspect'; x: number; y: number; mode: PickMode }
  | { op: 'scroll'; dy: number; x?: number; y?: number }
  | { op: 'hide'; selectors: string[] }
  | { op: 'rects'; targets: { selector: string; text?: string }[] };

const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const o = (await req.json()) as Op;
    const res = await picker.use(id, async (s) => {
      switch (o.op) {
        case 'inspect':
          if (!finite(o.x, o.y)) throw new Error('x/y fehlen');
          return { result: await s.inspect(o.x, o.y, o.mode === 'hide' || o.mode === 'click' ? o.mode : 'hover') };
        case 'scroll':
          if (!finite(o.dy)) throw new Error('dy fehlt');
          await s.scroll(Math.max(-5000, Math.min(5000, o.dy)), finite(o.x) ? o.x : undefined, finite(o.y) ? o.y : undefined);
          return { ok: true };
        case 'hide':
          await s.setHidden((o.selectors ?? []).filter((x) => typeof x === 'string'));
          return { ok: true };
        case 'rects':
          return { rects: await s.rects((o.targets ?? []).filter((t) => t && typeof t.selector === 'string')) };
        default:
          throw new Error('unbekannte Aktion');
      }
    });
    if (res === null) return json({ error: 'Vorschau ist nicht mehr geöffnet' }, 404);
    return json(res);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await picker.close((await params).id);
  return new Response(null, { status: 204 });
}
