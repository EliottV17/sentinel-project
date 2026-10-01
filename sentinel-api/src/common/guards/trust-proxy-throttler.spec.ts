import { Controller, Get, INestApplication } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppThrottlerGuard } from './app-throttler.guard';

@Controller('test-rate-limit')
class TestThrottlerController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('Rate Limiting with Trust Proxy (1 hop)', () => {
  let app: INestApplication;
  let storageService: ThrottlerStorageService;

  beforeAll(async () => {
    storageService = new ThrottlerStorageService();
    const options = [
      {
        name: 'default',
        ttl: 60000,
        limit: 2,
      },
    ];

    const guard = new AppThrottlerGuard(options as any, storageService, new Reflector());
    await guard.onModuleInit();

    const expressApp = (
      await NestFactory.create<NestExpressApplication>(
        {
          module: class TestModule {},
          controllers: [TestThrottlerController],
          providers: [
            {
              provide: 'APP_GUARD',
              useValue: guard,
            },
          ],
        },
        { logger: false },
      )
    );

    // Trust only 1 hop (the immediate reverse proxy)
    expressApp.set('trust proxy', 1);
    app = expressApp;
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('prevents rate limit evasion via forged X-Forwarded-For client IP', async () => {
    const realClientIp = '198.51.100.99';

    // Attacker sends forged upstream IPs in X-Forwarded-For before the reverse proxy appends realClientIp.
    // Express with 'trust proxy: 1' trusts only the last hop and evaluates req.ip as realClientIp.
    // Request 1: attacker injects 1.1.1.1
    const res1 = await request(app.getHttpServer())
      .get('/test-rate-limit')
      .set('X-Forwarded-For', `1.1.1.1, ${realClientIp}`);
    expect(res1.status).toBe(200);

    // Request 2: attacker attempts evasion with forged 2.2.2.2
    const res2 = await request(app.getHttpServer())
      .get('/test-rate-limit')
      .set('X-Forwarded-For', `2.2.2.2, ${realClientIp}`);
    expect(res2.status).toBe(200);

    // Request 3: attacker attempts evasion with forged 3.3.3.3
    // Rate limiter must recognize this is still realClientIp and block with 429
    const res3 = await request(app.getHttpServer())
      .get('/test-rate-limit')
      .set('X-Forwarded-For', `3.3.3.3, ${realClientIp}`);
    expect(res3.status).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();

    // A genuinely different client IP should still be allowed
    const differentClientIp = '198.51.100.100';
    const resOther = await request(app.getHttpServer())
      .get('/test-rate-limit')
      .set('X-Forwarded-For', `4.4.4.4, ${differentClientIp}`);
    expect(resOther.status).toBe(200);
  });
});
