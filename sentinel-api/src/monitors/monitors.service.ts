import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMonitorDto } from './dto/create-monitor.dto';
import { UpdateMonitorDto } from './dto/update-monitor.dto';
import { MonitorResponseDto } from './dto/monitor-response.dto';
import {
  AlertResponseDto,
  CheckResultResponseDto,
} from './dto/history-alert-response.dto';

const VALID_CHECK_TYPES = ['http'];

@Injectable()
export class MonitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createMonitor(
    dto: CreateMonitorDto,
    userOrId: number | { id: number; is_demo?: boolean },
  ): Promise<MonitorResponseDto> {
    const userId = typeof userOrId === 'number' ? userOrId : userOrId.id;
    const isDemo = typeof userOrId === 'object' && userOrId.is_demo === true;
    const checkType = dto.check_type || 'http';
    if (!VALID_CHECK_TYPES.includes(checkType)) {
      throw new BadRequestException(`Unknown checker type: ${checkType}`);
    }

    const minFrequency = Number(this.configService.get<number>(
      isDemo ? 'DEMO_MIN_FREQUENCY_SECONDS' : 'MIN_MONITOR_FREQUENCY_SECONDS', 60,
    ));
    const frequency = dto.frequency ?? 60;
    if (frequency < minFrequency) {
      throw new BadRequestException(
        `Monitor frequency cannot be less than ${minFrequency} seconds`,
      );
    }

    const maxMonitors = Number(this.configService.get<number>(
      isDemo ? 'DEMO_MAX_MONITORS' : 'MAX_MONITORS_PER_USER', isDemo ? 3 : 10,
    ));
    const currentCount = await this.prisma.monitor.count({
      where: { user_id: userId },
    });
    if (currentCount >= maxMonitors) {
      throw new BadRequestException(
        `Monitor limit reached. Maximum allowed: ${maxMonitors} monitors`,
      );
    }

    const monitor = await this.prisma.monitor.create({
      data: {
        name: dto.name,
        target: dto.target,
        frequency: frequency,
        state: 'Active',
        check_type: checkType,
        check_config: dto.check_config ?? {},
        consecutive_failures: 0,
        created_at: new Date(),
        user_id: userId,
      },
    });

    return MonitorResponseDto.fromEntity(monitor);
  }

  async getMonitorsByUser(userId: number): Promise<MonitorResponseDto[]> {
    const monitors = await this.prisma.monitor.findMany({
      where: { user_id: userId },
    });
    return monitors.map((m) => MonitorResponseDto.fromEntity(m));
  }

  async getMonitorById(monitorId: number) {
    return this.prisma.monitor.findUnique({
      where: { id: monitorId },
    });
  }

  async updateMonitor(
    monitorId: number,
    userOrId: number | { id: number; is_demo?: boolean },
    dto: UpdateMonitorDto,
  ): Promise<MonitorResponseDto> {
    const userId = typeof userOrId === 'number' ? userOrId : userOrId.id;
    const isDemo = typeof userOrId === 'object' && userOrId.is_demo === true;
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, user_id: userId },
    });

    if (!monitor) {
      throw new NotFoundException(
        'Monitor not found or you do not have permission to modify it.',
      );
    }

    if (dto.check_type && !VALID_CHECK_TYPES.includes(dto.check_type)) {
      throw new BadRequestException(`Unknown checker type: ${dto.check_type}`);
    }

    if (dto.frequency !== undefined) {
      const minFrequency = Number(this.configService.get<number>(
        isDemo ? 'DEMO_MIN_FREQUENCY_SECONDS' : 'MIN_MONITOR_FREQUENCY_SECONDS', 60,
      ));
      if (dto.frequency < minFrequency) {
        throw new BadRequestException(
          `Monitor frequency cannot be less than ${minFrequency} seconds`,
        );
      }
    }

    const dataToUpdate: any = {};
    if (dto.name !== undefined) dataToUpdate.name = dto.name;
    if (dto.target !== undefined) dataToUpdate.target = dto.target;
    if (dto.check_type !== undefined) dataToUpdate.check_type = dto.check_type;
    if (dto.check_config !== undefined) dataToUpdate.check_config = dto.check_config;
    if (dto.frequency !== undefined) dataToUpdate.frequency = dto.frequency;

    const updated = await this.prisma.monitor.update({
      where: { id: monitorId },
      data: dataToUpdate,
    });

    return MonitorResponseDto.fromEntity(updated);
  }

  async deleteMonitor(
    monitorId: number,
    userId: number,
  ): Promise<{ message: string }> {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id: monitorId, user_id: userId },
    });

    if (!monitor) {
      throw new NotFoundException(
        "Monitor not found or you don't have permission to delete it",
      );
    }

    await this.prisma.$transaction([
      this.prisma.check_result.deleteMany({ where: { monitor_id: monitorId } }),
      this.prisma.alert.deleteMany({ where: { monitor_id: monitorId } }),
      this.prisma.monitor.delete({ where: { id: monitorId } }),
    ]);

    return { message: 'Monitor deleted successfully' };
  }

  async getHistory(
    monitorId: number,
    userId: number,
    limit: number = 50,
  ): Promise<CheckResultResponseDto[]> {
    const monitor = await this.getMonitorById(monitorId);

    if (!monitor) {
      throw new NotFoundException('Monitor no encontrado');
    }

    if (monitor.user_id !== userId) {
      throw new ForbiddenException(
        'No tienes permiso para ver el historial de este monitor',
      );
    }

    const results = await this.prisma.check_result.findMany({
      where: { monitor_id: monitorId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return results.map((r) => CheckResultResponseDto.fromEntity(r));
  }

  async getAlerts(
    monitorId: number,
    userId: number,
    limit: number = 20,
  ): Promise<AlertResponseDto[]> {
    const monitor = await this.getMonitorById(monitorId);

    if (!monitor) {
      throw new NotFoundException('Monitor no encontrado');
    }

    if (monitor.user_id !== userId) {
      throw new ForbiddenException(
        'No tienes permiso para ver el historial de este monitor',
      );
    }

    const alerts = await this.prisma.alert.findMany({
      where: { monitor_id: monitorId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    return alerts.map((a) => AlertResponseDto.fromEntity(a));
  }
}
