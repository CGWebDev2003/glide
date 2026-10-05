// Builds the web app as a self-contained Next.js server and assembles it in
// apps/desktop/bundle/server, which the desktop app starts on launch (and which
// electron-builder ships as an extra resource).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const desktopDir = path.resolve(import.meta.dirname, '..');
const rootDir = path.resolve(desktopDir, '../..');
const webDir = path.join(rootDir, 'apps/web');
const coreDir = path.join(rootDir, 'packages/core');
// Nested in bundle/ because electron-builder drops a node_modules folder at the
// root of an extraResources source.
const outDir = path.join(desktopDir, 'bundle/server');

function run(args, cwd) {
  const res = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GLIDE_STANDALONE: '1' },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run(['run', 'build:core'], rootDir);
run(['run', 'build', '-w', '@glide/web'], rootDir);

const standalone = path.join(webDir, '.next/standalone');
if (!existsSync(path.join(standalone, 'apps/web/server.js'))) {
  console.error('Next.js standalone build not found (.next/standalone/apps/web/server.js).');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
const copy = (from, to) => cpSync(from, to, { recursive: true, dereference: true });

copy(standalone, outDir);
copy(path.join(webDir, '.next/static'), path.join(outDir, 'apps/web/.next/static'));
copy(path.join(webDir, 'public'), path.join(outDir, 'apps/web/public'));

// The recorder is loaded at runtime (not bundled), so Next's file tracing does
// not pick it up: copy @glide/core and its dependencies next to the server.
const modules = path.join(outDir, 'node_modules');
copy(path.join(coreDir, 'package.json'), path.join(modules, '@glide/core/package.json'));
copy(path.join(coreDir, 'dist'), path.join(modules, '@glide/core/dist'));
const requireFromCore = createRequire(path.join(coreDir, 'package.json'));
for (const name of ['playwright', 'playwright-core', 'zod']) {
  const pkg = requireFromCore.resolve(`${name}/package.json`);
  copy(path.dirname(pkg), path.join(modules, name));
}

console.log(`\nServer ready in ${path.relative(rootDir, outDir)}`);

// ffmpeg for this platform (from ffmpeg-static), so recipients need no install.
// The license and build info ship alongside, as the GPL build requires.
const ffmpegDir = path.join(desktopDir, 'bundle/ffmpeg');
const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'));
const ffmpegBin = requireFromDesktop('ffmpeg-static');
if (!ffmpegBin || !existsSync(ffmpegBin)) {
  console.error('ffmpeg-static binary missing. Run "npm install" again (it downloads on install).');
  process.exit(1);
}
rmSync(ffmpegDir, { recursive: true, force: true });
copy(ffmpegBin, path.join(ffmpegDir, path.basename(ffmpegBin)));
for (const file of ['ffmpeg.LICENSE', 'ffmpeg.README']) {
  const src = path.join(path.dirname(ffmpegBin), file);
  if (existsSync(src)) copy(src, path.join(ffmpegDir, file));
}
console.log(`ffmpeg ready in ${path.relative(rootDir, ffmpegDir)}`);

// Chromium for the bundled Playwright version. The app only records headless,
// so the headless shell is enough. Kept between builds; Playwright skips the
// download when it is already there and removes outdated revisions.
const browsersDir = path.join(desktopDir, 'bundle/browsers');
const install = spawnSync(
  process.execPath,
  [path.join(modules, 'playwright-core/cli.js'), 'install', '--only-shell', 'chromium'],
  { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir } },
);
if (install.status !== 0) process.exit(install.status ?? 1);
console.log(`Chromium ready in ${path.relative(rootDir, browsersDir)}`);
