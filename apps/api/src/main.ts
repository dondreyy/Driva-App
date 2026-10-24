import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  // The mobile apps are native and do not need CORS. Web builds are for local testing only.
  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',') ?? false });
  return app;
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(config.port);
}

if (require.main === module) {
  void bootstrap();
}
