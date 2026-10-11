export class PublicCheckSummaryDto {
  window_hours: number;
  total_checks: number;
  healthy_checks: number;
  window_start: Date;
  window_end: Date;
  first_check_at: Date | null;
  last_check_at: Date | null;
}

export class PublicStatusResponseDto {
  name: string;
  last_state: string | null;
  uptime_percentage: number | null;
  last_checked_at: Date | null;
  check_summary: PublicCheckSummaryDto;
}
