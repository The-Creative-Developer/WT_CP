import { z } from 'zod';
import { LANGUAGE_IDS, type Language } from '../languages';

export const MAX_CODE_BYTES = 64 * 1024;
export const MAX_STDIN_BYTES = 64 * 1024;

/** UTF-8 size of a string, computed without TextEncoder/Buffer so this file works in browsers and Node alike. */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (const char of s) {
    const code = char.codePointAt(0)!;
    // A lone surrogate is encoded as U+FFFD, which is also 3 bytes.
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const runRequestSchema = z.object({
  language: z.enum(LANGUAGE_IDS as [Language, ...Language[]]),
  code: z
    .string()
    .refine(
      (s) => utf8Length(s) <= MAX_CODE_BYTES,
      `Code must be at most ${MAX_CODE_BYTES / 1024} KB`,
    ),
  stdin: z
    .string()
    .refine(
      (s) => utf8Length(s) <= MAX_STDIN_BYTES,
      `Input must be at most ${MAX_STDIN_BYTES / 1024} KB`,
    )
    .default(''),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

/** How a run ended, from the user's point of view. */
export type RunVerdict =
  | 'ok' // exited 0
  | 'error' // exited non-zero (runtime or compile error)
  | 'timeout' // killed after the time limit
  | 'memory' // killed for using too much memory
  | 'output-limit'; // killed for printing too much

export interface RunResult {
  verdict: RunVerdict;
  exitCode: number | null;
  durationMs: number;
  /** True if some output was dropped because of the output limit. */
  truncated: boolean;
}

/**
 * The runner streams one JSON object per line (NDJSON) while a program runs.
 * [CONCEPT: Streaming Responses] Output reaches the user as it is printed, not after the program ends.
 */
export type RunEvent =
  | { type: 'started' }
  | { type: 'output'; stream: 'stdout' | 'stderr'; chunk: string }
  | ({ type: 'finished' } & RunResult)
  | { type: 'failed'; message: string }; // the runner itself failed (not the user's code)
