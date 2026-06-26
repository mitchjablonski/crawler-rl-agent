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
    const { lastFrame } = render(<MapScreen state={s} dispatch={noop} onViewDeck={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('take its toll');
    expect(frame).toContain(`-${ACT_TRANSITION_EXHAUSTION_HP} max HP`);
  });

  it('shows NO warning for an intra-act fork (no boundary crossed)', () => {
    // The start node's successors are all act 0 → no toll, no warning.
    const s = arcAt();
    const { lastFrame } = render(<MapScreen state={s} dispatch={noop} onViewDeck={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('take its toll');
  });
});
