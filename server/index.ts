import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { loadEnvFile, env } from './env.js'
import { distanceForCalories } from './geo.js'
import { planRoadLoop } from './routing.js'
import { parseJsonLoose, xaiChat, xaiConfigured, XaiError } from './xai.js'

loadEnvFile()

const app = new Hono()
const port = Number(env('PORT', '8787'))

app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
)

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    xai: xaiConfigured(),
    ors: Boolean(env('ORS_API_KEY')),
    model: env('XAI_MODEL', 'grok-4.3'),
  }),
)

app.post('/api/route/loop', async (c) => {
  try {
    const body = await c.req.json<{
      origin: { lat: number; lng: number }
      goalKind: 'distance' | 'calories'
      targetValue: number
      unit: 'mi' | 'km'
      weightKg: number
      turnAnnounceMeters?: number
      preferences?: string
      /** Client-provided bearing for a different loop direction */
      startBearing?: number
      /** Force a fresh variation (skip sticky preference bearing) */
      regenerate?: boolean
    }>()

    if (
      !body?.origin ||
      typeof body.origin.lat !== 'number' ||
      typeof body.origin.lng !== 'number'
    ) {
      return c.json({ error: 'origin.lat/lng required' }, 400)
    }

    let distanceMeters: number
    if (body.goalKind === 'calories') {
      distanceMeters = distanceForCalories(
        body.targetValue,
        body.weightKg || 75,
      )
    } else {
      distanceMeters =
        body.unit === 'mi'
          ? body.targetValue * 1609.344
          : body.targetValue * 1000
    }

    // Prefer explicit bearing (different-route clicks); otherwise random / AI
    let startBearing =
      typeof body.startBearing === 'number'
        ? ((body.startBearing % 360) + 360) % 360
        : 15 + Math.random() * 40

    if (
      !body.regenerate &&
      typeof body.startBearing !== 'number' &&
      body.preferences &&
      xaiConfigured()
    ) {
      try {
        const raw = await xaiChat({
          system:
            'You help plan outdoor running loops. Reply JSON only: {"bearing":number,"notes":string}. bearing is degrees from north (0-359) for the first leg of a loop starting at the user.',
          user: `Runner preferences: ${body.preferences}\nPick a sensible first bearing for a neighborhood loop.`,
          json: true,
          temperature: 0.4,
        })
        const parsed = parseJsonLoose<{ bearing?: number; notes?: string }>(raw)
        if (typeof parsed.bearing === 'number') {
          startBearing = ((parsed.bearing % 360) + 360) % 360
        }
      } catch {
        // routing still works without AI bias
      }
    }

    const loop = await planRoadLoop({
      origin: body.origin,
      distanceMeters,
      weightKg: body.weightKg || 75,
      turnAnnounceMeters: body.turnAnnounceMeters ?? 40,
      startBearing,
    })

    let aiNotes: string | undefined
    let summary: string | undefined

    if (xaiConfigured() && loop.path.length > 2) {
      try {
        const raw = await xaiChat({
          system:
            'You are a concise running coach for Loop. Reply JSON only: {"summary":string,"notes":string}. summary is a short route title (max 8 words). notes is 1-2 sentences about the loop feel (hills unknown ok).',
          user: JSON.stringify({
            goalKind: body.goalKind,
            targetValue: body.targetValue,
            unit: body.unit,
            distanceMeters: Math.round(loop.distanceMeters),
            estimatedCalories: loop.estimatedCalories,
            preferences: body.preferences ?? null,
            turnCount: loop.turns.length,
            provider: loop.provider,
          }),
          json: true,
          temperature: 0.5,
        })
        const parsed = parseJsonLoose<{ summary?: string; notes?: string }>(raw)
        summary = parsed.summary
        aiNotes = parsed.notes
      } catch (e) {
        aiNotes =
          e instanceof Error ? `Route ok; AI notes skipped (${e.message})` : undefined
      }
    }

    const label =
      summary ||
      (body.goalKind === 'calories'
        ? `~${body.targetValue} kcal loop`
        : `${body.targetValue} ${body.unit} loop`)

    return c.json({
      id: `route_${Date.now().toString(36)}`,
      summary: label,
      goalKind: body.goalKind,
      targetValue: body.targetValue,
      unit: body.unit,
      distanceMeters: loop.distanceMeters,
      estimatedCalories: loop.estimatedCalories,
      path: loop.path,
      turns: loop.turns,
      createdAt: new Date().toISOString(),
      aiNotes:
        aiNotes ||
        (loop.provider === 'mock'
          ? 'Geometric fallback — road router unavailable.'
          : `Routed via ${loop.provider.toUpperCase()}.`),
      provider: loop.provider,
      durationSeconds: loop.durationSeconds,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Route planning failed'
    return c.json({ error: message }, 500)
  }
})

app.post('/api/ai/training-plan', async (c) => {
  try {
    const body = await c.req.json<{
      goalKind: string
      targetLabel: string
      targetTimeSeconds?: number
      days: number
      caloriesPerRun?: number
      unit: 'mi' | 'km'
      notes?: string
    }>()

    if (!xaiConfigured()) {
      return c.json(
        { error: 'XAI_API_KEY not configured', code: 'NO_XAI' },
        503,
      )
    }

    const days = Math.max(3, Math.min(90, Number(body.days) || 28))
    const raw = await xaiChat({
      system: `You are an expert running coach building progressive training plans for Loop.
Reply with JSON only matching:
{
  "title": string,
  "notes": string,
  "sessions": [
    {
      "day": number,
      "title": string,
      "description": string,
      "distanceMeters": number | null,
      "targetPaceSecondsPerUnit": number | null,
      "isRest": boolean
    }
  ]
}
Include exactly one session per day from 1..${days}. Mix rest days. Be realistic. Unit preference: ${body.unit}.`,
      user: JSON.stringify({
        goalKind: body.goalKind,
        targetLabel: body.targetLabel,
        targetTimeSeconds: body.targetTimeSeconds ?? null,
        days,
        caloriesPerRun: body.caloriesPerRun ?? null,
        unit: body.unit,
        athleteNotes: body.notes ?? null,
      }),
      json: true,
      temperature: 0.55,
    })

    const parsed = parseJsonLoose<{
      title?: string
      notes?: string
      sessions?: {
        day: number
        title: string
        description: string
        distanceMeters?: number | null
        targetPaceSecondsPerUnit?: number | null
        isRest?: boolean
      }[]
    }>(raw)

    const sessions = (parsed.sessions ?? []).map((s) => ({
      day: s.day,
      title: s.title,
      description: s.description,
      distanceMeters: s.distanceMeters ?? undefined,
      targetPaceSecondsPerUnit: s.targetPaceSecondsPerUnit ?? undefined,
      isRest: Boolean(s.isRest),
    }))

    return c.json({
      id: `plan_${Date.now().toString(36)}`,
      title:
        parsed.title ||
        `${body.targetLabel} — ${days} days`,
      goalKind: body.goalKind,
      targetLabel: body.targetLabel,
      targetTimeSeconds: body.targetTimeSeconds,
      days,
      caloriesPerRun: body.caloriesPerRun,
      sessions,
      createdAt: new Date().toISOString(),
      notes: parsed.notes,
    })
  } catch (e) {
    const status = e instanceof XaiError && e.status ? 502 : 500
    return c.json(
      { error: e instanceof Error ? e.message : 'Plan generation failed' },
      status,
    )
  }
})

app.post('/api/ai/coach-nudge', async (c) => {
  try {
    const body = await c.req.json<{
      speedMps: number | null
      targetSpeedMps: number | null
      distanceRemainingMeters: number
      distanceDoneMeters: number
      elapsedSeconds: number
      progress: number
      phase: string
      offRoute?: boolean
    }>()

    if (!xaiConfigured()) {
      return c.json(
        { error: 'XAI_API_KEY not configured', code: 'NO_XAI' },
        503,
      )
    }

    const raw = await xaiChat({
      system: `You are Loop's in-run voice coach. Short, spicy, not cheesy. One sentence max.
Reply JSON only: {"message":string,"tone":"encourage"|"ease"|"push"|"info"|"celebrate"}
Tone guide: push = speed up, ease = slow down, encourage = hold, celebrate = finish energy.
If offRoute is true, tell them to get back on the path. If targetSpeedMps is set, coach vs that pace.`,
      user: JSON.stringify(body),
      json: true,
      temperature: 0.7,
    })

    const parsed = parseJsonLoose<{ message?: string; tone?: string }>(raw)
    const tones = ['encourage', 'ease', 'push', 'info', 'celebrate'] as const
    type Tone = (typeof tones)[number]
    const tone: Tone = tones.includes(parsed.tone as Tone)
      ? (parsed.tone as Tone)
      : 'info'

    return c.json({
      id: `nudge_${Date.now().toString(36)}`,
      message: parsed.message || 'Keep moving.',
      tone,
      at: new Date().toISOString(),
    })
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : 'Nudge failed' },
      500,
    )
  }
})

console.log(`[loop.run api] http://127.0.0.1:${port}  xai=${xaiConfigured()}`)

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
