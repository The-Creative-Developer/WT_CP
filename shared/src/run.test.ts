import { describe, expect, it } from 'vitest';
import { createRunSchema, MAX_CODE_BYTES, runRequestSchema, utf8Length } from './schemas/run';

describe('utf8Length', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['€', 3],
    ['😀', 4],
    ['a😀é€', 10],
    ['\ud800', 3], // lone surrogate → U+FFFD
  ])('%j is %i bytes', (s, bytes) => {
    expect(utf8Length(s)).toBe(bytes);
  });
});

describe('runRequestSchema', () => {
  it('defaults stdin to an empty string', () => {
    expect(runRequestSchema.parse({ language: 'python', code: 'print(1)' }).stdin).toBe('');
  });

  it('limits code by bytes, not characters', () => {
    const emoji = '😀'.repeat(MAX_CODE_BYTES / 4 + 1); // fewer chars than the limit, more bytes
    expect(runRequestSchema.safeParse({ language: 'python', code: emoji }).success).toBe(false);
  });
});

describe('createRunSchema', () => {
  const fileId = '0123456789abcdef01234567';

  it('takes a room and a file, never code', () => {
    const parsed = createRunSchema.parse({ roomSlug: 'room-abc', fileId, code: 'rm -rf /' });
    expect(parsed).toEqual({ roomSlug: 'room-abc', fileId, stdin: '' });
  });

  it('rejects ids that could carry a query operator', () => {
    expect(createRunSchema.safeParse({ roomSlug: 'r', fileId: { $ne: null } }).success).toBe(false);
    expect(createRunSchema.safeParse({ roomSlug: 'r', fileId: 'abc' }).success).toBe(false);
  });
});
