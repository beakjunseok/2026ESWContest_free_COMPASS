"use client";

import Link from "next/link";
import type { Floor, SensorReading } from "@/lib/types";
import { vibFrequencyLabel } from "@/lib/sensor";

export default function FloorCard({
  floor,
  reading,
  hasOpenAlert,
  vibCount,
}: {
  floor: Floor;
  reading: SensorReading | null;
  hasOpenAlert: boolean;
  vibCount: number;
}) {
  return (
    <Link
      href={`/floors/${floor.id}`}
      className={`card floor-card ${hasOpenAlert ? "status-danger" : ""}`}
    >
      <div className={`status-pill ${hasOpenAlert ? "danger" : "ok"}`}>
        {hasOpenAlert ? "소음 경고 중" : "정상"}
      </div>
      <h3 className="floor-title">{floor.label}</h3>
      {reading ? (
        <>
          <div className="reading-row">
            <span>바닥 소리</span>
            <b>{reading.floor_sound_db !== 0 ? "O" : "X"}</b>
          </div>
          <div className="reading-row">
            <span>바닥 진동 빈도</span>
            <b>{vibFrequencyLabel(vibCount)} ({vibCount}회)</b>
          </div>
        </>
      ) : (
        <p className="muted">아직 수신된 센서 데이터가 없습니다.</p>
      )}
    </Link>
  );
}
