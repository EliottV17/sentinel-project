import { DemoSeed } from './demo-seed';

describe('DemoSeed', () => {
  it('restores manifest values by seed key, adds missing entries once, and preserves extra monitors', async () => {
    const manifest = {
      user: { email: 'demo@example.com', password: 'password' },
      monitors: [
        {
          seed_key: 'example-website',
          name: 'Example Website',
          target: 'https://example.com',
          frequency: 60,
          check_type: 'http',
          check_config: {},
        },
        {
          seed_key: 'github-api',
          name: 'GitHub API',
          target: 'https://api.github.com',
          frequency: 60,
          check_type: 'http',
          check_config: {},
        },
      ],
    };
    const seededRow = {
      id: 11,
      user_id: 7,
      seed_key: 'example-website',
      name: 'User-edited name',
      target: 'https://user-edited.example',
      frequency: 120,
      state: 'Active',
      check_type: 'http',
      check_config: { edited: true },
      consecutive_failures: 4,
    };
    const extraRow = {
      id: 12,
      user_id: 7,
      seed_key: null,
      name: 'My personal monitor',
      target: 'https://personal.example',
      frequency: 300,
      state: 'Paused',
      check_type: 'http',
      check_config: { personal: true },
      consecutive_failures: 2,
    };
    const rows = [seededRow, extraRow];
    const monitorUpsert = jest.fn(async ({ where, update, create }) => {
      const existing = rows.find(
        (row) => row.user_id === where.user_id_seed_key.user_id &&
          row.seed_key === where.user_id_seed_key.seed_key,
      );
      if (existing) Object.assign(existing, update);
      else rows.push({ id: rows.length + 11, ...create });
      return existing ?? rows[rows.length - 1];
    });
    const prisma = {
      users: { upsert: jest.fn().mockResolvedValue({ id: 7 }) },
      monitor: {
        upsert: monitorUpsert,
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const seed = new DemoSeed(prisma as never);

    await seed.seed(manifest);
    await seed.seed(manifest);

    expect(rows.find((row) => row.seed_key === 'example-website')).toEqual(
      expect.objectContaining({
        name: 'Example Website',
        target: 'https://example.com',
        frequency: 60,
        check_config: {},
      }),
    );
    expect(rows.filter((row) => row.seed_key === 'github-api')).toHaveLength(1);
    expect(rows).toHaveLength(manifest.monitors.length + 1);
    expect(rows.find((row) => row.id === extraRow.id)).toEqual(extraRow);
    expect(prisma.monitor.delete).not.toHaveBeenCalled();
    expect(prisma.monitor.deleteMany).not.toHaveBeenCalled();
  });
});
