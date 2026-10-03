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
      monitor: { upsert: jest.fn(), updateMany: jest.fn() },
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
      monitor: { upsert: jest.fn(), updateMany: jest.fn() },
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
      monitor: { upsert: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((callback) => callback(prisma)),
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
      monitor: { upsert: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn((callback) => callback(prisma)),
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
    const monitorUpdateMany = jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!row.is_public) continue;
        const outsideEligibleSet = where.OR.some((condition: any) => {
          if (condition.user_id?.not !== undefined) return row.user_id !== condition.user_id.not;
          if (condition.seed_key === null) return row.user_id === condition.user_id && row.seed_key === null;
          return row.user_id === condition.user_id && !condition.seed_key.notIn.includes(row.seed_key);
        });
        if (outsideEligibleSet) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    });
    const prisma = {
      users: { findUnique: userFind, create: userCreate, update: userUpdate },
      monitor: { upsert: monitorUpsert, updateMany: monitorUpdateMany },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const seed = new StatusSeed(prisma as never);

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await seed.seed(manifest);
      const subset = [{ ...manifest[0], name: 'Updated example' }];
      await seed.seed(subset);

      expect(rows.get('github-api')?.is_public).toBe(false);
      await expect(monitorUpdateMany.mock.results[1].value).resolves.toEqual({ count: 1 });
      const unchangedSnapshot = [...rows.entries()].map(([key, row]) => [key, { ...row }]);
      await seed.seed(subset);

      expect([...rows.entries()]).toEqual(unchangedSnapshot);
      expect(monitorUpdateMany).toHaveBeenCalledTimes(3);
      expect(monitorUpdateMany.mock.calls[1][0].where.is_public).toBe(true);
      expect(log).toHaveBeenCalledWith('Status publication reconciliation hid 1 monitor(s)');
      expect(log).toHaveBeenCalledWith('Status publication reconciliation hid 0 monitor(s)');
    } finally {
      log.mockRestore();
    }
    expect(userCreate).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(rows.get('example-website')).toEqual(expect.objectContaining({
      name: 'Updated example', is_public: true, frequency: 60, state: 'Active', user_id: 42,
    }));
    expect(rows.get('github-api')).toBeDefined();
    expect(monitorUpsert).toHaveBeenCalledTimes(4);
    expect(monitorUpsert.mock.calls[0][0].create.is_public).toBe(true);
    expect(monitorUpsert.mock.calls[0][0].update.is_public).toBe(true);
    expect(user.password).toBe(sentinelPassword);
  });

  it('reconciles removed and null seed keys while preserving private monitors and logging the actual hidden count', async () => {
    process.env.STATUS_OWNER_EMAIL = 'owner@example.test';
    process.env.DEMO_USER_EMAIL = 'demo@example.test';
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({ id: 42, is_demo: false, is_active: false, password: 'STATUS_SEED_DISABLED_PASSWORD_SENTINEL' }),
        create: jest.fn(), update: jest.fn(),
      },
      monitor: { upsert: jest.fn().mockResolvedValue({}), updateMany },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await new StatusSeed(prisma as never).seed([manifest[0]]);
      const reconcile = updateMany.mock.calls[0][0];
      expect(reconcile.data).toEqual({ is_public: false });
      expect(reconcile.where).toEqual(expect.objectContaining({
        is_public: true,
        OR: expect.arrayContaining([
          { user_id: { not: 42 } },
          { user_id: 42, seed_key: null },
          { user_id: 42, seed_key: { notIn: ['example-website'] } },
        ]),
      }));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/2/));
    } finally {
      log.mockRestore();
    }
  });

  it('accepts an empty manifest and hides all published rows when no owner is configured', async () => {
    delete process.env.STATUS_OWNER_EMAIL;
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      monitor: { upsert: jest.fn(), updateMany },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    await new StatusSeed(prisma as never).seed([]);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({ where: { is_public: true }, data: { is_public: false } });
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
