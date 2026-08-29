// 바닥 소리 센서: ADC 1500~2500 → 0~80 dB (구간별 선형)
// ADC 1500 이하 → 0 dB, ADC 2000 → 30 dB, ADC 2500 이상 → 80 dB
const SOUND_ADC_MIN = 1900;
const SOUND_ADC_MID = 2000;
const SOUND_ADC_MAX = 2100;
const SOUND_DB_MIN = 0;
const SOUND_DB_MID = 30;
const SOUND_DB_MAX = 80;

const VIB_DB_MIN = 25;
const VIB_DB_MAX = 90;

export function soundAdcToDb(adcValue: number): number {
  if (adcValue <= SOUND_ADC_MIN) return SOUND_DB_MIN;
  if (adcValue >= SOUND_ADC_MAX) return SOUND_DB_MAX;
  if (adcValue <= SOUND_ADC_MID) {
    const ratio = (adcValue - SOUND_ADC_MIN) / (SOUND_ADC_MID - SOUND_ADC_MIN);
    return SOUND_DB_MIN + ratio * (SOUND_DB_MID - SOUND_DB_MIN);
  }
  const ratio = (adcValue - SOUND_ADC_MID) / (SOUND_ADC_MAX - SOUND_ADC_MID);
  return SOUND_DB_MID + ratio * (SOUND_DB_MAX - SOUND_DB_MID);
}

export function vibAdcToDb(adcValue: number): number {
  const ratio = Math.min(Math.max((adcValue - 0) / 4095, 0), 1);
  return VIB_DB_MIN + ratio * (VIB_DB_MAX - VIB_DB_MIN);
}
