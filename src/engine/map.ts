import type { Rng } from './rng.js';
import type { MapNode, NodeKind, RunMap } from './types.js';

export interface MapConfig {
  /** 0..1; longer expected sessions get the larger map. */
  readonly tempoHint?: number;
  /** Number of acts (1 = single session, 3 = multi-act arc). Default 1. */
  readonly acts?: number;
}

export const MIN_CHOICE_ROWS = 5;
export const MAX_CHOICE_ROWS = 6;
const LANES = 2;
const CROSSOVER_CHANCE = 0.35;

const KIND_WEIGHTS: readonly [NodeKind, number][] = [
  ['combat', 0.5],
  ['event', 0.2],
  ['elite', 0.15],
  ['shop', 0.1],
  ['rest', 0.05],
];

function rollKind(rng: Rng): NodeKind {
  let roll = rng.next();
  for (const [kind, weight] of KIND_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return 'combat';
}

export function generateMap(rng: Rng, config: MapConfig = {}): RunMap {
  const tempo = Math.min(1, Math.max(0, config.tempoHint ?? 0.5));
  const choiceRows =
    MIN_CHOICE_ROWS + Math.round(tempo * (MAX_CHOICE_ROWS - MIN_CHOICE_ROWS));
  const acts = Math.max(1, Math.floor(config.acts ?? 1));
  const actSpan = choiceRows + 2; // choice rows + rest + act cap

  const nodes: Record<string, MapNode> = {};
  const laneId = (row: number, lane: number) => `n${row}-${lane}`;
  const firstRow = (a: number) => a * actSpan + 1;

  // Acts are chained with continuous row numbering. Non-final acts cap with an
  // elite "act boss" that links into the next act; the final act caps with the
  // boss. For a single act this is byte-identical to the original generator
  // (same RNG call order), so existing seeds replay unchanged.
  for (let a = 0; a < acts; a++) {
    const isFinal = a === acts - 1;
    const base = a * actSpan;
    const restRow = base + choiceRows + 1;
    const capRow = base + choiceRows + 2;
    const restId = laneId(restRow, 0);
    const capId = laneId(capRow, 0);

    for (let r = 0; r < choiceRows; r++) {
      const row = base + 1 + r;
      for (let lane = 0; lane < LANES; lane++) {
        let kind: NodeKind = a === 0 && r === 0 ? 'combat' : rollKind(rng);
        if (kind === 'elite' && row < 3) kind = 'combat'; // no elites in the opening rows
        const next: string[] = [];
        if (r < choiceRows - 1) {
          next.push(laneId(row + 1, lane));
          if (rng.next() < CROSSOVER_CHANCE) next.push(laneId(row + 1, 1 - lane));
        } else {
          next.push(restId);
        }
        nodes[laneId(row, lane)] = { id: laneId(row, lane), kind, row, act: a, next };
      }
    }

    nodes[restId] = { id: restId, kind: 'rest', row: restRow, act: a, next: [capId] };
    nodes[capId] = {
      id: capId,
      kind: isFinal ? 'boss' : 'elite',
      row: capRow,
      act: a,
      next: isFinal ? [] : [laneId(firstRow(a + 1), 0), laneId(firstRow(a + 1), 1)],
    };
  }

  // Guarantee at least one shop so gold always has a sink. Any row>1 choice
  // node can be converted — restricting to combat nodes leaves rare seeds
  // with no candidates at all.
  const hasShop = Object.values(nodes).some((n) => n.kind === 'shop');
  if (!hasShop) {
    const all = Object.values(nodes).filter((n) => n.row > 1);
    const preferred = all.filter((n) => n.kind === 'combat' || n.kind === 'event');
    const candidates = preferred.length > 0 ? preferred : all;
    const chosen = rng.pick(candidates);
    nodes[chosen.id] = { ...chosen, kind: 'shop' };
  }

  const startId = 'n0-0';
  nodes[startId] = {
    id: startId,
    kind: 'start',
    row: 0,
    act: 0,
    next: [laneId(1, 0), laneId(1, 1)],
  };

  const bossId = laneId((acts - 1) * actSpan + choiceRows + 2, 0);
  return { nodes, startId, bossId };
}
