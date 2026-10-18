import { describe, expect, it } from 'vitest';
import { markdownToText, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders the Markdown people use in chat', () => {
    expect(renderMarkdown('**bold** _em_ ~~gone~~ `code`')).toBe(
      '<p><strong>bold</strong> <em>em</em> <del>gone</del> <code>code</code></p>',
    );
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
    expect(renderMarkdown('```\nconst x = 1;\n```')).toContain(
      '<pre><code>const x = 1;\n</code></pre>',
    );
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  });

  it('opens links safely in a new tab', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">docs</a></p>',
    );
  });

  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror="alert(1)">', 'onerror'],
    ['<a href="#" onclick="alert(1)">x</a>', 'onclick'],
    ['<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['<svg><script>alert(1)</script></svg>', 'svg'],
    ['<style>body { display: none }</style>', 'style'],
  ])('removes raw HTML that could run code or change the page: %s', (input, forbidden) => {
    expect(renderMarkdown(input)).not.toContain(forbidden);
  });

  it.each([
    ['[click](javascript:alert(1))'],
    ['[click](data:text/html,<script>alert(1)</script>)'],
    ['[click](vbscript:msgbox(1))'],
  ])('drops dangerous link schemes: %s', (input) => {
    const html = renderMarkdown(input);
    expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    expect(html).toContain('click');
  });

  it('drops images (tracking pixels, layout breakers) but keeps their alt text out of the way', () => {
    expect(renderMarkdown('![pixel](https://evil.example/t.gif)')).not.toContain('<img');
  });

  it('keeps the text of headings without the big heading styles', () => {
    expect(renderMarkdown('# Shouting')).toBe('Shouting');
  });
});

describe('markdownToText', () => {
  it('reads a message the way it looks, without Markdown syntax or URLs', () => {
    expect(markdownToText('Docs: [MDN](https://developer.mozilla.org), **now**!\n- a\n- b')).toBe(
      'Docs: MDN, now! a b',
    );
  });
});
