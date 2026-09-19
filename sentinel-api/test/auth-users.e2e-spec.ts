import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as express from 'express';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth & Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = `e2e_test_${Date.now()}@sentinel.com`;
  const testUsername = `user${Date.now()}`.substring(0, 18);
  const testPassword = 'Password123';
  let accessToken: string;

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

  it('GET /api/v1/users/me should return current user when authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(testEmail);
    expect(res.body.username).toBe(testUsername);
  });
});
