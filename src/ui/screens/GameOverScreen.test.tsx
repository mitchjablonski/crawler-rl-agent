import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { GameOverScreen } from './GameOverScreen.js';
import { createRun } from '../../engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../../engine/content/index.js';
import type { RunState } from '../../engine/types.js';

/** A finished-run RunState in the given phase, with optional held relics. */
function finished(phase: 'victory' | 'defeat', relics: readonly string[] = []): RunState {
  const base = createRun(content, 'over-test', DEFAULT_RUN_CONFIG);
  return {
    ...base,
    phase,
    hp: 24,
    maxHp: 80,
    gold: 137,
    relics,
    stats: { turns: 18, damageDealt: 240, damageTaken: 96, enemiesSlain: 11 },
  };
}

const noop = () => undefined;

// #28: a comfortable prior best so the summary tests land in the non-NEW-BEST
// branch (Score + Best) and don't accidentally trip the celebration text.
const SCORE = 1000;
const HIGH_PRIOR = 99999;

describe('GameOverScreen run summary', () => {
  it('victory shows depth, relics, deck, gold, hp, and the win anchor', () => {
    const state = finished('victory');
    const bossRow = state.map.nodes[state.map.bossId]?.row ?? 0;
    const { lastFrame } = render(
      <GameOverScreen
        state={state}
        relicNames={['Lucky Pocket Dice']}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('THE SCOPE CREEP IS SLAIN');
    expect(frame).toContain(`Depth reached`);
    expect(frame).toContain(`/${bossRow}`);
    expect(frame).toContain('Final HP');
    expect(frame).toContain('24/80');
    expect(frame).toContain(`${state.deck.length} cards`);
    expect(frame).toContain('137g');
    expect(frame).toContain('Relics');
    expect(frame).toContain('Lucky Pocket Dice');
    expect(frame).toContain('over-test'); // seed preserved (shareable id)
    expect(frame).toContain('[n] new delve');
  });

  it('defeat shows the same summary stats and the death anchor', () => {
    const state = finished('defeat', ['pocket-dice']);
    const { lastFrame } = render(
      <GameOverScreen
        state={state}
        relicNames={['Pocket Dice']}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('YOU DIED');
    expect(frame).toContain('Depth reached');
    expect(frame).toContain('Final HP');
    expect(frame).toContain('24/80');
    expect(frame).toContain('137g');
    expect(frame).toContain('Pocket Dice');
    expect(frame).toContain('[t] title');
    expect(frame).toContain('[q] quit');
  });

  it('surfaces the run stats (turns/dealt/taken/slain) in the report', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Turns');
    expect(frame).toContain('18');
    expect(frame).toContain('Dealt');
    expect(frame).toContain('240');
    expect(frame).toContain('Taken');
    expect(frame).toContain('96');
    expect(frame).toContain('Slain');
    expect(frame).toContain('11');
  });

  it('shows the class played in the run report', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Apothecary"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Class');
    expect(frame).toContain('Apothecary');
  });

  it('shows "none" when no relics are held', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('defeat')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Relics');
    expect(frame).toContain('none');
  });

  it('shows a daily tag for daily runs alongside the score line', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        dailyDate="2026-06-24"
        score={4242}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Daily 2026-06-24');
    expect(frame).toContain('Score 4242');
    // non-daily summary stats still present alongside the daily line
    expect(frame).toContain('Depth reached');
  });

  it('omits the daily tag for non-daily runs but keeps the summary', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Daily');
    expect(frame).toContain('Depth reached');
  });
});

describe('GameOverScreen new-unlock fanfare (#46)', () => {
  it('celebrates unlocks earned by this run with a NEW UNLOCKED line', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
        unlockedNames={['Overclock', 'Rubber Duck']}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('NEW UNLOCKED:');
    expect(frame).toContain('Overclock');
    expect(frame).toContain('Rubber Duck');
  });

  it('omits the NEW UNLOCKED line when no unlocks were earned', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
        unlockedNames={[]}
      />,
    );
    expect(lastFrame() ?? '').not.toContain('NEW UNLOCKED');
  });

  it('omits the NEW UNLOCKED line when the prop is not provided', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('defeat')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={SCORE}
        priorBest={HIGH_PRIOR}
      />,
    );
    expect(lastFrame() ?? '').not.toContain('NEW UNLOCKED');
  });
});

describe('GameOverScreen personal best', () => {
  it('celebrates NEW BEST with the prev best when this run beats it', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={1500}
        priorBest={1200}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('NEW BEST!');
    expect(frame).toContain('1500');
    expect(frame).toContain('prev 1200');
    expect(frame).not.toContain('Score 1500');
  });

  it('celebrates NEW BEST on a first run (no prior best), without a prev', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('victory')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={800}
        priorBest={null}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('NEW BEST!');
    expect(frame).toContain('800');
    expect(frame).not.toContain('prev');
  });

  it('shows Score and Best when this run does not beat the prior best', () => {
    const { lastFrame } = render(
      <GameOverScreen
        state={finished('defeat')}
        relicNames={[]}
        characterName="Knight"
        onNew={noop}
        onTitle={noop}
        score={600}
        priorBest={900}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('NEW BEST');
    expect(frame).toContain('Score 600');
    expect(frame).toContain('Best 900');
  });
});
