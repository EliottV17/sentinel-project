export class PublicStatusResponseDto {
  name: string;
  last_state: string | null;
  uptime_percentage: number | null;
  last_checked_at: Date | null;
}
