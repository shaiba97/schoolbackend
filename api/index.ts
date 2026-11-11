// Vercel serverless entrypoint for the NestJS backend.
// Wraps the Nest application with serverless-http so each incoming request
// is routed through the same controller/module graph as the long-running
// Render deployment. Initialised lazily once per cold start.

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import serverless from 'serverless-http';

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

export default async function handler(req: any, res: any): Promise<void> {
  const app = await getApp();
  const expressApp = app.getHttpAdapter().getInstance();
  await serverless(expressApp)(req, res);
}
