import { Link } from 'react-router';

const FEATURES = [
  ['👥', 'Code together', 'Real-time editing with live cursors, powered by CRDTs.'],
  ['🎥', 'Talk it through', 'Voice and video calls right inside the room (WebRTC).'],
  ['▶️', 'Run anything', 'JavaScript, Python, C++ and Java in isolated containers.'],
  ['🔍', 'Review code', 'Diff snapshots and leave inline comments.'],
  ['🤖', 'Ask the AI', 'Explain, fix and refactor code with a streaming assistant.'],
  ['🏆', 'Compete', 'Solve challenges and climb the leaderboard.'],
] as const;

export function Home() {
  return (
    <>
      <section aria-labelledby="hero-title" className="py-12 text-center">
        <h1 id="hero-title" className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Your multiplayer coding world
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
          GitHub + Discord + VS Code + a multiplayer game. Jump into a room and build something with
          friends.
        </p>
        <Link
          to="/dashboard"
          className="mt-8 inline-block rounded-lg bg-accent px-6 py-3 font-semibold text-accent-contrast shadow-md"
        >
          Enter DevVerse
        </Link>
      </section>

      <section aria-labelledby="features-title">
        <h2 id="features-title" className="sr-only">
          Features
        </h2>
        {/* [CONCEPT: Responsive Grid] auto-fill + minmax lays out as many columns as fit, with no media queries. */}
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title} className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-semibold">
                <span aria-hidden="true">{icon}</span> {title}
              </h3>
              <p className="mt-2 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
