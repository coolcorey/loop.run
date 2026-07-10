/**
 * Map running speed (m/s) to a trail color.
 * Range tuned for easy jog → hard run (not cars).
 * ~1.5 m/s walk · ~2.7 jog · ~3.5 run · ~5+ fast
 */
export const SPEED_MIN_MPS = 1.4
export const SPEED_MAX_MPS = 5.2

/** Stops for legend: slow → fast */
export const SPEED_LEGEND: { label: string; color: string; mps: number }[] = [
  { label: 'Easy', color: '#3b82f6', mps: 1.6 },
  { label: 'Steady', color: '#22c55e', mps: 2.8 },
  { label: 'Push', color: '#eab308', mps: 3.8 },
  { label: 'Hard', color: '#f97316', mps: 4.5 },
  { label: 'Sprint', color: '#ef4444', mps: 5.2 },
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const STOPS = SPEED_LEGEND.map((s) => ({
  mps: s.mps,
  rgb: hexToRgb(s.color),
}))

/** Color for a speed in m/s */
export function speedToColor(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps) || mps <= 0) {
    return '#64748b' // unknown / stationary
  }
  const v = Math.max(SPEED_MIN_MPS, Math.min(SPEED_MAX_MPS, mps))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (v <= b.mps) {
      const t = (v - a.mps) / Math.max(1e-6, b.mps - a.mps)
      return rgbToHex(
        lerp(a.rgb[0], b.rgb[0], t),
        lerp(a.rgb[1], b.rgb[1], t),
        lerp(a.rgb[2], b.rgb[2], t),
      )
    }
  }
  return SPEED_LEGEND[SPEED_LEGEND.length - 1].color
}
