import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { validateSecretKey } from './auth/utils/secret-validator';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Validate that a secure SECRET_KEY is set (enforces mandatory non-default key in production)
  validateSecretKey(configService);

  // Trust reverse proxy (Nginx / Caddy) headers so req.ip and req.ips reflect real client IP
  app.set('trust proxy', true);

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
