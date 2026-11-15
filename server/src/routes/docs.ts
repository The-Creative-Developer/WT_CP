import { createRequire } from 'node:module';
import path from 'node:path';
import { Router } from 'express';
import { buildOpenApiDocument } from '../openapi/document';

// Swagger UI's prebuilt files, straight from the package (resolved, not bundled: tsup leaves dependencies alone).
const require = createRequire(import.meta.url);
const SWAGGER_DIR = path.dirname(require.resolve('swagger-ui-dist/package.json'));
// Only what the page needs. The package's own index.html and initializer point at the Petstore demo.
const ASSETS = ['swagger-ui.css', 'swagger-ui-bundle.js'];

// Plain script files rather than inline <script>: the Content-Security-Policy from helmet only allows scripts from
// this origin, which is the protection worth keeping on a page that sends requests with your token.
const INIT_SCRIPT = `// Swagger UI ships a dark theme (html.dark-mode) but leaves switching it on to the page: follow the system setting.
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark-mode', dark.matches);
applyTheme();
dark.addEventListener('change', applyTheme);

window.ui = SwaggerUIBundle({
  // Next to this script, wherever the docs are mounted.
  url: new URL('openapi.json', document.currentScript.src).href,
  dom_id: '#swagger-ui',
  deepLinking: true,
  displayRequestDuration: true,
  defaultModelsExpandDepth: 0,
  // The token stays in memory, as in the app, rather than in localStorage where any script on the origin could read it.
  persistAuthorization: false,
  // Don't send the document's URL to swagger.io's public validator (CSP would block its badge anyway).
  validatorUrl: null,
});
`;

const page = (base: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Both themes are supported, so the browser must not darken the page by itself (unreadable dark-on-dark). -->
    <meta name="color-scheme" content="light dark" />
    <title>DevVerse API docs</title>
    <link rel="stylesheet" href="${base}/swagger-ui.css" />
    <style>
      body { margin: 0; }
      .swagger-ui .info { margin: 32px 0; }
      /* The API defines no OpenAPI links, so this column only ever says "No links", and it overflows on phones. */
      .swagger-ui .response-col_links { display: none; }
    </style>
  </head>
  <body>
    <main id="swagger-ui">
      <noscript><p>The interactive docs need JavaScript. The raw description is at <a href="${base}/openapi.json">openapi.json</a>.</p></noscript>
    </main>
    <script src="${base}/swagger-ui-bundle.js"></script>
    <script src="${base}/init.js"></script>
  </body>
</html>
`;

/** Interactive API docs (Swagger UI) and the OpenAPI document they render. Mounted at /api/docs. */
export function createDocsRouter() {
  const router = Router();
  let document: ReturnType<typeof buildOpenApiDocument> | undefined;

  router.get('/', (req, res) => {
    // baseUrl is the mount path ("/api/docs"), so links work with or without a trailing slash.
    res.type('html').set('Cache-Control', 'no-cache').send(page(req.baseUrl));
  });

  router.get('/openapi.json', (_req, res) => {
    // Built once, on first request: it only changes when the code does.
    document ??= buildOpenApiDocument();
    res.set('Cache-Control', 'no-cache').json(document);
  });

  router.get('/init.js', (_req, res) => {
    res.type('js').set('Cache-Control', 'no-cache').send(INIT_SCRIPT);
  });

  for (const asset of ASSETS) {
    router.get(`/${asset}`, (_req, res, next) => {
      // No hash in these file names, so cache for a day rather than forever; an upgrade shows up by tomorrow.
      res.sendFile(path.join(SWAGGER_DIR, asset), { maxAge: '1d' }, (err) => {
        if (err) next(err);
      });
    });
  }

  return router;
}
