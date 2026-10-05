'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeUrl, toConfig, type FormAction, type FormState } from '@/lib/form';

type Mode = 'hover' | 'click' | 'hide';
type Rect = { x: number; y: number; width: number; height: number };
type Candidate = { selector: string; label: string; rect: Rect };
type Inspect = { start: number; chain: Candidate[] };
type Session = { id: string; width: number; height: number };
/** a decoded preview frame and the action target rects measured for it */
type Frame = { url: string; marks: (Rect | null)[] };
/** the last pick, so it can be widened/narrowed to a parent/child element or undone */
type LastPick = { kind: 'action' | 'hide'; selector: string; chain: Candidate[]; level: number };

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'hover', label: 'Hover', hint: 'Maus drüber' },
  { value: 'click', label: 'Klick', hint: 'anklicken' },
  { value: 'hide', label: 'Ausblenden', hint: 'nicht im Video' },
];

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Live preview of the page (screenshots from a server-side browser with the
 * recording's viewport). Pointing at an element highlights it, clicking adds
 * it as hover/click action or to the hidden elements.
 */
export function Picker({ form, setForm, onClose }: { form: FormState; setForm: (f: FormState) => void; onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [mode, setMode] = useState<Mode>('hover');
  const [hover, setHover] = useState<Inspect | null>(null);
  const [last, setLast] = useState<LastPick | null>(null);
  const [scale, setScale] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const scrolling = useRef(false);
  const pendingScroll = useRef(0);
  const inspecting = useRef(false);
  /** last mouse position over the preview (page pixels), inspected again after a scroll */
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const call = useCallback(async (body: object) => {
    if (!session) return null;
    const res = await fetch(`/api/picker/${session.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }, [session]);

  // open the session
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const f = formRef.current;
        const config = toConfig({ ...f, url: normalizeUrl(f.url) });
        const res = await fetch('/api/picker', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        id = data.id;
        if (cancelled) void fetch(`/api/picker/${data.id}`, { method: 'DELETE' });
        else setSession(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (id) void fetch(`/api/picker/${id}`, { method: 'DELETE', keepalive: true });
    };
  }, []);

  // frame loop: long-poll for the next frame; the server answers as soon as the page changed
  useEffect(() => {
    if (!session) return;
    let stop = false;
    let url: string | null = null;
    (async () => {
      let seq = 0;
      while (!stop) {
        try {
          const res = await fetch(`/api/picker/${session.id}/frame?after=${seq}`, { cache: 'no-store' });
          if (res.status === 404) { setError('Die Vorschau wurde geschlossen (zu lange inaktiv). Bitte neu öffnen.'); return; }
          if (res.status !== 200) {
            if (res.status !== 204) await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          seq = Number(res.headers.get('x-frame-seq')) || seq + 1;
          let marks: (Rect | null)[] = [];
          try { marks = JSON.parse(res.headers.get('x-frame-rects') ?? '[]'); } catch { /* keep none */ }
          const next = URL.createObjectURL(await res.blob());
          // decode before swapping, so the <img> never shows a half-loaded frame
          const img = new Image();
          img.src = next;
          await img.decode().catch(() => {});
          if (stop) { URL.revokeObjectURL(next); return; }
          setFrame({ url: next, marks });
          if (url) URL.revokeObjectURL(url);
          url = next;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();
    return () => {
      stop = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session]);

  // the server measures the chosen actions with every frame (numbered boxes)
  const targetsKey = JSON.stringify(form.actions.filter((a) => a.selector.trim()).map((a) => ({ selector: a.selector, text: a.text || undefined })));
  useEffect(() => {
    if (!session) return;
    void call({ op: 'targets', targets: JSON.parse(targetsKey) }).catch(() => {});
  }, [session, call, targetsKey]);

  // scale between preview pixels and page pixels
  useEffect(() => {
    const el = stage.current;
    if (!el || !session) return;
    const update = () => setScale(el.clientWidth / session.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const inspect = async (x: number, y: number) => {
    const data = await call({ op: 'inspect', x, y, mode });
    return (data?.result ?? null) as Inspect | null;
  };

  /** highlights the element under the mouse; moves during a request are merged into one follow-up */
  const hoverAt = async (p: { x: number; y: number }) => {
    pointer.current = p;
    if (inspecting.current) return;
    inspecting.current = true;
    try {
      let at: { x: number; y: number } | null;
      do {
        at = pointer.current;
        if (!at) break;
        const r = await inspect(at.x, at.y);
        if (pointer.current) setHover(r);
      } while (pointer.current && pointer.current !== at);
    } catch { /* ignore */ }
    inspecting.current = false;
  };

  /** sends the wheel/drag deltas collected meanwhile in one request */
  const flushScroll = async () => {
    if (scrolling.current || !pendingScroll.current) return;
    scrolling.current = true;
    setHover(null);
    try {
      while (pendingScroll.current) {
        const dy = pendingScroll.current;
        pendingScroll.current = 0;
        // at the mouse position, so the page keeps its hover state and inner scroll areas scroll
        const at = pointer.current;
        try { await call({ op: 'scroll', dy, ...at }); } catch { /* ignore */ }
      }
    } finally {
      scrolling.current = false;
    }
    // the element under the mouse changed
    if (pointer.current) void hoverAt(pointer.current);
  };

  // wheel must be non-passive to keep the app from scrolling
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pendingScroll.current += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      void flushScroll();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const setHidden = (selectors: string[]) => {
    setForm({ ...formRef.current, hideSelectors: selectors.join('\n') });
    void call({ op: 'hide', selectors }).catch(() => {});
  };

  const pick = (r: Inspect, level = r.start) => {
    const c = r.chain[level];
    const f = formRef.current;
    if (mode === 'hide') {
      const hidden = lines(f.hideSelectors);
      if (!hidden.includes(c.selector)) setHidden([...hidden, c.selector]);
      setLast({ kind: 'hide', selector: c.selector, chain: r.chain, level });
    } else {
      const action: FormAction = { type: mode, selector: c.selector, text: '', duration: mode === 'click' ? 2 : 1.5, extra: {} };
      setForm({ ...f, actions: [...f.actions, action] });
      setLast({ kind: 'action', selector: c.selector, chain: r.chain, level });
    }
    setHover(null);
  };

  /** replaces the last pick with its parent (+1) or child (-1) */
  const adjust = (delta: number) => {
    if (!last) return;
    const level = Math.min(last.chain.length - 1, Math.max(0, last.level + delta));
    const selector = last.chain[level].selector;
    const f = formRef.current;
    if (last.kind === 'hide') {
      setHidden(lines(f.hideSelectors).map((s) => (s === last.selector ? selector : s)));
    } else {
      const i = f.actions.map((a) => a.selector).lastIndexOf(last.selector);
      if (i >= 0) setForm({ ...f, actions: f.actions.map((a, j) => (j === i ? { ...a, selector } : a)) });
    }
    setLast({ ...last, level, selector });
  };

  const undo = () => {
    if (!last) return;
    const f = formRef.current;
    if (last.kind === 'hide') setHidden(lines(f.hideSelectors).filter((s) => s !== last.selector));
    else {
      const i = f.actions.map((a) => a.selector).lastIndexOf(last.selector);
      if (i >= 0) setForm({ ...f, actions: f.actions.filter((_, j) => j !== i) });
    }
    setLast(null);
  };

  // pointer: mouse = hover to highlight, click to pick; touch = drag to scroll, tap to pick
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && d.id === e.pointerId && e.pointerType !== 'mouse') {
      const dy = d.y - e.clientY;
      d.moved += Math.abs(dy) + Math.abs(d.x - e.clientX);
      d.x = e.clientX;
      d.y = e.clientY;
      pendingScroll.current += dy / scale;
      void flushScroll();
      return;
    }
    if (e.pointerType !== 'mouse' || scrolling.current) {
      if (e.pointerType === 'mouse') pointer.current = toPage(e);
      return;
    }
    void hoverAt(toPage(e));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 8 || e.button > 0) return;
    const p = toPage(e);
    try {
      const r = await inspect(p.x, p.y);
      if (r) pick(r);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const box = (r: Rect) => ({
    left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale,
  });
  const hoverCandidate = hover ? hover.chain[hover.start] : null;
  const hidden = lines(form.hideSelectors);

  return (
    <div className="modal picker" role="dialog" aria-modal="true" aria-label="Elemente auswählen">
      <div className="picker-body">
        <div className="picker-bar">
          <div className="segmented" role="radiogroup" aria-label="Modus">
            {MODES.map((m) => (
              <button type="button" role="radio" aria-checked={mode === m.value} key={m.value}
                className={mode === m.value ? 'on' : ''} onClick={() => { setMode(m.value); setHover(null); }}>
                <strong>{m.label}</strong>
                <small>{m.hint}</small>
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" onClick={onClose}>Fertig</button>
        </div>

        <div className="picker-main">
          <div className="picker-stage-wrap">
            {!session && !error && <p className="muted picker-loading">Seite wird geladen…</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {session && (
              <div
                ref={stage}
                className={`picker-stage mode-${mode}`}
                style={{ aspectRatio: `${session.width} / ${session.height}`, width: `min(100%, calc((100dvh - 190px) * ${session.width / session.height}))` }}
                onPointerMove={onPointerMove}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerLeave={() => { pointer.current = null; if (!drag.current) setHover(null); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {frame && <img src={frame.url} alt="Vorschau der Seite" draggable={false} decoding="sync" />}
                {frame?.marks.map((r, i) => r && (
                  <div key={i} className="picker-mark" style={box(r)}><span>{i + 1}</span></div>
                ))}
                {hoverCandidate && (
                  <div className={`picker-hl ${hoverCandidate.rect.y * scale < 26 ? 'below' : ''}`} style={box(hoverCandidate.rect)}>
                    <span>{hoverCandidate.label}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="picker-side">
            <p className="hint">
              {mode === 'hide'
                ? 'Klicke auf Banner, Chat-Widgets o. Ä. Sie verschwinden sofort aus der Vorschau und fehlen im Video.'
                : 'Zeige auf ein Element und klicke es an. Scrollen mit Mausrad oder Wischen.'}
            </p>
            {last && (
              <div className="picker-last">
                <span className="small muted">Zuletzt gewählt</span>
                <strong>{last.chain[last.level].label}</strong>
                <code>{last.selector}</code>
                <div className="row-buttons">
                  <button type="button" className="btn ghost small" disabled={last.level >= last.chain.length - 1} onClick={() => adjust(1)}>↑ Größer</button>
                  <button type="button" className="btn ghost small" disabled={last.level <= 0} onClick={() => adjust(-1)}>↓ Kleiner</button>
                  <button type="button" className="btn ghost small danger" onClick={undo}>Rückgängig</button>
                </div>
              </div>
            )}
            <div>
              <h3>Hover &amp; Klicks</h3>
              {form.actions.length === 0 && <p className="small muted">Noch keine.</p>}
              <ol className="picker-list">
                {form.actions.map((a, i) => (
                  <li key={i}>
                    <span className="picker-num">{i + 1}</span>
                    <span>{a.type === 'click' ? 'Klick' : 'Hover'}</span>
                    <code title={a.selector}>{a.selector || '–'}</code>
                    <button type="button" className="btn ghost small danger" aria-label="Entfernen"
                      onClick={() => setForm({ ...form, actions: form.actions.filter((_, j) => j !== i) })}>✕</button>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>Ausgeblendet</h3>
              {hidden.length === 0 && <p className="small muted">Nichts.</p>}
              <ul className="picker-list">
                {hidden.map((s) => (
                  <li key={s}>
                    <code title={s}>{s}</code>
                    <button type="button" className="btn ghost small danger" aria-label="Wieder einblenden"
                      onClick={() => setHidden(hidden.filter((h) => h !== s))}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
