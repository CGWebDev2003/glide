import 'server-only';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '@glide/core';
import { loadCore } from './core';
import { readJson, writeJson } from './json-file';
import { ensureDirs, jobsFile, videosDir } from './paths';
import type { Job, ServerEvent } from '../types';

const MAX_LOG = 200;
const MAX_HISTORY = 500;

/**
 * In-process job queue. Recordings run one at a time (each one drives its own
 * Chromium + ffmpeg and is CPU-bound, parallel runs would only slow each other
 * down). Finished jobs are persisted to jobs.json and form the video gallery.
 */
class JobManager {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running: { id: string; ac: AbortController } | null = null;
  private previews = new Map<string, { image: Buffer; mime: string }>();
  private emitter = new EventEmitter();
  private ready: Promise<void>;
  private lastEmit = new Map<string, number>();
  private pendingEmit = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.emitter.setMaxListeners(0);
    this.ready = this.load();
  }

  private async load() {
    const saved = await readJson<Job[]>(jobsFile, []);
    for (const j of saved) {
      if (j.status === 'running' || j.status === 'queued') {
        j.status = 'error';
        j.error = 'Glide wurde während der Aufnahme beendet.';
      }
      this.jobs.set(j.id, j);
    }
  }

  private persistChain: Promise<void> = Promise.resolve();
  private persist() {
    const finished = [...this.jobs.values()]
      .filter((j) => j.status !== 'queued' && j.status !== 'running')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_HISTORY);
    this.persistChain = this.persistChain.then(() => writeJson(jobsFile, finished)).catch(() => {});
  }

  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  /** emits job updates, throttled to ~5/s per job while recording */
  private emit(job: Job, force = false) {
    const now = Date.now();
    const last = this.lastEmit.get(job.id) ?? 0;
    const send = () => {
      this.pendingEmit.delete(job.id);
      this.lastEmit.set(job.id, Date.now());
      this.emitter.emit('event', { type: 'job', job: structuredClone(job) } satisfies ServerEvent);
    };
    if (force || now - last >= 200) {
      clearTimeout(this.pendingEmit.get(job.id));
      send();
    } else if (!this.pendingEmit.has(job.id)) {
      this.pendingEmit.set(job.id, setTimeout(send, 200 - (now - last)));
    }
  }

  async list(): Promise<Job[]> {
    await this.ready;
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Job | undefined> {
    await this.ready;
    return this.jobs.get(id);
  }

  preview(id: string) {
    return this.previews.get(id);
  }

  /** Validates the config (throws ConfigError) and queues the job. */
  async enqueue(input: { config: Record<string, unknown>; name?: string; projectId?: string }): Promise<Job> {
    await this.ready;
    const { parseConfig } = await loadCore();
    parseConfig(input.config, 'Konfiguration');
    const url = String(input.config.url);
    const job: Job = {
      id: randomUUID(),
      name: input.name?.trim() || new URL(url).hostname.replace(/^www\./, ''),
      projectId: input.projectId,
      config: input.config,
      status: 'queued',
      previewVersion: 0,
      log: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.emit(job, true);
    void this.pump();
    return job;
  }

  async cancel(id: string): Promise<boolean> {
    await this.ready;
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
      this.persist();
      return true;
    }
    if (job.status === 'running' && this.running?.id === id) {
      job.stage = 'Wird abgebrochen…';
      this.emit(job, true);
      this.running.ac.abort();
      return true;
    }
    return false;
  }

  /** Removes a finished job from the history and deletes its video. */
  async remove(id: string): Promise<boolean> {
    await this.ready;
    const job = this.jobs.get(id);
    if (!job || job.status === 'running' || job.status === 'queued') return false;
    if (job.file) {
      await unlink(path.join(videosDir, job.file)).catch(() => {});
      await unlink(path.join(videosDir, `${job.file}.jpg`)).catch(() => {});
    }
    this.jobs.delete(id);
    this.previews.delete(id);
    this.emitter.emit('event', { type: 'removed', id } satisfies ServerEvent);
    this.persist();
    return true;
  }

  videoPath(job: Job): string | null {
    return job.file ? path.join(videosDir, job.file) : null;
  }

  private async pump() {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued') return void this.pump();
    const ac = new AbortController();
    this.running = { id, ac };
    try {
      await this.run(job, ac.signal);
    } finally {
      this.running = null;
      void this.pump();
    }
  }

  private async run(job: Job, signal: AbortSignal) {
    const { parseConfig, record, resolveOutputSize, extractPoster } = await loadCore();
    let config: Config;
    try {
      config = parseConfig(job.config, 'Konfiguration');
    } catch (e) {
      return this.fail(job, e);
    }
    await ensureDirs();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
    job.file = `${slug}-${stamp}-${job.id.slice(0, 6)}.${config.format}`;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.stage = 'Browser wird gestartet…';
    this.emit(job, true);

    const log = (m: string) => {
      job.log = [...job.log, m].slice(-MAX_LOG);
      job.stage = m;
      this.emit(job);
    };
    try {
      const res = await record(config, {
        output: path.join(videosDir, job.file),
        signal,
        log,
        warn: (m) => {
          job.warnings = [...job.warnings, m].slice(-MAX_LOG);
          log(`⚠ ${m}`);
        },
        onProgress: (p) => {
          job.progress = p;
          job.stage = p.phase === 'intro' ? 'Intro' : 'Scrollen';
          this.emit(job);
        },
        onPreview: (image, mime) => {
          this.previews.set(job.id, { image, mime });
          job.previewVersion++;
        },
        previewInterval: 500,
      });
      const size = resolveOutputSize(config);
      const bytes = (await stat(res.output)).size;
      // poster frame: end of the intro (hero animation finished), or the middle for short videos
      const posterAt = Math.min(config.introDuration, res.duration / 2);
      await extractPoster(res.output, `${res.output}.jpg`, posterAt).catch(() => {});
      job.status = 'done';
      job.stage = undefined;
      job.result = {
        frames: res.frames,
        duration: res.duration,
        renderMs: res.renderMs,
        bytes,
        width: size.width,
        height: size.height,
        fps: config.fps,
        format: config.format,
        driver: res.driver,
      };
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
      this.persist();
    } catch (e) {
      if ((e instanceof Error && e.name === 'RecordAbortedError') || signal.aborted) {
        job.status = 'cancelled';
        job.stage = undefined;
        job.file = undefined;
        job.finishedAt = new Date().toISOString();
        this.emit(job, true);
        this.persist();
        return;
      }
      if (job.file) await unlink(path.join(videosDir, job.file)).catch(() => {});
      job.file = undefined;
      this.fail(job, e);
    }
  }

  private fail(job: Job, e: unknown) {
    job.status = 'error';
    job.stage = undefined;
    job.error = e instanceof Error && (e.name === 'ConfigError' || e.name === 'FfmpegError')
      ? e.message
      : e instanceof Error
        ? friendlyError(e.message)
        : String(e);
    job.finishedAt = new Date().toISOString();
    this.emit(job, true);
    this.persist();
  }
}

function friendlyError(msg: string): string {
  if (/Executable doesn't exist/.test(msg)) {
    return 'Chromium für Playwright fehlt. Im Projektordner ausführen: npx playwright install chromium';
  }
  if (/net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION_REFUSED|net::ERR_INTERNET_DISCONNECTED/.test(msg)) {
    return `Seite nicht erreichbar: ${msg.split('\n')[0]}`;
  }
  return msg.split('\n').slice(0, 6).join('\n');
}

// one instance per server process (survives hot reloads in dev)
const g = globalThis as unknown as { __glideJobs?: JobManager };
export const jobs: JobManager = (g.__glideJobs ??= new JobManager());
