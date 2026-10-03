import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as express from 'express';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PublicStatusService } from '../src/status/public-status.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Public status endpoint (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let statusService: PublicStatusService;
  let fixtureUserId: number;
  let demoUserId: number;
  let fixtureMonitorIds: number[] = [];
  let demoMonitorId: number;
  let emptyCheckedAt: Date;
  let staleCheckedAt: Date;

  const suffix = randomUUID();
  const names = {
    healthy: `status-healthy-${suffix}`,
    mixed: `status-mixed-${suffix}`,
    empty: `status-empty-${suffix}`,
    bounded: `status-bounded-${suffix}`,
    stale: `status-stale-${suffix}`,
    never: `status-never-${suffix}`,
    private: `status-private-${suffix}`,
    inactive: `status-inactive-${suffix}`,
    demo: `status-demo-${suffix}`,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['/'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    statusService = moduleFixture.get<PublicStatusService>(PublicStatusService);
    await app.init();

    const user = await prisma.users.create({
      data: {
        name: 'Public Status E2E',
        last_name: 'Fixture',
        username: `status_${suffix}`,
        email: `status_${suffix}@sentinel.test`,
        password: 'not-used-by-this-fixture',
        created_at: new Date(),
        updated_at: new Date(),
        is_active: true,
        is_demo: false,
      },
      select: { id: true },
    });
    fixtureUserId = user.id;

    const demoLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({});
    expect(demoLogin.status).toBe(200);
    const demoMe = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${demoLogin.body.access_token}`);
    demoUserId = demoMe.body.id;

    const now = Date.now();
    emptyCheckedAt = new Date(now - 3 * 60_000);
    staleCheckedAt = new Date(now - 25 * 60 * 60_000);
    const monitorRows = [
      { name: names.healthy, is_public: true, state: 'Active', last_state: 'healthy', last_checked_at: new Date(now - 60_000) },
      { name: names.mixed, is_public: true, state: 'Active', last_state: 'unhealthy', last_checked_at: new Date(now - 60_000) },
      { name: names.empty, is_public: true, state: 'Active', last_state: 'healthy', last_checked_at: emptyCheckedAt },
      { name: names.bounded, is_public: true, state: 'Active', last_state: 'unhealthy', last_checked_at: new Date(now - 60_000) },
      { name: names.stale, is_public: true, state: 'Active', last_state: 'healthy', last_checked_at: staleCheckedAt },
      { name: names.never, is_public: true, state: 'Active', last_state: null, last_checked_at: null },
      { name: names.private, is_public: false, state: 'Active', last_state: 'healthy', last_checked_at: new Date(now - 60_000) },
      { name: names.inactive, is_public: true, state: 'Paused', last_state: 'healthy', last_checked_at: new Date(now - 60_000) },
    ].map((monitor) => ({
      ...monitor,
      target: 'https://example.com',
      frequency: 60,
      created_at: new Date(),
      check_type: 'http',
      check_config: {},
      consecutive_failures: 0,
      user_id: fixtureUserId,
    }));
    await prisma.monitor.createMany({ data: monitorRows });
    const fixtures = await prisma.monitor.findMany({
      where: { user_id: fixtureUserId, name: { in: monitorRows.map(({ name }) => name) } },
      select: { id: true, name: true },
    });
    fixtureMonitorIds = fixtures.map(({ id }) => id);
    const fixtureIdsByName = new Map(fixtures.map(({ id, name }) => [name, id]));

    await prisma.check_result.createMany({
      data: [
        ...[1, 2].map((minutesAgo) => ({
          monitor_id: fixtureIdsByName.get(names.healthy)!,
          state: 'healthy',
          created_at: new Date(now - minutesAgo * 60_000),
        })),
        { monitor_id: fixtureIdsByName.get(names.mixed)!, state: 'healthy', created_at: new Date(now - 120_000) },
        { monitor_id: fixtureIdsByName.get(names.mixed)!, state: 'unhealthy', created_at: new Date(now - 60_000) },
        { monitor_id: fixtureIdsByName.get(names.bounded)!, state: 'unhealthy', created_at: new Date(now - 60_000) },
        { monitor_id: fixtureIdsByName.get(names.bounded)!, state: 'healthy', created_at: new Date(now - 25 * 60 * 60_000) },
        { monitor_id: fixtureIdsByName.get(names.bounded)!, state: 'healthy', created_at: new Date(now + 60_000) },
        { monitor_id: fixtureIdsByName.get(names.stale)!, state: 'healthy', created_at: new Date(now - 25 * 60 * 60_000) },
      ],
    });

    const demoMonitor = await prisma.monitor.create({
      data: {
        name: names.demo,
        target: 'https://example.com',
        frequency: 60,
        state: 'Active',
        created_at: new Date(),
        check_type: 'http',
        check_config: {},
        consecutive_failures: 0,
        user_id: demoUserId,
        is_public: true,
      },
      select: { id: true },
    });
    demoMonitorId = demoMonitor.id;
  });

  afterAll(async () => {
    if (prisma) {
      const monitorIds = [...fixtureMonitorIds, demoMonitorId].filter(Boolean);
      await prisma.check_result.deleteMany({ where: { monitor_id: { in: monitorIds } } });
      await prisma.alert.deleteMany({ where: { monitor_id: { in: monitorIds } } });
      await prisma.monitor.deleteMany({ where: { id: { in: monitorIds } } });
      if (fixtureUserId) await prisma.users.deleteMany({ where: { id: fixtureUserId } });
    }
    await app?.close();
  });

  it('returns anonymous active public non-demo status with exactly four fields and windowed uptime', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/public/status');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const byName = new Map(response.body.map((monitor: any) => [monitor.name, monitor]));
    expect(byName.has(names.private)).toBe(false);
    expect(byName.has(names.inactive)).toBe(false);
    expect(byName.has(names.demo)).toBe(false);

    const healthy: any = byName.get(names.healthy);
    expect(healthy).toEqual({
      name: names.healthy,
      last_state: 'healthy',
      uptime_percentage: 100,
      last_checked_at: expect.any(String),
    });
    expect(Object.keys(healthy).sort()).toEqual([
      'last_checked_at', 'last_state', 'name', 'uptime_percentage',
    ]);
    expect((byName.get(names.mixed) as any).uptime_percentage).toBe(50);
    expect((byName.get(names.empty) as any).uptime_percentage).toBeNull();
    expect((byName.get(names.empty) as any).last_checked_at).toBe(emptyCheckedAt.toISOString());
    expect((byName.get(names.never) as any).uptime_percentage).toBeNull();
    expect((byName.get(names.never) as any).last_checked_at).toBeNull();
    expect((byName.get(names.bounded) as any).uptime_percentage).toBe(0);
    expect((byName.get(names.stale) as any).uptime_percentage).toBeNull();
    expect((byName.get(names.stale) as any).last_checked_at).toBe(staleCheckedAt.toISOString());
    expect(response.body.map((monitor: any) => monitor.name)).toEqual(
      [...response.body.map((monitor: any) => monitor.name)].sort(),
    );
    expect(response.body.every((monitor: any) => Object.keys(monitor).length === 4)).toBe(true);
  });

  it('caches results briefly and refreshes after cache expiry', async () => {
    (statusService as any).cacheTtlMilliseconds = 150;
    (statusService as any).cached = undefined;
    const first = await request(app.getHttpServer()).get('/api/v1/public/status');
    const fixture = await prisma.check_result.create({
      data: {
        monitor_id: fixtureMonitorIds[0],
        state: 'unhealthy',
        created_at: new Date(),
      },
    });
    const cached = await request(app.getHttpServer()).get('/api/v1/public/status');
    expect(cached.body.find((monitor: any) => monitor.name === names.healthy).uptime_percentage)
      .toBe(first.body.find((monitor: any) => monitor.name === names.healthy).uptime_percentage);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const refreshed = await request(app.getHttpServer()).get('/api/v1/public/status');
    expect(refreshed.body.find((monitor: any) => monitor.name === names.healthy).uptime_percentage)
      .toBeLessThan(100);
    await prisma.check_result.delete({ where: { id: fixture.id } });
  });

  it('serves normal 35-request polling without hitting the default IP limit', async () => {
    for (let index = 0; index < 35; index += 1) {
      const response = await request(app.getHttpServer()).get('/api/v1/public/status');
      expect(response.status).toBe(200);
    }
  });
});
