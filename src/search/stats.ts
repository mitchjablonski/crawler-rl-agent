// Small stats helpers for honest win-rate reporting. A bare "90%" over 20 seeds hides a
// ±~13pt interval; reporting the Wilson score interval makes the uncertainty visible so
// noise isn't read as signal.

export interface Interval {
  readonly rate: number;
  readonly lo: number;
  readonly hi: number;
}

/**
 * Wilson score interval for a binomial proportion (better than normal-approx at the
 * extremes and small n). `successes`/`n`; `z` defaults to 1.96 (95%). Clamped to [0,1].
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { rate: 0, lo: 0, hi: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Format a win rate with its 95% Wilson interval, e.g. "90.0% [68–99]". */
export function fmtRateCI(rate: number, n: number): string {
  const { lo, hi } = wilsonInterval(Math.round(rate * n), n);
  return `${(rate * 100).toFixed(1)}% [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}]`;
}
