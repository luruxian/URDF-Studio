export function meshJobProgressPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0 || value > 100) {
    return null;
  }
  return value;
}
