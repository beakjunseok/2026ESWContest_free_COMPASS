"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import AlertList, { AlertWithEvent } from "@/components/AlertList";
import ThresholdForm from "@/components/ThresholdForm";

export default function FloorDetailPage() {
  const params = useParams<{ id: string }>();
  const floorId = Number(params.id);

  const [floor, setFloor] = useState<Floor | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [alerts, setAlerts] = useState<AlertWithEvent[]>([]);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(floorId)) return;
    let cancelled = false;

    async function load() {
      const [{ data: floorRow }, { data: readingRows }, { data: alertRows }] = await Promise.all([
        supabase.from("floors").select("*").eq("id", floorId).single(),
        supabase
          .from("sensor_readings")
          .select("*")
          .eq("floor_id", floorId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("alerts")
          .select("*, noise_events(*)")
          .eq("floor_id", floorId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

      if (cancelled) return;
      setFloor((floorRow as Floor) ?? null);
      setReadings((readingRows as SensorReading[]) ?? []);
      setAlerts((alertRows as unknown as AlertWithEvent[]) ?? []);
    }

    load();

    const channel = supabase
      .channel(`floor-${floorId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sensor_readings", filter: `floor_id=eq.${floorId}` },
        (payload) => {
          setReadings((prev) => [payload.new as SensorReading, ...prev].slice(0, 20));
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `floor_id=eq.${floorId}` },
        () => {
          supabase
            .from("alerts")
            .select("*, noise_events(*)")
            .eq("floor_id", floorId)
            .order("created_at", { ascending: false })
            .limit(30)
            .then(({ data }) => setAlerts((data as unknown as AlertWithEvent[]) ?? []));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [floorId]);

  async function triggerManualAlert() {
    setTriggering(true);
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor_id: floorId }),
      });
    } finally {
      setTriggering(false);
    }
  }

  if (!floor) {
    return <p className="muted">불러오는 중...</p>;
  }

  return (
    <>
      <Link href="/" className="back-link">
        ← 전체 층 현황으로
      </Link>
      <h1 className="section-title" style={{ marginTop: 0 }}>
        {floor.label} 상세
      </h1>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="floor-title" style={{ margin: 0 }}>
            수동 스피커 경고
          </h3>
          <button className="btn danger" onClick={triggerManualAlert} disabled={triggering}>
            {triggering ? "발령 중..." : "이 층에 경고 발령"}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          자동 감지와 무관하게 경비실에서 직접 스피커 경고를 보낼 수 있습니다.
        </p>
      </div>

      <h2 className="section-title">최근 센서 데이터</h2>
      {readings.length === 0 ? (
        <p className="muted">아직 수신된 데이터가 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>시각</th>
              <th>천장 소리(dB)</th>
              <th>천장 진동(dB)</th>
              <th>바닥 소리(dB)</th>
              <th>바닥 진동(dB)</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleTimeString("ko-KR")}</td>
                <td>{r.ceiling_sound_db.toFixed(1)}</td>
                <td>{r.ceiling_vibration.toFixed(1)}</td>
                <td>{r.floor_sound_db.toFixed(1)}</td>
                <td>{r.floor_vibration.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title">경고 이력</h2>
      <AlertList alerts={alerts} showFloor={false} />

      <ThresholdForm floor={floor} />
    </>
  );
}
