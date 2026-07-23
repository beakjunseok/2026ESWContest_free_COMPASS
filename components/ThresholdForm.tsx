"use client";

import { useState } from "react";
import type { Floor } from "@/lib/types";

export default function ThresholdForm({ floor }: { floor: Floor }) {
  const [values, setValues] = useState({
    day_impact_limit_db: floor.day_impact_limit_db,
    night_impact_limit_db: floor.night_impact_limit_db,
    day_airborne_limit_db: floor.day_airborne_limit_db,
    night_airborne_limit_db: floor.night_airborne_limit_db,
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function update(key: keyof typeof values, v: string) {
    setValues((prev) => ({ ...prev, [key]: Number(v) }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/floors/${floor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 className="floor-title">소음 기준 설정 (dB)</h3>
      <p className="muted">
        기본값은 법정 층간소음 기준(직접충격 주간39/야간34, 공기전달 주간45/야간40)입니다. 필요 시
        조정 후 저장하세요.
      </p>
      <div className="threshold-form">
        <label>
          충격소음 · 주간 기준
          <input
            type="number"
            value={values.day_impact_limit_db}
            onChange={(e) => update("day_impact_limit_db", e.target.value)}
          />
        </label>
        <label>
          충격소음 · 야간 기준
          <input
            type="number"
            value={values.night_impact_limit_db}
            onChange={(e) => update("night_impact_limit_db", e.target.value)}
          />
        </label>
        <label>
          공기전달소음 · 주간 기준
          <input
            type="number"
            value={values.day_airborne_limit_db}
            onChange={(e) => update("day_airborne_limit_db", e.target.value)}
          />
        </label>
        <label>
          공기전달소음 · 야간 기준
          <input
            type="number"
            value={values.night_airborne_limit_db}
            onChange={(e) => update("night_airborne_limit_db", e.target.value)}
          />
        </label>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
        {savedAt && <span className="muted">저장됨</span>}
      </div>
    </div>
  );
}
