const ADC_MAX = 4095;
const SOUND_DB_MIN = 30;
const SOUND_DB_MAX = 100;
const VIB_DB_MIN = 25;
const VIB_DB_MAX = 90;

export function adcToDb(adcValue: number, dbMin: number, dbMax: number): number {
  const ratio = Math.min(Math.max(adcValue / ADC_MAX, 0), 1);
  return dbMin + ratio * (dbMax - dbMin);
}

export function soundAdcToDb(adcValue: number): number {
  return adcToDb(adcValue, SOUND_DB_MIN, SOUND_DB_MAX);
}

export function vibAdcToDb(adcValue: number): number {
  return adcToDb(adcValue, VIB_DB_MIN, VIB_DB_MAX);
}
