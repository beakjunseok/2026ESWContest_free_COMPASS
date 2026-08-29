"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import AlertList, { AlertWithEvent } from "@/components/AlertList";
import SendMessageForm from "@/components/SendMessageForm";
import { soundAdcToDb, vibFrequencyLabel } from "@/lib/sensor";

export default function FloorDetailPage() {
  const params = useParams<{ id: string }>();
  const floorId = Number(params.id);

  const [floor, setFloor] = useState<Floor | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [alerts, setAlerts] = useState<AlertWithEvent[]>([]);

  useEffect(() => {
    if (!Number.isFinite(floorId)) return;
    let cancelled = false;
    const supabase = getSupabaseClient();

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

      <SendMessageForm floorId={floorId} />

      <h2 className="section-title">최근 센서 데이터</h2>
      {readings.length === 0 ? (
        <p className="muted">아직 수신된 데이터가 없습니다.</p>
      ) : (
        <>
          <p className="muted">
            진동 빈도: <b>{vibFrequencyLabel(readings.filter((r) => r.floor_vibration >= 1).length)}</b>
            {" "}({readings.filter((r) => r.floor_vibration >= 1).length}회 / 최근 {readings.length}건)
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>시각</th>
                <th>바닥 소리(dB)</th>
                <th>바닥 진동</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleTimeString("ko-KR")}</td>
                  <td>{soundAdcToDb(r.floor_sound_db).toFixed(1)}</td>
                  <td>{r.floor_vibration >= 1 ? "O" : "X"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 className="section-title">경고 이력</h2>
      <AlertList alerts={alerts} showFloor={false} />

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="floor-title">적용 중인 소음 기준 (법정 고정값)</h3>
        <p className="muted">
          모든 층에 동일하게 적용되며 조정할 수 없습니다. (국가법령정보 생활법령 &middot;
          층간소음의 기준)
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>구분</th>
              <th>주간(06~22시)</th>
              <th>야간(22~06시)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>충격소음 (최고소음도 기준 판정)</td>
              <td>57 dB</td>
              <td>52 dB</td>
            </tr>
            <tr>
              <td>공기전달소음 (5분 등가소음도 기준)</td>
              <td>45 dB</td>
              <td>40 dB</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
