import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorsService } from './monitors.service';

describe('MonitorsService', () => {
  let service: MonitorsService;
  let configService: { get: jest.Mock };
  let prisma: {
    monitor: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    check_result: {
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
    alert: {
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      monitor: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      check_result: {
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      alert: {
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string, defaultValue: any) => {
        if (key === 'MAX_MONITORS_PER_USER') return 10;
        if (key === 'MIN_MONITOR_FREQUENCY_SECONDS') return 60;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<MonitorsService>(MonitorsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createMonitor', () => {
    it('should successfully create a monitor for valid input', async () => {
      prisma.monitor.create.mockImplementation(({ data }) => ({
        id: 10,
        ...data,
      }));

      const dto = {
        name: 'API Health',
        target: 'https://api.example.com',
        check_type: 'http',
        frequency: 60,
      };

      const result = await service.createMonitor(dto, 1);
      expect(result.id).toBe(10);
      expect(result.name).toBe('API Health');
      expect(result.user_id).toBe(1);
      expect(prisma.monitor.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException for unknown check_type', async () => {
      const dto = {
        name: 'API Health',
        target: 'https://api.example.com',
        check_type: 'tcp',
      };

      await expect(service.createMonitor(dto, 1)).rejects.toThrow(
        new BadRequestException('Unknown checker type: tcp'),
      );
    });

    it('should throw BadRequestException when frequency is below MIN_MONITOR_FREQUENCY_SECONDS', async () => {
      const dto = {
        name: 'Fast Monitor',
        target: 'https://api.example.com',
        check_type: 'http',
        frequency: 15,
      };

      await expect(service.createMonitor(dto, 1)).rejects.toThrow(
        new BadRequestException(
          'Monitor frequency cannot be less than 60 seconds',
        ),
      );
    });

    it('should throw BadRequestException when user reaches MAX_MONITORS_PER_USER', async () => {
      prisma.monitor.count.mockResolvedValue(10);

      const dto = {
        name: 'Excess Monitor',
        target: 'https://api.example.com',
        check_type: 'http',
        frequency: 60,
      };

      await expect(service.createMonitor(dto, 1)).rejects.toThrow(
        new BadRequestException(
          'Monitor limit reached. Maximum allowed: 10 monitors',
        ),
      );
    });
  });

  describe('demo monitor limits', () => {
    const demoUser = { id: 7, is_demo: true };
    const dto = { name: 'Demo', target: 'https://example.com', check_type: 'http', frequency: 60 };

    it('enforces demo-specific count of three on create', async () => {
      configService.get.mockImplementation((key: string, fallback: any) => key === 'DEMO_MAX_MONITORS' ? 3 : fallback);
      prisma.monitor.count.mockResolvedValue(3);
      prisma.monitor.create.mockImplementation(({ data }) => ({ id: 10, ...data }));
      await expect(service.createMonitor(dto, demoUser as any)).rejects.toThrow('Maximum allowed: 3 monitors');
      expect(prisma.monitor.create).not.toHaveBeenCalled();
    });

    it('uses DEMO_MIN_FREQUENCY_SECONDS to reject low-frequency creates', async () => {
      configService.get.mockImplementation((key: string, fallback: any) => key === 'DEMO_MIN_FREQUENCY_SECONDS' ? 120 : fallback);
      prisma.monitor.create.mockImplementation(({ data }) => ({ id: 10, ...data }));
      await expect(service.createMonitor({ ...dto, frequency: 60 }, demoUser as any)).rejects.toThrow('less than 120 seconds');
      expect(prisma.monitor.create).not.toHaveBeenCalled();
    });

    it('uses DEMO_MIN_FREQUENCY_SECONDS to reject low-frequency PATCHes', async () => {
      configService.get.mockImplementation((key: string, fallback: any) => key === 'DEMO_MIN_FREQUENCY_SECONDS' ? 120 : fallback);
      prisma.monitor.findFirst.mockResolvedValue({ id: 7, user_id: 7 });
      prisma.monitor.update.mockImplementation(({ data }) => ({ id: 7, user_id: 7, ...data }));
      await expect(service.updateMonitor(7, demoUser as any, { frequency: 60 } as any)).rejects.toThrow('less than 120 seconds');
      expect(prisma.monitor.update).not.toHaveBeenCalled();
    });

    it('keeps ordinary minimum frequency independent from the demo setting', async () => {
      configService.get.mockImplementation((key: string, fallback: any) => key === 'DEMO_MIN_FREQUENCY_SECONDS' ? 120 : key === 'MIN_MONITOR_FREQUENCY_SECONDS' ? 60 : fallback);
      prisma.monitor.create.mockImplementation(({ data }) => ({ id: 10, ...data }));
      await expect(service.createMonitor({ ...dto, frequency: 60 }, 9)).resolves.toMatchObject({ frequency: 60 });
    });

    it('keeps ordinary PATCH frequency independent from the demo setting', async () => {
      configService.get.mockImplementation((key: string, fallback: any) => key === 'DEMO_MIN_FREQUENCY_SECONDS' ? 120 : key === 'MIN_MONITOR_FREQUENCY_SECONDS' ? 60 : fallback);
      prisma.monitor.findFirst.mockResolvedValue({ id: 7, user_id: 9 });
      prisma.monitor.update.mockImplementation(({ data }) => ({ id: 7, user_id: 9, ...data }));
      await expect(service.updateMonitor(7, 9, { frequency: 60 })).resolves.toMatchObject({ frequency: 60 });
    });

    it('keeps the ordinary quota for non-demo users', async () => {
      prisma.monitor.count.mockResolvedValue(3);
      prisma.monitor.create.mockImplementation(({ data }) => ({ id: 10, ...data }));
      await expect(service.createMonitor(dto, 9)).resolves.toMatchObject({ user_id: 9 });
    });
  });

  describe('updateMonitor', () => {
    it('should throw BadRequestException when updating frequency below minimum', async () => {
      prisma.monitor.findFirst.mockResolvedValue({ id: 1, user_id: 2, name: 'Monitor' });

      await expect(
        service.updateMonitor(1, 2, { frequency: 20 }),
      ).rejects.toThrow(
        new BadRequestException(
          'Monitor frequency cannot be less than 60 seconds',
        ),
      );
    });
    it('should throw NotFoundException when monitor does not belong to user', async () => {
      prisma.monitor.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMonitor(1, 2, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update monitor when found', async () => {
      prisma.monitor.findFirst.mockResolvedValue({ id: 1, user_id: 2, name: 'Old' });
      prisma.monitor.update.mockResolvedValue({ id: 1, user_id: 2, name: 'New' });

      const result = await service.updateMonitor(1, 2, { name: 'New' });
      expect(result.name).toBe('New');
    });
  });

  describe('deleteMonitor', () => {
    it('should throw NotFoundException when monitor not found', async () => {
      prisma.monitor.findFirst.mockResolvedValue(null);

      await expect(service.deleteMonitor(1, 2)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should run transaction to delete cascaded children and monitor', async () => {
      prisma.monitor.findFirst.mockResolvedValue({ id: 1, user_id: 2 });
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.deleteMonitor(1, 2);
      expect(result.message).toBe('Monitor deleted successfully');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('getHistory & getAlerts', () => {
    it('should throw ForbiddenException if user is not monitor owner', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ id: 1, user_id: 99 });

      await expect(service.getHistory(1, 10)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.getAlerts(1, 10)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return history when authorized', async () => {
      prisma.monitor.findUnique.mockResolvedValue({ id: 1, user_id: 10 });
      prisma.check_result.findMany.mockResolvedValue([
        {
          id: 1,
          monitor_id: 1,
          state: 'healthy',
          status_code: 200,
          latency_ms: 120.5,
          created_at: new Date(),
        },
      ]);

      const result = await service.getHistory(1, 10, 50);
      expect(result.length).toBe(1);
      expect(result[0].state).toBe('healthy');
    });
  });
});
