"use client";

import { AXIS_MAX, dbToPercent } from "./scale";
import { formatDb, formatVib } from "@/lib/sensor";

/**
 * 한 센서의 현재 dB 를 축 위에 올린 미터.
 *
 * 색은 "어느 센서인가"(소리=파랑 / 진동=주황)만 나타낸다. 심각도는 색이 아니라
 *   - 카드 상단의 상태 배지(글자 + 색)
 *   - 막대가 기준선 눈금을 넘었는지 (기하학적으로 보임)
 *   - 기준을 넘긴 값의 글자색
 * 로 전달한다. 막대 색까지 상태에 따라 바꾸면 두 센서를 구분할 채널이 사라진다.
 */
export default function Meter({
  label,
  db,
  series,
  detectDb,
  limitDb,
  limitLabel,
  detected,
  suppressed = false,
}: {
  label: string;
  db: number;
  series: "sound" | "vib";
  detectDb: number;
  limitDb: number;
  limitLabel: string;
  detected: boolean;
  /** 다른 층의 신호가 더 강해 이 값의 감지/초과 표시를 정상으로 낮출지 여부 */
  suppressed?: boolean;
}) {
  const isDetected = suppressed ? false : detected;
  const over = !suppressed && db >= limitDb;
  const clipped = db > AXIS_MAX;
  // 진동은 실제 소음도가 아니라 같은 척도에 올린 세기 값이라 단위를 붙이지 않는다.
  const fmt = series === "sound" ? formatDb : formatVib;

  return (
    <div className={`meter series-${series}`}>
      <div className="meter-head">
        <span className="meter-label">
          <i className="series-key" aria-hidden="true" />
          {label}
        </span>
        <span className="meter-value">
          <b className={isDetected ? "hit" : "miss"}>{isDetected ? "O" : "X"}</b>
          <em className={over ? "db over" : "db"}>
            {clipped ? "▲ " : ""}
            {fmt(db)}
          </em>
        </span>
      </div>

      <div
        className="meter-track"
        role="meter"
        aria-valuenow={Number(db.toFixed(1))}
        aria-valuemin={30}
        aria-valuemax={AXIS_MAX}
        aria-label={`${label} ${fmt(db)}, 기준 ${limitLabel} ${fmt(limitDb)}`}
      >
        <div className="meter-fill" style={{ width: `${dbToPercent(db)}%` }} />
        <span
          className="meter-mark detect"
          style={{ left: `${dbToPercent(detectDb)}%` }}
          title={`감지 임계 ${fmt(detectDb)}`}
        />
        <span
          className={`meter-mark limit ${over ? "crossed" : ""}`}
          style={{ left: `${dbToPercent(limitDb)}%` }}
          title={`${limitLabel} ${fmt(limitDb)}`}
        />
      </div>
    </div>
  );
}
