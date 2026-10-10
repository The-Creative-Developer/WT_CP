export function Placeholder({ title, week }: { title: string; week: string }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        {title}
      </h1>
      <p className="mt-2 text-muted">Coming in {week} — see docs/PLAN.md.</p>
    </section>
  );
}
