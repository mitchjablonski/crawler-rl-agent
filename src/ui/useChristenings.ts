import { useCallback, useRef, useState } from 'react';
import type { ChristenContext, DungeonAi, RunSummary } from '../ai/dungeonAi.js';
import type { GameEvent } from '../events/types.js';
import type { SnarkLevel } from '../config.js';

export type ChristenKind = ChristenContext['kind'];

export interface Christenings {
  nameFor(kind: ChristenKind, id: string): string | undefined;
  request(kind: ChristenKind, id: string, baseName: string, event?: GameEvent): void;
  reset(): void;
}

/**
 * UI-side registry of AI-christened display names. Deliberately NOT part of
 * RunState: saves and replays never see a christened name (Tier 1 boundary).
 */
export function useChristenings(deps: {
  readonly ai?: DungeonAi | null;
  readonly snark: SnarkLevel;
  readonly getRunSummary: () => RunSummary | null;
}): Christenings {
  const [names, setNames] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  const request = useCallback(
    (kind: ChristenKind, id: string, baseName: string, event?: GameEvent) => {
      const key = `${kind}:${id}`;
      if (requested.current.has(key)) return;
      requested.current.add(key);
      deps.ai?.christen(
        {
          kind,
          baseName,
          ...(event !== undefined ? { event } : {}),
          snark: deps.snark,
          run: deps.getRunSummary(),
        },
        (name) => setNames((prev) => ({ ...prev, [key]: name })),
      );
    },
    [deps.ai, deps.snark, deps.getRunSummary],
  );

  const nameFor = useCallback(
    (kind: ChristenKind, id: string) => names[`${kind}:${id}`],
    [names],
  );

  const reset = useCallback(() => {
    requested.current = new Set();
    setNames({});
  }, []);

  return { nameFor, request, reset };
}
