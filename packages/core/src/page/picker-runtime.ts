/**
 * In-page helpers for the element picker (preview before recording).
 * Injected via `addInitScript` as a string, so it must be self-contained.
 *
 * `inspect(x, y, mode)` returns the element under a viewport point, plus its
 * ancestors (so the UI can step to a larger element), each with a stable,
 * unique CSS selector:
 *  - ids, test/data attributes and aria-labels are preferred when unique and
 *    not auto-generated
 *  - otherwise tag + up to two meaningful classes (no hashes, no state classes
 *    like "active"/"is-open"), with :nth-of-type where siblings look the same
 *  - the shortest of `leaf`, `anchor leaf` and the full `a > b > c` path that
 *    is unique wins
 */
export function installPickerRuntime(opts?: { tour?: boolean }): void {
  const w = window as any;
  if (w.__glidePick) return;

  // tours follow links in this tab, like the recording does (page/runtime.ts)
  if (opts && opts.tour) {
    window.addEventListener('click', (e) => {
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (link && link.target && link.target !== '_self') link.target = '_self';
    }, true);
    window.addEventListener('submit', (e) => {
      const form = e.target as HTMLFormElement | null;
      if (form?.target && form.target !== '_self') form.target = '_self';
    }, true);
    w.open = (url?: string | URL) => {
      if (url) location.assign(new URL(String(url), location.href).href);
      return null;
    };
  }

  const esc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));
  const count = (sel: string) => {
    try { return document.querySelectorAll(sel).length; } catch { return 0; }
  };
  const unique = (sel: string, el: Element) => {
    try { return count(sel) === 1 && document.querySelector(sel) === el; } catch { return false; }
  };
  const generated = (s: string) =>
    /\d{3,}|[0-9a-f]{6,}|^(css|sc|jsx|emotion|svelte|astro|tw)-|^_|__[\w]{5,}$|:|^ember|^react|^radix|^headlessui|^mui|^rc-/i.test(s) ||
    s.length > 40;
  const stateClass = (c: string) =>
    /^(is-|has-|js-)|^(active|hover|focus|focused|open|opened|closed|visible|hidden|show|shown|selected|current|in|animated|aos-.*|lenis.*|swiper-slide-(active|next|prev).*)$/i.test(c);
  const ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-id', 'data-section', 'data-glide-section', 'name', 'aria-label', 'title', 'alt'];
  const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  /** a selector step for one element; `anchor` = unique on its own */
  const step = (el: Element): { sel: string; anchor: boolean } => {
    const tag = el.localName;
    if (el.id && !generated(el.id)) {
      const s = `#${esc(el.id)}`;
      if (unique(s, el)) return { sel: s, anchor: true };
    }
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || v.length > 60) continue;
      const s = `${tag}[${a}=${quote(v)}]`;
      if (unique(s, el)) return { sel: s, anchor: true };
    }
    const classes = Array.from(el.classList).filter((c) => !generated(c) && !stateClass(c)).slice(0, 2);
    let s = tag + classes.map((c) => `.${esc(c)}`).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === tag);
      const alike = Array.from(parent.children).filter((c) => { try { return c.matches(s); } catch { return false; } });
      if (alike.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { sel: s, anchor: false };
  };

  const selectorFor = (el: Element): string => {
    const steps: string[] = [];
    let anchor: string | null = null;
    for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const st = step(cur);
      steps.unshift(st.sel);
      if (cur === el && unique(st.sel, el)) return st.sel;
      if (st.anchor) { anchor = st.sel; break; }
      if (unique(steps.join(' > '), el)) break;
      if (cur === document.body) break;
    }
    const leaf = steps[steps.length - 1];
    if (anchor) {
      const short = `${anchor} ${leaf}`;
      if (steps.length > 2 && unique(short, el)) return short;
    }
    return steps.join(' > ');
  };

  const label = (el: Element) => {
    const text = (el.getAttribute('aria-label') || el.getAttribute('alt') || (el as HTMLElement).innerText || '')
      .trim().replace(/\s+/g, ' ');
    const cls = Array.from(el.classList).filter((c) => !generated(c)).slice(0, 1).map((c) => `.${c}`).join('');
    return `${el.localName}${el.id && !generated(el.id) ? `#${el.id}` : cls}${text ? ` „${text.length > 40 ? `${text.slice(0, 38)}…` : text}“` : ''}`;
  };

  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="link"], input, select, textarea, summary, label, [onclick], [tabindex]';
  // writable text fields; same rules as in page/runtime.ts
  const TEXT_INPUTS = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
  const isTextField = (el: Element | null | undefined): el is HTMLElement =>
    ((el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUTS.includes(el.type))) && !el.readOnly && !el.disabled) ||
    (el instanceof HTMLElement && el.isContentEditable);
  /** the text field at an element: itself, the field it is part of, or the one its label is for */
  const textField = (el: Element): HTMLElement | null => {
    const control = el.closest('label')?.control;
    if (isTextField(control)) return control;
    const field = el.closest('input, textarea, [contenteditable]');
    return isTextField(field) ? field : null;
  };

  /** first visible match of an action target (optionally containing `text`) */
  const find = (selector: string, text?: string): HTMLElement | null => {
    let els: HTMLElement[] = [];
    try { els = Array.from(document.querySelectorAll<HTMLElement>(selector)); } catch { return null; }
    const needle = text ? text.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (needle && !(e.textContent || '').toLowerCase().replace(/\s+/g, ' ').includes(needle)) continue;
      return e;
    }
    return null;
  };

  const read = (el: HTMLElement) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent || '');
  const write = (el: HTMLElement, v: string) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // the prototype's setter, so frameworks that track `value` (React …) notice the change
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
    } else el.textContent = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** fields showing a text from a type action: their original content and the text written */
  const filled = new Map<HTMLElement, { original: string; value: string }>();

  let hideStyle: HTMLStyleElement | null = null;

  w.__glidePick = {
    inspect(x: number, y: number, mode: 'hover' | 'click' | 'hide' | 'type' | 'scroll') {
      let el = document.elementFromPoint(x, y);
      if (!el || el === document.documentElement || el === document.body) return null;
      if (mode === 'type') {
        // only text fields can be typed into
        const field = textField(el);
        return field ? { start: 0, chain: [{ selector: selectorFor(field), label: label(field), rect: rect(field) }] } : null;
      }
      // svg internals are not useful targets
      const svg = el.closest('svg');
      if (svg && svg.parentElement) el = svg.parentElement === document.body ? svg : svg.parentElement;
      let start = el;
      if (mode === 'hide') {
        // cookie banners, chat widgets: the outermost fixed/sticky layer
        for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
          const pos = getComputedStyle(cur).position;
          if (pos === 'fixed' || pos === 'sticky') start = cur;
        }
      } else if (mode === 'scroll') {
        // scroll stops: the block the element belongs to (a section, a card with an id …)
        const block = el.closest('section, header, footer, article, main > *, [id]');
        if (block && block !== document.body && block !== document.documentElement) start = block;
      } else {
        const hit = el.closest(INTERACTIVE);
        if (hit && hit !== document.body) start = hit;
      }
      // innermost hit first, ancestors after it; `start` is the suggested one
      const chain: Element[] = [];
      for (let cur: Element | null = el; cur && cur !== document.body && chain.length < 12; cur = cur.parentElement) chain.push(cur);
      let idx = chain.indexOf(start);
      if (idx < 0) { chain.push(start); idx = chain.length - 1; }
      return { start: idx, chain: chain.map((e) => ({ selector: selectorFor(e), label: label(e), rect: rect(e) })) };
    },
    /** viewport rects of action targets (first visible match, optional text) */
    rects(targets: { selector: string; text?: string }[]) {
      return targets.map(({ selector, text }) => {
        const e = find(selector, text);
        return e ? rect(e) : null;
      });
    },
    /**
     * Shows the texts of type actions in their fields; fields no longer listed
     * get their content back. Each text is written once (the page may reformat
     * it, e.g. an input mask), so this can run again for fields that show up later.
     */
    setValues(values: { selector: string; text?: string; value: string }[]) {
      const want = new Map<HTMLElement, string>();
      for (const { selector, text, value } of values) {
        const el = find(selector, text);
        if (isTextField(el)) want.set(el, value);
      }
      for (const [el, f] of filled) {
        if (want.has(el)) continue;
        filled.delete(el);
        write(el, f.original);
      }
      for (const [el, value] of want) {
        const f = filled.get(el);
        if (f?.value === value) continue;
        filled.set(el, { original: f ? f.original : read(el), value });
        write(el, value);
      }
    },
    /** Tours: writes a step's text into its field for good (replaying steps). */
    fill(selector: string, text: string | undefined, value: string) {
      const el = find(selector, text);
      if (!isTextField(el)) return false;
      el.focus();
      write(el, value);
      return true;
    },
    /** Tours: viewport centre of a step's element, scrolled into view first (null = not there). */
    reveal(selector: string, text?: string) {
      const el = find(selector, text);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    setHidden(selectors: string[]) {
      if (!hideStyle || !hideStyle.isConnected) {
        hideStyle = document.createElement('style');
        document.documentElement.appendChild(hideStyle);
      }
      // one rule per selector: an invalid selector must not void the others
      hideStyle.textContent = selectors.map((s) => `${s} { display: none !important; visibility: hidden !important; }`).join('\n');
    },
    selectorFor,
  };
}
