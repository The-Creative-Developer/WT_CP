import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import { errorHandler, notFound } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { apiRouter } from './routes';
import { healthRouter } from './routes/health';
import { logger } from './utils/logger';

export function createApp(env: Pick<Env, 'CORS_ORIGINS' | 'NODE_ENV'>) {
  const app = express();

  // Caddy terminates TLS in production; trust it so req.ip and secure cookies work.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // [CONCEPT: Middleware Pipeline] Each request flows through these functions in order before reaching a route.
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // [CONCEPT: Security Headers] Helmet sets CSP, HSTS, X-Content-Type-Options, Referrer-Policy and more.
  app.use(helmet());

  // [CONCEPT: CORS] Only the listed front-end origins may call the API with credentials (cookies).
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Location', 'Retry-After'],
    }),
  );

  // [CONCEPT: HTTP Compression] gzip/brotli negotiation via the Accept-Encoding header.
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/healthz', healthRouter);

  // [CONCEPT: Rate Limiting] Caps requests per IP; responds 429 with standard RateLimit-* headers.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'test' ? 10_000 : 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
