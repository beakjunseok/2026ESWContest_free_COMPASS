"use client";

import { useState } from "react";
import type { Alert, NoiseEvent } from "@/lib/types";

export type AlertWithEvent = Alert & { noise_events: NoiseEvent | null };

const NOISE_TYPE_LABEL: Record<string, string> = {
  impact: "충격소음(발걸음 등)",
  airborne: "공기전달소음(TV/음향기기)",
};

const STATUS_LABEL: Record<Alert["status"], string> = {
  pending: "대기 중 (스피커 전달 전)",
  delivered: "스피커 전달됨",
  acknowledged: "확인 완료",
  cancelled: "취소됨",
};

export default function AlertList({
  alerts,
  showFloor = true,
}: {
  alerts: AlertWithEvent[];
  showFloor?: boolean;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);

  async function acknowledge(id: number) {
    setBusyId(id);
    try {
      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "acknowledged" }),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (alerts.length === 0) {
    return <p className="muted">현재 미해결 경고가 없습니다.</p>;
  }

  return (
    <ul className="event-list">
      {alerts.map((a) => {
        const isOpen = a.status === "pending" || a.status === "delivered";
        const ev = a.noise_events;
        return (
          <li key={a.id} className={`event-item ${isOpen ? "danger" : ""}`}>
            <div>
              <div>
                {showFloor && <b>{a.floor_id}층 &middot; </b>}
                {ev ? NOISE_TYPE_LABEL[ev.noise_type] : a.message ? "경비실 음성 메시지" : "경비실 기본 경고음"}
                {ev && (
                  <span className="muted">
                    {" "}
                    ({ev.measured_db.toFixed(1)}dB / 기준 {ev.limit_db.toFixed(1)}dB,
                    신뢰도 {ev.confidence === "high" ? "높음" : "보통"})
                  </span>
                )}
              </div>
              {a.message && <div style={{ marginTop: 4 }}>&ldquo;{a.message}&rdquo;</div>}
              {a.audio_url && (
                <audio controls src={a.audio_url} style={{ height: 32, marginTop: 4 }} />
              )}
              <div className="muted">
                {STATUS_LABEL[a.status]} &middot;{" "}
                {new Date(a.created_at).toLocaleString("ko-KR")} &middot;{" "}
                {a.triggered_by === "guard" ? "경비실 수동 발령" : "자동 감지"}
              </div>
            </div>
            {isOpen && (
              <button
                className="btn"
                disabled={busyId === a.id}
                onClick={() => acknowledge(a.id)}
              >
                확인 처리
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
