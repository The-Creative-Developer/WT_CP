import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp({ CORS_ORIGINS: ['http://localhost:5173'], NODE_ENV: 'test' });

describe('app', () => {
  it('reports degraded health when the database is not connected', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'disconnected' });
  });

  it('returns API metadata with a request id', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v1');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('formats unknown routes as problem+json', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, instance: '/api/v1/nope' });
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await request(app).get('/api/v1').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const blocked = await request(app).get('/api/v1').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
