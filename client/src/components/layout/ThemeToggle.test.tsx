import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.setItem('devverse-theme', 'light');
  });

  it('switches theme and updates its accessible label', async () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
