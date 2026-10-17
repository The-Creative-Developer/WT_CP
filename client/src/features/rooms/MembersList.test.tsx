import type { RoomMember } from '@devverse/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MembersList } from './MembersList';

const members = [
  { id: 'u1', username: 'alice', role: 'owner' as const },
  { id: 'u2', username: 'bob', role: 'editor' as const },
  { id: 'u3', username: 'carol', role: 'viewer' as const },
];

const here = (id: string, username: string, status: 'online' | 'idle' = 'online'): RoomMember => ({
  id,
  username,
  status,
  color: 'hsl(1 70% 50%)',
  role: 'editor',
});

const rows = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('MembersList', () => {
  it('lists everyone with their status in words, people who are here first', () => {
    render(
      <MembersList
        members={members}
        present={[here('u3', 'carol', 'idle'), here('u1', 'alice')]}
        connected
        myId="u1"
      />,
    );
    expect(screen.getByRole('heading', { name: /Members \(3\)/ })).toHaveTextContent('2 here now');
    expect(rows()).toEqual([
      '@alice (you)online · owner',
      '@carolidle · viewer',
      '@boboffline · editor',
    ]);
  });

  it('includes someone who joined after the page loaded', () => {
    render(<MembersList members={members} present={[here('u9', 'dave')]} connected myId="u1" />);
    expect(rows()[0]).toBe('@daveonline · editor');
  });

  it('says when the live list may be out of date', () => {
    render(<MembersList members={members} present={[]} connected={false} myId="u1" />);
    expect(screen.getByRole('heading')).toHaveTextContent('reconnecting…');
  });

  it('announces joins and leaves, but not who was already there', () => {
    // Like the page: empty until the room channel's join answers with who is here.
    const { rerender } = render(<MembersList members={members} present={[]} connected myId="u1" />);
    rerender(
      <MembersList
        members={members}
        present={[here('u1', 'alice'), here('u3', 'carol')]}
        connected
        myId="u1"
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    rerender(<MembersList members={members} present={[here('u1', 'alice')]} connected myId="u1" />);
    expect(status).toHaveTextContent('@carol left the room');

    rerender(
      <MembersList
        members={members}
        present={[here('u1', 'alice'), here('u2', 'bob')]}
        connected
        myId="u1"
      />,
    );
    expect(status).toHaveTextContent('@bob joined the room');

    rerender(<MembersList members={members} present={[here('u2', 'bob')]} connected myId="u1" />);
    expect(status).toHaveTextContent('@alice left the room');
  });
});
