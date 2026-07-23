export type Floor = {
  id: number;
  label: string;
  created_at: string;
};

export type SensorReading = {
  id: number;
  floor_id: number;
  ceiling_sound_db: number;
  ceiling_vibration: number;
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
  created_at: string;
  resolved_at: string | null;
};

export type Alert = {
  id: number;
  floor_id: number;
  event_id: number | null;
  status: "pending" | "delivered" | "acknowledged" | "cancelled";
  triggered_by: "system" | "guard";
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
};
