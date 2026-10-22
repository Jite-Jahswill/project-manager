import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });
  const config = configureApp(app);

  if (config.nodeEnv !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Ventidoc API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addCookieAuth('vd_at')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }
  await app.listen(config.port);
}

void bootstrap();
