/**
 * 센서 값 해석 기준 (웹 전체의 단일 소스)
 *
 * 아두이노(arduino/noise_node/noise_node.ino)는 ADC 피크투피크를 dB 로 선형 환산해
 * floor_sound_db / floor_vibration 두 값을 2초마다 보낸다. 두 값 모두 같은 dB 스케일이고,
 * 소리도 진동도 전혀 없을 때 환산 하한인 SILENCE_DB 에 딱 붙는다.
 *
 *   중요: 무음은 "0" 이 아니라 "30" 이다.
 *   따라서 유무를 `값 !== 0` 으로 판정하면 언제나 "있음"이 된다. 반드시 아래 임계값을 쓸 것.
 */

// ── 아두이노 환산 하한 = 무음 기준선 ────────────────────────────────────────
// noise_node.ino 의 SOUND_DB_MIN / VIB_DB_MIN 과 반드시 같은 값이어야 한다.
export const SILENCE_DB = 30;

// ── 감지 임계값 (바닥 소리 / 바닥 진동 "유무" 판정) ─────────────────────────
// 무음 기준선에서 이만큼 넘으면 "감지됨(O)". ADC 흔들림과 센서 자체 노이즈를 넘기기 위한
// 여유값이다. 현장에서 조용할 때 값이 계속 O 로 뜨면 이 마진을 키우고,
// 실제 발소리/TV 소리에도 X 로 남으면 줄인다.
const DETECT_MARGIN_DB = 3;

export const DETECT_SOUND_DB = SILENCE_DB + DETECT_MARGIN_DB; // 33 dB
export const DETECT_VIB_DB = SILENCE_DB + DETECT_MARGIN_DB; // 33 dB

// ── 법정 기준 (Supabase 트리거 fn_process_sensor_reading 과 동일하게 유지) ──
// 국가법령정보 생활법령 "층간소음의 기준"
//   직접충격 소음 최고소음도(Lmax)   주간 57 / 야간 52
//   공기전달 소음 5분 등가소음도(Leq) 주간 45 / 야간 40
export const LEGAL_LIMITS = {
  impact: { day: 57, night: 52 },
  airborne: { day: 45, night: 40 },
} as const;

// ── 노드 연결 판정 ──────────────────────────────────────────────────────────
// 업로드 주기가 2초이므로, 이보다 오래 새 값이 없으면 노드가 끊긴 것으로 본다.
export const READING_STALE_MS = 15_000;

/** 트리거와 동일하게 Asia/Seoul 06:00~22:00 을 주간으로 본다. */
export function isDayTime(at: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at)
  );
  return hour >= 6 && hour < 22;
}

/** 해당 시각에 적용되는 주/야간 기준치 */
export function limitsAt(at: Date = new Date()) {
  const day = isDayTime(at);
  return {
    isDay: day,
    impact: day ? LEGAL_LIMITS.impact.day : LEGAL_LIMITS.impact.night,
    airborne: day ? LEGAL_LIMITS.airborne.day : LEGAL_LIMITS.airborne.night,
  };
}

/**
 * silent   : 무음 기준선 근처 — 사실상 아무 일도 없음 (X)
 * detected : 소리/진동이 잡히지만 법정 기준 이하 — 정상 생활소음 (O)
 * over     : 법정 기준 초과 — 트리거가 noise_event + alert 를 만드는 구간
 */
export type SensorLevel = "silent" | "detected" | "over";

export function soundLevel(db: number, at: Date = new Date()): SensorLevel {
  if (db >= limitsAt(at).airborne) return "over";
  if (db >= DETECT_SOUND_DB) return "detected";
  return "silent";
}

export function vibLevel(db: number, at: Date = new Date()): SensorLevel {
  if (db >= limitsAt(at).impact) return "over";
  if (db >= DETECT_VIB_DB) return "detected";
  return "silent";
}

/** 감지 임계값을 넘겼는가 = 카드의 O / X */
export function isSoundDetected(db: number): boolean {
  return db >= DETECT_SOUND_DB;
}

export function isVibDetected(db: number): boolean {
  return db >= DETECT_VIB_DB;
}

/** 두 센서 중 더 심각한 쪽을 층의 대표 상태로 삼는다. */
export function worstLevel(a: SensorLevel, b: SensorLevel): SensorLevel {
  const rank: Record<SensorLevel, number> = { silent: 0, detected: 1, over: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export const LEVEL_LABEL: Record<SensorLevel, string> = {
  silent: "정상",
  detected: "소음 감지",
  over: "기준 초과",
};

/** 마지막 수신이 너무 오래됐으면 노드가 끊긴 것으로 본다. */
export function isStale(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > READING_STALE_MS;
}

/**
 * 진동 빈도: 최근 관측 구간에서 감지 임계값을 넘긴 비율로 표시한다.
 * 건수 절대값으로 잡으면 대시보드(최근 5분)와 상세(최근 20건)의 기준이 달라져 의미가 어긋난다.
 */
export function vibFrequencyLabel(detected: number, total: number): string {
  if (total === 0) return "데이터 없음";
  if (detected === 0) return "없음";
  const ratio = detected / total;
  if (ratio < 0.1) return "낮음";
  if (ratio < 0.4) return "보통";
  return "높음";
}

/** 표시용 dB 포맷 */
export function formatDb(db: number): string {
  return `${db.toFixed(1)} dB`;
}
