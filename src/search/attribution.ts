// Content attribution: instead of one-at-a-time ablation (slow, binary, saturates),
// run ONE large corpus of games, record which content each run had + whether it won,
// and fit a ridge logistic regression of win on content presence. The coefficients are
// every item's marginal association with winning — with confidence intervals — from a
// single pass, controlling for the others.
//
// HONESTY: this is *associational with controls*, not pure causal. Winning runs survive
// longer and therefore draft more, so raw "held X" tilts positive (survivorship). We
// control for exogenous difficulty (enemyHp, acts) but NOT post-treatment progress (which
// would over-control a mediator). Treat the ranking as a screen; confirm the top/bottom
// with ablation (causal) or the value-head equity screen (survivorship-free).
import type { ContentRegistry, RunState } from '../engine/types.js';
import type { RunConfig } from '../engine/run.js';
import { type Player, runEpisode } from './balance.js';

export type FeatureKind = 'card' | 'relic' | 'potion' | 'ctrl';

export interface Corpus {
  /** Feature names, e.g. "card:venom-dart", "relic:whetstone", "ctrl:enemyHp". */
  readonly names: string[];
  readonly kinds: FeatureKind[];
  /** n × d design (natural units: binary presence / counts / control values). */
  readonly X: number[][];
  /** 0/1 outcome per run. */
  readonly y: number[];
}

/** Build the feature corpus by running `specs` episodes with `player`. */
export function collectCorpus(
  content: ContentRegistry,
  player: Player,
  specs: ReadonlyArray<{ seed: string; config: RunConfig }>,
): Corpus {
  const cardIds = Object.keys(content.cards)
    .filter((id) => content.cards[id]?.rarity !== 'starter')
    .sort();
  const relicIds = Object.keys(content.relics).sort();
  const potionIds = Object.keys(content.potions).sort();
  const names: string[] = [
    ...cardIds.map((id) => `card:${id}`),
    ...relicIds.map((id) => `relic:${id}`),
    ...potionIds.map((id) => `potion:${id}`),
    'ctrl:enemyHp',
    'ctrl:acts',
  ];
  const kinds: FeatureKind[] = [
    ...cardIds.map(() => 'card' as const),
    ...relicIds.map(() => 'relic' as const),
    ...potionIds.map(() => 'potion' as const),
    'ctrl',
    'ctrl',
  ];

  const X: number[][] = [];
  const y: number[] = [];
  for (const { seed, config } of specs) {
    let last: RunState | null = null;
    const potionsSeen = new Set<string>();
    const m = runEpisode(content, seed, config, player, (prev, _a, next) => {
      for (const p of prev.potions) potionsSeen.add(p);
      for (const p of next.potions) potionsSeen.add(p);
      last = next;
    });
    if (!last) continue;
    const fin = last as RunState;
    const deck = new Set(fin.deck);
    const relics = new Set(fin.relics);
    const row: number[] = [];
    for (const id of cardIds) row.push(deck.has(id) ? 1 : 0);
    for (const id of relicIds) row.push(relics.has(id) ? 1 : 0);
    for (const id of potionIds) row.push(potionsSeen.has(id) ? 1 : 0);
    row.push(config.enemyHpMult ?? 1);
    row.push(config.acts ?? 1);
    X.push(row);
    y.push(m.won ? 1 : 0);
  }
  return { names, kinds, X, y };
}

// ---- ridge logistic regression (IRLS) with coefficient standard errors ----

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Invert a square matrix via Gauss–Jordan with partial pivoting. */
function invert(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!; m[col] = m[piv]!; m[piv] = tmp;
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) m[col]![col] = 1e-12;
    const inv = 1 / m[col]![col]!;
    for (let j = 0; j < 2 * n; j++) m[col]![j]! *= inv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((r) => r.slice(n));
}

export interface Term {
  readonly name: string;
  readonly kind: FeatureKind;
  /** Log-odds change per unit (for binary features: having the item vs not). */
  readonly beta: number;
  readonly se: number;
  /** beta / se — |z| ≳ 1.96 ≈ significant at 95%. */
  readonly z: number;
  /** Odds ratio exp(beta): >1 helps win, <1 hurts. */
  readonly oddsRatio: number;
  readonly ci95: [number, number];
  /** Fraction of runs the feature was present (mean of the column). */
  readonly freq: number;
}

export interface FitResult {
  readonly intercept: number;
  readonly terms: Term[];
  readonly droppedConstant: string[];
  readonly n: number;
  readonly winRate: number;
}

/**
 * Fit win ~ features by ridge-penalized IRLS. Constant columns (e.g. starter content,
 * never-seen cards) are dropped — an effect can't be estimated without variation. The
 * intercept is unpenalized. Returns per-term beta, SE, z, odds ratio and 95% CI.
 */
export function fitLogistic(corpus: Corpus, opts: { l2?: number; maxIter?: number } = {}): FitResult {
  const l2 = opts.l2 ?? 1;
  const maxIter = opts.maxIter ?? 60;
  const n = corpus.y.length;
  const winRate = n > 0 ? corpus.y.reduce((a, b) => a + b, 0) / n : 0;

  // Drop constant columns.
  const keep: number[] = [];
  const dropped: string[] = [];
  const freqs: number[] = [];
  for (let j = 0; j < corpus.names.length; j++) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = corpus.X[i]![j]!;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    if (max - min < 1e-9) dropped.push(corpus.names[j]!);
    else { keep.push(j); freqs.push(sum / Math.max(1, n)); }
  }

  const d = keep.length + 1; // +1 intercept (column 0)
  // Design matrix with intercept first.
  const D: number[][] = corpus.X.map((row) => [1, ...keep.map((j) => row[j]!)]);
  const beta = new Array(d).fill(0) as number[];

  for (let iter = 0; iter < maxIter; iter++) {
    // gradient g = D^T (y - p) - λ R β ; Hessian-ish A = D^T W D + λ R  (R: no penalty on intercept)
    const g = new Array(d).fill(0) as number[];
    const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0) as number[]);
    for (let i = 0; i < n; i++) {
      const xi = D[i]!;
      let eta = 0;
      for (let j = 0; j < d; j++) eta += beta[j]! * xi[j]!;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(eta)));
      const w = p * (1 - p);
      const resid = corpus.y[i]! - p;
      for (let j = 0; j < d; j++) {
        g[j]! += resid * xi[j]!;
        const wij = w * xi[j]!;
        const Aj = A[j]!;
        for (let k = j; k < d; k++) Aj[k]! += wij * xi[k]!;
      }
    }
    for (let j = 1; j < d; j++) { g[j]! -= l2 * beta[j]!; A[j]![j]! += l2; }
    for (let j = 0; j < d; j++) for (let k = j + 1; k < d; k++) A[k]![j]! = A[j]![k]!; // symmetrize
    const Ainv = invert(A);
    let maxStep = 0;
    for (let j = 0; j < d; j++) {
      let step = 0;
      for (let k = 0; k < d; k++) step += Ainv[j]![k]! * g[k]!;
      beta[j]! += step;
      if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
    }
    if (maxStep < 1e-7) break;
  }

  // Covariance ≈ inv(D^T W D + λ R) at the solution.
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0) as number[]);
  for (let i = 0; i < n; i++) {
    const xi = D[i]!;
    let eta = 0;
    for (let j = 0; j < d; j++) eta += beta[j]! * xi[j]!;
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(eta)));
    const w = p * (1 - p);
    for (let j = 0; j < d; j++) { const wij = w * xi[j]!; for (let k = j; k < d; k++) A[j]![k]! += wij * xi[k]!; }
  }
  for (let j = 1; j < d; j++) A[j]![j]! += l2;
  for (let j = 0; j < d; j++) for (let k = j + 1; k < d; k++) A[k]![j]! = A[j]![k]!;
  const cov = invert(A);

  const terms: Term[] = keep.map((j, idx) => {
    const col = idx + 1;
    const b = beta[col]!;
    const se = Math.sqrt(Math.max(0, cov[col]![col]!));
    return {
      name: corpus.names[j]!,
      kind: corpus.kinds[j]!,
      beta: b,
      se,
      z: se > 0 ? b / se : 0,
      oddsRatio: Math.exp(b),
      ci95: [b - 1.96 * se, b + 1.96 * se],
      freq: freqs[idx]!,
    };
  });
  return { intercept: beta[0]!, terms, droppedConstant: dropped, n, winRate };
}
