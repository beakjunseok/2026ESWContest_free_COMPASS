export type Floor = {
  id: number;
  label: string;
  created_at: string;
};

export type SensorReading = {
  id: number;
  floor_id: number;
  floor_sound_db: number;
  floor_vibration: number;
  created_at: string;
};

export type NoiseEvent = {
  id: number;
  floor_id: number;
  noise_type: "impact" | "airborne";
  direction: "own_impact" | "own_airborne";
  measured_db: number;
  limit_db: number;
  confidence: "high" | "medium";
  is_day: boolean;
  /** 이 이벤트에서 기준을 초과한 마지막 측정 시각 (에피소드 지속 판단용) */
  last_exceeded_at: string;
  /** 이 이벤트 동안 기준을 넘긴 측정 횟수 */
  exceed_count: number;
  created_at: string;
  /** 30초 이상 조용해져 자동 종료된 시각. null 이면 소음이 진행 중 */
  resolved_at: string | null;
};

export type Alert = {
  id: number;
  floor_id: number;
  event_id: number | null;
  status: "pending" | "delivered" | "acknowledged" | "cancelled";
  triggered_by: "system" | "guard";
  message: string | null;
  audio_url: string | null;
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
};
