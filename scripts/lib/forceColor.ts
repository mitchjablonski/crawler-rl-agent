/**
 * Side-effect import: force chalk/Ink to emit truecolor ANSI even when stdout
 * is not a TTY (the play harness renders to an in-memory buffer). Import this
 * FIRST in any snapshot/gif tool so the captured frames carry color codes that
 * termRender can map to the theme palette. ESM hoists imports, so importing
 * this module before ink/chalk guarantees the env var is set in time.
 */
process.env.FORCE_COLOR = '3';
