# ADR-008: Server-side rendering only for public portfolio pages

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Portfolios must be shareable, indexable by search engines, and show rich previews on social media. The app itself is highly interactive.

## Decision

The app is a client-rendered SPA. Public portfolios at `/u/:username` are rendered on the server with **EJS** templates in Express, with meta tags, Open Graph, JSON-LD, `ETag` and `Cache-Control`.

## Alternatives considered

| Option                 | Why not                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Next.js for everything | Custom WebSocket servers are awkward to host alongside it; more to learn in 4 weeks |
| SPA only               | Crawlers and link previews see an empty page                                        |

## Consequences

- Demonstrates both rendering models; we compare them in the docs (TTFB, LCP, view-source).
- The portfolio has its own small stylesheet, separate from the SPA bundle.
