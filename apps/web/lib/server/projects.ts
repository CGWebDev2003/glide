import 'server-only';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from './json-file';
import { projectsFile } from './paths';
import type { Project } from '../types';

// serialize writes, the JSON file is the database
let chain: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

export async function listProjects(): Promise<Project[]> {
  const all = await readJson<Project[]>(projectsFile, []);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await listProjects()).find((p) => p.id === id);
}

export function saveProject(input: { id?: string; name: string; config: Record<string, unknown> }): Promise<Project> {
  return locked(async () => {
    const all = await readJson<Project[]>(projectsFile, []);
    const now = new Date().toISOString();
    const existing = input.id ? all.find((p) => p.id === input.id) : undefined;
    if (existing) {
      existing.name = input.name;
      existing.config = input.config;
      existing.updatedAt = now;
      await writeJson(projectsFile, all);
      return existing;
    }
    const project: Project = { id: randomUUID(), name: input.name, config: input.config, createdAt: now, updatedAt: now };
    all.push(project);
    await writeJson(projectsFile, all);
    return project;
  });
}

export function deleteProject(id: string): Promise<boolean> {
  return locked(async () => {
    const all = await readJson<Project[]>(projectsFile, []);
    const rest = all.filter((p) => p.id !== id);
    if (rest.length === all.length) return false;
    await writeJson(projectsFile, rest);
    return true;
  });
}
