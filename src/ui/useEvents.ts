import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classify } from '../events/classify.js';
import { createTailer, type Tailer, type TailerOptions } from '../events/tailer.js';
import type { GameEvent } from '../events/types.js';
import type { Modifier } from '../engine/modifiers.js';
import type { SnarkLevel } from '../config.js';
import type { DungeonAi, RunSummary } from '../ai/dungeonAi.js';
import { createLimiter } from '../modifiers/limiter.js';
import { limitFor, ruleFor } from '../modifiers/rules.js';

export interface PauseState {
  readonly reason: 'awaits' | 'notification' | 'review';
  readonly detail?: string;
  /** True once fresh activity arrives after the pause — Claude is working again. */
  readonly claudeActive: boolean;
}

export interface EventsDeps {
  /** Undefined → standalone mode: no tailer, dungeon stays dormant. */
  readonly eventsDir?: string;
  /** Test seam; defaults to the real polling tailer. */
  readonly createSource?: (opts: TailerOptions) => Tailer;
  readonly now?: () => number;
  readonly snark?: SnarkLevel;
  readonly ai?: DungeonAi | null;
  readonly getRunSummary?: () => RunSummary | null;
}

export interface QueuedModifier {
  readonly modifier: Modifier;
  readonly event: GameEvent;
}

export interface EventsState {
  readonly linked: boolean;
  readonly pause: PauseState | null;
  readonly narration: string | null;
  readonly eventTick: number;
  takeQueued(): QueuedModifier[];
  dismissPause(): void;
}

export function useEvents(deps: EventsDeps): EventsState {
  const [linked, setLinked] = useState(false);
  const [pause, setPause] = useState<PauseState | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [eventTick, setEventTick] = useState(0);
  const queueRef = useRef<QueuedModifier[]>([]);
  const limiter = useMemo(() => createLimiter(limitFor, deps.now), [deps.now]);

  const handleEvent = useCallback(
    (event: GameEvent) => {
      setLinked(true);
      switch (event.kind) {
        case 'claude_awaits_user':
          setPause({ reason: 'awaits', claudeActive: false });
          return;
        case 'attention_required':
          setPause(
            event.detail === undefined
              ? { reason: 'notification', claudeActive: false }
              : { reason: 'notification', detail: event.detail, claudeActive: false },
          );
          return;
        case 'review_requested':
          setPause(
            event.detail === undefined
              ? { reason: 'review', claudeActive: false }
              : { reason: 'review', detail: event.detail, claudeActive: false },
          );
          return;
        default:
          break;
      }
      // Any other event means Claude is active again.
      setPause((prev) => (prev && !prev.claudeActive ? { ...prev, claudeActive: true } : prev));
      if (!limiter.tryTake(event.kind)) return;
      const snark = deps.snark ?? 1;
      const outcome = ruleFor(event, snark);
      if (outcome.modifier) {
        queueRef.current.push({ modifier: outcome.modifier, event });
        setEventTick((t) => t + 1);
      }
      if (outcome.narration) {
        setNarration(outcome.narration);
        // Fire-and-forget upgrade: the Dungeon AI may re-word the line later.
        deps.ai?.narrate(
          {
            event,
            staticLine: outcome.narration,
            snark,
            run: deps.getRunSummary?.() ?? null,
          },
          (line) => setNarration(line),
        );
      }
    },
    [limiter, deps.snark, deps.ai, deps.getRunSummary],
  );

  useEffect(() => {
    if (deps.eventsDir === undefined && deps.createSource === undefined) return;
    const make = deps.createSource ?? createTailer;
    const source = make({
      eventsDir: deps.eventsDir ?? '',
      onRecord: (record) => handleEvent(classify(record)),
    });
    source.start();
    return () => source.stop();
  }, [deps.eventsDir, deps.createSource, handleEvent]);

  const takeQueued = useCallback((): QueuedModifier[] => {
    if (queueRef.current.length === 0) return [];
    const drained = queueRef.current;
    queueRef.current = [];
    return drained;
  }, []);

  const dismissPause = useCallback(() => setPause(null), []);

  return { linked, pause, narration, eventTick, takeQueued, dismissPause };
}
