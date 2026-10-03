import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublicStatusResponseDto } from './dto/public-status-response.dto';

interface PublicStatusRow {
  name: string;
  last_state: string | null;
  uptime_percentage: number | string | null;
  last_checked_at: Date | null;
}

@Injectable()
export class PublicStatusService implements OnModuleInit {
  private readonly logger = new Logger(PublicStatusService.name);
  private uptimeWindowHours = 24;
  private cacheTtlMilliseconds = 30_000;
  private cached: { expiresAt: number; rows: PublicStatusResponseDto[] } | undefined;
  private inFlight: Promise<PublicStatusResponseDto[]> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.uptimeWindowHours = this.readPositiveConfig(
      'STATUS_UPTIME_WINDOW_HOURS',
      24,
    );
    this.cacheTtlMilliseconds =
      this.readPositiveConfig('STATUS_CACHE_TTL_SECONDS', 30) * 1000;
    if (!Number.isFinite(this.cacheTtlMilliseconds)) {
      throw new Error('STATUS_CACHE_TTL_SECONDS must be a positive finite number');
    }
  }

  async getPublicStatus(): Promise<PublicStatusResponseDto[]> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.rows;
    }
    if (this.inFlight) return this.inFlight;

    const request = this.queryPublicStatus();
    this.inFlight = request;
    try {
      const rows = await request;
      this.cached = { rows, expiresAt: Date.now() + this.cacheTtlMilliseconds };
      return rows;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async queryPublicStatus(): Promise<PublicStatusResponseDto[]> {
    const rows = await this.prisma.$queryRaw<PublicStatusRow[]>(Prisma.sql`
      SELECT
        m.name AS name,
        m.last_state AS last_state,
        CASE
          WHEN checks.total_checks = 0 THEN NULL
          ELSE checks.healthy_checks::numeric * 100 / checks.total_checks
        END AS uptime_percentage,
        m.last_checked_at AS last_checked_at
      FROM monitor AS m
      INNER JOIN users AS u ON u.id = m.user_id
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*) AS total_checks,
          COUNT(*) FILTER (WHERE cr.state = 'healthy') AS healthy_checks
        FROM check_result AS cr
        WHERE cr.monitor_id = m.id
          AND cr.created_at >= NOW() - (${this.uptimeWindowHours} * INTERVAL '1 hour')
          AND cr.created_at <= NOW()
      ) AS checks
      WHERE m.state = 'Active'
        AND m.is_public = TRUE
        AND u.is_demo = FALSE
      ORDER BY m.name ASC, m.id ASC
    `);

    return rows.map((row) => ({
      name: row.name,
      last_state: row.last_state,
      uptime_percentage:
        row.uptime_percentage === null ? null : Number(row.uptime_percentage),
      last_checked_at: row.last_checked_at,
    }));
  }

  private readPositiveConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<string | number>(key, fallback));
    if (!Number.isFinite(value) || value <= 0) {
      this.logger.error(`${key} must be a positive finite number`);
      throw new Error(`${key} must be a positive finite number`);
    }
    return value;
  }
}
