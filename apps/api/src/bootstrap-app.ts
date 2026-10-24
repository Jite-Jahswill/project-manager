import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from './config/env';
import { ApiExceptionFilter } from './common/exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { clientIpMiddleware } from './abuse/client-ip.middleware';
import { TrustedProxies } from './abuse/client-ip';

/** Shared by main.ts and the integration tests, so tests exercise the real HTTP pipeline. */
export function configureApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  // Proxy trust is handled explicitly by clientIpMiddleware (TRUSTED_PROXIES); Express must not interpret forwarding headers.
  express.set('trust proxy', false);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(clientIpMiddleware(new TrustedProxies(config.trustedProxies)));
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'idempotency-key', 'x-request-id', 'x-file-name'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown body fields (e.g. organizationId, isOwner) are rejected, not silently dropped.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return config;
}
