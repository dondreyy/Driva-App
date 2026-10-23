import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
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
