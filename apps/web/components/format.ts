export const fmtDuration = (s: number) => {
  if (!Number.isFinite(s)) return '–';
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  return `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
};

export const fmtBytes = (b: number) =>
  b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return String(url ?? '');
  }
};
