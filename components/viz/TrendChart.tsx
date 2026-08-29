"use client";

import { useMemo, useRef, useState } from "react";
import type { SensorReading } from "@/lib/types";
import { formatDb, formatVib, limitsAt } from "@/lib/sensor";
import { AXIS_MAX, AXIS_MIN, AXIS_TICKS, dbToRatio } from "./scale";

const W = 720;
const H = 260;
// right 여백은 "공기전달 45" 라벨(한글 4자 + 숫자, 약 55px)이 잘리지 않을 만큼 잡는다
const PAD = { top: 16, right: 110, bottom: 30, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const y = (db: number) => PAD.top + (1 - dbToRatio(db)) * PLOT_H;
const x = (i: number, n: number) => PAD.left + (n <= 1 ? PLOT_W : (i / (n - 1)) * PLOT_W);

function line(values: number[]): string {
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i, values.length).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * 바닥 소리와 바닥 진동을 하나의 축 위에 겹쳐 그린다.
 *
 * 두 값은 아두이노에서 같은 척도로 환산되므로 축이 하나로 충분하다. 축을 둘로 나누면
 * 두 스케일의 정렬이 임의가 되어 없는 상관관계를 만들어낸다.
 * 소리는 소음도(dB), 진동은 같은 척도의 세기 값이라 축 눈금에는 단위를 쓰지 않는다.
 */
export default function TrendChart({ readings }: { readings: SensorReading[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // readings 는 최신순 → 시간순으로 뒤집는다
  const data = useMemo(() => [...readings].reverse(), [readings]);

  const limits = useMemo(
    () => limitsAt(data.length ? new Date(data[data.length - 1].created_at) : new Date()),
    [data]
  );

  if (data.length < 2) {
    return <p className="muted">추이를 그리려면 측정값이 2건 이상 필요합니다.</p>;
  }

  const soundPath = line(data.map((r) => r.floor_sound_db));
  const vibPath = line(data.map((r) => r.floor_vibration));
  const last = data[data.length - 1];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((ratio - PAD.left) / PLOT_W) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  const hi = hover ?? null;
  const point = hi === null ? null : data[hi];

  return (
    <figure className="chart">
      <figcaption className="chart-legend">
        <span className="legend-item sound">
          <i className="legend-key" aria-hidden="true" />
          바닥 소리 (dB)
        </span>
        <span className="legend-item vib">
          <i className="legend-key" aria-hidden="true" />
          바닥 진동 (세기)
        </span>
        <span className="legend-item threshold">
          <i className="legend-key" aria-hidden="true" />
          {limits.isDay ? "주간" : "야간"} 기준선
        </span>
      </figcaption>

      <div className="chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="바닥 소리와 바닥 진동의 최근 추이"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* 가로 눈금 — 실선 헤어라인 */}
          {AXIS_TICKS.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {/* 법정 기준선 — 눈금과 구분되도록 파선 + 직접 라벨 */}
          <line
            className="threshold"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(limits.airborne)}
            y2={y(limits.airborne)}
          />
          <text className="threshold-label" x={W - PAD.right + 6} y={y(limits.airborne) + 4}>
            공기전달 {limits.airborne}
          </text>
          <line
            className="threshold"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(limits.impact)}
            y2={y(limits.impact)}
          />
          <text className="threshold-label" x={W - PAD.right + 6} y={y(limits.impact) + 4}>
            충격 {limits.impact}
          </text>

          {/* 시간 축 — 양 끝과 가운데만. 점이 적으면 겹치므로 중복 위치는 버린다 */}
          {Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])).map((i) => (
            <text
              key={i}
              className="axis-label"
              x={x(i, data.length)}
              y={H - 10}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
            >
              {timeLabel(data[i].created_at)}
            </text>
          ))}

          <path className="series-line sound" d={soundPath} />
          <path className="series-line vib" d={vibPath} />

          {/* 끝점 — 표면색 링을 둘러 겹쳐도 읽히게 한다 */}
          <circle className="series-dot sound" cx={x(data.length - 1, data.length)} cy={y(last.floor_sound_db)} r={4} />
          <circle className="series-dot vib" cx={x(data.length - 1, data.length)} cy={y(last.floor_vibration)} r={4} />

          {point && hi !== null && (
            <g className="crosshair">
              <line x1={x(hi, data.length)} x2={x(hi, data.length)} y1={PAD.top} y2={PAD.top + PLOT_H} />
              <circle className="series-dot sound" cx={x(hi, data.length)} cy={y(point.floor_sound_db)} r={4} />
              <circle className="series-dot vib" cx={x(hi, data.length)} cy={y(point.floor_vibration)} r={4} />
            </g>
          )}
        </svg>

        {point && hi !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${Math.min(88, Math.max(12, (x(hi, data.length) / W) * 100))}%` }}
            role="status"
          >
            <div className="tt-time">{timeLabel(point.created_at)}</div>
            <div className="tt-row">
              <i className="legend-key sound" aria-hidden="true" />
              <b>{formatDb(point.floor_sound_db)}</b>
              <span>바닥 소리</span>
            </div>
            <div className="tt-row">
              <i className="legend-key vib" aria-hidden="true" />
              <b>{formatVib(point.floor_vibration)}</b>
              <span>바닥 진동</span>
            </div>
          </div>
        )}
      </div>

      <p className="muted chart-note">
        축 범위는 {AXIS_MIN}~{AXIS_MAX}이며 {AXIS_MIN}이 무음 기준선입니다. 값 하나하나는 아래 표에서
        확인할 수 있습니다.
      </p>
    </figure>
  );
}
