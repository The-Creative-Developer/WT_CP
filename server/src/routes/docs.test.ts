import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { testEnv } from '../test/helpers';

const app = createApp(testEnv);

describe('/api/docs', () => {
  it('serves the Swagger UI page without inline scripts, so the CSP can stay strict', async () => {
    for (const path of ['/api/docs', '/api/docs/']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.type).toBe('text/html');
      expect(res.text).toContain('<html lang="en">');
      // Absolute links, so the page works with or without the trailing slash.
      expect(res.text).toContain('src="/api/docs/swagger-ui-bundle.js"');
      expect(res.text).not.toMatch(/<script>|<script(?![^>]*\ssrc=)[^>]*>/);
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    }
  });

  it('serves the OpenAPI document and the Swagger UI assets', async () => {
    const doc = await request(app).get('/api/docs/openapi.json');
    expect(doc.status).toBe(200);
    expect(doc.body).toMatchObject({ openapi: '3.1.0', info: { title: 'DevVerse API' } });

    const init = await request(app).get('/api/docs/init.js');
    expect(init.type).toBe('text/javascript');
    expect(init.text).toContain("'openapi.json'");

    const bundle = await request(app).get('/api/docs/swagger-ui-bundle.js');
    expect(bundle.status).toBe(200);
    expect(bundle.headers['cache-control']).toBe('public, max-age=86400');
    expect((await request(app).get('/api/docs/swagger-ui.css')).type).toBe('text/css');
  });

  it("doesn't expose the rest of the package", async () => {
    expect((await request(app).get('/api/docs/index.html')).status).toBe(404);
    expect((await request(app).get('/api/docs/swagger-initializer.js')).status).toBe(404);
    expect((await request(app).get('/api/docs/package.json')).status).toBe(404);
  });
});
