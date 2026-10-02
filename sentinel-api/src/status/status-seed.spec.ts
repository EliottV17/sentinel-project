import { StatusSeed } from './status-seed';

describe('StatusSeed', () => {
  const manifest = [
    {
      seed_key: 'example-website',
      name: 'Example Website',
      target: 'https://example.com/api',
    },
    {
      seed_key: 'github-api',
      name: 'GitHub API',
      target: 'https://api.github.com',
    },
  ];
  const originalEnvironment = {
    owner: process.env.STATUS_OWNER_EMAIL,
    demo: process.env.DEMO_USER_EMAIL,
  };

  afterEach(() => {
    if (originalEnvironment.owner === undefined) delete process.env.STATUS_OWNER_EMAIL;
    else process.env.STATUS_OWNER_EMAIL = originalEnvironment.owner;
    if (originalEnvironment.demo === undefined) delete process.env.DEMO_USER_EMAIL;
    else process.env.DEMO_USER_EMAIL = originalEnvironment.demo;
  });

  it('does not appropriate an ordinary account with the configured owner email', async () => {
    process.env.STATUS_OWNER_EMAIL = 'owner@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({ id: 8, is_demo: false, password: '$argon2id$ordinary' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      monitor: { upsert: jest.fn() },
    };

    await expect(new StatusSeed(prisma as never).seed(manifest)).rejects.toThrow(/already belongs/i);
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.monitor.upsert).not.toHaveBeenCalled();
  });

  it('rejects a demo-owner collision before writes', async () => {
    process.env.STATUS_OWNER_EMAIL = 'demo@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const prisma = {
      users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      monitor: { upsert: jest.fn() },
    };

    await expect(new StatusSeed(prisma as never).seed(manifest)).rejects.toThrow(/different/i);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.monitor.upsert).not.toHaveBeenCalled();
  });

  it('rejects duplicate seed keys and malformed owner configuration before database access', async () => {
    process.env.STATUS_OWNER_EMAIL = 'not-an-email';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const prisma = {
      users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      monitor: { upsert: jest.fn() },
    };
    const seed = new StatusSeed(prisma as never);

    await expect(seed.seed([manifest[0], manifest[0]])).rejects.toThrow(/invalid status monitor/i);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
    await expect(seed.seed(manifest)).rejects.toThrow(/STATUS_OWNER_EMAIL must be a valid email/i);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });

  it('validates the entire manifest before owner or monitor writes', async () => {
    process.env.STATUS_OWNER_EMAIL = 'owner@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const prisma = {
      users: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      monitor: { upsert: jest.fn() },
    };

    await expect(
      new StatusSeed(prisma as never).seed([...manifest, {
        seed_key: 'private-target', name: 'Private', target: 'http://169.254.169.254/latest/meta-data',
      }]),
    ).rejects.toThrow(/invalid status monitor/i);
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.monitor.upsert).not.toHaveBeenCalled();
  });

  it('recognizes only its disabled owner and repeat-upserts public monitors without deleting omitted rows', async () => {
    process.env.STATUS_OWNER_EMAIL = 'owner@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const sentinelPassword = 'STATUS_SEED_DISABLED_PASSWORD_SENTINEL';
    const user = {
      id: 42,
      email: 'owner@example.test',
      is_demo: false,
      is_active: false,
      password: sentinelPassword,
    };
    const rows = new Map<string, any>();
    const userFind = jest.fn().mockResolvedValue(user);
    const userCreate = jest.fn();
    const userUpdate = jest.fn();
    const monitorUpsert = jest.fn(async ({ where, update, create }: any) => {
      const key = where.user_id_seed_key.seed_key;
      const existing = rows.get(key);
      if (existing) Object.assign(existing, update);
      else rows.set(key, { id: rows.size + 1, ...create });
    });
    const prisma = {
      users: { findUnique: userFind, create: userCreate, update: userUpdate },
      monitor: { upsert: monitorUpsert },
    };
    const seed = new StatusSeed(prisma as never);

    await seed.seed(manifest);
    await seed.seed([ { ...manifest[0], name: 'Updated example' } ]);

    expect(userCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(rows.get('example-website')).toEqual(expect.objectContaining({
      name: 'Updated example', is_public: true, frequency: 60, state: 'Active', user_id: 42,
    }));
    expect(rows.get('github-api')).toBeDefined();
    expect(monitorUpsert).toHaveBeenCalledTimes(3);
    expect(monitorUpsert.mock.calls[0][0].create.is_public).toBe(true);
    expect(monitorUpsert.mock.calls[0][0].update.is_public).toBe(true);
    expect(user.password).toBe(sentinelPassword);
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data',
  ])('rejects unsafe target %s', async (target) => {
    process.env.STATUS_OWNER_EMAIL = 'owner@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const prisma = {
      users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      monitor: { upsert: jest.fn() },
    };
    await expect(new StatusSeed(prisma as never).seed([
      { seed_key: 'unsafe', name: 'Unsafe', target },
    ])).rejects.toThrow(/invalid status monitor/i);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });
});
