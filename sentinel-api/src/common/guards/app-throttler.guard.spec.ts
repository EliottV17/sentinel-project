import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;
  let reflector: Reflector;
  let storageService: ThrottlerStorageService;

  beforeEach(async () => {
    reflector = new Reflector();
    storageService = new ThrottlerStorageService();
    const options = [
      {
        name: 'default',
        ttl: 60000,
        limit: 2,
      },
    ];
    guard = new AppThrottlerGuard(options as any, storageService, reflector);
    await guard.onModuleInit();
  });

  const createMockContext = (ip: string, user?: { id: number }) => {
    const headers: Record<string, any> = {};
    const req = {
      ip,
      ips: [ip],
      user,
      headers: {},
      socket: { remoteAddress: ip },
    };
    const res = {
      header: jest.fn((name: string, val: any) => {
        headers[name] = val;
      }),
      setHeader: jest.fn((name: string, val: any) => {
        headers[name] = val;
      }),
      getHeader: (name: string) => headers[name],
    };

    return {
      context: {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
        getClass: () => ({ name: 'TestController' }),
        getHandler: () => ({ name: 'testHandler' }),
      } as unknown as ExecutionContext,
      res,
      req,
      headers,
    };
  };

  it('tracks unauthenticated requests by IP', async () => {
    const tracker1 = await (guard as any).getTracker({ ip: '203.0.113.1' });
    const tracker2 = await (guard as any).getTracker({ ip: '198.51.100.2' });
    expect(tracker1).toBe('ip_203.0.113.1');
    expect(tracker2).toBe('ip_198.51.100.2');
    expect(tracker1).not.toBe(tracker2);
  });

  it('tracks authenticated requests by user ID regardless of IP', async () => {
    const trackerUser1FromIpA = await (guard as any).getTracker({
      user: { id: 42 },
      ip: '192.0.2.1',
    });
    const trackerUser1FromIpB = await (guard as any).getTracker({
      user: { id: 42 },
      ip: '198.51.100.5',
    });
    const trackerUser2 = await (guard as any).getTracker({
      user: { id: 99 },
      ip: '192.0.2.1',
    });

    expect(trackerUser1FromIpA).toBe('user_42');
    expect(trackerUser1FromIpB).toBe('user_42');
    expect(trackerUser2).toBe('user_99');
  });

  it('throws 429 and sets Retry-After header when rate limit is exceeded', async () => {
    const { context, headers } = createMockContext('203.0.113.10');

    // First request should pass
    await expect(guard.canActivate(context)).resolves.toBe(true);

    // Second request should pass
    await expect(guard.canActivate(context)).resolves.toBe(true);

    // Third request should be throttled
    await expect(guard.canActivate(context)).rejects.toThrow();

    // Verify Retry-After header is set
    expect(headers['Retry-After']).toBeDefined();
    expect(typeof headers['Retry-After']).toBe('number');
    expect(headers['Retry-After']).toBeGreaterThanOrEqual(1);
  });

  it('isolates rate limits between different client IPs behind proxy', async () => {
    const clientA = createMockContext('203.0.113.50');
    const clientB = createMockContext('203.0.113.51');

    // Client A uses its 2 requests
    await expect(guard.canActivate(clientA.context)).resolves.toBe(true);
    await expect(guard.canActivate(clientA.context)).resolves.toBe(true);
    await expect(guard.canActivate(clientA.context)).rejects.toThrow();

    // Client B still has its quota available
    await expect(guard.canActivate(clientB.context)).resolves.toBe(true);
  });
});
