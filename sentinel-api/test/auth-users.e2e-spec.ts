import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as express from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('Auth & Users (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let configService: ConfigService;
  const testEmail = `e2e_test_${Date.now()}@sentinel.com`;
  const testUsername = `user${Date.now()}`.substring(0, 18);
  const testPassword = 'Password123';
  let accessToken: string;

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
    configService = moduleFixture.get<ConfigService>(ConfigService);
    await app.init();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.users.deleteMany({
        where: { email: { contains: 'e2e_test_' } },
      });
      await prisma.$disconnect();
    }
    await app.close();
  });

  it('GET / should return sentinel health message', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Sentinel API está en línea y vigilando');
  });

  it('POST /api/v1/users should fail when password does not meet complexity', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        name: 'Invalid',
        last_name: 'User',
        username: 'invaliduser1',
        email: 'invalid@sentinel.com',
        password: 'onlyletters',
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Password must contain both letters and numbers');
  });

  it('POST /api/v1/users should successfully register a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        name: 'John',
        last_name: 'Doe',
        username: testUsername,
        email: testEmail,
        password: testPassword,
        phonenumber: '123456789',
      });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(testEmail);
    expect(res.body.username).toBe(testUsername);
    expect(res.body.password).toBeUndefined();
    expect(res.body.id).toBeDefined();
  });

  it('POST /api/v1/users should fail when email already exists', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        name: 'Duplicate',
        last_name: 'User',
        username: 'anotherusername',
        email: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Email already registered');
  });

  it('POST /api/v1/auth/login should fail with wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: testEmail,
        password: 'WrongPassword123',
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Incorrect username or password');
  });

  it('POST /api/v1/auth/login should return access_token with JSON body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: testEmail,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('bearer');
    accessToken = res.body.access_token;
  });

  it('POST /api/v1/auth/login should return access_token with form-urlencoded body (OAuth2 style)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .type('form')
      .send({
        username: testUsername,
        password: testPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('bearer');
  });

  it('GET /api/v1/users/me should fail when unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('ordinary login marks the configured demo account token as demo', async () => {
    const configuredEmail = process.env.DEMO_USER_EMAIL;
    const configuredPassword = process.env.DEMO_USER_PASSWORD;
    expect(configuredEmail).toBeTruthy();
    expect(configuredPassword).toBeTruthy();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: configuredEmail, password: configuredPassword });

    expect(response.status).toBe(200);
    expect(response.body.access_token).toBeDefined();
    const payload = JSON.parse(
      Buffer.from(response.body.access_token.split('.')[1], 'base64').toString(),
    );
    expect(payload.sub).toBe(configuredEmail);
    expect(payload.is_demo).toBe(true);

    const demoExpiryMinutes = Number(process.env.DEMO_ACCESS_TOKEN_EXPIRE_MINUTES);
    if (Number.isFinite(demoExpiryMinutes) && demoExpiryMinutes > 0) {
      expect(payload.exp - payload.iat).toBe(demoExpiryMinutes * 60);
    }
  });

  it('POST demo-login selects configured account despite unrelated caller email', async () => {
    const configuredEmail = process.env.DEMO_USER_EMAIL;
    expect(configuredEmail).toBeTruthy();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ email: testEmail });
    expect(response.status).toBe(200);
    const payload = JSON.parse(Buffer.from(response.body.access_token.split('.')[1], 'base64').toString());
    expect(payload.sub).toBe(configuredEmail);
    expect(payload.is_demo).toBe(true);
  });

  it('demo login returns 503 when the configured account is missing or email is unset, without creating a user', async () => {
    const originalEmail = configService.get<string>('DEMO_USER_EMAIL');
    const before = await prisma.users.count();
    configService.set('DEMO_USER_EMAIL', 'missing-demo-e2e@sentinel.com');
    const missing = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({});
    expect(missing.status).toBe(503);
    expect(await prisma.users.findUnique({ where: { email: 'missing-demo-e2e@sentinel.com' } })).toBeNull();
    configService.set('DEMO_USER_EMAIL', undefined as any);
    const unset = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({});
    expect(unset.status).toBe(503);
    expect(await prisma.users.count()).toBe(before);
    configService.set('DEMO_USER_EMAIL', originalEmail);
  });

  it('demo user mutation endpoint attempts do not change account state', async () => {
    const token = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({}).then((response) => response.body.access_token);
    expect(token).toBeDefined();
    const me = await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    const before = await prisma.users.findUnique({ where: { id: me.body.id } });
    const attempts = [];
    attempts.push(await request(app.getHttpServer()).patch('/api/v1/users/password').set('Authorization', `Bearer ${token}`).send({ password: 'ChangedPassword123' }));
    attempts.push(await request(app.getHttpServer()).patch('/api/v1/users/email').set('Authorization', `Bearer ${token}`).send({ email: 'changed@sentinel.com' }));
    attempts.push(await request(app.getHttpServer()).delete(`/api/v1/users/${me.body.id}`).set('Authorization', `Bearer ${token}`));
    expect(attempts.every((response) => [403, 404].includes(response.status))).toBe(true);
    expect(await prisma.users.findUnique({ where: { id: me.body.id } })).toEqual(before);
  });

  it('GET /api/v1/users/me returns database-backed demo identity', async () => {
    const configuredEmail = process.env.DEMO_USER_EMAIL;
    expect(configuredEmail).toBeTruthy();
    const token = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').set('X-Forwarded-For', '198.51.100.21').send({}).then((r) => r.body.access_token);
    const response = await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.is_demo).toBe(true);
  });

  it('demo login permits 30 requests per client IP and throttles the 31st', async () => {
    const configuredEmail = process.env.DEMO_USER_EMAIL;
    expect(configuredEmail).toBeTruthy();
    const attempts = [];
    for (let i = 0; i < 31; i++) {
      attempts.push(await request(app.getHttpServer()).post('/api/v1/auth/demo-login')
        .set('X-Forwarded-For', '198.51.100.22').send({}));
    }
    expect(attempts.slice(0, 30).every((r) => r.status === 200)).toBe(true);
    expect(attempts[30].status).toBe(429);
  });

  it('password login remains limited to five requests per client IP', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(await request(app.getHttpServer()).post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.23')
        .send({ username: testEmail, password: 'WrongPassword123' }));
    }
    expect(attempts.slice(0, 5).every((r) => r.status === 401)).toBe(true);
    expect(attempts[5].status).toBe(429);
  });

  it('registration remains limited to five requests per client IP', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(await request(app.getHttpServer()).post('/api/v1/users')
        .set('X-Forwarded-For', '198.51.100.24')
        .send({ name: 'Invalid', email: 'invalid', username: 'invalid', password: 'bad' }));
    }
    expect(attempts.slice(0, 5).every((r) => r.status === 400)).toBe(true);
    expect(attempts[5].status).toBe(429);
  });

  it('GET /api/v1/users/me should return current user when authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(testEmail);
    expect(res.body.username).toBe(testUsername);
  });
});
