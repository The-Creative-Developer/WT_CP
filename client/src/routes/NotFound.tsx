import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

// [CONCEPT: Error Boundaries] The router renders this instead of crashing the whole app.
export function RouteError() {
  const error = useRouteError();
  return <ErrorPage notFound={isRouteErrorResponse(error) && error.status === 404} />;
}

export function NotFound() {
  return <ErrorPage notFound />;
}

function ErrorPage({ notFound }: { notFound: boolean }) {
  return (
    <section aria-labelledby="error-title" className="py-16 text-center">
      <h1 id="error-title" className="text-3xl font-bold">
        {notFound ? 'Page not found' : 'Something went wrong'}
      </h1>
      <p className="mt-2 text-muted">
        {notFound ? "This room doesn't exist (yet)." : 'Try refreshing the page.'}
      </p>
      <Link to="/" className="mt-6 inline-block text-accent underline">
        Back to home
      </Link>
    </section>
  );
}
