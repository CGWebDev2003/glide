import 'server-only';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { ensureDirs } from './paths';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write (tmp file + rename), so a crash never leaves half a file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDirs();
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}
