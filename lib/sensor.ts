export function vibFrequencyLabel(count: number): string {
  if (count === 0) return "없음";
  if (count <= 3) return "낮음";
  if (count <= 8) return "보통";
  return "높음";
}
