import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PublicStatusService } from './public-status.service';

describe('PublicStatusService', () => {
  let prisma: { $queryRaw: jest.Mock };
  let config: { get: jest.Mock };
  let service: PublicStatusService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    config = {
      get: jest.fn((key: string, fallback: number) => fallback),
    };
    service = new PublicStatusService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('aggregates rows once and returns only the four public fields as JSON values', async () => {
    config.get.mockImplementation((key: string, fallback: number) =>
      key === 'STATUS_UPTIME_WINDOW_HOURS' ? 6 : fallback,
    );
    const checkedAt = new Date('2025-01-01T00:00:00.000Z');
    prisma.$queryRaw.mockResolvedValue([
      {
        name: 'API',
        last_state: 'healthy',
        uptime_percentage: '87.5000',
        last_checked_at: checkedAt,
      },
    ]);

    await service.onModuleInit();
    await expect(service.getPublicStatus()).resolves.toEqual([
      {
        name: 'API',
        last_state: 'healthy',
        uptime_percentage: 87.5,
        last_checked_at: checkedAt,
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('m.name AS name');
    expect(query.sql).toContain('m.last_checked_at AS last_checked_at');
    expect(query.sql).not.toContain('MAX(cr.created_at)');
    expect(query.values).toContain(6);
    expect(query.sql).toContain('m.is_public = TRUE');
    expect(query.sql).toContain('u.is_demo = FALSE');
    expect(query.sql).toContain("cr.state = 'healthy'");
    expect(query.sql).toContain("cr.created_at <= NOW()");
    expect(query.sql).toContain('ORDER BY m.name ASC, m.id ASC');
    expect(query.sql).not.toContain('SELECT *');
    expect(Object.keys((await service.getPublicStatus())[0])).toEqual([
      'name',
      'last_state',
      'uptime_percentage',
      'last_checked_at',
    ]);
  });

  it('caches successful results and refreshes after the configured TTL', async () => {
    jest.useFakeTimers();
    config.get.mockImplementation((key: string, fallback: number) =>
      key === 'STATUS_CACHE_TTL_SECONDS' ? 2 : fallback,
    );
    prisma.$queryRaw.mockResolvedValue([]);
    service = new PublicStatusService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
    await service.onModuleInit();

    await service.getPublicStatus();
    await service.getPublicStatus();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2001);
    await service.getPublicStatus();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('coalesces concurrent refreshes and represents empty uptime as null', async () => {
    let resolveQuery: (rows: any[]) => void;
    prisma.$queryRaw.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    await service.onModuleInit();

    const first = service.getPublicStatus();
    const second = service.getPublicStatus();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    resolveQuery!([
      {
        name: 'No checks',
        last_state: null,
        uptime_percentage: null,
        last_checked_at: null,
      },
    ]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ name: 'No checks', last_state: null, uptime_percentage: null, last_checked_at: null }],
      [{ name: 'No checks', last_state: null, uptime_percentage: null, last_checked_at: null }],
    ]);
  });

  it('does not cache failed queries', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.onModuleInit();

    await expect(service.getPublicStatus()).rejects.toThrow('database unavailable');
    await expect(service.getPublicStatus()).resolves.toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['STATUS_UPTIME_WINDOW_HOURS', 0],
    ['STATUS_UPTIME_WINDOW_HOURS', Number.POSITIVE_INFINITY],
    ['STATUS_CACHE_TTL_SECONDS', -1],
    ['STATUS_CACHE_TTL_SECONDS', Number.NaN],
  ])('rejects invalid %s value %s', async (key, value) => {
    config.get.mockImplementation((current: string, fallback: number) =>
      current === key ? value : fallback,
    );
    service = new PublicStatusService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
    expect(() => service.onModuleInit()).toThrow(key);
  });
});
