/** Physical constants (SI) and plain-language formatting for the readout. */
export const C = 299_792_458; // m/s, exact
export const KM = 1000;
export const AU = 149_597_870_700; // m, exact (IAU 2012)
export const YEAR = 365.25 * 86_400; // Julian year, s
export const LY = C * YEAR; // 9.4607e15 m
export const PC = (AU * 648_000) / Math.PI; // 3.0857e16 m
export const KPC = PC * 1e3;
export const MPC = PC * 1e6;

const group = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Three significant figures, with thousands separators once the number is large. */
export function sig3(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const ax = Math.abs(x);
  if (ax === 0) return '0';
  if (ax >= 999.5) {
    const mag = Math.pow(10, Math.floor(Math.log10(ax)) - 2);
    return group.format(Math.round(x / mag) * mag);
  }
  if (ax >= 99.95) return x.toFixed(0);
  if (ax >= 9.995) return x.toFixed(1);
  if (ax >= 0.9995) return x.toFixed(2);
  return x.toPrecision(2);
}

function withWords(x: number, unit: string): string {
  if (x >= 0.9995e9) return `${sig3(x / 1e9)} billion ${unit}`;
  if (x >= 0.9995e6) return `${sig3(x / 1e6)} million ${unit}`;
  return `${sig3(x)} ${unit}`;
}

/** Distance in the unit a person would use at that scale: kilometres near home, light-years beyond. */
export function formatDistance(metres: number): string {
  const ly = metres / LY;
  if (ly >= 0.1) return withWords(ly, 'light-years');
  return withWords(metres / KM, 'km');
}

/** Astronomical units, shown only where they are the natural unit. */
export function formatAu(metres: number): string | null {
  const au = metres / AU;
  if (au < 0.01 || au > 100_000) return null;
  return `${sig3(au)} AU`;
}

/** A duration in the largest unit that keeps the number readable. */
export function formatDuration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 120) return `${sig3(s)} seconds`;
  if (s < 2 * 3600) return `${sig3(s / 60)} minutes`;
  if (s < 2 * 86_400) return `${sig3(s / 3600)} hours`;
  if (s < YEAR) return `${sig3(s / 86_400)} days`;
  return withWords(s / YEAR, 'years');
}
