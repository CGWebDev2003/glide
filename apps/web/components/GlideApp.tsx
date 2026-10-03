'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FORM, fromConfig, normalizeUrl, toConfig, type FormState } from '@/lib/form';
import type { Job, Project, SystemStatus } from '@/lib/types';
import { RecordForm } from './RecordForm';
import { ActiveJobs, Gallery } from './Jobs';
import { useJobs } from './useJobs';
import { notify, NotificationToggle } from './notifications';

const DRAFT_KEY = 'glide:draft';

export function GlideApp({ sharedUrl }: { sharedUrl?: string }) {
  const [form, setFormState] = useState<FormState>(DEFAULT_FORM);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { jobs, connected } = useJobs(
    useCallback((job: Job) => {
      if (job.status === 'done') notify(`Video fertig: ${job.name}`, `${job.result?.duration.toFixed(1)} s · bereit zum Download`);
      else notify(`Aufnahme fehlgeschlagen: ${job.name}`, job.error ?? '');
    }, []),
  );

  // restore the last draft (or a shared URL)
  useEffect(() => {
    let draft = DEFAULT_FORM;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = { ...DEFAULT_FORM, ...(JSON.parse(raw) as FormState) };
    } catch { /* storage unavailable */ }
    if (sharedUrl) draft = { ...draft, url: sharedUrl, name: '' };
    setFormState(draft);
  }, [sharedUrl]);

  const setForm = (f: FormState) => {
    setFormState(f);
    setError(null);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    } catch { /* ignore */ }
  };

  const loadProjects = useCallback(async () => {
    setProjects(await (await fetch('/api/projects')).json());
  }, []);

  useEffect(() => {
    void loadProjects();
    void fetch('/api/system').then(async (r) => setSystem(await r.json()));
  }, [loadProjects]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const f = { ...form, url: normalizeUrl(form.url) };
      const project = projects.find((p) => p.id === projectId);
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: toConfig(f), name: project?.name || f.name || undefined, projectId: projectId ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').reverse();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <h1>Glide</h1>
            <p>Flüssige Scroll-Videos von Websites</p>
          </div>
        </div>
        <div className="topbar-right">
          <NotificationToggle />
          <span className={`status-dot ${connected ? 'ok' : ''}`} title={connected ? 'verbunden' : 'getrennt'} />
        </div>
      </header>

      {system && (!system.ffmpeg.ok || !system.chromium.ok) && (
        <div className="banner error" role="alert">
          {!system.ffmpeg.ok && <pre>{system.ffmpeg.message}</pre>}
          {!system.chromium.ok && <pre>{system.chromium.message}</pre>}
        </div>
      )}

      <main className="layout">
        <div className="col-form">
          <RecordForm
            form={form}
            setForm={setForm}
            projects={projects}
            projectId={projectId}
            setProjectId={setProjectId}
            onSaveProject={async (name) => {
              const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: projects.find((p) => p.id === projectId && p.name === name)?.id, name, config: toConfig(form) }),
              });
              const saved = (await res.json()) as Project;
              await loadProjects();
              setProjectId(saved.id);
            }}
            onDeleteProject={async (id) => {
              await fetch(`/api/projects/${id}`, { method: 'DELETE' });
              setProjectId(null);
              await loadProjects();
            }}
            onSubmit={submit}
            submitting={submitting}
            error={error}
          />
        </div>
        <div className="col-output">
          <ActiveJobs jobs={active} />
          <Gallery
            jobs={jobs}
            onReuse={(job) => {
              setProjectId(job.projectId ?? null);
              setForm(fromConfig(job.config, job.name));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
          {system && <p className="muted small footer-note">Videos liegen in <code>{system.videosDir}</code></p>}
        </div>
      </main>
    </div>
  );
}

function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="logo" src="/icons/icon-192.png" alt="" width={40} height={40} />;
}
