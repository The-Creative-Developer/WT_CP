import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from './document';

/** docs/openapi.yaml: the API description as a file, for readers of the repo and for tools. */
export const OPENAPI_YAML_PATH = fileURLToPath(
  new URL('../../../docs/openapi.yaml', import.meta.url),
);

export function renderOpenApiYaml(): string {
  const header =
    "# Generated from server/src/openapi by `npm run openapi`. Don't edit by hand: a test fails if it's stale.\n";
  return header + stringify(buildOpenApiDocument(), { lineWidth: 0 });
}
