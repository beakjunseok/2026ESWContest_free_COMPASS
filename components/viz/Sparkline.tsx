"use client";

import type { SensorReading } from "@/lib/types";
import { dbToRatio } from "./scale";

const W = 160;
const H = 30;

function path(values: number[]): string {
  if (values.length < 2) return "";
  const step = W / (values.length - 1);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${((1 - dbToRatio(v)) * H).toFixed(1)}`)
    .join(" ");
}

/**
 * 층 카드용 미니 추이. 축·눈금 없이 형태만 본다. y 축 범위는 모든 층이 공유하는
 * 표시 축(30~75dB)으로 고정해, 카드끼리 높낮이를 그대로 비교할 수 있게 한다.
 * 계열 색은 상세 화면의 추이 그래프와 동일하다 (소리=파랑, 진동=주황).
 */
export default function Sparkline({ readings }: { readings: SensorReading[] }) {
  // readings 는 최신순으로 들어오므로 뒤집어 시간순으로 그린다.
  const series = [...readings].reverse();

  if (series.length < 2) {
    return <div className="sparkline empty" aria-hidden="true" />;
  }

  const sound = path(series.map((r) => r.floor_sound_db));
  const vib = path(series.map((r) => r.floor_vibration));
  const last = series[series.length - 1];

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`최근 ${series.length}건 추이`}
    >
      <path className="spark-line sound" d={sound} />
      <path className="spark-line vib" d={vib} />
      <circle
        className="spark-dot sound"
        cx={W}
        cy={(1 - dbToRatio(last.floor_sound_db)) * H}
        r={2.5}
      />
      <circle
        className="spark-dot vib"
        cx={W}
        cy={(1 - dbToRatio(last.floor_vibration)) * H}
        r={2.5}
      />
    </svg>
  );
}
