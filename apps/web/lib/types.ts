/** Shared between server and client (no runtime imports). */

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobProgress {
  frame: number;
  total: number;
  phase: 'intro' | 'scroll';
  elapsedMs: number;
}

export interface Job {
  id: string;
  name: string;
  projectId?: string;
  /** raw config as submitted (CLI-compatible JSON) */
  config: Record<string, unknown>;
  status: JobStatus;
  stage?: string;
  progress?: JobProgress;
  /** increments whenever a new preview frame is available */
  previewVersion: number;
  log: string[];
  warnings: string[];
  error?: string;
  file?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: {
    frames: number;
    duration: number;
    renderMs: number;
    bytes: number;
    width: number;
    height: number;
    fps: number;
    format: 'mp4' | 'webm';
    driver: string;
  };
}

export interface Project {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStatus {
  ffmpeg: { ok: boolean; message?: string };
  chromium: { ok: boolean; message?: string };
  dataDir: string;
  videosDir: string;
}

export type ServerEvent =
  | { type: 'snapshot'; jobs: Job[] }
  | { type: 'job'; job: Job }
  | { type: 'removed'; id: string };
