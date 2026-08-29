"use client";

import Link from "next/link";
import type { Floor, SensorReading } from "@/lib/types";
import { soundAdcToDb, vibAdcToDb } from "@/lib/sensor";

export default function FloorCard({
  floor,
  reading,
  hasOpenAlert,
}: {
  floor: Floor;
  reading: SensorReading | null;
  hasOpenAlert: boolean;
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
            <span>천장 소리</span>
            <b>{soundAdcToDb(reading.ceiling_sound_db).toFixed(1)} dB</b>
          </div>
          <div className="reading-row">
            <span>천장 진동</span>
            <b>{vibAdcToDb(reading.ceiling_vibration).toFixed(1)} dB</b>
          </div>
          <div className="reading-row">
            <span>바닥 소리</span>
            <b>{soundAdcToDb(reading.floor_sound_db).toFixed(1)} dB</b>
          </div>
          <div className="reading-row">
            <span>바닥 진동</span>
            <b>{vibAdcToDb(reading.floor_vibration).toFixed(1)} dB</b>
          </div>
        </>
      ) : (
        <p className="muted">아직 수신된 센서 데이터가 없습니다.</p>
      )}
    </Link>
  );
}
