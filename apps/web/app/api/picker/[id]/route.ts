import type { PickMode, PickValue } from '@glide/core';
import { picker } from '@/lib/server/picker';
import { errorResponse, json } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Op =
  | { op: 'inspect'; x: number; y: number; mode: PickMode }
  | { op: 'scroll'; dy: number; x?: number; y?: number }
  | { op: 'hide'; selectors: string[] }
  | { op: 'targets'; targets: { selector: string; text?: string }[] }
  | { op: 'values'; values: PickValue[] }
  /** tours: run one step in the preview / open the start page and run all steps */
  | { op: 'run'; step: Record<string, unknown> }
  | { op: 'replay'; steps: Record<string, unknown>[] };

const MODES: PickMode[] = ['hover', 'click', 'type', 'hide', 'scroll'];
const finite = (...n: unknown[]) => n.every((v) => typeof v === 'number' && Number.isFinite(v));

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const o = (await req.json()) as Op;
    // checked before queueing, so a bad step can't hold up the session
    const steps = o.op === 'run' ? await picker.steps([o.step]) : o.op === 'replay' ? await picker.steps(Array.isArray(o.steps) ? o.steps : []) : [];
    const res = await picker.use(id, async (s) => {
      switch (o.op) {
        case 'inspect':
          if (!finite(o.x, o.y)) throw new Error('x/y fehlen');
          return { result: await s.inspect(o.x, o.y, MODES.includes(o.mode) ? o.mode : 'hover') };
        case 'scroll':
          if (!finite(o.dy)) throw new Error('dy fehlt');
          await s.scroll(Math.max(-5000, Math.min(5000, o.dy)), finite(o.x) ? o.x : undefined, finite(o.y) ? o.y : undefined);
          return { ok: true };
        case 'hide':
          await s.setHidden((o.selectors ?? []).filter((x) => typeof x === 'string'));
          return { ok: true };
        case 'targets':
          await s.setTargets((o.targets ?? []).filter((t) => t && typeof t.selector === 'string'));
          return { ok: true };
        case 'values':
          await s.setValues((o.values ?? []).filter((v) => v && typeof v.selector === 'string' && typeof v.value === 'string'));
          return { ok: true };
        case 'run':
          return { result: await s.run(steps[0]) };
        case 'replay':
          return { result: await s.replay(steps) };
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
