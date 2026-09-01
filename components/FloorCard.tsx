"use client";

import Link from "next/link";
import type { Floor, SensorReading } from "@/lib/types";
import Meter from "@/components/viz/Meter";
import Sparkline from "@/components/viz/Sparkline";
import {
  DETECT_SOUND_DB,
  DETECT_VIB_DB,
  LEVEL_LABEL,
  isSoundDetected,
  isVibDetected,
  isStale,
  limitsAt,
  soundLevel,
  vibLevel,
  worstLevel,
} from "@/lib/sensor";

const LEVEL_CLASS = {
  silent: "ok",
  detected: "warn",
  over: "danger",
} as const;

const LEVEL_ICON = {
  silent: "●",
  detected: "▲",
  over: "■",
} as const;

export default function FloorCard({
  floor,
  reading,
  history,
  openAlertCount,
  now,
  suppressed = false,
}: {
  floor: Floor;
  reading: SensorReading | null;
  /** 이 층의 최근 측정값(최신순). 미니 추이 그래프에 쓴다. */
  history: SensorReading[];
  openAlertCount: number;
  now: number;
  /** 같은 시점에 이 층보다 신호가 더 강한 층이 있어, 감지/초과 표시를 정상으로 낮출지 여부 */
  suppressed?: boolean;
}) {
  const stale = reading ? isStale(reading.created_at, now) : true;
  const live = reading && !stale ? reading : null;
  const at = new Date(now);
  const limits = limitsAt(at);

  // 카드 상태는 "지금 이 순간의 측정값"으로 정한다. 미확인 경고가 남아 있다고 계속
  // 경고색으로 두면 소음이 멎어도 영원히 빨간 화면이 된다.
  const rawLevel = live
    ? worstLevel(soundLevel(live.floor_sound_db, at), vibLevel(live.floor_vibration, at))
    : null;
  // 소리/진동은 인접 층으로 새어나가기 쉽다 — 신호가 더 강한 층이 따로 있으면
  // 이 층은 정상으로 표시해, 화면상 반응 위치가 한 곳으로 좁혀지게 한다.
  const level = rawLevel && suppressed ? "silent" : rawLevel;

  return (
    <Link
      href={`/floors/${floor.id}`}
      className={`floor-row ${level ? `level-${LEVEL_CLASS[level]}` : "level-idle"}`}
    >
      <div className="floor-id">
        <span className="floor-title">{floor.label}</span>
        {/* 상태는 색만으로 전달하지 않는다 — 기호와 글자를 항상 함께 붙인다 */}
        <span className={`status-pill ${level ? LEVEL_CLASS[level] : "idle"}`}>
          <span aria-hidden="true">{level ? LEVEL_ICON[level] : "○"}</span>
          {level ? LEVEL_LABEL[level] : "수신 없음"}
        </span>
        {openAlertCount > 0 && (
          <span className="alert-badge">미확인 경고 {openAlertCount}건</span>
        )}
      </div>

      {live ? (
        <>
          <div className="floor-meters">
            <Meter
              label="바닥 소리"
              db={live.floor_sound_db}
              series="sound"
              detectDb={DETECT_SOUND_DB}
              limitDb={limits.airborne}
              limitLabel="공기전달소음 기준"
              detected={isSoundDetected(live.floor_sound_db)}
              suppressed={suppressed}
            />
            <Meter
              label="바닥 진동"
              db={live.floor_vibration}
              series="vib"
              detectDb={DETECT_VIB_DB}
              limitDb={limits.impact}
              limitLabel="충격소음 기준"
              detected={isVibDetected(live.floor_vibration)}
              suppressed={suppressed}
            />
          </div>

          <div className="floor-spark">
            <Sparkline readings={history} />
            <span className="muted">최근 {history.length}건</span>
          </div>
        </>
      ) : (
        <p className="muted floor-empty">
          {reading ? "센서 수신이 끊겼습니다." : "아직 수신된 센서 데이터가 없습니다."}
        </p>
      )}
    </Link>
  );
}
