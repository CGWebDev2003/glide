'use client';
import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // only in production builds: a SW caching dev assets makes hot reload confusing
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
