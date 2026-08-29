// 바닥 소리 센서: 지수 함수 변환 dB = A × e^(B × ADC)
// 기준점: ADC 2000 → 37 dB, ADC 2800 → 85 dB
const SOUND_EXP_A = 4.625;
const SOUND_EXP_B = 0.001040;

const VIB_DB_MIN = 25;
const VIB_DB_MAX = 90;

export function soundAdcToDb(adcValue: number): number {
  return SOUND_EXP_A * Math.exp(SOUND_EXP_B * adcValue);
}

export function vibAdcToDb(adcValue: number): number {
  const ratio = Math.min(Math.max(adcValue / 4095, 0), 1);
  return VIB_DB_MIN + ratio * (VIB_DB_MAX - VIB_DB_MIN);
}
