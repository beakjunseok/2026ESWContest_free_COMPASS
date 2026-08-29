// 소리: 측정된 안정 기준값(ADC 1981)에서의 편차를 로그 스케일로 dB 변환
// 안정 시 ADC 편차 ≈ 19 → 35 dB (조용한 방)
// ADC 2230 이상 → 57 dB (충격소음 기준) 초과
const QUIET_ADC = 1981;
const NOISE_FLOOR = 19;
const QUIET_DB = 35;

export function soundAdcToDb(adcValue: number): number {
  const deviation = Math.max(Math.abs(adcValue - QUIET_ADC), NOISE_FLOOR);
  return QUIET_DB + 20 * Math.log10(deviation / NOISE_FLOOR);
}

export function vibFrequencyLabel(count: number): string {
  if (count === 0) return "없음";
  if (count <= 3) return "낮음";
  if (count <= 8) return "보통";
  return "높음";
}
