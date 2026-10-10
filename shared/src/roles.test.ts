import { describe, expect, it } from 'vitest';
import { hasRoomRole } from './roles';

describe('hasRoomRole', () => {
  it('lets higher roles do what lower roles can', () => {
    expect(hasRoomRole('owner', 'editor')).toBe(true);
    expect(hasRoomRole('editor', 'editor')).toBe(true);
  });

  it('blocks lower roles', () => {
    expect(hasRoomRole('viewer', 'editor')).toBe(false);
  });
});
