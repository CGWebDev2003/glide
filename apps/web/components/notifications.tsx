'use client';
import { useEffect, useState } from 'react';

/** Shows a system notification (via the service worker when available). */
export async function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: title });
    else new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch { /* ignore */ }
}

export function NotificationToggle() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => {
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);
  if (perm === 'unsupported' || perm === 'granted') return null;
  return (
    <button
      className="btn ghost small"
      disabled={perm === 'denied'}
      title={perm === 'denied' ? 'In den Browser-Einstellungen blockiert' : 'Benachrichtigen, wenn ein Video fertig ist'}
      aria-label="Benachrichtigen, wenn ein Video fertig ist"
      onClick={async () => setPerm(await Notification.requestPermission())}
    >
      🔔<span className="label-long"> Benachrichtigen, wenn fertig</span>
    </button>
  );
}
