import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { MapScreen } from './MapScreen.js';
import { createRun, ACT_TRANSITION_EXHAUSTION_HP } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { MapNode, RunState } from '../../engine/types.js';

const noop = () => undefined;

/** A 3-act arc run, optionally parked on a given node id. */
function arcAt(nodeId?: string): RunState {
  const base = createRun(content, 'map-screen-test', { ...DEFAULT_RUN_CONFIG, acts: 3 });
  return nodeId ? { ...base, phase: 'map', currentNodeId: nodeId } : base;
}

/** Find an act-0 cap node whose successors lead into act 1. */
function actCap(s: RunState): MapNode {
  const cap = Object.values(s.map.nodes).find(
    (n) => n.act === 0 && n.next.some((id) => s.map.nodes[id]?.act === 1),
  );
  if (!cap) throw new Error('no act boundary in arc map');
  return cap;
}

describe('MapScreen #32 exhaustion warning', () => {
  it('warns about the max-HP toll when an option crosses into the next act', () => {
    const s = arcAt(actCap(arcAt()).id);
    const { lastFrame } = render(
      <MapScreen state={s} content={content} dispatch={noop} onViewDeck={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('take its toll');
    expect(frame).toContain(`-${ACT_TRANSITION_EXHAUSTION_HP} max HP`);
  });

  it('shows NO warning for an intra-act fork (no boundary crossed)', () => {
    // The start node's successors are all act 0 → no toll, no warning.
    const s = arcAt();
    const { lastFrame } = render(
      <MapScreen state={s} content={content} dispatch={noop} onViewDeck={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('take its toll');
  });
});

describe('MapScreen #60 node-stake labels', () => {
  /** Park on a node that links to a node of the given kind, returning the run. */
  function arcLinkingTo(kind: MapNode['kind']): RunState {
    const base = createRun(content, 'map-stakes', { ...DEFAULT_RUN_CONFIG, acts: 3 });
    const parent = Object.values(base.map.nodes).find((n) =>
      n.next.some((id) => base.map.nodes[id]?.kind === kind),
    );
    if (!parent) throw new Error(`no node linking to a ${kind}`);
    return { ...base, phase: 'map', currentNodeId: parent.id };
  }

  it.each([
    ['event', '(risk/reward)'],
    ['rest', '(heal or upgrade)'],
    ['shop', '(spend gold)'],
    ['elite', '(harder, better loot)'],
  ] as const)('annotates a %s node with its stake', (kind, stake) => {
    const s = arcLinkingTo(kind);
    const { lastFrame } = render(
      <MapScreen state={s} content={content} dispatch={noop} onViewDeck={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(stake);
    // Labels stay within the column budget.
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(76);
  });
});

describe('MapScreen #69 tiered reveal', () => {
  /** Park on a node whose two event successors are a revealed + a hidden event. */
  function twoEvents(): RunState {
    const base = createRun(content, 'reveal-test', DEFAULT_RUN_CONFIG);
    const nodes: Record<string, MapNode> = {
      start: { id: 'start', kind: 'start', row: 0, act: 0, next: ['ev1', 'ev2'] },
      // shrine-of-the-crawl is a revealed (named) event; vending machine is a
      // curated hiddenOnMap gamble.
      ev1: { id: 'ev1', kind: 'event', row: 1, act: 0, next: ['ev2'], eventId: 'shrine-of-the-crawl' },
      ev2: { id: 'ev2', kind: 'event', row: 1, act: 0, next: [], eventId: 'abandoned-vending-machine' },
    };
    return {
      ...base,
      map: { nodes, startId: 'start', bossId: 'ev2' },
      currentNodeId: 'start',
      phase: 'map',
    };
  }

  it('names a revealed event and keeps a hiddenOnMap event a "??? Unknown" mystery', () => {
    const s = twoEvents();
    const { lastFrame } = render(
      <MapScreen state={s} content={content} dispatch={noop} onViewDeck={noop} />,
    );
    const frame = lastFrame() ?? '';
    // Revealed event shows its NAME; hidden event shows the mystery label only.
    expect(frame).toContain('Shrine of the Crawl');
    expect(frame).toContain('??? Unknown event');
    // The hidden event's real name must NEVER leak onto the map.
    expect(frame).not.toContain('Abandoned Vending Machine');
    // The #60 stake hint rides along on every event node.
    expect(frame).toContain('(risk/reward)');
    // Budget holds.
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(76);
  });
});
