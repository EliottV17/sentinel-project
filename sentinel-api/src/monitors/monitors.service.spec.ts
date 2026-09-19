import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MonitorsService } from './monitors.service';

describe('MonitorsService', () => {
  let service: MonitorsService;
  let prisma: {
    monitor: {
      create: jest.Mock;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitorsService,
        { provide: PrismaService, useValue: prisma },
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
  });

  describe('updateMonitor', () => {
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
