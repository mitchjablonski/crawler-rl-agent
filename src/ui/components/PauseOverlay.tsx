import { Box, Text, useInput } from 'ink';
import type { SnarkLevel } from '../../config.js';
import type { PauseState } from '../useEvents.js';

const TITLES: Record<PauseState['reason'], string> = {
  awaits: 'CLAUDE AWAITS YOUR COMMAND',
  notification: 'ATTENTION REQUIRED ON THE SURFACE',
  review: 'YOUR PAIR PARTNER AWAITS JUDGMENT',
};

const BODIES: Record<PauseState['reason'], Readonly<Record<SnarkLevel, string>>> = {
  awaits: {
    0: 'Claude has finished and is waiting for your input.',
    1: 'The dungeon grinds to a halt. Somewhere above, a terminal blinks expectantly at an empty chair.',
    2: 'Claude finished actual work and now stares at the chair you abandoned. The dungeon judges you both.',
  },
  notification: {
    0: 'Claude Code sent a notification.',
    1: 'A messenger imp materializes, clears its throat, and unrolls a scroll.',
    2: 'A messenger imp reads your notification, snorts, and demands you deal with it so it can leave.',
  },
  review: {
    0: 'deepPairing is waiting for your review.',
    1: 'deepPairing has presented work for your review. The dungeon respects code review. Barely.',
    2: 'deepPairing begs for your judgment. The dungeon suggests rejecting something to assert dominance.',
  },
};

export function PauseOverlay({
  pause,
  snark,
  onDismiss,
}: {
  readonly pause: PauseState;
  readonly snark: SnarkLevel;
  readonly onDismiss: () => void;
}) {
  useInput((input, key) => {
    if (key.return || input === 'p') onDismiss();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="yellow">
        {TITLES[pause.reason]}
      </Text>
      <Box marginTop={1} width={76}>
        <Text wrap="wrap">{BODIES[pause.reason][snark]}</Text>
      </Box>
      {pause.detail !== undefined && (
        <Box marginTop={1} width={76}>
          <Text dimColor wrap="wrap">
            {pause.detail}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          {pause.claudeActive
            ? 'Claude is working again - [enter] descend'
            : 'Go handle it, crawler. [p] keep playing anyway'}
        </Text>
      </Box>
    </Box>
  );
}
