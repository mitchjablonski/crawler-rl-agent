import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { theme } from '../theme.js';

/**
 * Shared screen chrome (V2): a single presentational frame every in-run screen
 * renders through, so titles, footers, spacing and width are IDENTICAL across
 * the app instead of each screen rolling its own ad-hoc layout.
 *
 * Layout (top to bottom):
 *   - header: the screen title in `theme.chrome.titleColor`, plus an optional
 *     right-aligned `meta` slot (e.g. "Depth 2/8"), with a divider rule under it
 *   - body: the screen's own content (`children`)
 *   - footer: the key-hint line in `theme.chrome.footerColor`
 *
 * Two variants keep the look cohesive without clipping the tight combat screen:
 *   - `framed` (default): a bordered panel — used by the calm screens (map,
 *     reward, shop, rest, event, deck, game-over, title)
 *   - `framed={false}`: the SAME header/divider/footer treatment but no full
 *     border — used by COMBAT, which sits under the 4-row StatusBar and must fit
 *     the 30-row snapshot canvas without a top+bottom border eating two rows
 *
 * Dumb/presentational: holds no game state, dispatches nothing, owns no input.
 * Colors route exclusively through `theme` tokens.
 */
export function Screen({
  title,
  meta,
  footer,
  framed = true,
  children,
}: {
  /** Screen name shown in the header (theme title color). */
  readonly title: ReactNode;
  /** Optional right-aligned header annotation (e.g. depth / progress). */
  readonly meta?: ReactNode;
  /** Key-hint line shown in the footer (theme muted color). */
  readonly footer?: ReactNode;
  /** Bordered panel (calm screens) vs lighter header/footer-only (combat). */
  readonly framed?: boolean;
  readonly children: ReactNode;
}) {
  const { chrome, layout } = theme;
  const dividerColor = theme.colors[chrome.borderColor];
  // The snapshot canvas is exactly `contentWidth` columns wide, and an unbounded
  // Ink Box expands to the host terminal (often wider), so we PIN the frame to
  // `contentWidth` and clip nothing. A framed panel spends 4 of those columns on
  // its border (2) + inner padding (2); an unframed screen spends 2 on padding.
  // The inner content width is what the header/divider/body share.
  const innerWidth = framed ? layout.contentWidth - 4 : layout.contentWidth - 2;
  const rule = theme.box.divider.repeat(innerWidth);

  const header = (
    <Box flexDirection="column">
      <Box width={innerWidth} justifyContent="space-between">
        <Text bold color={theme.colors[chrome.titleColor]}>
          {title}
        </Text>
        {meta !== undefined && (
          <Text color={theme.colors[chrome.footerColor]}>{meta}</Text>
        )}
      </Box>
      <Text color={dividerColor} dimColor>
        {rule}
      </Text>
    </Box>
  );

  const foot =
    footer !== undefined ? (
      <Box marginTop={chrome.gap}>
        <Text color={theme.colors[chrome.footerColor]} wrap="truncate">
          {footer}
        </Text>
      </Box>
    ) : null;

  const inner = (
    <>
      {header}
      <Box marginTop={chrome.gap} flexDirection="column">
        {children}
      </Box>
      {foot}
    </>
  );

  if (framed) {
    return (
      <Box
        flexDirection="column"
        width={layout.contentWidth}
        borderStyle={theme.chrome.borderStyle}
        borderColor={theme.colors[chrome.borderColor]}
        paddingX={chrome.paddingX}
      >
        {inner}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={layout.contentWidth} paddingX={chrome.paddingX}>
      {inner}
    </Box>
  );
}
