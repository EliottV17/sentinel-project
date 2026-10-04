import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let prisma: { $queryRaw: jest.Mock };
  let service: HealthService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    service = new HealthService(prisma as unknown as PrismaService);
  });

  it('returns a stable healthy status after a successful database probe', async () => {
    prisma.$queryRaw.mockResolvedValue([{ result: 1 }]);

    await expect(service.getReadiness()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized unavailable response when the database probe fails', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('postgres://private-user:private-password@db/private-db'),
    );

    try {
      await service.getReadiness();
      throw new Error('expected readiness check to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const exception = error as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      expect(exception.getResponse()).toEqual({
        statusCode: 503,
        message: 'Database unavailable',
        error: 'Service Unavailable',
      });
      expect(JSON.stringify(exception.getResponse())).not.toMatch(/private-user|private-password|private-db/);
    }
  });
});
