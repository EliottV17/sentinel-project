import { PrismaClient } from '@prisma/client';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as express from 'express';
import * as request from 'supertest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { StatusSeed, StatusManifest } from '../src/status/status-seed';

describe('Status seed (PostgreSQL e2e)', () => {
  const prisma = new PrismaClient();
  const seed = new StatusSeed(prisma);
  const configuredOwnerEmail = process.env.STATUS_OWNER_EMAIL!;
  const originalStatusOwnerEmail = process.env.STATUS_OWNER_EMAIL;
  const originalDemoEmail = process.env.DEMO_USER_EMAIL;
  const ownerEmail = `status-test-${randomUUID()}@example.test`;
  const demoEmail = process.env.DEMO_USER_EMAIL!;
  const fixtureEmails: string[] = [];
  let configuredOwnerSnapshot: { owner: unknown; monitors: unknown[]; history: unknown[] } | undefined;
  let app: NestExpressApplication;

  beforeAll(async () => {
    expect(configuredOwnerEmail).toBeTruthy();
    expect(demoEmail).toBeTruthy();
    expect(ownerEmail.toLowerCase()).not.toBe(demoEmail.toLowerCase());
    process.env.STATUS_OWNER_EMAIL = ownerEmail;
    const configuredOwner = await prisma.users.findUnique({ where: { email: configuredOwnerEmail } });
    expect(configuredOwner).not.toBeNull();
    const configuredMonitors = configuredOwner
      ? await prisma.monitor.findMany({ where: { user_id: configuredOwner.id }, orderBy: { id: 'asc' } })
      : [];
    const configuredHistory = configuredMonitors.length
      ? await prisma.check_result.findMany({
          where: { monitor_id: { in: configuredMonitors.map((monitor) => monitor.id) } },
          orderBy: { id: 'asc' },
        })
      : [];
    configuredOwnerSnapshot = { owner: configuredOwner, monitors: configuredMonitors, history: configuredHistory };
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['/'] });
    await app.init();
  });

  afterAll(async () => {
    try {
      expect(fixtureEmails).not.toContain(configuredOwnerEmail);
      if (fixtureEmails.length) {
        const fixtures = await prisma.users.findMany({
          where: { email: { in: fixtureEmails } },
          select: { id: true },
        });
        const ownerIds = fixtures.map((user) => user.id);
        if (ownerIds.length) {
          await prisma.monitor.deleteMany({ where: { user_id: { in: ownerIds } } });
          await prisma.users.deleteMany({ where: { id: { in: ownerIds } } });
        }
      }
      if (configuredOwnerSnapshot) {
        const owner = await prisma.users.findUnique({ where: { email: configuredOwnerEmail } });
        const monitors = owner
          ? await prisma.monitor.findMany({ where: { user_id: owner.id }, orderBy: { id: 'asc' } })
          : [];
        const history = monitors.length
          ? await prisma.check_result.findMany({
              where: { monitor_id: { in: monitors.map((monitor) => monitor.id) } },
              orderBy: { id: 'asc' },
            })
          : [];
        expect({ owner, monitors, history }).toEqual(configuredOwnerSnapshot);
      }
    } finally {
      if (originalStatusOwnerEmail === undefined) delete process.env.STATUS_OWNER_EMAIL;
      else process.env.STATUS_OWNER_EMAIL = originalStatusOwnerEmail;
      if (originalDemoEmail === undefined) delete process.env.DEMO_USER_EMAIL;
      else process.env.DEMO_USER_EMAIL = originalDemoEmail;
      try {
        await prisma.$disconnect();
      } finally {
        if (app) await app.close();
      }
    }
  });

  it('seeds the root manifest, updates in place, preserves omitted monitors and check history', async () => {
    const manifestPath = resolve(process.env.STATUS_MONITORS_MANIFEST_PATH ?? '../status-monitors.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StatusManifest;
    await seed.seed(manifest);

    const owner = await prisma.users.findUniqueOrThrow({ where: { email: ownerEmail } });
    fixtureEmails.push(ownerEmail);
    expect(owner).toMatchObject({ is_demo: false, is_active: false, password: 'STATUS_SEED_DISABLED_PASSWORD_SENTINEL' });

    const seeded = await prisma.monitor.findMany({ where: { user_id: owner.id }, orderBy: { seed_key: 'asc' } });
    expect(seeded).toHaveLength(manifest.length);
    expect(seeded.every((monitor) => monitor.is_public && monitor.state === 'Active')).toBe(true);
    const first = seeded[0];
    const existingHistory = await prisma.check_result.create({
      data: { monitor_id: first.id, state: 'Healthy', created_at: new Date(), latency_ms: 1 },
    });
    const omittedSeedKey = seeded[1].seed_key!;

    await seed.seed([{ ...manifest[0], name: 'Updated public monitor' }]);

    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: first.id } });
    expect(updated.name).toBe('Updated public monitor');
    expect(updated.is_public).toBe(true);
    expect(await prisma.monitor.findFirst({ where: { user_id: owner.id, seed_key: omittedSeedKey } })).not.toBeNull();
    expect(await prisma.monitor.count({ where: { user_id: owner.id } })).toBe(manifest.length);
    expect(await prisma.check_result.findUnique({ where: { id: existingHistory.id } })).not.toBeNull();
  });

  it('rejects an ordinary account collision without changing the account or creating monitors', async () => {
    const collisionEmail = `status-collision-${Date.now()}@example.test`;
    process.env.STATUS_OWNER_EMAIL = collisionEmail;
    process.env.DEMO_USER_EMAIL = demoEmail;
    const ordinary = await prisma.users.create({
      data: {
        email: collisionEmail,
        username: collisionEmail,
        name: 'Ordinary',
        last_name: 'Account',
        password: '$argon2id$unchanged-ordinary-password',
        status: 'Active',
        is_active: true,
        is_demo: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    fixtureEmails.push(collisionEmail);

    await expect(seed.seed([{ seed_key: 'collision-monitor', name: 'Collision', target: 'https://example.com' }]))
      .rejects.toThrow(/already belongs/i);
    expect(await prisma.users.findUniqueOrThrow({ where: { id: ordinary.id } })).toMatchObject({
      password: '$argon2id$unchanged-ordinary-password', is_active: true, is_demo: false,
    });
    expect(await prisma.monitor.count({ where: { user_id: ordinary.id } })).toBe(0);
  });

  it('does not authenticate the disabled owner or route demo login to that owner', async () => {
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: ownerEmail, password: 'STATUS_SEED_DISABLED_PASSWORD_SENTINEL' });
    expect(ownerLogin.status).toBe(401);

    const demoLogin = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({});
    expect(demoLogin.status).toBe(200);
    const payload = JSON.parse(Buffer.from(demoLogin.body.access_token.split('.')[1], 'base64').toString());
    expect(payload.sub).toBe(demoEmail);
    expect(payload.sub).not.toBe(ownerEmail);
    expect(payload.is_demo).toBe(true);
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://10.10.0.2/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
  ])('rejects unsafe seed target %s before creating an owner', async (target) => {
    const rejectedEmail = `status-unsafe-${Date.now()}@example.test`;
    process.env.STATUS_OWNER_EMAIL = rejectedEmail;
    process.env.DEMO_USER_EMAIL = demoEmail;
    await expect(seed.seed([{ seed_key: 'unsafe', name: 'Unsafe', target }])).rejects.toThrow(/invalid status monitor/i);
    expect(await prisma.users.findUnique({ where: { email: rejectedEmail } })).toBeNull();
  });
});
