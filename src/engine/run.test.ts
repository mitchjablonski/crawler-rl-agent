import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createRun,
  rollCardChoices,
  ACT_TRANSITION_EXHAUSTION_HP,
  RARITY_WEIGHTS_BY_ACT,
} from './run.js';
import { legalActions } from '../search/legalActions.js';
import { DEFAULT_RUN_CONFIG, content } from './content/index.js';
import { UPGRADE_TARGET_IDS, UNLOCKABLE_CARD_IDS } from './content/cards.js';
import { EngineError, eventRequirementMet } from './types.js';
import { Rng, seedFromString } from './rng.js';
import type { CombatState, EnemyInstance, MapNode, RunState } from './types.js';

const run = (seed: string) => createRun(content, seed, DEFAULT_RUN_CONFIG);

describe('createRun', () => {
  it('is deterministic per seed', () => {
    expect(run('alpha')).toEqual(run('alpha'));
    expect(run('alpha')).not.toEqual(run('beta'));
  });

  it('initializes run stats to all-zero', () => {
    expect(run('alpha').stats).toEqual({
      turns: 0,
      damageDealt: 0,
      damageTaken: 0,
      enemiesSlain: 0,
    });
  });

  it('defaults enemyHpMult to 1 and scales enemy HP when set', () => {
    expect(run('alpha').enemyHpMult).toBe(1);
    const firstNode = (s: RunState) => s.map.nodes[s.currentNodeId]?.next[0] as string;

    const neutral = createRun(content, 'hpmult', DEFAULT_RUN_CONFIG);
    const scaled = createRun(content, 'hpmult', { ...DEFAULT_RUN_CONFIG, enemyHpMult: 2 });
    const n = applyAction(content, neutral, { type: 'chooseNode', nodeId: firstNode(neutral) });
    const s = applyAction(content, scaled, { type: 'chooseNode', nodeId: firstNode(scaled) });
    const nHp = n.combat?.enemies[0]?.maxHp ?? 0;
    const sHp = s.combat?.enemies[0]?.maxHp ?? 0;
    expect(sHp).toBe(Math.round(nHp * 2)); // same seed roll, scaled after
  });

  it('applies the per-act HP ramp: act 0 is a no-op, later acts scale', () => {
    // Walk an arc run, at each map node taking the first edge that leads to a
    // plain combat, and capture the first enemy's maxHp + the node's act. Run
    // the SAME walk with no ramp and with a steep ramp, then compare per-act.
    // Huge HP so ending turns won't kill the player before later acts; the ramp
    // does not affect player HP, so this only changes how far the walk reaches.
    const ARC = (ramp: readonly number[] | undefined) => ({
      ...DEFAULT_RUN_CONFIG,
      acts: 3,
      maxHp: 100_000,
      enemyHpMult: 1,
      ...(ramp ? { actHpRamp: ramp } : {}),
    });

    const walkCombats = (cfg: Parameters<typeof createRun>[2]) => {
      let s = createRun(content, 'arc-ramp-seed', cfg);
      const seen: { act: number; hp: number }[] = [];
      let prevPhase = s.phase;
      for (let guard = 0; guard < 2000 && seen.length < 6; guard++) {
        if (s.phase === 'combat' && prevPhase !== 'combat' && s.combat) {
          const node = s.map.nodes[s.currentNodeId];
          const first = s.combat.enemies[0];
          if (node && first) seen.push({ act: node.act, hp: first.maxHp });
        }
        prevPhase = s.phase;
        if (s.phase === 'map') {
          const next = s.map.nodes[s.currentNodeId]?.next ?? [];
          // Prefer a plain-combat edge so we sample enemy HP across acts.
          const combatEdge = next.find((id) => s.map.nodes[id]?.kind === 'combat');
          const target = combatEdge ?? next[0];
          if (target === undefined) break;
          s = applyAction(content, s, { type: 'chooseNode', nodeId: target });
        } else if (s.phase === 'combat' && s.combat) {
          const combat = s.combat;
          // Play the first affordable attack at a living enemy, else end turn,
          // so combats actually resolve and the walk advances through the acts.
          const handIdx = combat.hand.findIndex((id) => {
            const c = content.cards[id];
            return c && c.type === 'attack' && c.cost <= combat.energy;
          });
          const tgt = combat.enemies.findIndex((e) => e.hp > 0);
          s =
            handIdx >= 0
              ? applyAction(content, s, {
                  type: 'playCard',
                  handIndex: handIdx,
                  targetIndex: tgt,
                })
              : applyAction(content, s, { type: 'endTurn' });
        } else if (s.phase === 'reward') {
          s = applyAction(content, s, { type: 'skipReward' });
        } else if (s.phase === 'victory' || s.phase === 'defeat') {
          break;
        } else if (s.phase === 'shop') {
          s = applyAction(content, s, { type: 'leaveShop' });
        } else if (s.phase === 'rest') {
          s = applyAction(content, s, { type: 'rest' });
        } else if (s.phase === 'event') {
          if (s.event?.result) {
            s = applyAction(content, s, { type: 'continueEvent' });
          } else {
            const def = s.event ? content.events[s.event.eventId] : undefined;
            const idx = (def?.options ?? []).findIndex((o) =>
              eventRequirementMet(s, o.requires),
            );
            s = applyAction(content, s, {
              type: 'chooseEventOption',
              index: idx < 0 ? 0 : idx,
            });
          }
        } else {
          break;
        }
      }
      return seen;
    };

    const flat = walkCombats(ARC(undefined));
    const ramped = walkCombats(ARC([1.0, 2.0, 3.0]));
    expect(flat.length).toBeGreaterThan(0);
    expect(ramped.length).toBe(flat.length);

    let sawAct0 = false;
    let sawLater = false;
    for (let i = 0; i < flat.length; i++) {
      const f = flat[i]!;
      const r = ramped[i]!;
      expect(r.act).toBe(f.act);
      if (f.act === 0) {
        // Act 0's scalar is 1.0 → identical roll (single byte-identity preserved).
        expect(r.hp).toBe(f.hp);
        sawAct0 = true;
      } else {
        // Later acts scale by the ramp, applied AFTER the roll.
        expect(r.hp).toBe(Math.max(1, Math.round(f.hp * (f.act === 1 ? 2 : 3))));
        sawLater = true;
      }
    }
    expect(sawAct0).toBe(true);
    expect(sawLater).toBe(true);
  });

  it('defaults actHpRamp to empty (every act multiplies by 1 → no-op)', () => {
    expect(run('alpha').actHpRamp).toEqual([]);
  });

  it('starts at the map start with the starter deck', () => {
    const state = run('alpha');
    expect(state.phase).toBe('map');
    expect(state.currentNodeId).toBe(state.map.startId);
    expect(state.deck).toHaveLength(DEFAULT_RUN_CONFIG.starterDeck.length);
    expect(state.hp).toBe(DEFAULT_RUN_CONFIG.maxHp);
  });
});

describe('#69 tiered reveal: eventId decided at generation', () => {
  it('assigns a real content eventId to every event node (and none elsewhere)', () => {
    for (let i = 0; i < 50; i++) {
      const s = createRun(content, `ev-gen-${i}`, { ...DEFAULT_RUN_CONFIG, acts: 3 });
      for (const node of Object.values(s.map.nodes)) {
        if (node.kind === 'event') {
          expect(node.eventId, node.id).toBeDefined();
          expect(content.events[node.eventId as string], node.eventId).toBeDefined();
        } else {
          expect(node.eventId, node.id).toBeUndefined();
        }
      }
    }
  });

  it('entering an event uses the STORED eventId — no re-roll at entry', () => {
    // Find an arc seed with an event node reachable from a parent.
    let found: { state: RunState; parent: MapNode; ev: MapNode } | undefined;
    for (let i = 0; i < 200 && !found; i++) {
      const s = createRun(content, `ev-enter-${i}`, { ...DEFAULT_RUN_CONFIG, acts: 3 });
      for (const ev of Object.values(s.map.nodes)) {
        if (ev.kind !== 'event') continue;
        const parent = Object.values(s.map.nodes).find((p) => p.next.includes(ev.id));
        if (parent) {
          found = { state: s, parent, ev };
          break;
        }
      }
    }
    expect(found, 'an arc seed has a reachable event node').toBeDefined();
    const { state, parent, ev } = found as { state: RunState; parent: MapNode; ev: MapNode };
    // Override the stored eventId to a sentinel; entry must read exactly it.
    const sentinel = 'shrine-of-the-crawl';
    const nodes = { ...state.map.nodes, [ev.id]: { ...ev, eventId: sentinel } };
    const parked: RunState = {
      ...state,
      map: { ...state.map, nodes },
      phase: 'map',
      currentNodeId: parent.id,
    };
    const entered = applyAction(content, parked, { type: 'chooseNode', nodeId: ev.id });
    expect(entered.phase).toBe('event');
    expect(entered.event?.eventId).toBe(sentinel);
    // No rng consumed at entry (the roll already happened at generation).
    expect(entered.rng).toEqual(parked.rng);
  });
});

describe('per-act-transition exhaustion (#32)', () => {
  // Build an arc (3-act) run and locate the act-0 cap node (the act boss elite
  // that links into act 1's first row). Crossing this boundary is the ONLY place
  // the toll fires. Single mode (act 0 only) has no such boundary.
  const ARC = { ...DEFAULT_RUN_CONFIG, acts: 3 };
  const arcRun = (seed: string) => createRun(content, seed, ARC);

  /** The act-N cap node and one of its act-(N+1) successors, for any seed. */
  const actBoundary = (s: RunState, fromAct: number) => {
    const cap = Object.values(s.map.nodes).find(
      (n) => n.act === fromAct && n.next.some((id) => s.map.nodes[id]?.act === fromAct + 1),
    );
    const into = cap?.next.map((id) => s.map.nodes[id]).find((n) => n?.act === fromAct + 1);
    return { cap, into };
  };

  it('lowers max HP (and clamps current HP) when advancing into the next act', () => {
    const base = arcRun('exhaust-seed');
    const { cap, into } = actBoundary(base, 0);
    expect(cap).toBeDefined();
    expect(into).toBeDefined();
    // Sit at the act-0 cap, full HP, then descend into act 1.
    const atCap: RunState = { ...base, phase: 'map', currentNodeId: cap!.id };
    const crossed = applyAction(content, atCap, { type: 'chooseNode', nodeId: into!.id });
    expect(crossed.maxHp).toBe(base.maxHp - ACT_TRANSITION_EXHAUSTION_HP);
    // Current HP was at the (old) max, so it is clamped down to the new max.
    expect(crossed.hp).toBe(base.maxHp - ACT_TRANSITION_EXHAUSTION_HP);
    expect(crossed.currentNodeId).toBe(into!.id);
  });

  it('does NOT drop HP below the lowered max, but does clamp a full bar', () => {
    const base = arcRun('exhaust-seed');
    const { cap, into } = actBoundary(base, 0);
    // Already injured well below the new ceiling → current HP is untouched, only
    // max HP falls.
    const lowHp = base.maxHp - ACT_TRANSITION_EXHAUSTION_HP - 15;
    const injured: RunState = { ...base, phase: 'map', currentNodeId: cap!.id, hp: lowHp };
    const crossed = applyAction(content, injured, { type: 'chooseNode', nodeId: into!.id });
    expect(crossed.maxHp).toBe(base.maxHp - ACT_TRANSITION_EXHAUSTION_HP);
    expect(crossed.hp).toBe(lowHp);
  });

  it('clamps HP and max HP to >= 1 — exhaustion can never be lethal', () => {
    const base = arcRun('exhaust-seed');
    const { cap, into } = actBoundary(base, 0);
    // Force a tiny max HP so the fixed toll would otherwise drive it to <= 0.
    const frail: RunState = {
      ...base,
      phase: 'map',
      currentNodeId: cap!.id,
      hp: 1,
      maxHp: 3,
    };
    const crossed = applyAction(content, frail, { type: 'chooseNode', nodeId: into!.id });
    expect(crossed.maxHp).toBe(1);
    expect(crossed.hp).toBe(1);
    expect(crossed.phase).not.toBe('defeat');
  });

  it('does NOT fire on intra-act moves (same act → no toll)', () => {
    const base = arcRun('exhaust-seed');
    // First map move from the start node stays within act 0.
    const first = base.map.nodes[base.currentNodeId]?.next[0] as string;
    expect(base.map.nodes[first]?.act).toBe(0);
    const moved = applyAction(content, base, { type: 'chooseNode', nodeId: first });
    expect(moved.maxHp).toBe(base.maxHp); // unchanged
  });

  it('single mode has no act transition, so the toll never fires (and is byte-identical)', () => {
    // Single mode is act 0 only: NO node has an act-1 successor, so the toll's
    // `toAct > fromAct` guard is never satisfied. Walking the whole single-mode
    // map never lowers maxHp below the starting value.
    const single = run('single-no-toll');
    expect(Object.values(single.map.nodes).every((n) => n.act === 0)).toBe(true);
    // A determinism cross-check: a single-mode run is identical to itself, and
    // the default-config replay used elsewhere is unaffected by this change.
    expect(run('single-no-toll')).toEqual(run('single-no-toll'));
  });
});

describe('applyAction', () => {
  it('chooseNode follows edges and rejects non-edges', () => {
    const state = run('alpha');
    const first = state.map.nodes[state.currentNodeId]?.next[0] as string;
    const moved = applyAction(content, state, { type: 'chooseNode', nodeId: first });
    expect(moved.currentNodeId).toBe(first);
    expect(moved.phase).toBe('combat'); // row 1 is always combat
    expect(() =>
      applyAction(content, state, { type: 'chooseNode', nodeId: state.map.bossId }),
    ).toThrow(EngineError);
  });

  it('enforces phase guards', () => {
    const state = run('alpha');
    expect(() => applyAction(content, state, { type: 'endTurn' })).toThrow(EngineError);
    expect(() => applyAction(content, state, { type: 'rest' })).toThrow(EngineError);
  });

  it('rest heals 20% of max HP, capped', () => {
    const state: RunState = { ...run('alpha'), phase: 'rest', hp: 10 };
    const rested = applyAction(content, state, { type: 'rest' });
    expect(rested.hp).toBe(10 + Math.floor(70 * 0.2));
    expect(rested.phase).toBe('map');
  });

  it('upgradeCard swaps the deck slot to the upgraded id and returns to the map', () => {
    const base: RunState = {
      ...run('alpha'),
      phase: 'rest',
      deck: ['rusty-shortsword', 'battered-buckler', 'rusty-shortsword'],
    };
    const upgraded = applyAction(content, base, { type: 'upgradeCard', deckIndex: 0 });
    expect(upgraded.deck).toEqual([
      'rusty-shortsword-plus',
      'battered-buckler',
      'rusty-shortsword',
    ]);
    expect(upgraded.phase).toBe('map');
  });

  it('upgradeCard is rest-phase only', () => {
    const onMap: RunState = {
      ...run('alpha'),
      phase: 'map',
      deck: ['rusty-shortsword'],
    };
    expect(() =>
      applyAction(content, onMap, { type: 'upgradeCard', deckIndex: 0 }),
    ).toThrow(EngineError);
  });

  it('upgradeCard rejects an out-of-range deck index', () => {
    const state: RunState = { ...run('alpha'), phase: 'rest', deck: ['rusty-shortsword'] };
    expect(() =>
      applyAction(content, state, { type: 'upgradeCard', deckIndex: 5 }),
    ).toThrow(EngineError);
  });

  it('upgradeCard rejects a card that has no upgrade', () => {
    // adrenaline-rush is authored without an upgradeTo.
    const state: RunState = { ...run('alpha'), phase: 'rest', deck: ['adrenaline-rush'] };
    expect(() =>
      applyAction(content, state, { type: 'upgradeCard', deckIndex: 0 }),
    ).toThrow(EngineError);
  });

  it('reward pick adds the card and returns to the map', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'reward',
      reward: { cards: ['lucky-dagger'], gold: 0 },
    };
    const picked = applyAction(content, state, { type: 'pickRewardCard', index: 0 });
    expect(picked.deck).toContain('lucky-dagger');
    expect(picked.phase).toBe('map');
    expect(picked.reward).toBeNull();
  });

  it('buyCard spends gold and marks the slot sold', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'shop',
      gold: 100,
      shop: { stock: [{ cardId: 'shield-wall', price: 50, sold: false }], potionStock: [], removeUsed: false },
    };
    const bought = applyAction(content, state, { type: 'buyCard', index: 0 });
    expect(bought.gold).toBe(50);
    expect(bought.deck).toContain('shield-wall');
    expect(bought.shop?.stock[0]?.sold).toBe(true);
    expect(() => applyAction(content, bought, { type: 'buyCard', index: 0 })).toThrow(
      EngineError,
    );
  });

  it('usePotion applies effects, consumes the potion, and is combat-only', () => {
    const base = run('alpha');
    const first = base.map.nodes[base.currentNodeId]?.next[0] as string;
    const inCombat = applyAction(content, base, { type: 'chooseNode', nodeId: first });
    expect(inCombat.phase).toBe('combat');
    const armed: RunState = { ...inCombat, potions: ['iron-tonic'] };
    const used = applyAction(content, armed, { type: 'usePotion', potionIndex: 0 });
    expect(used.combat?.playerBlock).toBe(12); // Iron Tonic = 12 block
    expect(used.potions).toHaveLength(0); // consumed

    // Out of combat the action is rejected.
    expect(() =>
      applyAction(content, { ...base, potions: ['iron-tonic'] }, {
        type: 'usePotion',
        potionIndex: 0,
      }),
    ).toThrow(EngineError);
    // Unknown index rejected.
    expect(() =>
      applyAction(content, armed, { type: 'usePotion', potionIndex: 5 }),
    ).toThrow(EngineError);
  });

  it('buyPotion deducts gold, fills a slot, and respects sold/full', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'shop',
      gold: 100,
      potions: [],
      maxPotions: 1,
      shop: {
        stock: [],
        potionStock: [{ potionId: 'fire-flask', price: 35, sold: false }],
        removeUsed: false,
      },
    };
    const bought = applyAction(content, state, { type: 'buyPotion', index: 0 });
    expect(bought.gold).toBe(65);
    expect(bought.potions).toEqual(['fire-flask']);
    expect(bought.shop?.potionStock[0]?.sold).toBe(true);
    // Already sold -> reject.
    expect(() => applyAction(content, bought, { type: 'buyPotion', index: 0 })).toThrow(
      EngineError,
    );
    // Full satchel (maxPotions 1) -> reject even on a fresh unsold slot.
    const full: RunState = {
      ...state,
      potions: ['healing-draught'],
    };
    expect(() => applyAction(content, full, { type: 'buyPotion', index: 0 })).toThrow(
      EngineError,
    );
  });

  it('removeCard removes the chosen card, charges gold, and marks removal used (#49)', () => {
    const state: RunState = {
      ...run('alpha'),
      phase: 'shop',
      gold: 100,
      deck: ['rusty-shortsword', 'shield-wall', 'a', 'b', 'c', 'd'],
      shop: { stock: [], potionStock: [], removeUsed: false },
    };
    const removed = applyAction(content, state, { type: 'removeCard', deckIndex: 1 });
    expect(removed.deck).toEqual(['rusty-shortsword', 'a', 'b', 'c', 'd']); // index 1 gone
    expect(removed.gold).toBe(50); // 100 - SHOP_REMOVAL_COST (50)
    expect(removed.shop?.removeUsed).toBe(true);
    // A second removal in the same shop visit is rejected.
    expect(() => applyAction(content, removed, { type: 'removeCard', deckIndex: 0 })).toThrow(
      EngineError,
    );
  });

  it('removeCard rejects when poor, deck at floor, bad index, or not at a shop (#49)', () => {
    const okShop = { stock: [], potionStock: [], removeUsed: false };
    const sixCards = ['a', 'b', 'c', 'd', 'e', 'f'];
    // Insufficient gold.
    expect(() =>
      applyAction(content, { ...run('alpha'), phase: 'shop', gold: 10, deck: sixCards, shop: okShop }, {
        type: 'removeCard',
        deckIndex: 0,
      }),
    ).toThrow(EngineError);
    // Deck at the floor (5 cards) — removal would drop below the floor.
    expect(() =>
      applyAction(
        content,
        { ...run('alpha'), phase: 'shop', gold: 100, deck: ['a', 'b', 'c', 'd', 'e'], shop: okShop },
        { type: 'removeCard', deckIndex: 0 },
      ),
    ).toThrow(EngineError);
    // Out-of-range deck index.
    expect(() =>
      applyAction(content, { ...run('alpha'), phase: 'shop', gold: 100, deck: sixCards, shop: okShop }, {
        type: 'removeCard',
        deckIndex: 9,
      }),
    ).toThrow(EngineError);
    // Not at a shop (wrong phase).
    expect(() =>
      applyAction(content, { ...run('alpha'), gold: 100 }, { type: 'removeCard', deckIndex: 0 }),
    ).toThrow(EngineError);
  });

  it('reward potion grant respects the slot limit', () => {
    const room: RunState = {
      ...run('alpha'),
      phase: 'reward',
      potions: [],
      maxPotions: 2,
      reward: { cards: ['lucky-dagger'], gold: 0, potionId: 'fire-flask' },
    };
    const picked = applyAction(content, room, { type: 'pickRewardCard', index: 0 });
    expect(picked.potions).toEqual(['fire-flask']);

    const full: RunState = {
      ...room,
      potions: ['healing-draught', 'iron-tonic'],
    };
    const skipped = applyAction(content, full, { type: 'skipReward' });
    expect(skipped.potions).toHaveLength(2); // unchanged, no overflow
  });

  it('event outcomes apply via a result screen, then continue returns to map', () => {
    const base = run('alpha');
    const shrine: RunState = {
      ...base,
      phase: 'event',
      event: { eventId: 'shrine-of-the-crawl' },
    };
    // Choosing an option that applies outcomes shows a result, not the map.
    // "Tithe and pray" costs 20 gold for +6 max HP.
    const prayed = applyAction(content, shrine, { type: 'chooseEventOption', index: 0 });
    expect(prayed.maxHp).toBe(base.maxHp + 6);
    expect(prayed.hp).toBe(base.hp + 6);
    expect(prayed.gold).toBe(base.gold - 20);
    expect(prayed.phase).toBe('event');
    expect(prayed.event?.result?.applied).toEqual([
      { kind: 'loseGold', amount: 20 },
      { kind: 'gainMaxHp', amount: 6 },
    ]);
    expect(prayed.event?.result?.rolled).toBe(false);

    // Continue clears the event and returns to the map.
    const after = applyAction(content, prayed, { type: 'continueEvent' });
    expect(after.phase).toBe('map');
    expect(after.event).toBeNull();
  });

  it('lethal event outcomes end the run with no result screen', () => {
    const base = run('alpha');
    const shrine: RunState = {
      ...base,
      phase: 'event',
      event: { eventId: 'shrine-of-the-crawl' },
      hp: 3,
    };
    // "Pry up the offerings" costs 5 HP → lethal at 3 HP.
    const looted = applyAction(content, shrine, { type: 'chooseEventOption', index: 1 });
    expect(looted.phase).toBe('defeat');
    expect(looted.event).toBeNull();
  });

  it('an empty-outcome option (Walk away) goes straight to the map', () => {
    const base = run('alpha');
    const vending: RunState = {
      ...base,
      phase: 'event',
      event: { eventId: 'abandoned-vending-machine' },
    };
    // Option 2 (index 2) is "Walk away" with no outcomes.
    const left = applyAction(content, vending, { type: 'chooseEventOption', index: 2 });
    expect(left.phase).toBe('map');
    expect(left.event).toBeNull();
  });

  it('rollOutcomes is deterministic per seed and varies across seeds', () => {
    const onVending = (seed: string): RunState => ({
      ...run(seed),
      phase: 'event',
      event: { eventId: 'abandoned-vending-machine' },
    });
    const resolve = (s: RunState) =>
      applyAction(content, s, { type: 'chooseEventOption', index: 0 }).event?.result?.applied;

    // Same seed → identical branch.
    const a1 = resolve(onVending('roll-seed-A'));
    const a2 = resolve(onVending('roll-seed-A'));
    expect(a1).toEqual(a2);
    // The result is flagged as rolled.
    const rolledState = applyAction(content, onVending('roll-seed-A'), {
      type: 'chooseEventOption',
      index: 0,
    });
    expect(rolledState.event?.result?.rolled).toBe(true);

    // Different seeds can pick different branches across the kick event.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(JSON.stringify(resolve(onVending(`roll-vary-${i}`))));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('conditional outcomes branch on player state (ifPass vs ifFail)', () => {
    const base = run('alpha');
    const idol = (relics: readonly string[]): RunState => ({
      ...base,
      phase: 'event',
      event: { eventId: 'cursed-idol' },
      relics: [...relics],
    });
    // < 3 relics → heavy bite (ifFail: lose 9 HP).
    const poor = applyAction(content, idol([]), { type: 'chooseEventOption', index: 0 });
    expect(poor.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 9 });
    // >= 3 relics → warded (ifPass: lose only 2 HP).
    const rich = applyAction(content, idol(['whetstone', 'lucky-coin', 'troll-tooth']), {
      type: 'chooseEventOption',
      index: 0,
    });
    expect(rich.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 2 });
  });

  // #34: difficulty-scaled event lethality. The cursed-idol ifFail branch is a
  // fixed 9-HP loss; with a healthy player the max(base, 50%-of-max-HP) cap is
  // well above the scaled value, so we read pure scaling. Default config
  // (normal) is mult 1 → byte-identical.
  describe('#34 event loseHp scaling', () => {
    const idolFail = (
      cfg: Parameters<typeof createRun>[2],
      hp = 60,
      maxHp?: number,
    ): RunState => {
      const base = createRun(content, 'idol-seed', cfg);
      const onIdol: RunState = {
        ...base,
        phase: 'event',
        event: { eventId: 'cursed-idol' },
        relics: [], // < 3 relics → ifFail (lose HP)
        hp,
        ...(maxHp !== undefined ? { maxHp } : {}),
      };
      return applyAction(content, onIdol, { type: 'chooseEventOption', index: 0 });
    };

    it('normal (mult 1, default) is unchanged — loses the base 9 HP', () => {
      const r = idolFail(DEFAULT_RUN_CONFIG);
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 9 });
      expect(r.hp).toBe(51);
    });

    it('hard scales loseHp by 1.25 → floor(9*1.25)=11', () => {
      const r = idolFail({ ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.25 });
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 11 });
      expect(r.hp).toBe(49);
    });

    it('nightmare scales loseHp by 1.5 → floor(9*1.5)=13', () => {
      const r = idolFail({ ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.5 });
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 13 });
      expect(r.hp).toBe(47);
    });

    it('caps the SCALED loss at max(base, 50% of MAX HP) (no cheap one-shots)', () => {
      // maxHp 20 → cap = max(base 9, floor(20*0.5)=10) = 10; nightmare scales
      // 9→13, clamped down to 10. (hp is full at 20 here.)
      const r = idolFail({ ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.5 }, 20, 20);
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 10 });
      expect(r.hp).toBe(10);
    });

    it('cap uses MAX HP, not current HP — does not shrink when wounded', () => {
      // Same maxHp 20 (cap 10) but wounded to 14 HP. The cap stays 10 (not
      // floor(14*…)), so the scaled 13 is clamped to 10, dropping HP to 4 — a
      // current-HP cap would have softened this. The lethal band is real and
      // stable; the #24 hint shows the scaled stakes so it's informed consent.
      const r = idolFail({ ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.5 }, 14, 20);
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 10 });
      expect(r.hp).toBe(4);
    });

    it('a scaled event CAN be the killing blow for a warned, wounded player', () => {
      // maxHp 20 (cap 10), wounded to 9 HP. Nightmare scaling lands the full
      // capped 10 → defeat. This is the feature: events occasionally lethal at
      // hard+ for a wounded player (vs flat/never on normal).
      const r = idolFail({ ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.5 }, 9, 20);
      expect(r.phase).toBe('defeat');
    });

    it('cap floor is the base amount: an author-lethal event stays lethal on normal', () => {
      // shrine "Pry up the offerings" is a flat 5-HP loss; on normal (mult 1)
      // the loss is the base 5 (the cap never reduces it — base is the floor),
      // so at 3 HP it is still lethal: byte-identical to pre-#34.
      const base = run('alpha');
      const shrine: RunState = {
        ...base,
        phase: 'event',
        event: { eventId: 'shrine-of-the-crawl' },
        hp: 3,
      };
      const looted = applyAction(content, shrine, { type: 'chooseEventOption', index: 1 });
      expect(looted.phase).toBe('defeat');
    });

    it('does not scale gains (gold/maxHp/relics) — only loseHp', () => {
      // abandoned-cache "Force it open": +40 gold, -5 HP. Nightmare scales only HP.
      const base = createRun(content, 'cache-seed', { ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1.5 });
      const cache: RunState = { ...base, phase: 'event', event: { eventId: 'abandoned-cache' }, hp: 60 };
      const r = applyAction(content, cache, { type: 'chooseEventOption', index: 0 });
      expect(r.event?.result?.applied).toContainEqual({ kind: 'gainGold', amount: 40 });
      expect(r.event?.result?.applied).toContainEqual({ kind: 'loseHp', amount: 7 }); // floor(5*1.5)
    });

    it('defaults eventLoseHpMult to 1 and does not shift the rng stream', () => {
      expect(run('alpha').eventLoseHpMult).toBe(1);
      // The rng/state of a default run equals one built with an explicit mult of
      // 1 — the scalar never draws rng, so the stream is identical regardless.
      const explicit = createRun(content, 'alpha', { ...DEFAULT_RUN_CONFIG, eventLoseHpMult: 1 });
      expect(explicit.rng).toEqual(run('alpha').rng);
    });
  });

  it('a stat-gated option is excluded from legalActions unless affordable', () => {
    const base = run('alpha');
    const toll = (gold: number): RunState => ({
      ...base,
      phase: 'event',
      event: { eventId: 'goblin-toll-booth' },
      gold,
    });
    // Option 0 "Pay the toll" requires 30 gold.
    const poor = legalActions(content, toll(10));
    expect(poor).not.toContainEqual({ type: 'chooseEventOption', index: 0 });
    const rich = legalActions(content, toll(50));
    expect(rich).toContainEqual({ type: 'chooseEventOption', index: 0 });
    // Dispatching the gated option while unaffordable throws.
    expect(() => applyAction(content, toll(10), { type: 'chooseEventOption', index: 0 })).toThrow();
  });

  it('continueEvent is the only legal action while a result is showing', () => {
    const base = run('alpha');
    const shrine: RunState = {
      ...base,
      phase: 'event',
      event: { eventId: 'shrine-of-the-crawl' },
    };
    const prayed = applyAction(content, shrine, { type: 'chooseEventOption', index: 0 });
    expect(legalActions(content, prayed)).toEqual([{ type: 'continueEvent' }]);
  });
});

describe('rollCardChoices depth-scaled rarity weighting (D3)', () => {
  const weightOf = (act: number, rarity: 'common' | 'uncommon' | 'rare') =>
    RARITY_WEIGHTS_BY_ACT[act]!.find(([r]) => r === rarity)![1];

  it('act 0 weight row is exactly [0.6, 0.3, 0.1] (single-mode invariant)', () => {
    // Single mode is act 0 only; this row must never change or act-0/single
    // reward & shop draws would diverge from the historical flat weighting.
    expect(RARITY_WEIGHTS_BY_ACT[0]).toEqual([
      ['common', 0.6],
      ['uncommon', 0.3],
      ['rare', 0.1],
    ]);
  });

  it('every act row sums to ~1', () => {
    for (const row of RARITY_WEIGHTS_BY_ACT) {
      const sum = row.reduce((a, [, w]) => a + w, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('deeper acts tilt toward higher rarity (monotonic non-decreasing)', () => {
    for (let act = 1; act < RARITY_WEIGHTS_BY_ACT.length; act++) {
      // uncommon and rare weights never drop vs act 0, and at least one rises.
      expect(weightOf(act, 'uncommon')).toBeGreaterThanOrEqual(weightOf(0, 'uncommon'));
      expect(weightOf(act, 'rare')).toBeGreaterThanOrEqual(weightOf(0, 'rare'));
      expect(weightOf(act, 'common')).toBeLessThanOrEqual(weightOf(0, 'common'));
      // and strictly improving versus the previous act
      expect(weightOf(act, 'rare')).toBeGreaterThan(weightOf(act - 1, 'rare'));
      expect(weightOf(act, 'uncommon')).toBeGreaterThanOrEqual(weightOf(act - 1, 'uncommon'));
    }
  });

  it('act 0 rolls are byte-identical to a flat [0.6,0.3,0.1] reference roll', () => {
    // Re-implement the historical flat algorithm and assert act-0 matches it
    // for a fixed seed and identical rng consumption.
    const flatWeights: [string, number][] = [
      ['common', 0.6],
      ['uncommon', 0.3],
      ['rare', 0.1],
    ];
    const byRarity = new Map<string, { id: string }[]>();
    for (const card of Object.values(content.cards).sort((a, b) => a.id.localeCompare(b.id))) {
      if (card.rarity === 'starter') continue;
      if (UPGRADE_TARGET_IDS.has(card.id)) continue;
      // E2: the default draft pool excludes unlockable extras (none allowed here),
      // so the reference re-implementation must mirror that to stay byte-identical.
      if (UNLOCKABLE_CARD_IDS.has(card.id)) continue;
      byRarity.set(card.rarity, [...(byRarity.get(card.rarity) ?? []), card]);
    }
    const flatRoll = (rng: Rng, count: number): string[] => {
      const choices: string[] = [];
      for (let i = 0; i < count * 10 && choices.length < count; i++) {
        let roll = rng.next();
        let rarity = 'common';
        for (const [r, w] of flatWeights) {
          roll -= w;
          if (roll < 0) {
            rarity = r;
            break;
          }
        }
        const pool = byRarity.get(rarity);
        if (!pool || pool.length === 0) continue;
        const picked = rng.pick(pool);
        if (!choices.includes(picked.id)) choices.push(picked.id);
      }
      return choices;
    };
    for (const seed of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      const a = rollCardChoices(content, new Rng(seedFromString(seed)), 3, 0);
      const b = flatRoll(new Rng(seedFromString(seed)), 3);
      expect(a).toEqual(b);
    }
  });

  it('act 2 yields more uncommon+rare than act 0 over many seeded rolls', () => {
    const tally = (act: number) => {
      let higher = 0;
      let total = 0;
      for (let i = 0; i < 4000; i++) {
        const ids = rollCardChoices(content, new Rng(seedFromString(`s-${i}`)), 1, act);
        for (const id of ids) {
          total++;
          if (content.cards[id]!.rarity !== 'common') higher++;
        }
      }
      return higher / total;
    };
    const act0 = tally(0);
    const act2 = tally(2);
    // Act 0 ~0.4 higher-rarity share; act 2 should be meaningfully larger.
    expect(act2).toBeGreaterThan(act0 + 0.05);
  });

  it('excludes starters and upgrade targets at every act, with no dupes', () => {
    for (let act = 0; act < RARITY_WEIGHTS_BY_ACT.length; act++) {
      for (let i = 0; i < 200; i++) {
        const ids = rollCardChoices(content, new Rng(seedFromString(`x-${act}-${i}`)), 3, act);
        expect(new Set(ids).size).toBe(ids.length); // dedupe within offer
        for (const id of ids) {
          expect(content.cards[id]!.rarity).not.toBe('starter');
          expect(UPGRADE_TARGET_IDS.has(id)).toBe(false);
        }
      }
    }
  });

  it('clamps act beyond the table to the deepest row', () => {
    const seed = () => new Rng(seedFromString('clamp'));
    expect(rollCardChoices(content, seed(), 3, 99)).toEqual(
      rollCardChoices(content, seed(), 3, RARITY_WEIGHTS_BY_ACT.length - 1),
    );
  });
});

describe('E2 unlock gating of the draft pool', () => {
  // Re-derive the full default pool (the way rollCardChoices builds it with no
  // unlocks) so we can assert membership directly.
  const defaultPool = (): Set<string> => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      for (const id of rollCardChoices(content, new Rng(seedFromString(`pool-${i}`)), 3, 2)) {
        seen.add(id);
      }
    }
    return seen;
  };

  it('default (no allow set) excludes every unlockable card', () => {
    const pool = defaultPool();
    for (const id of UNLOCKABLE_CARD_IDS) {
      expect(pool.has(id), `${id} must be locked out by default`).toBe(false);
    }
    // sanity: the core pool is still substantial
    expect(pool.size).toBeGreaterThan(20);
  });

  it('an allowed unlockable card CAN be drafted once unlocked', () => {
    const target = 'crawlers-resolve';
    expect(UNLOCKABLE_CARD_IDS.has(target)).toBe(true);
    let appeared = false;
    for (let i = 0; i < 2000 && !appeared; i++) {
      const ids = rollCardChoices(content, new Rng(seedFromString(`u-${i}`)), 3, 2, [target]);
      if (ids.includes(target)) appeared = true;
    }
    expect(appeared, `${target} should be draftable when allowed`).toBe(true);
  });

  it('allowing one unlockable does NOT admit the others', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      for (const id of rollCardChoices(content, new Rng(seedFromString(`o-${i}`)), 3, 2, [
        'crawlers-resolve',
      ])) {
        seen.add(id);
      }
    }
    for (const id of UNLOCKABLE_CARD_IDS) {
      if (id === 'crawlers-resolve') continue;
      expect(seen.has(id), `${id} must stay locked`).toBe(false);
    }
  });

  it('createRun captures allowedUnlockIds onto state (determinism across resume)', () => {
    const state = createRun(content, 'cap', { ...DEFAULT_RUN_CONFIG, allowedUnlockIds: ['arc-warden'] });
    expect(state.allowedUnlockIds).toEqual(['arc-warden']);
    // DEFAULT (no allow) → empty list on state → core-only pool.
    expect(createRun(content, 'cap', DEFAULT_RUN_CONFIG).allowedUnlockIds).toEqual([]);
  });
});

describe('run stats (#25)', () => {
  // Build a controlled in-combat run: one cave-rat (Bite = 5 dmg at move idx 0),
  // a hand of rusty-shortsword (6 dmg). enemyHp drives win vs loss; stats fold
  // ONCE at resolution. No rng in the stat counters — fully deterministic.
  const enemy = (hp: number): EnemyInstance => ({
    defId: 'cave-rat',
    name: 'Cave Rat',
    hp,
    maxHp: hp,
    block: 0,
    statuses: {},
    nextMoveIndex: 0, // Bite (5 damage) on the next enemy turn
  });

  const combatRun = (enemyHp: number, playerHp = 50): RunState => {
    const base = run('stats-seed');
    const combat: CombatState = {
      enemies: [enemy(enemyHp)],
      hand: ['rusty-shortsword', 'rusty-shortsword'],
      drawPile: ['rusty-shortsword', 'rusty-shortsword', 'rusty-shortsword'],
      discardPile: [],
      energy: 3,
      maxEnergy: 3,
      playerHp,
      playerMaxHp: 50,
      playerBlock: 0,
      playerStatuses: {},
      turn: 1,
      dealt: 0,
      taken: 0,
      slain: 0,
    };
    return { ...base, phase: 'combat', combat };
  };

  it('tracks dealt/taken/slain/turns on a one-card winning kill', () => {
    // Enemy at 6 HP, one 6-damage strike kills it → combat WON, fold once.
    const won = applyAction(content, combatRun(6), {
      type: 'playCard',
      handIndex: 0,
      targetIndex: 0,
    });
    expect(won.phase).toBe('reward'); // resolved (non-boss win → reward)
    expect(won.stats.damageDealt).toBe(6);
    expect(won.stats.enemiesSlain).toBe(1);
    expect(won.stats.damageTaken).toBe(0); // killed before it could act
    expect(won.stats.turns).toBe(1); // resolved on turn 1
  });

  it('counts player damage taken across an endTurn, then folds on the killing turn', () => {
    // Enemy at 10 HP. Strike once (6 dmg, survives), endTurn → Bite 5 taken,
    // then strike twice more (12 dmg) to kill on turn 2.
    let s = combatRun(10);
    s = applyAction(content, s, { type: 'playCard', handIndex: 0, targetIndex: 0 });
    expect(s.combat?.dealt).toBe(6);
    expect(s.combat?.slain).toBe(0);
    s = applyAction(content, s, { type: 'endTurn' });
    expect(s.phase).toBe('combat');
    expect(s.combat?.taken).toBe(5); // Bite landed (no block)
    expect(s.combat?.turn).toBe(2);
    // One more strike (6) finishes the 4 HP remaining → kill on turn 2.
    s = applyAction(content, s, { type: 'playCard', handIndex: 0, targetIndex: 0 });
    expect(s.phase).toBe('reward');
    // damageDealt counts HP ACTUALLY removed: 6, then only 4 left → 6 + 4 = 10.
    expect(s.stats.damageDealt).toBe(10);
    expect(s.stats.damageTaken).toBe(5);
    expect(s.stats.enemiesSlain).toBe(1);
    expect(s.stats.turns).toBe(2);
  });

  it('folds stats on a LOSS too (fatal combat still tallies damage/turns)', () => {
    // Player at 5 HP, enemy at 100 (won't die). Strike for 6 (dealt), endTurn →
    // Bite 5 kills the player → defeat, fold once.
    let s = combatRun(100, 5);
    s = applyAction(content, s, { type: 'playCard', handIndex: 0, targetIndex: 0 });
    s = applyAction(content, s, { type: 'endTurn' });
    expect(s.phase).toBe('defeat');
    expect(s.stats.damageDealt).toBe(6);
    expect(s.stats.damageTaken).toBe(5);
    expect(s.stats.enemiesSlain).toBe(0);
    expect(s.stats.turns).toBe(1); // died during turn 1's enemy phase
  });

  it('does not fold while a combat is still in progress (no double-count)', () => {
    // Strike a high-HP enemy: combat continues, run-level stats stay zero until
    // resolution; only the combat-scoped counters move.
    const s = applyAction(content, combatRun(100), {
      type: 'playCard',
      handIndex: 0,
      targetIndex: 0,
    });
    expect(s.phase).toBe('combat');
    expect(s.combat?.dealt).toBe(6);
    expect(s.stats).toEqual({ turns: 0, damageDealt: 0, damageTaken: 0, enemiesSlain: 0 });
  });
});

describe('onCombatEnd relics (D9 post-victory sustain)', () => {
  // A controlled winnable combat on a plain COMBAT node (no elite relic roll, so
  // owner/non-owner loot rolls stay byte-identical). One strike (6 dmg) kills the
  // 1-HP enemy on turn 1; onCombatEnd fires in finishCombat against RUN hp.
  const enemy = (hp: number): EnemyInstance => ({
    defId: 'cave-rat',
    name: 'Cave Rat',
    hp,
    maxHp: hp,
    block: 0,
    statuses: {},
    nextMoveIndex: 0, // Bite (5 damage) on the next enemy turn
  });

  const winnableRun = (opts: {
    relics?: readonly string[];
    playerHp?: number;
    maxHp?: number;
    enemyHp?: number;
  }): RunState => {
    const base = run('oncombatend-seed');
    const playerHp = opts.playerHp ?? 30;
    const maxHp = opts.maxHp ?? 50;
    const combatNodeId = Object.keys(base.map.nodes).find(
      (id) => base.map.nodes[id]?.kind === 'combat',
    ) as string;
    const combat: CombatState = {
      enemies: [enemy(opts.enemyHp ?? 1)],
      hand: ['rusty-shortsword', 'rusty-shortsword'],
      drawPile: ['rusty-shortsword', 'rusty-shortsword'],
      discardPile: [],
      energy: 3,
      maxEnergy: 3,
      playerHp,
      playerMaxHp: maxHp,
      playerBlock: 0,
      playerStatuses: {},
      turn: 1,
      dealt: 0,
      taken: 0,
      slain: 0,
    };
    return {
      ...base,
      currentNodeId: combatNodeId,
      phase: 'combat',
      hp: playerHp,
      maxHp,
      relics: [...(opts.relics ?? [])],
      combat,
    };
  };

  const strike = (s: RunState) =>
    applyAction(content, s, { type: 'playCard', handIndex: 0, targetIndex: 0 });

  it('heals RUN hp on victory for an owner', () => {
    const won = strike(winnableRun({ relics: ['field-dressing'], playerHp: 30 }));
    expect(won.phase).toBe('reward'); // non-boss win
    expect(won.combat).toBeNull();
    expect(won.hp).toBe(34); // 30 + 4
  });

  it('caps the post-victory heal at maxHp', () => {
    const won = strike(winnableRun({ relics: ['field-dressing'], playerHp: 49, maxHp: 50 }));
    expect(won.hp).toBe(50); // 49 + 4 → capped, not 53
  });

  it('is a strict no-op for a player owning no onCombatEnd relic', () => {
    const won = strike(winnableRun({ relics: [], playerHp: 30 }));
    expect(won.phase).toBe('reward');
    expect(won.hp).toBe(30); // unchanged
  });

  it('owning an onCombatEnd relic is rng-free: combat is byte-identical to a non-owner (only hp/relics differ)', () => {
    const owner = strike(winnableRun({ relics: ['field-dressing'], playerHp: 30 }));
    const nonOwner = strike(winnableRun({ relics: [], playerHp: 30 }));
    // The combat rng stream is untouched by the heal → identical.
    expect(owner.rng).toEqual(nonOwner.rng);
    // Everything except the healed hp (and the relic list) is identical.
    expect({ ...owner, hp: nonOwner.hp, relics: nonOwner.relics }).toEqual(nonOwner);
    expect(owner.hp).toBe(34);
    expect(nonOwner.hp).toBe(30);
  });

  it('does NOT fire on defeat (no heal on a loss)', () => {
    // Player at 5 HP vs a 100-HP enemy: strike (survives), endTurn → Bite 5 → dead.
    let s = winnableRun({ relics: ['field-dressing'], playerHp: 5, enemyHp: 100 });
    s = strike(s);
    s = applyAction(content, s, { type: 'endTurn' });
    expect(s.phase).toBe('defeat');
    expect(s.hp).toBe(0); // killed, onCombatEnd never runs
  });
});
