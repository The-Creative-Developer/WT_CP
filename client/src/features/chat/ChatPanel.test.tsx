import type { ChatMessage } from '@devverse/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel, typingText } from './ChatPanel';
import type { useChat } from './useChat';

type Chat = ReturnType<typeof useChat>;

const message = (id: string, username: string, body: string): ChatMessage => ({
  id,
  roomSlug: 'room',
  author: { id: `u-${username}`, username },
  body,
  createdAt: '2026-10-18T10:00:00.000Z',
});

// jsdom has no IntersectionObserver; this one lets a test say "the top of the list came into view".
let intersect: (() => void) | null = null;
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        intersect = () =>
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      disconnect() {
        intersect = null;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  intersect = null;
});

function renderPanel(overrides: Partial<Chat> = {}) {
  const chat: Chat = {
    messages: [],
    status: 'success',
    hasOlder: false,
    loadingOlder: false,
    loadOlder: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    signalTyping: vi.fn(),
    typing: [],
    lastIncoming: null,
    connected: true,
    ...overrides,
  };
  const utils = render(<ChatPanel chat={chat} myId="u-alice" />);
  return { chat, ...utils };
}

describe('ChatPanel', () => {
  it('shows messages oldest first, with Markdown rendered safely', () => {
    renderPanel({
      messages: [
        message('1', 'bob', 'hello **there**'),
        message('2', 'alice', '<img src=x onerror="alert(1)">hi'),
      ],
    });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('@bob');
    expect(items[0]!.querySelector('strong')).toHaveTextContent('there');
    expect(items[1]!.querySelector('img')).toBeNull();
    expect(items[1]).toHaveTextContent('hi');
  });

  it('sends with Enter and clears the box, but Shift+Enter makes a new line', async () => {
    const { chat } = renderPanel();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(chat.send).not.toHaveBeenCalled();
    expect(chat.signalTyping).toHaveBeenCalled();

    await userEvent.type(box, '{Enter}');
    expect(chat.send).toHaveBeenCalledWith('line one\nline two');
    expect(box).toHaveValue('');
  });

  it('keeps the text and explains when sending fails', async () => {
    const { chat } = renderPanel({
      send: vi
        .fn()
        .mockRejectedValue(new Error("You're sending messages too fast. Wait a moment.")),
    });
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'hi{Enter}');
    expect(chat.send).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('too fast');
    expect(box).toHaveValue('hi');
    expect(box).toHaveAccessibleDescription(/too fast/);
  });

  it("can't send while disconnected, and says why", () => {
    renderPanel({ connected: false });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
  });

  it('announces messages from others, and shows who is typing', () => {
    renderPanel({
      lastIncoming: message('3', 'bob', 'are you there?'),
      typing: ['carol'],
    });
    expect(screen.getByRole('status')).toHaveTextContent('@bob: are you there?');
    expect(screen.getByText('@carol is typing…')).toBeInTheDocument();
  });

  it('loads older messages when the top of the list scrolls into view', () => {
    const { chat } = renderPanel({ messages: [message('1', 'bob', 'hi')], hasOlder: true });
    act(() => intersect?.());
    expect(chat.loadOlder).toHaveBeenCalledOnce();
  });

  it('says when the beginning of the chat has been reached', () => {
    renderPanel({ messages: [message('1', 'bob', 'first!')], hasOlder: false });
    expect(screen.getByText('This is the start of the chat.')).toBeInTheDocument();
  });
});

describe('typingText', () => {
  it('names one or two people, then summarises', () => {
    expect(typingText([])).toBe('');
    expect(typingText(['bob'])).toBe('@bob is typing…');
    expect(typingText(['bob', 'carol'])).toBe('@bob and @carol are typing…');
    expect(typingText(['bob', 'carol', 'dave'])).toBe('Several people are typing…');
  });
});
