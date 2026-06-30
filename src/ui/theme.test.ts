import { describe, expect, it } from 'vitest';
import { hpTint, theme } from './theme.js';

describe('hpTint (#64 player-HP legibility gradient)', () => {
  const { hpHealthy, hpWarning, hpCritical } = theme.colors;

  it('uses three DISTINCT semantic tokens so the gradient is actually felt', () => {
    // If any two collapsed to the same color the low-HP cue would be invisible.
    expect(new Set([hpHealthy, hpWarning, hpCritical]).size).toBe(3);
  });

  it('is healthy above 50% HP', () => {
    expect(hpTint(60, 60)).toBe(hpHealthy);
    expect(hpTint(31, 60)).toBe(hpHealthy); // 51.6%
  });

  it('shows the WARNING tint from 50% down to 25%', () => {
    expect(hpTint(30, 60)).toBe(hpWarning); // exactly 50%
    expect(hpTint(16, 60)).toBe(hpWarning); // 26.6%
  });

  it('shows the CRITICAL tint at/under 25% (the low-HP alarm)', () => {
    expect(hpTint(15, 60)).toBe(hpCritical); // exactly 25%
    expect(hpTint(1, 60)).toBe(hpCritical);
    expect(hpTint(0, 60)).toBe(hpCritical);
  });

  it('degrades safely at maxHp 0 (treated as critical, never throws/NaN)', () => {
    expect(hpTint(0, 0)).toBe(hpCritical);
  });
});
