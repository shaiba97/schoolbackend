// Vercel serverless entrypoint for the NestJS backend.
// Boots the Nest application inside the lambda and exposes it through a
// loopback HTTP server: the handler pipes the raw request/response streams
// to a real internal http.createServer(expressApp) instance. This avoids
// serverless-http entirely, which hangs forever with Express 5 (dougmoscrop/
// serverless-http#305) because its synthetic IncomingMessage breaks
// body-parser's on-finished checks.
// Initialised lazily once per cold start.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';

let appPromise: Promise<NestExpressApplication> | null = null;

async function getApp(): Promise<NestExpressApplication> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = await NestFactory.create<NestExpressApplication>(AppModule);
      app.setGlobalPrefix('api');

      const corsOrigins = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      app.enableCors({
        origin:
          corsOrigins.length > 0
            ? corsOrigins
            : (_origin: string, callback: (err: Error | null, allow?: boolean) => void) =>
                callback(null, !!_origin),
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        credentials: true,
      });

      app.use(helmet());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );

      await app.init();
      return app;
    })();
  }
  return appPromise;
}

let portPromise: Promise<number> | null = null;

async function getLoopbackPort(): Promise<number> {
  if (!portPromise) {
    portPromise = (async () => {
      const app = await getApp();
      const expressApp = app.getHttpAdapter().getInstance();
      const internal = http.createServer(expressApp);
      await new Promise<void>((resolve) =>
        internal.listen(0, '127.0.0.1', () => resolve()),
      );
      const port = (internal.address() as AddressInfo).port;
      // Keep the server referenced so it is never garbage collected.
      internal.unref === undefined ? undefined : internal.ref();
      return port;
    })();
  }
  return portPromise;
}

export default async function handler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const port = await getLoopbackPort();
  await new Promise<void>((resolve, reject) => {
    const upstream = http.request(
      { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 500, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(`loopback error: ${String(err)}`);
      }
      reject(err);
    });
    res.on('finish', () => resolve());
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
}
