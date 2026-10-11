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
  window_hours: number | string;
  total_checks: bigint;
  healthy_checks: bigint;
  window_start: Date;
  window_end: Date;
  first_check_at: Date | null;
  last_check_at: Date | null;
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
        m.last_checked_at AS last_checked_at,
        ${this.uptimeWindowHours} AS window_hours,
        checks.total_checks AS total_checks,
        checks.healthy_checks AS healthy_checks,
        boundaries.window_end - (${this.uptimeWindowHours} * INTERVAL '1 hour') AS window_start,
        boundaries.window_end AS window_end,
        checks.first_check_at AS first_check_at,
        checks.last_check_at AS last_check_at
      FROM monitor AS m
      INNER JOIN users AS u ON u.id = m.user_id
      CROSS JOIN (SELECT NOW() AS window_end) AS boundaries
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*) AS total_checks,
          COUNT(*) FILTER (WHERE cr.state = 'healthy') AS healthy_checks,
          MIN(cr.created_at) AS first_check_at,
          MAX(cr.created_at) AS last_check_at
        FROM check_result AS cr
        WHERE cr.monitor_id = m.id
          AND cr.created_at >= boundaries.window_end - (${this.uptimeWindowHours} * INTERVAL '1 hour')
          AND cr.created_at <= boundaries.window_end
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
      check_summary: {
        window_hours: Number(row.window_hours),
        total_checks: Number(row.total_checks),
        healthy_checks: Number(row.healthy_checks),
        window_start: row.window_start,
        window_end: row.window_end,
        first_check_at: row.first_check_at,
        last_check_at: row.last_check_at,
      },
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
