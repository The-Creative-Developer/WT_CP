import { describe, expect, it } from 'vitest';
import { listRoomsQuerySchema } from './schemas/room';

describe('listRoomsQuerySchema', () => {
  it('treats missing or blank values as "any"', () => {
    expect(listRoomsQuerySchema.parse({})).toEqual({});
    expect(listRoomsQuerySchema.parse({ q: '   ' })).toEqual({ q: undefined });
  });

  it('trims the search and accepts known languages and roles', () => {
    expect(listRoomsQuerySchema.parse({ q: ' pair ', language: 'python', role: 'owner' })).toEqual({
      q: 'pair',
      language: 'python',
      role: 'owner',
    });
  });

  it('rejects unknown filters and over-long searches', () => {
    expect(listRoomsQuerySchema.safeParse({ language: 'cobol' }).success).toBe(false);
    expect(listRoomsQuerySchema.safeParse({ role: 'admin' }).success).toBe(false);
    expect(listRoomsQuerySchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(false);
  });
});
