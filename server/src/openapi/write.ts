import { writeFile } from 'node:fs/promises';
import { OPENAPI_YAML_PATH, renderOpenApiYaml } from './yaml';

// `npm run openapi`: rewrites docs/openapi.yaml after the API changes.
await writeFile(OPENAPI_YAML_PATH, renderOpenApiYaml());
console.log(`Wrote ${OPENAPI_YAML_PATH}`);
