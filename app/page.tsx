"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import FloorCard from "@/components/FloorCard";
import AlertList, { AlertWithEvent } from "@/components/AlertList";
import {
  DETECT_SOUND_DB,
  SILENCE_DB,
  limitsAt,
  READING_STALE_MS,
} from "@/lib/sensor";

export default function DashboardPage() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [latestByFloor, setLatestByFloor] = useState<Record<number, SensorReading>>({});
  const [alerts, setAlerts] = useState<AlertWithEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // 수신 끊김("수신 없음")은 시간이 흐르기만 해도 상태가 바뀌므로, 새 데이터가 오지 않아도
  // 주기적으로 다시 그려야 한다.
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
          .limit(300),
        supabase
          .from("alerts")
          .select("*, noise_events(*)")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (cancelled) return;

      setFloors((floorRows as Floor[]) ?? []);

      const latest: Record<number, SensorReading> = {};
      for (const r of (readingRows as SensorReading[]) ?? []) {
        if (!latest[r.floor_id]) latest[r.floor_id] = r;
      }

      setLatestByFloor(latest);
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
          setLatestByFloor((prev) => ({ ...prev, [reading.floor_id]: reading }));
          setNow(Date.now());
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => {
          supabase
            .from("alerts")
            .select("*, noise_events(*)")
            .order("created_at", { ascending: false })
            .limit(50)
            .then(({ data }) => setAlerts((data as unknown as AlertWithEvent[]) ?? []));
        }
      )
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

  if (loading) {
    return <p className="muted">불러오는 중...</p>;
  }

  return (
    <>
      <h1 className="section-title" style={{ marginTop: 0 }}>
        층별 실시간 소음 현황
      </h1>
      <p className="muted">
        {floors.length}개 층 모니터링 중 · 카드를 클릭하면 층별 상세 이력과 수동 경고 발령이 가능합니다.
      </p>
      <p className="muted">
        지금은 <b>{limits.isDay ? "주간" : "야간"}</b> 기준 적용 중 · 감지 표시(O) {DETECT_SOUND_DB}dB
        이상 · 충격소음 경고 {limits.impact}dB · 공기전달소음 경고 {limits.airborne}dB ·
        무음 기준선 {SILENCE_DB}dB
      </p>

      <div className="floor-grid">
        {floors.map((floor) => (
          <FloorCard
            key={floor.id}
            floor={floor}
            reading={latestByFloor[floor.id] ?? null}
            openAlertCount={openAlertCountByFloor[floor.id] ?? 0}
            now={now}
          />
        ))}
      </div>

      <h2 className="section-title">미해결 경고</h2>
      <AlertList alerts={openAlerts} />
    </>
  );
}
