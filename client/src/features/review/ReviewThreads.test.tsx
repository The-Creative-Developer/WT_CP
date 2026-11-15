import type { ReviewComment } from '@devverse/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { ReviewThreads, type ReviewThreadsProps } from './ReviewThreads';
import { groupThreads } from './threads';

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  author: { id: 'u2', username: 'bob' },
  path: 'main.py',
  line: 4,
  body: 'Why <b>4</b>?',
  parentId: null,
  resolved: false,
  createdAt: new Date().toISOString(),
  editedAt: null,
  ...over,
});

/** The panel with its selected line kept in state, as the review page does. */
function Panel(props: Partial<ReviewThreadsProps>) {
  const [line, setLine] = useState<number | null>(null);
  return (
    <ReviewThreads
      path="main.py"
      threads={[]}
      lineCount={10}
      open
      selectedLine={line}
      activeThreadId={null}
      canResolve={() => true}
      onSelectLine={setLine}
      onFocusThread={() => {}}
      onComment={async () => {}}
      onResolve={async () => {}}
      {...props}
    />
  );
}

describe('ReviewThreads', () => {
  it('starts a thread on a line chosen by number', async () => {
    const onComment = vi.fn(async () => {});
    render(<Panel onComment={onComment} />);
    expect(screen.getByText('No comments on this file yet.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Line'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Comment on line' }));
    const box = screen.getByRole('textbox', { name: 'Comment on line 7 of main.py' });
    expect(box).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a comment first');
    expect(onComment).not.toHaveBeenCalled();

    await userEvent.type(box, '  Looks good  ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onComment).toHaveBeenCalledWith({ path: 'main.py', line: 7, body: 'Looks good' });
  });

  it('shows threads as plain text, with reply and resolve', async () => {
    const onComment = vi.fn(async () => {});
    const onResolve = vi.fn(async () => {});
    const onFocusThread = vi.fn();
    const threads = groupThreads([
      comment({}),
      comment({
        id: 'c2',
        parentId: 'c1',
        body: 'It has to be',
        author: { id: 'u1', username: 'ada' },
      }),
    ]);
    render(
      <Panel
        threads={threads}
        onComment={onComment}
        onResolve={onResolve}
        onFocusThread={onFocusThread}
      />,
    );

    // Text from other people is never parsed as HTML.
    expect(screen.getByText('Why <b>4</b>?')).toBeInTheDocument();
    expect(screen.getByText('It has to be')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Line 4' }));
    expect(onFocusThread).toHaveBeenCalledWith(threads[0]);

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply about line 4' }), 'Agreed');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onComment).toHaveBeenCalledWith({ parentId: 'c1', body: 'Agreed' });

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onResolve).toHaveBeenCalledWith(threads[0], true);
  });

  it("explains why a comment wasn't sent", async () => {
    const onComment = vi.fn(async () => {
      throw new ApiError(422, 'Validation failed', {
        errors: { line: ['main.py has 3 lines in this version'] },
      });
    });
    render(<Panel onComment={onComment} />);
    await userEvent.type(screen.getByLabelText('Line'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Comment on line' }));
    await userEvent.type(screen.getByRole('textbox'), 'Hm');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'main.py has 3 lines in this version',
    );
  });

  it('hides resolve from people who may not, and everything from closed reviews', () => {
    const threads = groupThreads([comment({ resolved: true })]);
    const { rerender } = render(<Panel threads={threads} canResolve={() => false} />);
    expect(screen.queryByRole('button', { name: /Reopen|Resolve/ })).not.toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();

    rerender(<Panel threads={threads} open={false} />);
    expect(screen.getByText(/This review is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Line')).not.toBeInTheDocument();
  });

  it("doesn't offer comments on a deleted file", () => {
    render(<Panel lineCount={0} />);
    expect(screen.getByText(/This file was deleted/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Line')).not.toBeInTheDocument();
  });
});
