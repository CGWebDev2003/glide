'use client';
import { useEffect, useRef, useState } from 'react';
import type { Job, ServerEvent } from '@/lib/types';

/** Live job list via Server-Sent Events (reconnects automatically). */
export function useJobs(onFinished?: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ServerEvent;
      if (e.type === 'snapshot') {
        setJobs(e.jobs);
      } else if (e.type === 'removed') {
        setJobs((all) => all.filter((j) => j.id !== e.id));
      } else {
        setJobs((all) => {
          const prev = all.find((j) => j.id === e.job.id);
          const wasActive = prev && (prev.status === 'running' || prev.status === 'queued');
          const isFinal = e.job.status === 'done' || e.job.status === 'error';
          if (wasActive && isFinal) queueMicrotask(() => finishedRef.current?.(e.job));
          const rest = all.filter((j) => j.id !== e.job.id);
          return [e.job, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
      }
    };
    return () => es.close();
  }, []);

  return { jobs, connected };
}
