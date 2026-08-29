/**
 * 모든 그래프가 공유하는 dB 표시 축.
 *
 * 소리(30~100dB)와 진동(30~90dB)은 아두이노에서 환산 범위가 다르지만, 화면에서는
 * 같은 축 위에 그려야 두 값을 눈으로 직접 비교할 수 있다. 판정에 쓰이는 구간
 * (무음 30 / 감지 33 / 공기전달 45 / 충격 57) 이 다 들어가면서 저구간이 뭉개지지
 * 않도록 30~75dB 를 표시 범위로 쓰고, 넘는 값은 끝에 붙인 뒤 숫자로 따로 보여준다.
 */
import { SILENCE_DB } from "@/lib/sensor";

export const AXIS_MIN = SILENCE_DB; // 30
export const AXIS_MAX = 75;
export const AXIS_TICKS = [30, 40, 50, 60, 70];

/** dB 값을 0~1 위치로. 축을 벗어나면 잘라낸다. */
export function dbToRatio(db: number): number {
  const r = (db - AXIS_MIN) / (AXIS_MAX - AXIS_MIN);
  return Math.min(1, Math.max(0, r));
}

export function dbToPercent(db: number): number {
  return dbToRatio(db) * 100;
}
