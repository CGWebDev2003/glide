import 'server-only';
import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/** Everything Glide stores lives here (override with GLIDE_DATA_DIR). */
export const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.GLIDE_DATA_DIR ?? path.join(os.homedir(), 'Glide'));
export const videosDir = path.join(dataDir, 'videos');
export const projectsFile = path.join(dataDir, 'projects.json');
export const jobsFile = path.join(dataDir, 'jobs.json');

export async function ensureDirs(): Promise<void> {
  await mkdir(videosDir, { recursive: true });
}
