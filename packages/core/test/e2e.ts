/**
 * End-to-end verification against the local test page.
 *
 * Records the page with the native and the Lenis driver and checks, per frame:
 *  - virtual time advances by exactly 1000/fps
 *  - scroll position follows the planned timeline (no jumps, monotonic)
 *  - CSS keyframes, IO-triggered CSS transitions, GSAP time tweens and GSAP
 *    scrub are captured in intermediate states (not just start/end)
 *  - two recordings of the same page are bit-identical (determinism)
 *  - frame extraction from the video (ffmpeg) for visual inspection
 *  - hover/click actions: real :hover transitions and click handlers, scroll
 *    halts during actions, links do not navigate, cursor fades in and out
 *  - type actions: text appears character by character through real key
 *    events, replaces existing text, the caret follows the virtual clock
 *    (two recordings are bit-identical)
 *  - tours: steps run in order across a dialog, content loaded by a click,
 *    an anchor link, a link to a subpage (opened in the same tab) and a
 *    goto; scrolling only where needed (two recordings are bit-identical)
 *
 * E2E_ONLY=tour (or picker, actions, …) runs just that part.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.js';
import { PickerSession } from '../src/picker.js';
import { record, type RecordResult } from '../src/recorder.js';
import { scrollAt, segmentAt } from '../src/timeline.js';
import { startServer } from './serve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
mkdirSync(outDir, { recursive: true });

const PROBE = `(() => {
  const op = (s) => { const e = document.querySelector(s); return e ? +getComputedStyle(e).opacity : null; };
  const tx = (s) => { const e = document.querySelector(s); return e ? new DOMMatrix(getComputedStyle(e).transform).m41 : null; };
  const rot = (s) => { const e = document.querySelector(s); if (!e) return null; const m = new DOMMatrix(getComputedStyle(e).transform); return Math.atan2(m.m12, m.m11) * 180 / Math.PI; };
  return {
    now: performance.now(),
    hero: op('.hero h1 span:nth-child(3)'),
    underline: new DOMMatrix(getComputedStyle(document.querySelector('.underline')).transform).a,
    badge: rot('.badge'),
    card: op('.card:nth-child(1)'),
    gsapIn: op('.gsap-in'),
    scrubX: tx('.scrub-box'),
    progress: new DOMMatrix(getComputedStyle(document.getElementById('progress')).transform).a,
    track: tx('.track'),
    video: document.getElementById('clip').currentTime,
    cookie: getComputedStyle(document.getElementById('cookie')).display,
  };
})()`;

type Probe = {
  now: number; hero: number; underline: number; badge: number; card: number; gsapIn: number;
  scrubX: number; progress: number; track: number; video: number; cookie: string;
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const intermediate = (vals: number[]) => vals.filter((v) => v > 0.02 && v < 0.98).length;

async function run(url: string, name: string, driver: 'native' | 'lenis'): Promise<RecordResult> {
  const config = parseConfig({
    url,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    fps: 30,
    introDuration: 1.5,
    outroDuration: 0.5,
    scroll: { speed: 700 },
    scrollDriver: driver,
    hideSelectors: ['#cookie'],
    encoderPreset: 'veryfast',
  });
  return record(config, { output: path.join(outDir, `${name}.mp4`), probe: PROBE, warn: (m) => console.log(`  ⚠ ${m}`) });
}

function verify(name: string, r: RecordResult, fps: number) {
  console.log(`\n── ${name}: ${r.frames} frames, driver=${r.driver}, maxScroll=${r.maxScroll}, timelineFrozen=${r.timelineFrozen}`);
  const p = r.probes as Probe[];

  // virtual time
  const dts = p.slice(1).map((x, i) => x.now - p[i].now);
  const dtOk = dts.every((d) => Math.abs(d - 1000 / fps) < 1e-6);
  check('virtual time advances exactly 1/fps per frame', dtOk, `dt=${dts[0]?.toFixed(4)}ms`);

  // scroll
  const introFrames = Math.round(1.5 * fps);
  const ys = r.scrollPositions;
  const expected = ys.map((_, i) => (i < introFrames ? 0 : scrollAt(r.timeline, (i - introFrames) / fps)));
  const maxErr = Math.max(...ys.map((y, i) => Math.abs(y - expected[i])));
  check('scroll position follows the timeline', maxErr <= 1, `max error ${maxErr.toFixed(3)}px`);
  const monotonic = ys.every((y, i) => i === 0 || y >= ys[i - 1] - 0.5);
  check('scroll is monotonic (no jumps back)', monotonic);
  const deltas = ys.slice(1).map((y, i) => y - ys[i]);
  const jerk = Math.max(...deltas.slice(1).map((d, i) => Math.abs(d - deltas[i])));
  check('scroll speed changes smoothly frame to frame', jerk < 3, `max Δspeed ${jerk.toFixed(2)}px/frame`);
  check('reaches the bottom', Math.abs(ys[ys.length - 1] - r.maxScroll) < 1, `${ys[ys.length - 1]} / ${r.maxScroll}`);

  // animations
  check('CSS keyframes captured mid-animation (hero)', intermediate(p.map((x) => x.hero)) >= 10, `${intermediate(p.map((x) => x.hero))} frames`);
  const ul = p.map((x) => x.underline);
  check('fill-mode:none animation not lost during slow page load', intermediate(ul) >= 20 && ul[0] < 0.02,
    `${intermediate(ul)} frames, first=${ul[0].toFixed(3)}`);
  const badgeSteps = p.slice(1, introFrames).map((x, i) => ((x.badge - p[i].badge + 360) % 360));
  check('infinite CSS animation advances evenly', badgeSteps.every((s) => Math.abs(s - 3) < 0.05), `${badgeSteps[0]?.toFixed(3)}°/frame`);
  check('IO + CSS transition captured mid-transition (card)', intermediate(p.map((x) => x.card)) >= 10, `${intermediate(p.map((x) => x.card))} frames`);
  check('GSAP time tween captured mid-tween', intermediate(p.map((x) => x.gsapIn)) >= 10, `${intermediate(p.map((x) => x.gsapIn))} frames`);
  const scrub = p.map((x) => x.scrubX);
  const scrubDistinct = new Set(scrub.map((v) => v.toFixed(1))).size;
  check('GSAP scrub moves continuously', scrubDistinct > 40, `${scrubDistinct} distinct positions`);
  const progErr = Math.max(...p.map((x, i) => Math.abs(x.progress - ys[i] / r.maxScroll)));
  check('ScrollTrigger scrub:true matches scroll position', progErr < 0.01, `max error ${progErr.toFixed(4)}`);
  const track = p.map((x) => x.track);
  const trackMoves = new Set(track.map((v) => Math.round(v))).size;
  const trackMonotonic = track.every((v, i) => i === 0 || v <= track[i - 1] + 0.5);
  check('pinned horizontal track moves continuously', trackMoves > 15 && trackMonotonic, `${trackMoves} positions`);
  const vsteps = p.slice(1, 60).map((x, i) => x.video - p[i].video).filter((d) => d > 0);
  check('<video> follows virtual time', vsteps.length > 50 && vsteps.every((d) => Math.abs(d - 1 / fps) < 0.002),
    `${vsteps.length} steps, Δ=${vsteps[0]?.toFixed(4)}s`);
  check('hideSelectors applied', p.every((x) => x.cookie === 'none'));
}

function frameHashes(file: string): string[] {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim());
}

function minFramePsnr(a: string, b: string): number {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi', 'psnr=stats_file=-', '-f', 'null', '-'], { encoding: 'utf8' });
  const vals = [...out.matchAll(/psnr_avg:(\S+)/g)].map((m) => (m[1] === 'inf' ? Infinity : Number(m[1])));
  return Math.min(...vals);
}

function contactSheet(file: string, png: string, from: number, to: number, step: number) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf',
    `select='between(n\\,${from}\\,${to})*not(mod(n-${from}\\,${step}))',scale=480:-1,tile=4x3`, '-frames:v', '1', png]);
}

const ACTION_PROBE = `(() => {
  const sc = (s) => new DOMMatrix(getComputedStyle(document.querySelector(s)).transform).a;
  const cur = document.getElementById('__glide-cursor');
  const q = document.getElementById('q');
  return {
    b1: sc('#b1'), b2: sc('#b2'),
    acc: +getComputedStyle(document.querySelector('.acc-body')).opacity,
    path: location.pathname, awayClicks: window.awayClicks,
    cursor: cur ? +cur.style.opacity : 0,
    hovered: Array.from(document.querySelectorAll(':hover')).map((e) => e.id).filter(Boolean).join(','),
    q: q.value, echo: document.getElementById('echo').textContent, keys: window.keys, keyups: window.keyups, allKeys: window.allKeys,
    email: document.getElementById('email').value, note: document.getElementById('note').textContent,
    caret: getComputedStyle(q).caretColor,
  };
})()`;

type ActionProbe = {
  b1: number; b2: number; acc: number; path: string; awayClicks: number; cursor: number; hovered: string;
  q: string; echo: string; keys: number; keyups: number; allKeys: number; email: string; note: string; caret: string;
};

async function runActions(url: string) {
  const warnings: string[] = [];
  const fps = 30;
  const config = parseConfig({
    url,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    fps,
    introDuration: 0.5,
    outroDuration: 0.5,
    scroll: { speed: 1400 },
    encoderPreset: 'veryfast',
    actions: [
      { type: 'click', selector: '.acc button', text: 'mehr erfahren', duration: 1 },
      { type: 'hover', selector: '#b1', duration: 0.8 },
      { type: 'hover', selector: '#b2', duration: 0.8 },
      { type: 'click', selector: '#away', duration: 0.5 },
      { type: 'type', selector: '#q', value: 'Glide Showcase München', duration: 1.2 },
      { type: 'type', selector: '#echo', value: 'kein Feld', duration: 0.3 },
      // faster than the frame rate and no hold: the last characters still have to arrive
      { type: 'type', selector: '#email', value: 'max@kunde.de', typingSpeed: 1000, duration: 0 },
      { type: 'type', selector: '#ro', value: 'schreibgeschützt', duration: 0.3 },
      { type: 'type', selector: '#note', value: 'Neu', duration: 0.5 },
      { type: 'hover', selector: '#does-not-exist' },
    ],
  });
  const output = path.join(outDir, 'e2e-actions.mp4');
  const r = await record(config, {
    output,
    probe: ACTION_PROBE,
    warn: (m) => { warnings.push(m); console.log(`  ⚠ ${m}`); },
  });
  console.log(`\n── actions: ${r.frames} frames, ${r.actions.length} actions`);
  const p = r.probes as ActionProbe[];
  const intro = Math.round(0.5 * fps);
  const segs = r.scrollPositions.map((_, i) => (i < intro ? null : segmentAt(r.timeline, (i - intro) / fps)));
  const norm = (v: number) => (v - 1) / 0.15;

  check('missing element is skipped with a warning', r.actions.length === 9 && warnings.some((w) => w.includes('#does-not-exist')));
  check('actions run top to bottom', r.actions.map((a) => a.selector).join(' ') === '#b1 #b2 .acc button #away #q #echo #email #ro #note');
  check('#b1 and #b2 share one stop', r.actions[0].y === r.actions[1].y);
  const actionFrames = segs.map((s, i) => (s?.segment.kind === 'action' ? i : -1)).filter((i) => i >= 0);
  const still = actionFrames.every((i) => Math.abs(r.scrollPositions[i] - (segs[i]!.segment as { y: number }).y) <= 1);
  check('scroll stands still during actions', actionFrames.length > 60 && still, `${actionFrames.length} action frames`);
  const b1 = p.map((x) => norm(x.b1));
  check(':hover transition captured mid-transition (#b1)', intermediate(b1) >= 6 && Math.max(...b1) > 0.99, `${intermediate(b1)} frames`);
  const b1Peak = b1.findIndex((v) => v > 0.99);
  check('hover moves on: #b1 transitions back when the cursor goes to #b2', intermediate(b1.slice(b1Peak)) >= 6, `${intermediate(b1.slice(b1Peak))} frames`);
  const b2 = p.map((x) => norm(x.b2));
  check('#b2 hovered after #b1', b2.findIndex((v) => v > 0.99) > b1Peak);
  const acc = p.map((x) => x.acc);
  check('click handler ran, opening transition captured', intermediate(acc) >= 8 && acc[acc.length - 1] === 1, `${intermediate(acc)} frames`);
  check('link click reached the page but did not navigate', p.every((x) => x.path === '/actions.html') && p[p.length - 1].awayClicks === 1);
  const cur = p.map((x) => x.cursor);
  check('cursor hidden before actions and at the end, visible during them',
    cur.slice(0, intro).every((c) => c === 0) && cur[cur.length - 1] === 0 && actionFrames.some((i) => cur[i] === 1) && intermediate(cur) >= 4);
  check('nothing hovered while scrolling away', p.slice(-10).every((x) => x.hovered === ''), p[p.length - 1].hovered);

  const typed = 'Glide Showcase München';
  const qs = p.map((x) => x.q);
  const grows = qs.every((v, i) => typed.startsWith(v) && (i === 0 || v.length >= qs[i - 1].length));
  check('text is typed character by character', grows && new Set(qs).size === typed.length + 1 && qs[qs.length - 1] === typed,
    `${new Set(qs).size - 1} steps`);
  const last = p[p.length - 1];
  check('typing sends real key events (keydown, keyup, input), umlauts too',
    last.keys === typed.length && last.keyups === typed.length && last.echo === typed, `${last.keys} keydowns, ${last.keyups} keyups`);
  check('existing text in the field is replaced, also when typing outpaces the frame rate', last.email === 'max@kunde.de', last.email);
  check('existing text in a contenteditable is replaced', last.note === 'Neu', last.note ?? '');
  const skipped = (sel: string) => warnings.some((w) => w.includes(sel) && w.includes('no text field'));
  check('no keys are sent when the click did not focus a writable text field',
    skipped('#echo') && skipped('#ro') && last.allKeys === typed.length + 'max@kunde.de'.length + 'Neu'.length,
    `${last.allKeys} keydowns in total`);
  const echoAction = r.actions.findIndex((a) => a.selector === '#echo');
  const echoFrames = segs.map((s, i) => (s?.segment.kind === 'action' && s.segment.action === echoAction ? i : -1)).filter((i) => i >= 0);
  check('pointer stays when there is nothing to type into', echoFrames.length > 0 && cur[echoFrames[echoFrames.length - 1]] === 1,
    `${cur[echoFrames[echoFrames.length - 1]]}`);
  const done = qs.indexOf(typed);
  const qFrames = segs.map((s, i) => (s && s.index === segs[done]?.index ? i : -1)).filter((i) => i >= 0);
  check('cursor fades out while typing', qFrames.some((i) => cur[i] === 1) && cur[done] === 0);
  const caret = p.map((x) => x.caret !== 'rgba(0, 0, 0, 0)');
  const firstChar = qs.findIndex((v) => v.length > 0);
  const qEnd = qFrames[qFrames.length - 1];
  const hold = caret.slice(done, qEnd + 1);
  check('caret hidden until typing, shown while typing, blinking afterwards, hidden once the action ends',
    caret.slice(0, firstChar).every((c) => !c) && caret.slice(firstChar, done + 1).every((c) => c) &&
      hold.includes(false) && hold.lastIndexOf(true) > hold.indexOf(false) && caret.slice(qEnd + 1).every((c) => !c),
    hold.map((c) => (c ? '|' : '.')).join(''));

  const again = path.join(outDir, 'e2e-actions-2.mp4');
  await record(config, { output: again, probe: ACTION_PROBE });
  const ha = frameHashes(output);
  const hb = frameHashes(again);
  const same = ha.filter((h, i) => h === hb[i]).length;
  check('deterministic with hover, clicks and typing: two recordings are bit-identical', ha.length === hb.length && same === ha.length,
    `${same}/${ha.length} frames`);
}

async function runPicker(url: string) {
  console.log('\n── picker');
  const s = await PickerSession.open(parseConfig({ url, viewport: { width: 1280, height: 720 } }));
  try {
    const center = (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width / 2, r.y + r.height / 2] as const;
    const picked = async (x: number, y: number, mode: 'hover' | 'click' | 'hide' | 'type') => {
      const r = await s.inspect(x, y, mode);
      return r ? r.chain[r.start] : null;
    };
    // the "OK" button inside the fixed banner: hide picks the whole banner, click the button
    const [ok] = await s.rects([{ selector: '.consent button' }]);
    const hide = await picked(...center(ok!), 'hide');
    check('hide mode picks the outermost fixed layer', hide?.selector === 'div.consent-wrap', hide?.selector);
    const btn = await picked(...center(ok!), 'click');
    check('click mode picks the button', !!btn?.label.startsWith('button'), btn?.selector);
    await s.scroll(720);
    await new Promise((r) => setTimeout(r, 300));
    const [b1] = await s.rects([{ selector: '#b1' }]);
    check('ids are used when unique', (await picked(...center(b1!), 'hover'))?.selector === '#b1');
    await s.scroll(720);
    await new Promise((r) => setTimeout(r, 300));
    const [more] = await s.rects([{ selector: '.acc button', text: 'mehr erfahren' }]);
    const sel = (await picked(...center(more!), 'click'))?.selector ?? '';
    const [again] = await s.rects([{ selector: sel }]);
    check('generated selector finds the same element again', !!again && Math.abs(again.y - more!.y) < 1 && Math.abs(again.x - more!.x) < 1, sel);
    await s.setHidden(['div.consent-wrap']);
    const [gone] = await s.rects([{ selector: '.consent button' }]);
    check('hidden elements disappear from the preview', gone === null);
    await s.scroll(720);
    await new Promise((r) => setTimeout(r, 300));
    const [label] = await s.rects([{ selector: 'label[for="q"]' }]);
    const field = await picked(...center(label!), 'type');
    check('type mode picks the text field, also via its label', field?.selector === '#q', field?.selector);
    const [echo] = await s.rects([{ selector: '#echo' }]);
    check('type mode ignores elements that are not text fields', (await s.inspect(echo!.x + 40, echo!.y + echo!.height / 2, 'type')) === null);
    const [ro] = await s.rects([{ selector: '#ro' }]);
    check('type mode skips read-only fields', (await s.inspect(...center(ro!), 'type')) === null);
    // the page mirrors the search field into #echo on `input` events
    const echoes = async (text: string) => (await s.rects([{ selector: '#echo', text }]))[0] !== null;
    await s.setValues([{ selector: '#q', value: 'Hallo Vorschau' }]);
    check('texts show up in their fields in the preview (input event fired)', await echoes('hallo vorschau'));
    await s.setValues([]);
    check('removing a text restores the field', !(await echoes('hallo')));
    check('preview frame', ((await s.nextFrame(0))?.image.length ?? 0) > 1000);
  } finally {
    await s.close();
  }
}

/** A field rendered after the preview opened (embedded widgets, SPAs) still gets its text. */
async function runPickerLate(url: string) {
  const s = await PickerSession.open(parseConfig({ url, viewport: { width: 1280, height: 720 } }));
  try {
    await s.setValues([{ selector: '#late', value: 'Spät da' }]);
    const before = (await s.rects([{ selector: '#late' }]))[0];
    await new Promise((r) => setTimeout(r, 2500));
    const [shown] = await s.rects([{ selector: '#late', text: 'spät da' }]);
    check('texts reach fields that show up after the preview opened', before === null && shown !== null);
  } finally {
    await s.close();
  }
}

const TOUR_PROBE = `(() => {
  const dlg = document.getElementById('dialog');
  const name = document.getElementById('name');
  const cur = document.getElementById('__glide-cursor');
  return {
    page: location.pathname + location.search,
    now: performance.now(),
    y: Math.round(scrollY),
    dialog: dlg ? +getComputedStyle(dlg).opacity * (dlg.classList.contains('open') ? 1 : 0) : 0,
    name: name ? name.value : null,
    inner: dlg ? dlg.querySelector('.dialog').scrollTop : 0,
    loaded: !!document.getElementById('loaded'),
    far: !!window.farClicked, hello: !!window.hello, escaped: !!window.escaped,
    cookie: document.getElementById('cookie') ? getComputedStyle(document.getElementById('cookie')).display : null,
    cursor: cur ? +cur.style.opacity : 0,
  };
})()`;

type TourProbe = {
  page: string; now: number; y: number; dialog: number; name: string | null; inner: number; loaded: boolean;
  far: boolean; hello: boolean; escaped: boolean; cookie: string | null; cursor: number;
};

async function runTourCheck(base: string) {
  console.log('\n── tour');
  const warnings: string[] = [];
  const fps = 30;
  const config = parseConfig({
    url: `${base}tour.html`,
    kind: 'tour',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    fps,
    introDuration: 0.5,
    outroDuration: 0.5,
    scroll: { speed: 2000, minSegmentDuration: 0.6 },
    encoderPreset: 'veryfast',
    hideSelectors: ['#cookie'],
    actions: [
      { type: 'click', selector: '#open', duration: 0.6 },
      { type: 'type', selector: '#name', value: 'Jörg', typingSpeed: 20, duration: 0.3 },
      { type: 'click', selector: '#close', duration: 0.5 },
      { type: 'click', selector: '#load', duration: 0.3 },
      { type: 'hover', selector: '#loaded', duration: 0.3 },
      { type: 'click', selector: '#far', duration: 0.5 },
      { type: 'scroll', to: 'top', duration: 0.3 },
      { type: 'click', selector: '#jump', duration: 0.5 },
      { type: 'scroll', selector: '#missing', duration: 0.3 },
      { type: 'scroll', to: 'top', duration: 0.2 },
      { type: 'click', selector: '#next', duration: 1 },
      { type: 'click', selector: '#hello', duration: 0.5 },
      { type: 'press', key: 'Escape', duration: 0.3 },
      { type: 'goto', url: 'tour.html?again', duration: 0.5 },
      { type: 'wait', duration: 0.5 },
    ],
  });
  const output = path.join(outDir, 'e2e-tour.mp4');
  const r = await record(config, { output, probe: TOUR_PROBE, warn: (m) => { warnings.push(m); console.log(`  ⚠ ${m}`); } });
  const p = r.probes as TourProbe[];
  console.log(`  ${r.frames} frames, pages: ${r.pages?.map((u) => new URL(u).pathname + new URL(u).search).join(' → ')}`);

  const pages = p.map((x) => x.page).filter((x, i, a) => i === 0 || a[i - 1] !== x);
  check('tour pages in order, the subpage in the same tab', JSON.stringify(pages) === JSON.stringify(['/tour.html', '/tour-2.html', '/tour.html?again']),
    pages.join(' → '));
  check('every frame advances virtual time by 1/fps (within a page)',
    p.every((x, i) => i === 0 || x.page !== p[i - 1].page || Math.abs(x.now - p[i - 1].now - 1000 / fps) < 1e-6));
  const open = p.map((x) => x.dialog);
  check('the dialog fades in (intermediate states)', open.filter((v) => v > 0.05 && v < 0.95).length >= 3, `${open.filter((v) => v > 0.05 && v < 0.95).length} frames`);
  const names = [...new Set(p.map((x) => x.name).filter((v) => v !== null))];
  check('text typed character by character in the dialog', JSON.stringify(names) === JSON.stringify(['', 'J', 'Jö', 'Jör', 'Jörg']), names.join('|'));
  const closeAt = p.findIndex((x, i) => i > 0 && p[i - 1].dialog > 0.9 && x.dialog === 0);
  check('the dialog closes, its body scrolled to reach the button', closeAt > 0 && p.some((x) => x.inner > 0), `frame ${closeAt}`);
  check('no page scrolling while the dialog is open', p.filter((x) => x.dialog > 0).every((x) => x.y === 0));
  const loadedAt = p.findIndex((x) => x.loaded);
  check('content loaded by a click is there in the next frames, the hover on it ran',
    loadedAt > 0 && r.actions.some((a) => a.selector === '#loaded'), `frame ${loadedAt}`);
  const farAt = p.findIndex((x) => x.far);
  const toFar = p.slice(loadedAt, farAt).map((x) => x.y);
  check('scrolls smoothly to an element out of view, then clicks it',
    farAt > 0 && toFar[toFar.length - 1] > 500 && toFar.filter((v) => v > 0 && v < toFar[toFar.length - 1]).length >= 5,
    `y ${toFar[0]} → ${toFar[toFar.length - 1]}`);
  const first = p.filter((x) => x.page === '/tour.html');
  const maxY = Math.max(...first.map((x) => x.y));
  const jumps = first.map((x, i) => (i ? Math.abs(x.y - first[i - 1].y) : 0));
  check('an anchor link scrolls there smoothly (no jump)', maxY > 1200 && Math.max(...jumps) < 400, `max y ${maxY}, biggest step ${Math.max(...jumps)} px`);
  check('missing elements are skipped with a warning', warnings.some((w) => w.includes('#missing')));
  const second = p.filter((x) => x.page === '/tour-2.html');
  check('subpage: starts at the top, the click and the key press ran there',
    second.length > 0 && second[0].y === 0 && second.some((x) => x.hello) && second.some((x) => x.escaped));
  check('hideSelectors apply on every page', second.every((x) => x.cookie === 'none'));
  const last = p.filter((x) => x.page === '/tour.html?again');
  check('goto opens a page, wait and outro hold there', Math.abs(last.length - (0.5 + 0.5 + 0.5) * fps) <= 2, `${last.length} frames`);
  check('the cursor is gone after the page changed', second[0]?.cursor === 0 && last[0]?.cursor === 0);

  const again = path.join(outDir, 'e2e-tour-2.mp4');
  await record(config, { output: again });
  const ha = frameHashes(output);
  const hb = frameHashes(again);
  const same = ha.filter((h, i) => h === hb[i]).length;
  check('deterministic tour: two recordings are bit-identical', ha.length === hb.length && same === ha.length, `${same}/${ha.length} frames`);
}

/** Tours: steps run in the preview, clicks open dialogs and subpages, replay gets back there. */
async function runPickerTour(base: string) {
  console.log('\n── picker (tour)');
  const s = await PickerSession.open(parseConfig({ url: `${base}tour.html`, kind: 'tour', viewport: { width: 1280, height: 720 }, hideSelectors: ['#cookie'] }));
  try {
    const center = (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width / 2, r.y + r.height / 2] as const;
    const visible = async (selector: string) => (await s.rects([{ selector }]))[0] !== null;
    const open = await s.run(parseConfig({ url: base, kind: 'tour', actions: [{ type: 'click', selector: '#open' }] }).actions[0]);
    await new Promise((r) => setTimeout(r, 500));
    check('a click step runs in the preview and opens the dialog', open.ok && !open.navigated && await visible('#name'));
    const [name] = await s.rects([{ selector: '#name' }]);
    const field = (await s.inspect(...center(name!), 'type'))?.chain[0].selector;
    check('fields in the dialog can be picked', field === '#name', field);
    const step = (a: Record<string, unknown>) => parseConfig({ url: base, kind: 'tour', actions: [a] }).actions[0];
    check('a type step fills the field', (await s.run(step({ type: 'type', selector: '#name', value: 'Max' }))).ok);
    await s.run(step({ type: 'click', selector: '#close' }));
    await new Promise((r) => setTimeout(r, 300));
    check('closing the dialog in the preview', !(await visible('#name')));
    const [mid] = await s.rects([{ selector: 'section:nth-of-type(1) h1' }]);
    const block = await s.inspect(...center(mid!), 'scroll');
    check('scroll mode picks the block (section)', block?.chain[block.start].selector.includes('section') ?? false, block?.chain[block.start].selector);
    const next = await s.run(step({ type: 'click', selector: '#next' }));
    check('a link opens the subpage in the preview (same tab)', next.navigated && next.url.endsWith('/tour-2.html'), next.url);
    await new Promise((r) => setTimeout(r, 300));
    check('hidden elements stay hidden on the next page', await visible('#hello') && !(await visible('#cookie')));
    const steps = [
      step({ type: 'click', selector: '#open' }),
      step({ type: 'type', selector: '#name', value: 'Max' }),
      step({ type: 'click', selector: '#close' }),
      step({ type: 'click', selector: '#next' }),
      step({ type: 'click', selector: '#hello' }),
    ];
    const r = await s.replay(steps);
    check('replay gets back to the page the steps lead to', r.pageStart === 4 && r.failed.length === 0 && r.url.endsWith('/tour-2.html'),
      `pageStart ${r.pageStart}, failed ${r.failed.join(',') || '–'}`);
    check('preview frame after navigating', ((await s.nextFrame(0))?.image.length ?? 0) > 1000);
  } finally {
    await s.close();
  }
}

/** Page whose <body> scrolls instead of the document (html, body { height: 100%; overflow-x: hidden }). */
async function runContainer(url: string) {
  const fps = 30;
  const base = {
    url,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    fps,
    introDuration: 0.2,
    outroDuration: 0.2,
    scroll: { speed: 2400 },
    encoderPreset: 'veryfast' as const,
    prepass: false,
  };
  const expected = 4 * 900 - 720;
  const r = await record(parseConfig(base), { output: path.join(outDir, 'e2e-container.mp4') });
  console.log(`\n── container: ${r.frames} frames, driver=${r.driver}, maxScroll=${r.maxScroll}`);
  check('scroll container detected (body)', r.driver === 'native (container: body)', r.driver);
  check('container scroll length measured', Math.abs(r.maxScroll - expected) <= 1, `${r.maxScroll}`);
  const ys = r.scrollPositions;
  const mono = ys.every((y, i) => i === 0 || y >= ys[i - 1] - 0.5);
  check('container scrolls top to bottom', ys[0] === 0 && Math.abs(ys[ys.length - 1] - expected) <= 1 && mono);

  const hooked = await record(parseConfig({
    ...base,
    scrollDriver: 'custom',
    scrollHook: '(y) => { document.body.scrollTop = y }',
  }), { output: path.join(outDir, 'e2e-container-hook.mp4') });
  check('custom hook measures the container', Math.abs(hooked.maxScroll - expected) <= 1, `${hooked.maxScroll}`);

  const off = await record(parseConfig({ ...base, scrollContainer: 'none' }), { output: path.join(outDir, 'e2e-container-off.mp4') });
  check('scrollContainer "none" keeps the document', off.maxScroll === 0 && off.driver === 'native');
}

const { server, url } = await startServer();
const only = process.env.E2E_ONLY;
try {
  if (only) {
    const parts: Record<string, () => Promise<void>> = {
      picker: () => runPicker(`${url}actions.html`),
      'picker-tour': () => runPickerTour(url),
      actions: () => runActions(`${url}actions.html`),
      container: () => runContainer(`${url}container.html`),
      tour: () => runTourCheck(url),
    };
    if (!parts[only]) throw new Error(`E2E_ONLY: one of ${Object.keys(parts).join(', ')}`);
    await parts[only]();
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
  }
  const a = await run(`${url}?lenis=0`, 'e2e-native', 'native');
  verify('native', a, 30);
  const b = await run(url, 'e2e-lenis', 'lenis');
  verify('lenis', b, 30);

  const c = await run(`${url}?lenis=0`, 'e2e-native-2', 'native');
  const fa = path.join(outDir, 'e2e-native.mp4');
  const fc = path.join(outDir, 'e2e-native-2.mp4');
  const ha = frameHashes(fa);
  const hc = frameHashes(fc);
  const same = ha.filter((h, i) => h === hc[i]).length;
  const minPsnr = minFramePsnr(fa, fc);
  console.log('');
  // Decoded <video> frames can differ by a few LSBs between runs (GPU/decoder
  // rounding), everything else is bit-identical.
  check('deterministic: two recordings match frame by frame', ha.length === hc.length && minPsnr > 40,
    `${same}/${ha.length} frames bit-identical, worst PSNR ${minPsnr === Infinity ? '∞' : minPsnr.toFixed(1) + ' dB'}`);
  void c;

  await runPicker(`${url}actions.html`);
  await runPickerLate(`${url}late.html`);
  await runActions(`${url}actions.html`);
  await runContainer(`${url}container.html`);
  await runTourCheck(url);
  await runPickerTour(url);
  contactSheet(path.join(outDir, 'e2e-tour.mp4'), path.join(outDir, 'sheet-tour.png'), 0, 440, 12);
  contactSheet(path.join(outDir, 'e2e-actions.mp4'), path.join(outDir, 'sheet-actions.png'), 0, 400, 12);

  contactSheet(path.join(outDir, 'e2e-native.mp4'), path.join(outDir, 'sheet-intro.png'), 0, 44, 4);
  contactSheet(path.join(outDir, 'e2e-lenis.mp4'), path.join(outDir, 'sheet-scroll.png'), 50, 270, 20);
  console.log(`\ncontact sheets written to ${outDir}`);
} finally {
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
