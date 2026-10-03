#!/usr/bin/env node
import { writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import {
  ConfigError,
  defaultOutputName,
  EASING_NAMES,
  FfmpegError,
  loadConfigFile,
  parseConfig,
  record,
  resolveOutputSize,
  resolveViewport,
  type Progress,
} from '@glide/core';

const program = new Command();
program
  .name('glide')
  .description('Record websites as perfectly smooth scroll videos (deterministic, frame by frame).')
  .version('0.2.0');

const num = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};

program
  .command('record')
  .description('record a video from a config file and/or CLI flags')
  .argument('[config]', 'path to a glide JSON config')
  .option('-u, --url <url>', 'page URL (overrides config)')
  .option('-o, --out <file>', 'output file (.mp4 or .webm)')
  .addOption(new Option('-p, --preset <name>', 'viewport preset').choices(['desktop', 'laptop', 'mobile']))
  .option('--viewport <WxH>', 'custom viewport, e.g. 1280x800')
  .option('--dsf <n>', 'deviceScaleFactor', num)
  .option('--fps <n>', 'frames per second', num)
  .addOption(new Option('--format <fmt>', 'output format').choices(['mp4', 'webm']))
  .addOption(new Option('--mode <mode>', 'scroll mode').choices(['continuous', 'sections']))
  .option('--speed <px>', 'scroll speed in px/s', num)
  .option('--duration <s>', 'scroll duration in seconds (overrides speed)', num)
  .addOption(new Option('--easing <name>', 'easing').choices(EASING_NAMES))
  .option('--pause <s>', 'sections mode: pause at each section in seconds', num)
  .option('--intro <s>', 'seconds at the top before scrolling', num)
  .option('--outro <s>', 'seconds at the bottom at the end', num)
  .addOption(new Option('--driver <driver>', 'scroll driver').choices(['auto', 'native', 'lenis', 'custom']))
  .option('--hide <selector...>', 'CSS selectors to hide (cookie banners, chat widgets)')
  .option('--hover <selector...>', 'elements to hover (scrolling stops at each)')
  .option('--click <selector...>', 'elements to click (scrolling stops at each)')
  .addOption(new Option('--cursor <style>', 'visible cursor during actions').choices(['auto', 'arrow', 'touch', 'none']))
  .option('--no-prepass', 'skip the lazy-loading pre-pass')
  .option('--max-duration <s>', 'safety cap for the video length', num)
  .addOption(new Option('--browser <name>', 'browser (chrome/msedge play H.264 videos)').choices(['chromium', 'chrome', 'msedge']))
  .option('--headful', 'show the browser window')
  .option('--debug-frames <dir>', 'also save every 30th frame as an image into <dir>')
  .option('-q, --quiet', 'no progress output')
  .action(async (configPath: string | undefined, o: Record<string, any>) => {
    let raw: Record<string, any> = {};
    let baseDir = process.cwd();
    if (configPath) {
      const loaded = await loadConfigFile(configPath);
      raw = loaded.raw;
      baseDir = loaded.dir;
    }
    if (o.url) raw.url = o.url;
    if (!raw.url) throw new ConfigError('No URL given. Use a config file with "url" or --url https://...');
    if (o.preset) raw.viewport = o.preset;
    if (o.viewport) {
      const m = /^(\d+)x(\d+)$/.exec(o.viewport);
      if (!m) throw new ConfigError(`--viewport must look like 1280x800, got "${o.viewport}"`);
      raw.viewport = { width: Number(m[1]), height: Number(m[2]) };
    }
    if (o.dsf !== undefined) raw.deviceScaleFactor = o.dsf;
    if (o.fps !== undefined) raw.fps = o.fps;
    if (o.format) raw.format = o.format;
    if (o.out && !o.format && /\.webm$/i.test(o.out)) raw.format = 'webm';
    const scroll: Record<string, unknown> = { ...(raw.scroll ?? {}) };
    if (o.mode) scroll.mode = o.mode;
    if (o.speed !== undefined) scroll.speed = o.speed;
    if (o.duration !== undefined) scroll.duration = o.duration;
    if (o.easing) scroll.easing = o.easing;
    if (o.pause !== undefined) scroll.pauseDuration = o.pause;
    raw.scroll = scroll;
    if (o.intro !== undefined) raw.introDuration = o.intro;
    if (o.outro !== undefined) raw.outroDuration = o.outro;
    if (o.driver) raw.scrollDriver = o.driver;
    if (o.hide) raw.hideSelectors = [...(raw.hideSelectors ?? []), ...o.hide];
    if (o.hover || o.click) {
      raw.actions = [
        ...(raw.actions ?? []),
        ...(o.hover ?? []).map((selector: string) => ({ type: 'hover', selector })),
        ...(o.click ?? []).map((selector: string) => ({ type: 'click', selector })),
      ];
    }
    if (o.cursor) raw.cursor = { ...(raw.cursor ?? {}), style: o.cursor };
    if (o.prepass === false) raw.prepass = false;
    if (o.maxDuration !== undefined) raw.maxDuration = o.maxDuration;
    if (o.headful) raw.headful = true;
    if (o.browser) raw.browser = o.browser;

    const config = parseConfig(raw, configPath ?? 'options');
    const output = path.resolve(
      o.out ? process.cwd() : baseDir,
      o.out ?? config.output ?? defaultOutputName(config),
    );

    const vp = resolveViewport(config);
    const size = resolveOutputSize(config);
    const quiet = !!o.quiet;
    const info = (m: string) => { if (!quiet) process.stderr.write(`${m}\n`); };
    info(`glide → ${path.relative(process.cwd(), output) || output}`);
    info(`  viewport ${vp.width}×${vp.height} @${config.deviceScaleFactor}x, video ${size.width}×${size.height}, ${config.fps} fps, ${config.format}`);

    const progress = createProgress(quiet);
    const ac = new AbortController();
    process.once('SIGINT', () => {
      progress.clear();
      process.stderr.write('\n  aborting…\n');
      ac.abort();
    });
    const res = await record(config, {
      output,
      signal: ac.signal,
      log: (m) => { progress.clear(); info(`  ${m}`); },
      warn: (m) => { progress.clear(); process.stderr.write(`  ⚠ ${m}\n`); },
      onProgress: progress.update,
      debugFramesDir: o.debugFrames ? path.resolve(o.debugFrames) : undefined,
    });
    progress.done();
    info(
      `✔ ${res.frames} frames, ${res.duration.toFixed(2)} s video, rendered in ${(res.renderMs / 1000).toFixed(1)} s` +
        ` (${((res.frames / res.renderMs) * 1000).toFixed(1)} frames/s)`,
    );
    info(`  ${output}`);
  });

program
  .command('init')
  .description('write an example config file')
  .argument('[file]', 'target file', 'glide.json')
  .option('-u, --url <url>', 'page URL', 'https://example.com')
  .action(async (file: string, o: { url: string }) => {
    const exists = await access(file).then(() => true, () => false);
    if (exists) throw new ConfigError(`${file} already exists`);
    const example = {
      url: o.url,
      output: 'showcase-desktop.mp4',
      viewport: 'desktop',
      deviceScaleFactor: 2,
      fps: 60,
      format: 'mp4',
      scroll: { mode: 'continuous', speed: 600, easing: 'easeInOutCubic' },
      introDuration: 2.5,
      outroDuration: 1.5,
      scrollDriver: 'auto',
      hideSelectors: ['#cookie-banner', '.chat-widget'],
      maxDuration: 90,
    };
    await writeFile(file, `${JSON.stringify(example, null, 2)}\n`);
    process.stderr.write(`wrote ${file}\n`);
  });

function createProgress(quiet: boolean) {
  const tty = process.stderr.isTTY;
  let lastLen = 0;
  let lastPct = -1;
  return {
    update(p: Progress) {
      if (quiet) return;
      const pct = Math.floor((p.frame / p.total) * 100);
      const rate = p.frame / Math.max(0.001, p.elapsedMs / 1000);
      const eta = (p.total - p.frame) / Math.max(0.01, rate);
      const line =
        `  Frame ${p.frame}/${p.total} (${pct}%) ${bar(p.frame / p.total)} ` +
        `${rate.toFixed(1)} f/s, ETA ${fmt(eta)} [${p.phase}]`;
      if (tty) {
        process.stderr.write(`\r${line.padEnd(lastLen)}`);
        lastLen = line.length;
      } else if (pct >= lastPct + 10 || p.frame === p.total) {
        process.stderr.write(`${line}\n`);
        lastPct = pct;
      }
    },
    clear() {
      if (tty && lastLen) {
        process.stderr.write(`\r${' '.repeat(lastLen)}\r`);
        lastLen = 0;
      }
    },
    done() {
      if (tty && lastLen) process.stderr.write('\n');
      lastLen = 0;
    },
  };
}

const bar = (f: number, w = 24) => {
  const n = Math.round(Math.min(1, f) * w);
  return `[${'█'.repeat(n)}${'·'.repeat(w - n)}]`;
};
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);

program.parseAsync().catch((e: unknown) => {
  if (e instanceof Error && e.name === 'RecordAbortedError') {
    process.stderr.write('\n✖ aborted, no video written\n');
  } else if (e instanceof ConfigError || e instanceof FfmpegError) {
    process.stderr.write(`\n✖ ${e.message}\n`);
  } else if (e instanceof Error && /Executable doesn't exist|browserType.launch/.test(e.message)) {
    process.stderr.write(`\n✖ Chromium for Playwright is missing. Run: npx playwright install chromium\n\n${e.message}\n`);
  } else {
    process.stderr.write(`\n✖ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  }
  process.exit(1);
});
