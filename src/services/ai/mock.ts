import type { AiProvider, GeneratePlanInput, PlanRouteInput } from './types'
import type { CoachContext, CoachNudge, PlannedRoute, TrainingPlan } from '@/types'
import {
  distanceForCalories,
  estimateCalories,
  mockLoopPath,
  pathLengthMeters,
  toMeters,
} from '@/services/geo'
import { uid } from '@/services/storage'

function phaseFromProgress(p: number): CoachContext['phase'] {
  if (p < 0.1) return 'warmup'
  if (p > 0.9) return 'finish'
  if (p > 0.75) return 'push'
  return 'steady'
}

export const mockAi: AiProvider = {
  name: 'mock',

  async planRoute(input: PlanRouteInput): Promise<PlannedRoute> {
    // Simulate a short "thinking" beat
    await delay(280)

    let distanceMeters: number
    if (input.goalKind === 'calories') {
      distanceMeters = distanceForCalories(input.targetValue, input.weightKg)
    } else {
      distanceMeters = toMeters(input.targetValue, input.unit)
    }

    // Clamp to something runnable for demos
    distanceMeters = Math.min(Math.max(distanceMeters, 400), 42_195)

    const bearing = input.startBearing ?? Math.random() * 360
    const path = mockLoopPath(input.origin, distanceMeters, 48, bearing)
    const actual = pathLengthMeters(path)
    const calories = estimateCalories(actual, input.weightKg)

    const turns = buildMockTurns(path.length, input.turnAnnounceMeters)

    const label =
      input.goalKind === 'calories'
        ? `~${input.targetValue} kcal loop`
        : `${input.targetValue} ${input.unit} loop`

    return {
      id: uid('route'),
      summary: label,
      goalKind: input.goalKind,
      targetValue: input.targetValue,
      unit: input.unit,
      distanceMeters: actual,
      estimatedCalories: calories,
      path,
      turns,
      createdAt: new Date().toISOString(),
      aiNotes: input.regenerate
        ? 'Mock planner: new loop orientation.'
        : 'Mock planner: geometric loop from your start.',
    }
  },

  async generateTrainingPlan(input: GeneratePlanInput): Promise<TrainingPlan> {
    await delay(350)

    const sessions = []
    for (let day = 1; day <= input.days; day++) {
      const isRest = day % 7 === 0 || (input.days > 5 && day % 4 === 0)
      if (isRest) {
        sessions.push({
          day,
          title: 'Rest / easy walk',
          description: 'Recover. Short walk optional.',
          isRest: true,
        })
        continue
      }

      const week = Math.ceil(day / 7)
      const progress = day / input.days
      const baseKm =
        input.goalKind === 'calories_per_run'
          ? 3 + progress * 2
          : 2.5 + progress * 4

      sessions.push({
        day,
        title: week === 1 ? 'Base run' : progress > 0.7 ? 'Quality effort' : 'Build run',
        description:
          input.goalKind === 'race_time'
            ? `Easy-moderate run. Build toward ${input.targetLabel}${input.targetTimeSeconds ? ` in ${Math.round(input.targetTimeSeconds / 60)} min` : ''}.`
            : input.goalKind === 'calories_per_run'
              ? `Aim near ${input.caloriesPerRun ?? 300} kcal. Keep form easy early weeks.`
              : `Progressive volume toward ${input.targetLabel}.`,
        distanceMeters: Math.round(baseKm * 1000),
        targetPaceSecondsPerUnit: input.targetTimeSeconds
          ? Math.round(input.targetTimeSeconds / Math.max(1, baseKm))
          : undefined,
      })
    }

    return {
      id: uid('plan'),
      title:
        input.goalKind === 'race_time'
          ? `${input.targetLabel} build — ${input.days} days`
          : input.goalKind === 'calories_per_run'
            ? `Burn plan — ${input.days} days`
            : `${input.targetLabel} in ${input.days} days`,
      goalKind: input.goalKind,
      targetLabel: input.targetLabel,
      targetTimeSeconds: input.targetTimeSeconds,
      days: input.days,
      caloriesPerRun: input.caloriesPerRun,
      sessions,
      createdAt: new Date().toISOString(),
      notes:
        input.notes ||
        'Mock AI plan: progressive volume with rest days. Real AI will personalize from history.',
    }
  },

  async coachNudge(ctx: CoachContext): Promise<CoachNudge> {
    await delay(40)
    const phase = ctx.phase || phaseFromProgress(ctx.progress)
    let message: string
    let tone: CoachNudge['tone'] = 'info'

    const speed = ctx.speedMps
    const target = ctx.targetSpeedMps
    const remainingMi = ctx.distanceRemainingMeters / 1609.344

    if (ctx.offRoute) {
      message = 'Off the path — ease back to the route line.'
      tone = 'info'
    } else if (phase === 'warmup') {
      message = 'Ease in. Find your rhythm for the first few minutes.'
      tone = 'ease'
    } else if (phase === 'finish' || remainingMi < 0.3) {
      message = "Last stretch — if you've got gas, open it up."
      tone = 'push'
    } else if (speed != null && target != null && target > 0) {
      const ratio = speed / target
      if (ratio < 0.9) {
        message = 'A little quicker toward your target pace.'
        tone = 'push'
      } else if (ratio > 1.12) {
        message = "Easy — you're hot vs target. Save some for later."
        tone = 'ease'
      } else {
        message = 'Locked on target pace. Hold this.'
        tone = 'encourage'
      }
    } else if (phase === 'push') {
      message = 'Final quarter of the loop. Stay tall, stay smooth.'
      tone = 'push'
    } else {
      message = 'Steady. Check your shoulders — relax them.'
      tone = 'encourage'
    }

    return {
      id: uid('nudge'),
      message,
      tone,
      at: new Date().toISOString(),
    }
  },
}

function buildMockTurns(pathLen: number, announceMeters: number) {
  const spots = [0.2, 0.4, 0.6, 0.8].map((f) => Math.floor(f * (pathLen - 1)))
  const labels = [
    'Bear right along the loop',
    'Continue on the path',
    'Slight left — stay on the loop',
    'Heading home — keep the line',
  ]
  return spots.map((pathIndex, i) => ({
    id: uid('turn'),
    pathIndex,
    instruction: labels[i] ?? 'Continue',
    announceDistanceMeters: announceMeters,
  }))
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
