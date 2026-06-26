import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Screen } from './Screen.js';
import { theme } from '../theme.js';

/** Strip ANSI so we assert on the plain text the chrome lays out. */
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, '');

describe('Screen chrome', () => {
  it('renders title header, a divider rule, body and footer', () => {
    const { lastFrame } = render(
      <Screen title="My Title" footer="press a key">
        <Text>body content</Text>
      </Screen>,
    );
    const text = strip(lastFrame() ?? '');
    expect(text).toContain('My Title');
    expect(text).toContain('body content');
    expect(text).toContain('press a key');
    // A horizontal divider rule (run of the theme divider glyph) sits under the header.
    expect(text).toMatch(new RegExp(`\\${theme.box.divider}{10,}`));
  });

  it('renders an optional right-aligned meta slot in the header', () => {
    const { lastFrame } = render(
      <Screen title="The Map" meta="Depth 2/8">
        <Text>x</Text>
      </Screen>,
    );
    const text = strip(lastFrame() ?? '');
    expect(text).toContain('The Map');
    expect(text).toContain('Depth 2/8');
  });

  it('framed variant draws a full border; unframed (combat) does not', () => {
    const framed = strip(
      render(
        <Screen title="Framed">
          <Text>x</Text>
        </Screen>,
      ).lastFrame() ?? '',
    );
    const bare = strip(
      render(
        <Screen title="Combat" framed={false}>
          <Text>x</Text>
        </Screen>,
      ).lastFrame() ?? '',
    );
    // Round border corners appear only in the framed panel; the lighter combat
    // treatment relies on the header divider rule instead of a box.
    expect(framed).toContain('╭');
    expect(bare).not.toContain('╭');
    // Both still share the same header + divider chrome.
    expect(bare).toContain('Combat');
    expect(bare).toMatch(new RegExp(`\\${theme.box.divider}{10,}`));
  });
});
