export class CheckResultResponseDto {
  id: number;
  monitor_id: number;
  state: string;
  status_code: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: Date;

  static fromEntity(entity: any): CheckResultResponseDto {
    return {
      id: entity.id,
      monitor_id: entity.monitor_id,
      state: entity.state,
      status_code: entity.status_code ?? null,
      latency_ms: entity.latency_ms ?? null,
      error_message: entity.error_message ?? null,
      created_at: entity.created_at,
    };
  }
}

export class AlertResponseDto {
  id: number;
  monitor_id: number;
  alert_type: string;
  message: string;
  created_at: Date;

  static fromEntity(entity: any): AlertResponseDto {
    return {
      id: entity.id,
      monitor_id: entity.monitor_id,
      alert_type: entity.alert_type,
      message: entity.message,
      created_at: entity.created_at,
    };
  }
}
