import { Controller, Get, INestApplication } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorageService } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppThrottlerGuard } from './app-throttler.guard';

@Controller('monitors')
class MockMonitorsController {
  @Get()
  findAll() {
    return [{ id: 1, name: 'Prod API', state: 'Active' }];
  }
}

describe('Monitors Polling Throttling (GET /monitors)', () => {
  let app: INestApplication;
  let storageService: ThrottlerStorageService;

  beforeAll(async () => {
    storageService = new ThrottlerStorageService();
    const options = [
      {
        name: 'default',
        ttl: 60000,
        limit: 100, // Generous default baseline
      },
      {
        name: 'auth',
        ttl: 60000,
        limit: 5, // Strict auth rate limit
      },
      {
        name: 'monitors',
        ttl: 60000,
        limit: 20, // Write monitor limit
      },
    ];

    const guard = new AppThrottlerGuard(options as any, storageService, new Reflector());
    await guard.onModuleInit();

    const expressApp = await NestFactory.create<NestExpressApplication>(
      {
        module: class TestModule {},
        controllers: [MockMonitorsController],
        providers: [
          {
            provide: 'APP_GUARD',
            useValue: guard,
          },
        ],
      },
      { logger: false },
    );

    expressApp.set('trust proxy', 1);
    app = expressApp;
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows high frequency frontend polling (more than 10 consecutive GET requests) without 429', async () => {
    // Frontend polls GET /monitors frequently. This should NOT be throttled by the 5 req/min auth limit.
    for (let i = 1; i <= 15; i++) {
      const res = await request(app.getHttpServer()).get('/monitors');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 1, name: 'Prod API', state: 'Active' }]);
    }
  });
});
