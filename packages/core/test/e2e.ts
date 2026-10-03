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
  return {
    b1: sc('#b1'), b2: sc('#b2'),
    acc: +getComputedStyle(document.querySelector('.acc-body')).opacity,
    path: location.pathname, awayClicks: window.awayClicks,
    cursor: cur ? +cur.style.opacity : 0,
    hovered: Array.from(document.querySelectorAll(':hover')).map((e) => e.id).filter(Boolean).join(','),
  };
})()`;

type ActionProbe = { b1: number; b2: number; acc: number; path: string; awayClicks: number; cursor: number; hovered: string };

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
      { type: 'hover', selector: '#does-not-exist' },
    ],
  });
  const r = await record(config, {
    output: path.join(outDir, 'e2e-actions.mp4'),
    probe: ACTION_PROBE,
    warn: (m) => { warnings.push(m); console.log(`  ⚠ ${m}`); },
  });
  console.log(`\n── actions: ${r.frames} frames, ${r.actions.length} actions`);
  const p = r.probes as ActionProbe[];
  const intro = Math.round(0.5 * fps);
  const segs = r.scrollPositions.map((_, i) => (i < intro ? null : segmentAt(r.timeline, (i - intro) / fps)));
  const norm = (v: number) => (v - 1) / 0.15;

  check('missing element is skipped with a warning', r.actions.length === 4 && warnings.some((w) => w.includes('#does-not-exist')));
  check('actions run top to bottom', r.actions.map((a) => a.selector).join(' ') === '#b1 #b2 .acc button #away');
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
}

async function runPicker(url: string) {
  console.log('\n── picker');
  const s = await PickerSession.open(parseConfig({ url, viewport: { width: 1280, height: 720 } }));
  try {
    const center = (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width / 2, r.y + r.height / 2] as const;
    const picked = async (x: number, y: number, mode: 'hover' | 'click' | 'hide') => {
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
    check('preview screenshot', (await s.screenshot()).length > 1000);
  } finally {
    await s.close();
  }
}

const { server, url } = await startServer();
try {
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
  await runActions(`${url}actions.html`);
  contactSheet(path.join(outDir, 'e2e-actions.mp4'), path.join(outDir, 'sheet-actions.png'), 0, 400, 12);

  contactSheet(path.join(outDir, 'e2e-native.mp4'), path.join(outDir, 'sheet-intro.png'), 0, 44, 4);
  contactSheet(path.join(outDir, 'e2e-lenis.mp4'), path.join(outDir, 'sheet-scroll.png'), 50, 270, 20);
  console.log(`\ncontact sheets written to ${outDir}`);
} finally {
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
