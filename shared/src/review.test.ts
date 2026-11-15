import { describe, expect, it } from 'vitest';
import {
  createCommentSchema,
  createReviewSchema,
  createSnapshotSchema,
  updateCommentSchema,
} from './schemas/review';

const ID = '6730c2f4e1b2a3c4d5e6f701';

describe('createSnapshotSchema', () => {
  it('trims the description and requires one', () => {
    expect(createSnapshotSchema.parse({ message: '  Loop works ' })).toEqual({
      message: 'Loop works',
    });
    expect(createSnapshotSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(createSnapshotSchema.safeParse({ message: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('createReviewSchema', () => {
  it('takes a base version, none (null), or the default (left out)', () => {
    expect(createReviewSchema.parse({ snapshotId: ID })).toEqual({ snapshotId: ID });
    expect(createReviewSchema.parse({ snapshotId: ID, baseSnapshotId: null }).baseSnapshotId).toBe(
      null,
    );
    expect(createReviewSchema.safeParse({ snapshotId: 'abc' }).success).toBe(false);
  });
});

describe('createCommentSchema', () => {
  it('accepts a new thread on a line, or a reply', () => {
    expect(createCommentSchema.safeParse({ body: 'Hm', path: 'main.py', line: 2 }).success).toBe(
      true,
    );
    expect(createCommentSchema.safeParse({ body: 'Yes', parentId: ID }).success).toBe(true);
  });

  it.each([
    [{ body: 'Hm', path: 'main.py' }, 'line'],
    [{ body: 'Hm', line: 2 }, 'line'],
    [{ body: 'Hm', parentId: ID, path: 'main.py', line: 2 }, 'parentId'],
    [{ body: '  ', path: 'main.py', line: 2 }, 'body'],
    [{ body: 'Hm', path: 'main.py', line: 0 }, 'line'],
    [{ body: 'Hm', path: 'main.py', line: 1.5 }, 'line'],
  ])('rejects %j (problem with %s)', (input, field) => {
    const result = createCommentSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toHaveProperty(field);
  });
});

describe('updateCommentSchema', () => {
  it('needs something to change', () => {
    expect(updateCommentSchema.safeParse({ resolved: true }).success).toBe(true);
    expect(updateCommentSchema.safeParse({ body: 'New words' }).success).toBe(true);
    const empty = updateCommentSchema.safeParse({});
    expect(empty.error?.flatten().fieldErrors.body).toEqual([
      'Change the text or the resolved state',
    ]);
  });
});
