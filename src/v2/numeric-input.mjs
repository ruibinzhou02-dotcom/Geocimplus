export function boundedNumber(value, min, max, step = 1) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(
        max,
        Math.max(
          min,
          Number((Math.round((n - min) / step) * step + min).toFixed(8)),
        ),
      )
    : min;
}
export function numberValue(p = {}) {
  const value = Number(p.value ?? 30),
    min = Number(p.min ?? 0),
    max = Number(p.max ?? 100),
    step = Number(p.step ?? 1);
  if (
    ![value, min, max, step].every(Number.isFinite) ||
    min >= max ||
    step <= 0 ||
    value < min ||
    value > max
  )
    throw new Error("Invalid number slider range / 数字滑条范围或数值无效");
  return value;
}
