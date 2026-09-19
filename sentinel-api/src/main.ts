import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : '*';

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['/'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT', 8000);
  await app.listen(port);
  console.log(`Sentinel API (NestJS) running on http://localhost:${port}`);
}

bootstrap();
