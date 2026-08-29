"use client";

import Link from "next/link";
import type { Floor, SensorReading } from "@/lib/types";
import {
  LEVEL_LABEL,
  formatDb,
  isSoundDetected,
  isVibDetected,
  isStale,
  soundLevel,
  vibLevel,
  worstLevel,
} from "@/lib/sensor";

const LEVEL_CLASS = {
  silent: "ok",
  detected: "warn",
  over: "danger",
} as const;

export default function FloorCard({
  floor,
  reading,
  openAlertCount,
  now,
}: {
  floor: Floor;
  reading: SensorReading | null;
  openAlertCount: number;
  /** 렌더 시각. 수신 끊김 판정과 주/야간 기준 선택에 함께 쓴다. */
  now: number;
}) {
  const stale = reading ? isStale(reading.created_at, now) : true;
  const at = new Date(now);

  // 카드 색은 "지금 이 순간의 측정값"으로 정한다. 미확인 경고가 남아 있다고 계속 빨갛게
  // 두면 소음이 멎어도 영원히 경고 상태로 보인다.
  const level =
    reading && !stale
      ? worstLevel(
          soundLevel(reading.floor_sound_db, at),
          vibLevel(reading.floor_vibration, at)
        )
      : null;

  return (
    <Link
      href={`/floors/${floor.id}`}
      className={`card floor-card ${level ? `status-${LEVEL_CLASS[level]}` : ""}`}
    >
      <div className={`status-pill ${level ? LEVEL_CLASS[level] : "idle"}`}>
        {level ? LEVEL_LABEL[level] : "수신 없음"}
      </div>
      <h3 className="floor-title">{floor.label}</h3>

      {reading && !stale ? (
        <>
          <div className="reading-row">
            <span>바닥 소리</span>
            <span>
              <b className={isSoundDetected(reading.floor_sound_db) ? "hit" : "miss"}>
                {isSoundDetected(reading.floor_sound_db) ? "O" : "X"}
              </b>
              <em className="reading-db">{formatDb(reading.floor_sound_db)}</em>
            </span>
          </div>
          <div className="reading-row">
            <span>바닥 진동</span>
            <span>
              <b className={isVibDetected(reading.floor_vibration) ? "hit" : "miss"}>
                {isVibDetected(reading.floor_vibration) ? "O" : "X"}
              </b>
              <em className="reading-db">{formatDb(reading.floor_vibration)}</em>
            </span>
          </div>
        </>
      ) : (
        <p className="muted">
          {reading ? "센서 수신이 끊겼습니다." : "아직 수신된 센서 데이터가 없습니다."}
        </p>
      )}

      {openAlertCount > 0 && (
        <div className="alert-badge">미확인 경고 {openAlertCount}건</div>
      )}
    </Link>
  );
}
