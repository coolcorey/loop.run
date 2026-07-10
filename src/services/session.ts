import type { DistanceUnit, PlannedRoute, TrainingSession } from '@/types'
import { ai } from '@/services/ai'
import { fetchSessionBrief } from '@/services/ai/extra'
import { getCurrentPosition, FALLBACK_ORIGIN } from '@/services/geo'
import { speak } from '@/services/voice'
import { useGuestStore } from '@/stores/guest'
import { useRunsStore } from '@/stores/runs'

/** Convert target pace (sec per mi/km) → m/s */
export function paceToSpeedMps(
  paceSecondsPerUnit: number,
  unit: DistanceUnit,
): number {
  if (!paceSecondsPerUnit || paceSecondsPerUnit <= 0) return 0
  const meters = unit === 'mi' ? 1609.344 : 1000
  return meters / paceSecondsPerUnit
}

export function speedToPaceSeconds(
  speedMps: number,
  unit: DistanceUnit,
): number {
  if (!speedMps || speedMps <= 0) return 0
  const meters = unit === 'mi' ? 1609.344 : 1000
  return meters / speedMps
}

/**
 * Plan a loop for a training session and start the run with target pace.
 */
export async function startSessionRun(opts: {
  planId: string
  session: TrainingSession
  unit: DistanceUnit
}): Promise<PlannedRoute> {
  const guest = useGuestStore()
  const runs = useRunsStore()

  let origin = FALLBACK_ORIGIN
  try {
    origin = await getCurrentPosition({ maxWaitMs: 12_000 })
  } catch {
    // placeholder origin
  }

  const distanceMeters = opts.session.distanceMeters ?? 3000
  const targetValue =
    opts.unit === 'mi' ? distanceMeters / 1609.344 : distanceMeters / 1000

  const notes = guest.profile.athleteNotes?.trim()
  const route = await ai.planRoute({
    origin,
    goalKind: 'distance',
    targetValue: Math.round(targetValue * 100) / 100,
    unit: opts.unit,
    weightKg: guest.profile.weightKg,
    turnAnnounceMeters: guest.profile.turnAnnounceMeters,
    preferences: [
      `Training session: ${opts.session.title}. ${opts.session.description}`,
      'True loop preferred; avoid doubling back on the same road.',
      notes ? `Athlete notes: ${notes}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  })

  // Prefer planned summary that names the session
  route.summary = `${opts.session.title} · ${route.summary}`

  const targetSpeedMps = opts.session.targetPaceSecondsPerUnit
    ? paceToSpeedMps(opts.session.targetPaceSecondsPerUnit, opts.unit)
    : null

  runs.saveRoute(route)
  runs.startRun(route, {
    targetSpeedMps,
    planId: opts.planId,
    planDay: opts.session.day,
    sessionTitle: opts.session.title,
  })

  // Quiet session brief (voice only — no new screen)
  if (
    guest.profile.voiceEnabled &&
    guest.profile.autoSessionBrief
  ) {
    const brief = await fetchSessionBrief({
      session: opts.session,
      unit: opts.unit,
      athleteNotes: notes || undefined,
    })
    if (brief?.speak) {
      speak(brief.speak, { rate: guest.profile.voiceRate })
    } else {
      speak(
        `Today: ${opts.session.title}. Stay smooth.`,
        { rate: guest.profile.voiceRate },
      )
    }
  }

  return route
}
