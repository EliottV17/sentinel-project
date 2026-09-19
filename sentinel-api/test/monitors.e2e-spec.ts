import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as express from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Monitors (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let ownerId: number;
  let otherToken: string;
  let otherId: number;
  let createdMonitorId: number;

  const ownerEmail = `monowner_${Date.now()}@sentinel.com`;
  const ownerUser = `monowner${Date.now()}`.substring(0, 18);
  const otherEmail = `monother_${Date.now()}@sentinel.com`;
  const otherUser = `monother${Date.now()}`.substring(0, 18);
  const password = 'Password123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
      await prisma.users.deleteMany({
        where: { id: { in: [ownerId, otherId] } },
      });
      await prisma.$disconnect();
    }
    await app.close();
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
        target: '127.0.0.1:80',
        check_type: 'tcp',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown checker type');
  });

  it('POST /api/v1/monitors should create monitor successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Production API',
        target: 'https://httpbin.org/status/200',
        check_type: 'http',
        frequency: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Production API');
    expect(res.body.check_type).toBe('http');
    expect(res.body.frequency).toBe(30);
    expect(res.body.user_id).toBe(ownerId);
    createdMonitorId = res.body.id;
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
        frequency: 45,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Production API');
    expect(res.body.frequency).toBe(45);
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
