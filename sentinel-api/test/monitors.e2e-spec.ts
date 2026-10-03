import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as express from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Monitors (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let ownerId: number;
  let otherToken: string;
  let otherId: number;
  let createdMonitorId: number;
  let demoToken: string;
  let demoId: number;
  const demoFixtureMonitorIds: number[] = [];

  const ownerEmail = `monowner_${Date.now()}@sentinel.com`;
  const ownerUser = `monowner${Date.now()}`.substring(0, 18);
  const otherEmail = `monother_${Date.now()}@sentinel.com`;
  const otherUser = `monother${Date.now()}`.substring(0, 18);
  const password = 'Password123';

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
    await app.init();

    const demoLogin = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({});
    if (demoLogin.status === 200) {
      demoToken = demoLogin.body.access_token;
      const demoMe = await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${demoToken}`);
      demoId = demoMe.body.id;
    }

    // Register owner
    const regOwner = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        name: 'Owner',
        last_name: 'User',
        username: ownerUser,
        email: ownerEmail,
        password,
      });
    ownerId = regOwner.body.id;

    // Login owner
    const loginOwner = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: ownerEmail, password });
    ownerToken = loginOwner.body.access_token;

    // Register other
    const regOther = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        name: 'Other',
        last_name: 'User',
        username: otherUser,
        email: otherEmail,
        password,
      });
    otherId = regOther.body.id;

    // Login other
    const loginOther = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: otherEmail, password });
    otherToken = loginOther.body.access_token;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.check_result.deleteMany({
        where: { monitor: { user_id: { in: [ownerId, otherId] } } },
      });
      await prisma.alert.deleteMany({
        where: { monitor: { user_id: { in: [ownerId, otherId] } } },
      });
      await prisma.monitor.deleteMany({
        where: { user_id: { in: [ownerId, otherId] } },
      });
      if (demoFixtureMonitorIds.length) {
        await prisma.check_result.deleteMany({ where: { monitor_id: { in: demoFixtureMonitorIds } } });
        await prisma.alert.deleteMany({ where: { monitor_id: { in: demoFixtureMonitorIds } } });
        await prisma.monitor.deleteMany({ where: { id: { in: demoFixtureMonitorIds } } });
      }
      await prisma.users.deleteMany({
        where: { id: { in: [ownerId, otherId] } },
      });
      await prisma.$disconnect();
    }
    await app.close();
  });

  it('enforces the demo frequency, three-monitor quota, and rejects public flags', async () => {
    expect(demoToken).toBeDefined();
    const demoAuth = { Authorization: `Bearer ${demoToken}` };
    const minFrequency = Number(process.env.DEMO_MIN_FREQUENCY_SECONDS || 60);
    const belowMinimum = await request(app.getHttpServer()).post('/api/v1/monitors').set(demoAuth).send({ name: 'E2E demo quota low frequency', target: 'https://example.com', frequency: Math.max(1, minFrequency - 1) });
    expect(belowMinimum.status).toBe(400);

    const startCount = await prisma.monitor.count({ where: { user_id: demoId } });
    const createdIds: number[] = [];
    for (let index = startCount; index < 3; index++) {
      const created = await request(app.getHttpServer()).post('/api/v1/monitors').set(demoAuth).send({ name: `E2E demo quota ${index}`, target: 'https://example.com', frequency: minFrequency });
      expect(created.status).toBe(201);
      createdIds.push(created.body.id);
      demoFixtureMonitorIds.push(created.body.id);
    }
    const fourth = await request(app.getHttpServer()).post('/api/v1/monitors').set(demoAuth).send({ name: 'E2E demo quota fourth', target: 'https://example.com', frequency: minFrequency });
    expect(fourth.status).toBe(400);
    expect(fourth.body.message).toContain('Monitor limit reached');

    const lowPatch = await request(app.getHttpServer()).patch(`/api/v1/monitors/${createdIds[0]}`).set(demoAuth).send({ frequency: Math.max(1, minFrequency - 1) });
    expect(lowPatch.status).toBe(400);
    const publicAttempt = await request(app.getHttpServer()).post('/api/v1/monitors').set(demoAuth).send({ name: 'E2E demo quota public', target: 'https://example.com', frequency: minFrequency, is_public: true });
    expect(publicAttempt.status).toBe(400);
    expect(publicAttempt.body.is_public).toBeUndefined();
    if (createdIds[0]) {
      const demoPatch = await request(app.getHttpServer()).patch(`/api/v1/monitors/${createdIds[0]}`).set(demoAuth).send({ is_public: true });
      expect(demoPatch.status).toBe(400);
      expect((await prisma.monitor.findUnique({ where: { id: createdIds[0] } }))?.is_public).toBe(false);
    }
    expect(await prisma.monitor.count({ where: { user_id: demoId } })).toBe(3);
  });

  it('POST /api/v1/monitors should fail without auth', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .send({
        name: 'No Auth Monitor',
        target: 'https://example.com',
      });
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/monitors should fail if frequency < 10', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Low Frequency Monitor',
        target: 'https://example.com',
        frequency: 5,
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('frequency');
  });

  it('POST /api/v1/monitors should fail if check_type != http', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'TCP Monitor',
        target: 'https://example.com',
        check_type: 'tcp',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown checker type');
  });

  it('POST /api/v1/monitors should reject private, loopback and cloud metadata targets with 400', async () => {
    const maliciousTargets = [
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/status',
      'http://192.168.1.1',
      'http://db:5432',
    ];

    for (const target of maliciousTargets) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/monitors')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Malicious Monitor',
          target,
          frequency: 60,
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('target');
    }
  });

  it('POST /api/v1/monitors rejects a public flag and never stores it', async () => {
    const before = await prisma.monitor.count({ where: { user_id: ownerId } });
    const response = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Public attempt', target: 'https://example.com', frequency: 60, is_public: true });
    expect(response.status).toBe(400);
    expect(await prisma.monitor.count({ where: { user_id: ownerId } })).toBe(before);
    expect(response.body.is_public).toBeUndefined();
  });

  it('POST /api/v1/monitors should create monitor successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Production API',
        target: 'https://example.com',
        check_type: 'http',
        frequency: 60,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Production API');
    expect(res.body.check_type).toBe('http');
    expect(res.body.frequency).toBe(60);
    expect(res.body.user_id).toBe(ownerId);
    createdMonitorId = res.body.id;
    const publicPatch = await request(app.getHttpServer())
      .patch(`/api/v1/monitors/${createdMonitorId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ is_public: true });
    expect(publicPatch.status).toBe(400);
    expect((await prisma.monitor.findUnique({ where: { id: createdMonitorId } }))?.is_public).toBe(false);
  });

  it('POST /api/v1/monitors should reject creation when exceeding MAX_MONITORS_PER_USER with 400', async () => {
    // Owner currently has 1 monitor created above. Seed the remaining quota
    // directly so the assertion exercises the quota rather than HTTP throttling.
    await prisma.monitor.createMany({
      data: Array.from({ length: 9 }, (_, index) => ({
        name: `Quota Monitor ${index + 2}`,
        target: `https://example${index + 2}.com`,
        frequency: 60,
        state: 'Active',
        created_at: new Date(),
        check_type: 'http',
        consecutive_failures: 0,
        user_id: ownerId,
      })),
    });

    // 11th monitor should be rejected with 400
    const excessRes = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Excess Monitor 11',
        target: 'https://example11.com',
        frequency: 60,
      });
    expect(excessRes.status).toBe(400);
    expect(excessRes.body.message).toContain('Monitor limit reached');

  });

  it('GET /api/v1/monitors should list user monitors', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('Production API');
  });

  it('PATCH /api/v1/monitors/:id should update monitor', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/monitors/${createdMonitorId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Updated Production API',
        frequency: 120,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Production API');
    expect(res.body.frequency).toBe(120);
  });

  it('GET /api/v1/monitors/:id/history should return checks', async () => {
    // Insert a check_result
    await prisma.check_result.create({
      data: {
        monitor_id: createdMonitorId,
        state: 'healthy',
        status_code: 200,
        latency_ms: 150.0,
        created_at: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/monitors/${createdMonitorId}/history?limit=10`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].state).toBe('healthy');
  });

  it('GET /api/v1/monitors/:id/alerts should return alerts', async () => {
    // Insert an alert
    await prisma.alert.create({
      data: {
        monitor_id: createdMonitorId,
        alert_type: 'down',
        message: 'Endpoint unreachable',
        created_at: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/monitors/${createdMonitorId}/alerts`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].alert_type).toBe('down');
  });

  it('GET /api/v1/monitors/:id/history should forbid other users', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/monitors/${createdMonitorId}/history`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No tienes permiso');
  });

  it('DELETE /api/v1/monitors/:id should delete monitor and cascaded children', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/monitors/${createdMonitorId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Monitor deleted successfully');

    // Verify cascade
    const checkCount = await prisma.check_result.count({
      where: { monitor_id: createdMonitorId },
    });
    const alertCount = await prisma.alert.count({
      where: { monitor_id: createdMonitorId },
    });
    const monitorCount = await prisma.monitor.count({
      where: { id: createdMonitorId },
    });

    expect(checkCount).toBe(0);
    expect(alertCount).toBe(0);
    expect(monitorCount).toBe(0);
  });
});
