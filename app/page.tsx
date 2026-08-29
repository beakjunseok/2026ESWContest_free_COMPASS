"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import FloorCard from "@/components/FloorCard";
import AlertList, { AlertWithEvent } from "@/components/AlertList";

export default function DashboardPage() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [latestByFloor, setLatestByFloor] = useState<Record<number, SensorReading>>({});
  const [vibCountByFloor, setVibCountByFloor] = useState<Record<number, number>>({});
  const [alerts, setAlerts] = useState<AlertWithEvent[]>([]);
  const [loading, setLoading] = useState(true);

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
      const vibCount: Record<number, number> = {};
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;

      for (const r of (readingRows as SensorReading[]) ?? []) {
        if (!latest[r.floor_id]) latest[r.floor_id] = r;
        if (new Date(r.created_at).getTime() > fiveMinAgo && r.floor_vibration !== 0) {
          vibCount[r.floor_id] = (vibCount[r.floor_id] ?? 0) + 1;
        }
      }

      setLatestByFloor(latest);
      setVibCountByFloor(vibCount);
      setAlerts((alertRows as unknown as AlertWithEvent[]) ?? []);
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
          if (reading.floor_vibration !== 0) {
            setVibCountByFloor((prev) => ({
              ...prev,
              [reading.floor_id]: (prev[reading.floor_id] ?? 0) + 1,
            }));
          }
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

  const openAlertFloorIds = useMemo(
    () =>
      new Set(
        alerts.filter((a) => a.status === "pending" || a.status === "delivered").map((a) => a.floor_id)
      ),
    [alerts]
  );

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

      <div className="floor-grid">
        {floors.map((floor) => (
          <FloorCard
            key={floor.id}
            floor={floor}
            reading={latestByFloor[floor.id] ?? null}
            hasOpenAlert={openAlertFloorIds.has(floor.id)}
            vibCount={vibCountByFloor[floor.id] ?? 0}
          />
        ))}
      </div>

      <h2 className="section-title">미해결 경고</h2>
      <AlertList alerts={alerts.filter((a) => a.status !== "acknowledged" && a.status !== "cancelled")} />
    </>
  );
}
