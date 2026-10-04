import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { validateSecretKey } from './auth/utils/secret-validator';
import { getCorsOptions } from './common/config/cors-options';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Validate that a secure SECRET_KEY is set (enforces mandatory non-default key in production)
  validateSecretKey(configService);

  // Trust 1 hop (reverse proxy like Nginx or Caddy) so req.ip reflects the real client IP
  // and prevents spoofing via forged upstream X-Forwarded-For headers
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.enableCors(
    getCorsOptions(
      configService.get<string>('CORS_ORIGINS'),
      configService.get<string>('NODE_ENV', process.env.NODE_ENV),
    ),
  );

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
