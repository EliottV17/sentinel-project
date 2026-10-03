import { PrismaClient } from '@prisma/client';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as express from 'express';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
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
        expect(owner).toEqual(configuredOwnerSnapshot.owner);
        expect(monitors.map(({ is_public: _publication, ...monitor }) => monitor)).toEqual(
          (configuredOwnerSnapshot.monitors as any[]).map(({ is_public: _publication, ...monitor }) => monitor),
        );
        expect(monitors.every((monitor) => !monitor.is_public)).toBe(true);
        expect(history).toEqual(configuredOwnerSnapshot.history);
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

  it('seeds a synthetic manifest, updates in place, and preserves omitted monitors and check history', async () => {
    const manifest: StatusManifest = [
      { seed_key: 'synthetic-status-one', name: 'Synthetic Status One', target: 'https://example.com/one' },
      { seed_key: 'synthetic-status-two', name: 'Synthetic Status Two', target: 'https://example.com/two' },
    ];
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
    const omittedHistory = await prisma.check_result.create({
      data: { monitor_id: seeded[1].id, state: 'Healthy', created_at: new Date(), latency_ms: 3 },
    });

    await seed.seed([{ ...manifest[0], name: 'Updated public monitor' }]);

    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: first.id } });
    expect(updated.name).toBe('Updated public monitor');
    expect(updated.is_public).toBe(true);
    const omitted = await prisma.monitor.findFirst({ where: { user_id: owner.id, seed_key: omittedSeedKey } });
    expect(omitted).not.toBeNull();
    expect(omitted?.is_public).toBe(false);
    expect(await prisma.monitor.count({ where: { user_id: owner.id } })).toBe(manifest.length);
    expect(await prisma.check_result.findUnique({ where: { id: existingHistory.id } })).not.toBeNull();
    expect(await prisma.check_result.findUnique({ where: { id: omittedHistory.id } })).not.toBeNull();
  });

  it('preserves already-private normal and demo monitors plus history through repeat seeding', async () => {
    process.env.STATUS_OWNER_EMAIL = ownerEmail;
    process.env.DEMO_USER_EMAIL = demoEmail;
    const normalEmail = `status-private-normal-${randomUUID()}@example.test`;
    const privateDemoEmail = `status-private-demo-${randomUUID()}@example.test`;
    const normal = await prisma.users.create({
      data: {
        email: normalEmail, username: normalEmail, name: 'Private Normal', last_name: 'Fixture',
        password: 'not-used-by-this-fixture', status: 'Active', is_active: true, is_demo: false,
        created_at: new Date(), updated_at: new Date(),
      },
    });
    fixtureEmails.push(normalEmail);
    const demo = await prisma.users.create({
      data: {
        email: privateDemoEmail, username: privateDemoEmail, name: 'Private Demo', last_name: 'Fixture',
        password: 'not-used-by-this-fixture', status: 'Active', is_active: true, is_demo: true,
        created_at: new Date(), updated_at: new Date(),
      },
    });
    fixtureEmails.push(privateDemoEmail);
    const createdAt = new Date();
    await prisma.monitor.createMany({
      data: [normal, demo].map((user, index) => ({
        name: `Private monitor ${index}`,
        target: 'https://example.com/private',
        frequency: 60,
        state: 'Active',
        created_at: createdAt,
        check_type: 'http',
        check_config: {},
        consecutive_failures: 0,
        user_id: user.id,
        seed_key: null,
        is_public: false,
      })),
    });
    const privateMonitors = await prisma.monitor.findMany({
      where: { user_id: { in: [normal.id, demo.id] } },
      orderBy: { id: 'asc' },
    });
    const historyRows = await Promise.all(privateMonitors.map((monitor, index) => prisma.check_result.create({
      data: { monitor_id: monitor.id, state: 'Healthy', created_at: new Date(createdAt.getTime() + index), latency_ms: index + 1 },
    })));
    const manifest: StatusManifest = [
      { seed_key: 'private-monitor-retention', name: 'Public fixture status', target: 'https://example.com/public' },
    ];
    await seed.seed(manifest);

    const privateSnapshot = await prisma.monitor.findMany({ where: { id: { in: privateMonitors.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
    const historySnapshot = await prisma.check_result.findMany({ where: { monitor_id: { in: privateMonitors.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await seed.seed(manifest);
      expect(await prisma.monitor.findMany({ where: { id: { in: privateMonitors.map(({ id }) => id) } }, orderBy: { id: 'asc' } })).toEqual(privateSnapshot);
      expect(await prisma.check_result.findMany({ where: { monitor_id: { in: privateMonitors.map(({ id }) => id) } }, orderBy: { id: 'asc' } })).toEqual(historySnapshot);
      expect(historySnapshot.map(({ id }) => id)).toEqual(historyRows.map(({ id }) => id));
      expect(privateSnapshot.every((monitor) => !monitor.is_public)).toBe(true);
      expect(log).toHaveBeenCalledWith('Status publication reconciliation hid 0 monitor(s)');
    } finally {
      log.mockRestore();
    }
  });

  it('hides the previous owner on owner switch without deleting monitor or check history', async () => {
    const previousEmail = `status-previous-${randomUUID()}@example.test`;
    const currentEmail = `status-current-${randomUUID()}@example.test`;
    process.env.DEMO_USER_EMAIL = demoEmail;
    process.env.STATUS_OWNER_EMAIL = previousEmail;
    const manifest: StatusManifest = [
      { seed_key: 'switch-retained', name: 'Retained status', target: 'https://example.com/status' },
    ];
    await seed.seed(manifest);
    fixtureEmails.push(previousEmail);
    const previousOwner = await prisma.users.findUniqueOrThrow({ where: { email: previousEmail } });
    const previousMonitor = await prisma.monitor.findFirstOrThrow({ where: { user_id: previousOwner.id } });
    const history = await prisma.check_result.create({
      data: { monitor_id: previousMonitor.id, state: 'Healthy', created_at: new Date(), latency_ms: 2 },
    });

    process.env.STATUS_OWNER_EMAIL = currentEmail;
    await seed.seed(manifest);
    fixtureEmails.push(currentEmail);

    const hidden = await prisma.monitor.findUniqueOrThrow({ where: { id: previousMonitor.id } });
    const { is_public: _publication, ...unchangedFields } = hidden;
    const { is_public: _originalPublication, ...originalFields } = previousMonitor;
    expect(hidden.is_public).toBe(false);
    expect(unchangedFields).toEqual(originalFields);
    expect(await prisma.users.findUnique({ where: { email: previousEmail } })).not.toBeNull();
    expect(await prisma.users.findUnique({ where: { email: currentEmail } })).not.toBeNull();
    expect(await prisma.check_result.findUnique({ where: { id: history.id } })).not.toBeNull();
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
