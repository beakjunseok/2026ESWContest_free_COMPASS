"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Floor, SensorReading } from "@/lib/types";
import AlertList, { AlertWithEvent } from "@/components/AlertList";
import SendMessageForm from "@/components/SendMessageForm";
import StatTile from "@/components/StatTile";
import Meter from "@/components/viz/Meter";
import TrendChart from "@/components/viz/TrendChart";
import {
  DETECT_SOUND_DB,
  DETECT_VIB_DB,
  LEVEL_LABEL,
  SILENCE_DB,
  formatDb,
  formatVib,
  isSoundDetected,
  isStale,
  isVibDetected,
  limitsAt,
  soundLevel,
  vibFrequencyLabel,
  vibLevel,
  worstLevel,
} from "@/lib/sensor";

const LEVEL_CLASS = { silent: "ok", detected: "warn", over: "danger" } as const;
const LEVEL_ICON = { silent: "●", detected: "▲", over: "■" } as const;
const HISTORY_LIMIT = 60;

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
          .limit(HISTORY_LIMIT),
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
        {
          event: "INSERT",
          schema: "public",
          table: "sensor_readings",
          filter: `floor_id=eq.${floorId}`,
        },
        (payload) => {
          setReadings((prev) => [payload.new as SensorReading, ...prev].slice(0, HISTORY_LIMIT));
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

  const stats = useMemo(() => {
    const vibHits = readings.filter((r) => isVibDetected(r.floor_vibration)).length;
    const soundHits = readings.filter((r) => isSoundDetected(r.floor_sound_db)).length;
    const peakSound = readings.reduce((m, r) => Math.max(m, r.floor_sound_db), SILENCE_DB);
    const peakVib = readings.reduce((m, r) => Math.max(m, r.floor_vibration), SILENCE_DB);
    return { vibHits, soundHits, peakSound, peakVib };
  }, [readings]);

  if (!floor) {
    return <p className="muted">불러오는 중...</p>;
  }

  const latest = readings[0] ?? null;
  const live = latest && !isStale(latest.created_at) ? latest : null;
  const limits = limitsAt();
  const level = live
    ? worstLevel(soundLevel(live.floor_sound_db), vibLevel(live.floor_vibration))
    : null;

  return (
    <>
      <Link href="/" className="back-link">
        ← 전체 층 현황으로
      </Link>

      <div className="page-head">
        <h1 className="section-title" style={{ marginTop: 0 }}>
          {floor.label} 상세
        </h1>
        <span className={`status-pill ${level ? LEVEL_CLASS[level] : "idle"}`}>
          <span aria-hidden="true">{level ? LEVEL_ICON[level] : "○"}</span>
          {level ? LEVEL_LABEL[level] : "수신 없음"}
        </span>
      </div>

      <div className="card">
        <h2 className="card-title">현재 측정값</h2>
        {live ? (
          <>
            <div className="detail-meters">
              <Meter
                label="바닥 소리"
                db={live.floor_sound_db}
                series="sound"
                detectDb={DETECT_SOUND_DB}
                limitDb={limits.airborne}
                limitLabel="공기전달소음 기준"
                detected={isSoundDetected(live.floor_sound_db)}
              />
              <Meter
                label="바닥 진동"
                db={live.floor_vibration}
                series="vib"
                detectDb={DETECT_VIB_DB}
                limitDb={limits.impact}
                limitLabel="충격소음 기준"
                detected={isVibDetected(live.floor_vibration)}
              />
            </div>
            <p className="muted">
              {new Date(live.created_at).toLocaleString("ko-KR")} 수신 · O 로 표시되는 감지
              임계값은 소리 {DETECT_SOUND_DB}dB / 진동 {DETECT_VIB_DB}, 무음 기준선은{" "}
              {SILENCE_DB}입니다.
            </p>
          </>
        ) : (
          <p className="muted">
            {latest ? "센서 수신이 끊겼습니다." : "아직 수신된 데이터가 없습니다."}
          </p>
        )}
      </div>

      <div className="stat-row">
        <StatTile
          label="최근 최고 소리"
          value={formatDb(stats.peakSound)}
          hint={`최근 ${readings.length}건 기준`}
          tone={stats.peakSound >= limits.airborne ? "danger" : "neutral"}
        />
        <StatTile
          label="최근 최고 진동"
          value={formatVib(stats.peakVib)}
          hint={`최근 ${readings.length}건 기준`}
          tone={stats.peakVib >= limits.impact ? "danger" : "neutral"}
        />
        <StatTile
          label="진동 빈도"
          value={vibFrequencyLabel(stats.vibHits, readings.length)}
          hint={`${stats.vibHits}회 / ${readings.length}건`}
          tone={stats.vibHits > 0 ? "warn" : "ok"}
        />
        <StatTile
          label="소리 감지"
          value={`${stats.soundHits}회`}
          hint={`${readings.length}건 중`}
          tone={stats.soundHits > 0 ? "warn" : "ok"}
        />
      </div>

      <h2 className="section-title">소음 추이</h2>
      <div className="card">
        <TrendChart readings={readings} />
      </div>

      <SendMessageForm floorId={floorId} />

      <h2 className="section-title">최근 측정 기록</h2>
      {readings.length === 0 ? (
        <p className="muted">아직 수신된 데이터가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>시각</th>
                <th>바닥 소리 (dB)</th>
                <th>바닥 진동 (세기)</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => {
                const at = new Date(r.created_at);
                const lim = limitsAt(at);
                return (
                  <tr key={r.id}>
                    <td>{at.toLocaleTimeString("ko-KR")}</td>
                    <td className={r.floor_sound_db >= lim.airborne ? "over" : undefined}>
                      <b className={isSoundDetected(r.floor_sound_db) ? "hit" : "miss"}>
                        {isSoundDetected(r.floor_sound_db) ? "O" : "X"}
                      </b>{" "}
                      {r.floor_sound_db.toFixed(1)}
                    </td>
                    <td className={r.floor_vibration >= lim.impact ? "over" : undefined}>
                      <b className={isVibDetected(r.floor_vibration) ? "hit" : "miss"}>
                        {isVibDetected(r.floor_vibration) ? "O" : "X"}
                      </b>{" "}
                      {r.floor_vibration.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title">경고 이력</h2>
      <AlertList alerts={alerts} showFloor={false} />

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">적용 중인 소음 기준 (법정 고정값)</h3>
        <p className="muted">
          모든 층에 동일하게 적용되며 조정할 수 없습니다. (국가법령정보 생활법령 &middot; 층간소음의
          기준) 진동센서 값은 충격소음 최고소음도 기준과 바로 비교할 수 있도록 같은 척도로 환산한
          세기 값이며, 소음도가 아니므로 dB 를 붙이지 않습니다.
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
              <td>충격소음 &mdash; 바닥 진동으로 판정</td>
              <td>57</td>
              <td>52</td>
            </tr>
            <tr>
              <td>공기전달소음 &mdash; 바닥 소리로 판정</td>
              <td>45 dB</td>
              <td>40 dB</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
