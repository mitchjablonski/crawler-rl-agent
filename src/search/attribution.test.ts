import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../engine/rng.js';
import { DEFAULT_RUN_CONFIG, content } from '../engine/content/index.js';
import { greedyPlayer } from './balance.js';
import { type Corpus, collectCorpus, fitLogistic } from './attribution.js';

describe('attribution', () => {
  it('recovers known coefficients on synthetic logistic data', () => {
    // y ~ sigmoid(0.5 + 2*x1 - 1.5*x2 + 0*x3); fit should recover signs + significance.
    const r = new Rng(seedFromString('synthetic'));
    const n = 3000;
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const x1 = r.next() < 0.5 ? 1 : 0;
      const x2 = r.next() < 0.5 ? 1 : 0;
      const x3 = r.next() < 0.5 ? 1 : 0;
      const eta = 0.5 + 2 * x1 - 1.5 * x2 + 0 * x3;
      const p = 1 / (1 + Math.exp(-eta));
      X.push([x1, x2, x3]);
      y.push(r.next() < p ? 1 : 0);
    }
    const corpus: Corpus = {
      names: ['card:a', 'card:b', 'card:c'],
      kinds: ['card', 'card', 'card'],
      X,
      y,
    };
    const fit = fitLogistic(corpus, { l2: 0.5 });
    const by = (nm: string) => fit.terms.find((t) => t.name === nm)!;
    expect(by('card:a').beta).toBeGreaterThan(1.4); // true 2.0
    expect(by('card:b').beta).toBeLessThan(-1.0); // true -1.5
    expect(Math.abs(by('card:c').z)).toBeLessThan(2); // true 0 → not significant
    expect(Math.abs(by('card:a').z)).toBeGreaterThan(2); // strong → significant
    expect(fit.intercept).toBeGreaterThan(0); // true 0.5
  });

  it('drops constant columns and reports them', () => {
    const corpus: Corpus = {
      names: ['card:varies', 'card:constant'],
      kinds: ['card', 'card'],
      X: [
        [1, 1],
        [0, 1],
        [1, 1],
        [0, 1],
      ],
      y: [1, 0, 1, 0],
    };
    const fit = fitLogistic(corpus, { l2: 1 });
    expect(fit.droppedConstant).toContain('card:constant');
    expect(fit.terms.map((t) => t.name)).toEqual(['card:varies']);
  });

  it('collects a corpus with the expected feature layout from real runs', () => {
    const r = new Rng(seedFromString('corpus'));
    const specs = Array.from({ length: 8 }, (_, i) => ({ seed: `c${i}`, config: DEFAULT_RUN_CONFIG }));
    const corpus = collectCorpus(content, greedyPlayer(() => r.next()), specs);
    expect(corpus.X.length).toBe(8);
    expect(corpus.y.length).toBe(8);
    expect(corpus.names).toContain('ctrl:enemyHp');
    expect(corpus.names.some((nm) => nm.startsWith('relic:'))).toBe(true);
    // Every row has one entry per declared feature.
    for (const row of corpus.X) expect(row.length).toBe(corpus.names.length);
  });
});
