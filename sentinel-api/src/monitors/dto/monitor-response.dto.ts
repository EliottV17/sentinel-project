export class MonitorResponseDto {
  id: number;
  name: string;
  target: string;
  check_type: string;
  check_config: Record<string, any>;
  frequency: number;
  state: string;
  last_state: string | null;
  last_checked_at: Date | null;
  consecutive_failures: number;
  created_at: Date;
  user_id: number;

  static fromEntity(entity: any): MonitorResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      target: entity.target,
      check_type: entity.check_type,
      check_config: entity.check_config ?? {},
      frequency: entity.frequency,
      state: entity.state,
      last_state: entity.last_state ?? null,
      last_checked_at: entity.last_checked_at ?? null,
      consecutive_failures: entity.consecutive_failures ?? 0,
      created_at: entity.created_at,
      user_id: entity.user_id,
    };
  }
}
