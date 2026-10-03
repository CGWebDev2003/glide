// Glide desktop: starts the bundled Glide server in the background and shows
// the web app in its own window. Quitting the app stops the server.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const PREFERRED_PORT = 4321;
const HOST = '127.0.0.1';

// Apps started from Finder/Dock don't get the shell PATH, so ffmpeg from
// Homebrew would not be found.
if (process.platform !== 'win32') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const parts = (process.env.PATH || '').split(':').filter(Boolean);
  process.env.PATH = [...parts, ...extra.filter((p) => !parts.includes(p))].join(':');
}

let server = null;
let baseUrl = null;
let win = null;
let quitting = false;
let confirmed = false;
let confirming = false;

function serverDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, 'bundle/server');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, HOST, () => srv.close(() => resolve(true)));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** True when a Glide server (e.g. `npm run app`) already answers on this port. */
async function isGlide(url) {
  try {
    const res = await fetch(`${url}/manifest.webmanifest`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()).includes('Glide');
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!server || server.exitCode !== null) throw new Error('Der Glide-Server wurde unerwartet beendet.');
    try {
      const res = await fetch(`${url}/manifest.webmanifest`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Der Glide-Server ist nicht rechtzeitig gestartet.');
}

async function startServer() {
  if (!(await isPortFree(PREFERRED_PORT))) {
    const existing = `http://${HOST}:${PREFERRED_PORT}`;
    // Reuse a running Glide instead of starting a second queue on the same data.
    if (await isGlide(existing)) return existing;
  }
  const port = (await isPortFree(PREFERRED_PORT)) ? PREFERRED_PORT : await freePort();
  const script = path.join(serverDir(), 'apps/web/server.js');
  if (!fs.existsSync(script)) {
    throw new Error(`Server-Build fehlt (${script}).\nZuerst im Repo "npm run desktop" ausführen.`);
  }

  const log = [];
  // Run the server with Electron's built-in Node.js, no separate install needed.
  server = spawn(process.execPath, [script], {
    cwd: path.dirname(script),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', PORT: String(port), HOSTNAME: HOST },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const collect = (chunk) => {
    process.stdout.write(chunk);
    log.push(chunk.toString());
    if (log.length > 50) log.shift();
  };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  server.on('exit', (code) => {
    if (quitting) return;
    confirmed = true;
    dialog.showErrorBox('Glide', `Der Glide-Server wurde beendet (Code ${code}).\n\n${log.join('').slice(-2000)}`);
    app.quit();
  });

  const url = `http://${HOST}:${port}`;
  await waitForServer(url).catch((e) => {
    throw new Error(`${e.message}\n\n${log.join('').slice(-2000)}`);
  });
  return url;
}

function stopServer() {
  if (server && server.exitCode === null) server.kill();
}

async function runningJobs() {
  try {
    const res = await fetch(`${baseUrl}/api/jobs`, { signal: AbortSignal.timeout(1500) });
    const jobs = await res.json();
    return jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  } catch {
    return 0;
  }
}

/** Asks before quitting while recordings would be cancelled, then quits. */
async function confirmQuit() {
  if (confirming) return;
  confirming = true;
  const count = server ? await runningJobs() : 0;
  confirming = false;
  if (count > 0) {
    const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'warning',
      buttons: ['Abbrechen', 'Beenden'],
      defaultId: 0,
      cancelId: 0,
      message: count === 1 ? 'Eine Aufnahme läuft noch oder wartet.' : `${count} Aufnahmen laufen noch oder warten.`,
      detail: 'Beim Beenden werden sie abgebrochen.',
    });
    if (response === 0) return;
  }
  confirmed = true;
  app.quit();
}

function isAppUrl(url) {
  return url.startsWith(`${baseUrl}/`) || url === baseUrl;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 420,
    minHeight: 500,
    title: 'Glide',
    backgroundColor: '#0e0f13',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());

  // Links to other sites open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('close', (event) => {
    if (confirmed) return;
    event.preventDefault();
    confirmQuit();
  });

  win.loadURL(baseUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      baseUrl = await startServer();
    } catch (e) {
      dialog.showErrorBox('Glide konnte nicht starten', e.message);
      quitting = true;
      app.quit();
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!confirmed && baseUrl) {
      event.preventDefault();
      confirmQuit();
      return;
    }
    quitting = true;
  });
  app.on('will-quit', stopServer);
  process.on('exit', stopServer);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      stopServer();
      app.exit(0);
    });
  }
}
