"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import FloorCard from "@/components/FloorCard";
import StatTile from "@/components/StatTile";
import AlertList, { AlertWithEvent } from "@/components/AlertList";
import {
  DETECT_SOUND_DB,
  READING_STALE_MS,
  SILENCE_DB,
  isStale,
  limitsAt,
  soundLevel,
  vibLevel,
  worstLevel,
} from "@/lib/sensor";

/** 카드 미니 추이에 쓸 최근 측정 건수 (2초 주기 × 40 ≈ 80초) */
const SPARK_POINTS = 40;

export default function DashboardPage() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [historyByFloor, setHistoryByFloor] = useState<Record<number, SensorReading[]>>({});
  const [alerts, setAlerts] = useState<AlertWithEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // "수신 없음"은 새 데이터가 오지 않아도 시간이 흐르면 상태가 바뀐다 → 주기적 재렌더
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), READING_STALE_MS / 3);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();

    async function loadInitial() {
      const [{ data: floorRows }, { data: readingRows }, { data: alertRows }] = await Promise.all([
        supabase.from("floors").select("*").order("id", { ascending: true }),
        supabase
          .from("sensor_readings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(400),
        supabase
          .from("alerts")
          .select("*, noise_events(*)")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (cancelled) return;

      setFloors((floorRows as Floor[]) ?? []);

      const history: Record<number, SensorReading[]> = {};
      for (const r of (readingRows as SensorReading[]) ?? []) {
        const bucket = (history[r.floor_id] ??= []);
        if (bucket.length < SPARK_POINTS) bucket.push(r);
      }

      setHistoryByFloor(history);
      setAlerts((alertRows as unknown as AlertWithEvent[]) ?? []);
      setNow(Date.now());
      setLoading(false);
    }

    loadInitial();

    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sensor_readings" },
        (payload) => {
          const reading = payload.new as SensorReading;
          setHistoryByFloor((prev) => ({
            ...prev,
            [reading.floor_id]: [reading, ...(prev[reading.floor_id] ?? [])].slice(0, SPARK_POINTS),
          }));
          setNow(Date.now());
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        supabase
          .from("alerts")
          .select("*, noise_events(*)")
          .order("created_at", { ascending: false })
          .limit(50)
          .then(({ data }) => setAlerts((data as unknown as AlertWithEvent[]) ?? []));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const openAlerts = useMemo(
    () => alerts.filter((a) => a.status === "pending" || a.status === "delivered"),
    [alerts]
  );

  const openAlertCountByFloor = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const a of openAlerts) counts[a.floor_id] = (counts[a.floor_id] ?? 0) + 1;
    return counts;
  }, [openAlerts]);

  const limits = limitsAt(new Date(now));

  // 층별 현재 상태 집계 — 상단 요약 타일에 쓴다
  const summary = useMemo(() => {
    const at = new Date(now);
    let over = 0;
    let detected = 0;
    let offline = 0;
    for (const floor of floors) {
      const latest = historyByFloor[floor.id]?.[0];
      if (!latest || isStale(latest.created_at, now)) {
        offline += 1;
        continue;
      }
      const level = worstLevel(
        soundLevel(latest.floor_sound_db, at),
        vibLevel(latest.floor_vibration, at)
      );
      if (level === "over") over += 1;
      else if (level === "detected") detected += 1;
    }
    return { over, detected, offline };
  }, [floors, historyByFloor, now]);

  if (loading) {
    return <p className="muted">불러오는 중...</p>;
  }

  // 위층이 위에 오도록 뒤집는다 — 목록이 곧 건물 단면이 된다
  const stack = [...floors].sort((a, b) => b.id - a.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="section-title" style={{ marginTop: 0 }}>
            층별 실시간 소음 현황
          </h1>
          <p className="muted">
            카드를 클릭하면 층별 상세 이력과 수동 경고 발령이 가능합니다.
          </p>
        </div>
        <div className={`mode-chip ${limits.isDay ? "day" : "night"}`}>
          {limits.isDay ? "주간 기준 (06~22시)" : "야간 기준 (22~06시)"}
        </div>
      </div>

      <div className="stat-row">
        <StatTile
          label="기준 초과 층"
          value={summary.over}
          hint={`충격 ${limits.impact} / 공기전달 ${limits.airborne} 이상`}
          tone={summary.over > 0 ? "danger" : "ok"}
        />
        <StatTile
          label="소음 감지 층"
          value={summary.detected}
          hint={`${DETECT_SOUND_DB} 이상 · 기준 이내`}
          tone={summary.detected > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="미확인 경고"
          value={`${openAlerts.length}건`}
          hint="경비실 확인 처리 대기"
          tone={openAlerts.length > 0 ? "danger" : "neutral"}
        />
        <StatTile
          label="센서 수신"
          value={`${floors.length - summary.offline} / ${floors.length}`}
          hint={summary.offline > 0 ? `${summary.offline}개 층 수신 없음` : "전 층 정상 수신"}
          tone={summary.offline > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="building-head">
        <h2 className="section-title">건물 현황</h2>
        <div className="chart-legend inline">
          <span className="legend-item sound">
            <i className="legend-key" aria-hidden="true" />
            바닥 소리 (dB)
          </span>
          <span className="legend-item vib">
            <i className="legend-key" aria-hidden="true" />
            바닥 진동 (세기)
          </span>
          <span className="legend-item scale">눈금 {SILENCE_DB}(무음) ~ 75</span>
        </div>
      </div>

      <div className="building">
        {stack.map((floor) => (
          <FloorCard
            key={floor.id}
            floor={floor}
            reading={historyByFloor[floor.id]?.[0] ?? null}
            history={historyByFloor[floor.id] ?? []}
            openAlertCount={openAlertCountByFloor[floor.id] ?? 0}
            now={now}
          />
        ))}
        <div className="building-ground" aria-hidden="true" />
      </div>

      <h2 className="section-title">미해결 경고</h2>
      <AlertList alerts={openAlerts} />
    </>
  );
}
