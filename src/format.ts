/** 00:00.00 style clock; hours appear only when needed. */
export function clock(n: number): string {
  const t = Math.max(0, n);
  const h = Math.floor(t / 3600),
    m = Math.floor((t % 3600) / 60),
    s = t % 60;
  const mm = m.toString().padStart(2, "0"),
    ss = s.toFixed(2).padStart(5, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Short human duration for ETAs: "about 2 min", "40 s". */
export function eta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds / 5) * 5)} s left`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `about ${m} min left` : `about ${(m / 60).toFixed(1)} h left`;
}

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Picks a ruler step (seconds) so labels sit at least `minPx` apart. */
export function rulerStep(zoom: number, minPx = 80): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800])
    if (s * zoom >= minPx) return s;
  return 3600;
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;
