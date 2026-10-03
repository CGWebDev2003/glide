'use client';
import { useEffect, useState } from 'react';
import type { Job } from '@/lib/types';
import { fmtBytes, fmtDate, fmtDuration, hostOf } from './format';

const cancelOrDelete = (id: string) => fetch(`/api/jobs/${id}`, { method: 'DELETE' });

export function ActiveJobs({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return null;
  return (
    <section className="card">
      <h2>Läuft gerade</h2>
      <div className="active-list">
        {jobs.map((j) => (
          <ActiveJob key={j.id} job={j} />
        ))}
      </div>
    </section>
  );
}

function ActiveJob({ job }: { job: Job }) {
  const p = job.progress;
  const pct = p ? Math.min(100, (p.frame / p.total) * 100) : 0;
  const rate = p ? p.frame / Math.max(0.001, p.elapsedMs / 1000) : 0;
  const eta = p && rate > 0 ? (p.total - p.frame) / rate : NaN;
  return (
    <article className="active-job">
      <div className="preview">
        {job.previewVersion > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/jobs/${job.id}/preview?v=${job.previewVersion}`} alt="Live-Vorschau" />
        ) : (
          <div className="preview-empty">{job.status === 'queued' ? 'Wartet…' : 'Lädt…'}</div>
        )}
      </div>
      <div className="active-body">
        <div className="active-title">
          <strong>{job.name}</strong>
          <span className="muted">{hostOf(job.config.url)}</span>
        </div>
        <div className="progress" aria-label="Fortschritt">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="active-meta">
          {job.status === 'queued' ? (
            <span>In der Warteschlange</span>
          ) : p ? (
            <>
              <span>Frame {p.frame} von {p.total}</span>
              <span>{rate.toFixed(1)} Frames/s</span>
              <span>noch {fmtDuration(eta)}</span>
            </>
          ) : (
            <span>{job.stage ?? 'Startet…'}</span>
          )}
        </div>
        {job.stage && p && <div className="muted small">{job.stage}</div>}
        {job.warnings.length > 0 && <div className="warn small">⚠ {job.warnings[job.warnings.length - 1]}</div>}
      </div>
      <button className="btn ghost small" onClick={() => cancelOrDelete(job.id)}>
        Abbrechen
      </button>
    </article>
  );
}

export function Gallery({ jobs, onReuse }: { jobs: Job[]; onReuse: (job: Job) => void }) {
  const [open, setOpen] = useState<Job | null>(null);
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'error' || j.status === 'cancelled').slice(0, 5);
  return (
    <section className="card">
      <div className="gallery-head">
        <h2>Videos</h2>
        <span className="muted">{done.length} {done.length === 1 ? 'Video' : 'Videos'}</span>
      </div>
      {failed.length > 0 && (
        <ul className="failed-list">
          {failed.map((j) => (
            <li key={j.id} className={j.status}>
              <div>
                <strong>{j.name}</strong>{' '}
                <span className="muted">{j.status === 'cancelled' ? 'abgebrochen' : 'fehlgeschlagen'} · {fmtDate(j.createdAt)}</span>
                {j.error && <pre>{j.error}</pre>}
              </div>
              <div className="row-buttons">
                <button className="btn ghost small" onClick={() => onReuse(j)}>Erneut</button>
                <button className="btn ghost small" onClick={() => cancelOrDelete(j.id)} aria-label="Entfernen">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {done.length === 0 ? (
        <p className="empty">Noch keine Videos. Starte oben deine erste Aufnahme.</p>
      ) : (
        <div className="gallery">
          {done.map((j) => (
            <VideoCard key={j.id} job={j} onOpen={() => setOpen(j)} onReuse={() => onReuse(j)} />
          ))}
        </div>
      )}
      {open && <VideoModal job={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function VideoCard({ job, onOpen, onReuse }: { job: Job; onOpen: () => void; onReuse: () => void }) {
  const r = job.result!;
  const portrait = r.height > r.width;
  return (
    <article className="video-card">
      <button className={`thumb ${portrait ? 'portrait' : ''}`} onClick={onOpen} aria-label={`${job.name} abspielen`}>
        <video
          src={`/api/videos/${job.id}`}
          poster={`/api/videos/${job.id}/poster`}
          preload="none"
          muted
          playsInline
          loop
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
        <span className="badge">{fmtDuration(r.duration)}</span>
      </button>
      <div className="video-info">
        <strong title={job.name}>{job.name}</strong>
        <span className="muted small">
          {r.width}×{r.height} · {r.fps} fps · {r.format.toUpperCase()} · {fmtBytes(r.bytes)}
        </span>
        <span className="muted small">{fmtDate(job.createdAt)}</span>
      </div>
      <div className="video-actions">
        <a className="btn ghost small" href={`/api/videos/${job.id}?download=1`} download={job.file}>Download</a>
        <button className="btn ghost small" onClick={onReuse}>Erneut</button>
        <button
          className="btn ghost small danger"
          onClick={() => {
            if (window.confirm(`„${job.name}“ und die Videodatei löschen?`)) void cancelOrDelete(job.id);
          }}
        >
          Löschen
        </button>
      </div>
    </article>
  );
}

function VideoModal({ job, onClose }: { job: Job; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const r = job.result!;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={job.name} onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <video src={`/api/videos/${job.id}`} poster={`/api/videos/${job.id}/poster`} controls autoPlay playsInline className={r.height > r.width ? 'portrait' : ''} />
        <div className="modal-bar">
          <div>
            <strong>{job.name}</strong>
            <div className="muted small">
              {r.width}×{r.height} · {r.fps} fps · {fmtDuration(r.duration)} · gerendert in {fmtDuration(r.renderMs / 1000)}
            </div>
          </div>
          <div className="row-buttons">
            {canShare && (
              <button
                className="btn ghost small"
                onClick={async () => {
                  const blob = await (await fetch(`/api/videos/${job.id}`)).blob();
                  const file = new File([blob], job.file ?? 'glide.mp4', { type: blob.type });
                  if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: job.name }).catch(() => {});
                }}
              >
                Teilen
              </button>
            )}
            <a className="btn primary small" href={`/api/videos/${job.id}?download=1`} download={job.file}>Download</a>
            <button className="btn ghost small" onClick={onClose}>Schließen</button>
          </div>
        </div>
      </div>
    </div>
  );
}
