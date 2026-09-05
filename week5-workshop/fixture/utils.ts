// utils.ts — a tiny helper module with one real bug in it.
export function parseDuration(s: string): number {
  let total = 0;
  for (const [, value, unit] of s.matchAll(/(\d+)([hms])/g)) {
    total += Number(value);
  }
  return total;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : "", s ? `${s}s` : ""].join("") || "0s";
}
