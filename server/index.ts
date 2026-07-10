import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile, env } from './env.js'
import { distanceForCalories } from './geo.js'
import { planRoadLoop } from './routing.js'
import { parseJsonLoose, xaiChat, xaiConfigured, XaiError } from './xai.js'

function voiceModeAddon(mode?: string): string {
  switch (mode) {
    case 'jerk':
      return `VOICE: JERK COMEDY. Mean sports-roast. Swear freely (fuck, shit, ass, damn, hell, bullshit, bastard). Savage, funny, contemptuous. One sentence. Roast laziness/pace/quitting/"fitness journey" — not identity hate. No slurs, no self-harm, not minors.
LOCAL COLOR: made-up look left/right/ahead/behind near {placeLabel} that roasts them. Invent NEW. Examples of tone only:
- "If you look left near East Cesar Chavez you'll see people who aren't gasping like your slow ass."
- "Look right by Lady Bird Lake — a fucking shrine to runners who finished before you thought about walking."
Never real private addresses. The joke is required when local color is on.`
    case 'drill':
      return `VOICE: DRILL SERGEANT COMEDY. Barked ALL-CAPS-friendly orders with absurd military theater (funny Full Metal Jacket energy). Invent ridiculous cadences, enemy sofas, traitor sidewalks, imaginary medals. One short command. Funny first, still sergeant-shaped.
LOCAL COLOR: "LEFT — {place} — [absurd barked landmark]. HOLD FORM." Invent fresh. No slurs, no self-harm, not minors.`
    case 'zen':
      return `VOICE: ZEN COMEDY. Calm, spare, deadpan — but funny. Soft spiritual nonsense that gently mocks striving and running culture while sounding peaceful. Ironic koans, absurd mindfulness. Not sincere wellness brochure copy. One sentence.
LOCAL COLOR: "If you glance left near {place}, notice…" invent gently absurd ambient fiction. No slurs, no self-harm, not minors.`
    case 'hype':
      return `VOICE: HYPE COMEDY. Stadium announcer treating a neighborhood jog like the Super Bowl. Ridiculous hyperbole, fake crowd energy, absurd heroic claims. Caps welcome. One sentence. Funny bombast, not bland cheerleading.
LOCAL COLOR: "LOOK LEFT AT {place} — [absurd legendary claim]!" Invent fresh. No slurs, no self-harm, not minors.`
    case 'silent':
      return `VOICE: SILENT. Minimal empty message.`
    default:
      return `VOICE: COACH. Direct, useful, not cheesy, NOT comedic. One practical sentence.
LOCAL COLOR: brief useful landmark cue only — helpful, not jokes.`
  }
}

loadEnvFile()

const app = new Hono()
const port = Number(env('PORT', '8787'))
// App Platform / containers must bind all interfaces (not 127.0.0.1 only)
const hostname = env('HOST', '0.0.0.0')

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const hasDist = existsSync(join(distDir, 'index.html'))

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

    const loopPrefs =
      [
        body.preferences,
        'Prefer a true closed loop. Avoid out-and-back segments where the runner doubles back on the same road.',
      ]
        .filter(Boolean)
        .join(' ')

    if (
      !body.regenerate &&
      typeof body.startBearing !== 'number' &&
      body.preferences &&
      xaiConfigured()
    ) {
      try {
        const raw = await xaiChat({
          system:
            'You help plan outdoor running loops that are true circuits (not out-and-back). Reply JSON only: {"bearing":number,"notes":string}. bearing is degrees from north (0-359) for the first leg.',
          user: `Runner preferences: ${loopPrefs}\nPick a first bearing that opens a neighborhood loop, not a dead-end corridor.`,
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
            'You are a concise running coach for Loop. Reply JSON only: {"summary":string,"notes":string}. summary is a short route title (max 8 words). notes is 1-2 sentences: how the loop flows (true circuit vs any caveats), and one pacing tip. Prefer celebrating loop shape when it is a circuit.',
          user: JSON.stringify({
            goalKind: body.goalKind,
            targetValue: body.targetValue,
            unit: body.unit,
            distanceMeters: Math.round(loop.distanceMeters),
            estimatedCalories: loop.estimatedCalories,
            preferences: loopPrefs,
            turnCount: loop.turns.length,
            provider: loop.provider,
            regenerate: Boolean(body.regenerate),
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

    const days = Math.max(3, Math.min(180, Number(body.days) || 28))
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
      voiceMode?: string
      placeLabel?: string | null
      includeLocalColor?: boolean
    }>()

    if (!xaiConfigured()) {
      return c.json(
        { error: 'XAI_API_KEY not configured', code: 'NO_XAI' },
        503,
      )
    }

    const wantLocal =
      Boolean(body.includeLocalColor) && Boolean(body.placeLabel)

    const localRule = wantLocal
      ? `CRITICAL: includeLocalColor is ON and placeLabel is "${body.placeLabel}". Your message MUST invent a short fictional local beat in the active voice using look left / look right / ahead / behind + that place name. Do NOT only name-drop the street while coaching pace. The local invented fact is the star of the sentence. Never invent real private addresses of real people.`
      : `includeLocalColor is off or placeLabel missing — do NOT invent location fiction; coach effort/pace/route only.`

    const raw = await xaiChat({
      system: `You are Loop's in-run voice coach. One sentence max for TTS over music.
Reply JSON only: {"message":string,"tone":"encourage"|"ease"|"push"|"info"|"celebrate"}
Tone guide: push = speed up, ease = slow down, encourage = hold, celebrate = finish, info = neutral/roast.
If offRoute is true, get them back on path (in voice). Pace numbers are optional spice, not the whole line.
${voiceModeAddon(body.voiceMode)}
${localRule}`,
      user: JSON.stringify(body),
      json: true,
      temperature: (() => {
        const m = body.voiceMode
        // Comedy voices run hotter for invention
        if (m === 'jerk' || m === 'hype' || m === 'drill' || m === 'zen') return 0.95
        if (wantLocal) return 0.8
        return 0.65
      })(),
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

app.post('/api/ai/debrief', async (c) => {
  try {
    const body = await c.req.json<{
      routeSummary: string
      distanceMeters: number
      durationSeconds: number
      alongRouteMeters?: number
      loopCompleted?: boolean
      splits?: { index: number; paceSecondsPerUnit: number; durationSeconds: number }[]
      targetSpeedMps?: number | null
      unit?: 'mi' | 'km'
      athleteNotes?: string
      freeRun?: boolean
    }>()

    if (!xaiConfigured()) {
      return c.json({ error: 'XAI_API_KEY not configured', code: 'NO_XAI' }, 503)
    }

    const raw = await xaiChat({
      system: `You are Loop's post-run coach. Reply JSON only:
{"headline":string,"bullets":[string,string,string],"speak":string}
- headline: max 8 words
- bullets: exactly 3 short coaching points (what went well, one fix, next focus)
- speak: one sentence to say aloud (max 20 words)
Respect athlete notes (injury/fatigue) if present.
${voiceModeAddon((body as { voiceMode?: string }).voiceMode)}`,
      user: JSON.stringify(body),
      json: true,
      temperature: 0.55,
    })
    const parsed = parseJsonLoose<{
      headline?: string
      bullets?: string[]
      speak?: string
    }>(raw)
    return c.json({
      headline: parsed.headline || 'Solid work',
      bullets: (parsed.bullets || []).slice(0, 3),
      speak: parsed.speak || parsed.headline || 'Nice run.',
      at: new Date().toISOString(),
    })
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : 'Debrief failed' },
      500,
    )
  }
})

app.post('/api/ai/session-brief', async (c) => {
  try {
    const body = await c.req.json<{
      sessionTitle: string
      description?: string
      distanceMeters?: number
      targetPaceSecondsPerUnit?: number
      unit?: 'mi' | 'km'
      athleteNotes?: string
      planTitle?: string
    }>()

    if (!xaiConfigured()) {
      return c.json({ error: 'XAI_API_KEY not configured', code: 'NO_XAI' }, 503)
    }

    const raw = await xaiChat({
      system: `You brief a runner before a training session. Reply JSON only:
{"speak":string,"card":string}
- speak: one breath, max 25 words, for TTS before they start
- card: one short line for the UI (max 14 words)
Warmup + intent + one focus. Honor injury notes.`,
      user: JSON.stringify(body),
      json: true,
      temperature: 0.5,
    })
    const parsed = parseJsonLoose<{ speak?: string; card?: string }>(raw)
    return c.json({
      speak: parsed.speak || `Today: ${body.sessionTitle}. Stay smooth.`,
      card: parsed.card || body.sessionTitle,
      at: new Date().toISOString(),
    })
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : 'Brief failed' },
      500,
    )
  }
})

// Production: serve Vite build + SPA fallback (DigitalOcean App Platform, etc.)
if (hasDist) {
  app.use(
    '/*',
    serveStatic({
      root: './dist',
    }),
  )
  app.get('*', (c) => {
    // Don't swallow API 404s as HTML
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404)
    }
    const html = readFileSync(join(distDir, 'index.html'), 'utf8')
    return c.html(html)
  })
} else {
  app.get('/', (c) =>
    c.json({
      ok: true,
      service: 'loop.run api',
      note: 'No dist/ found — API only. Run npm run build for full app.',
      health: '/api/health',
    }),
  )
}

console.log(
  `[loop.run] http://${hostname}:${port}  xai=${xaiConfigured()}  static=${hasDist}`,
)

serve({ fetch: app.fetch, port, hostname })
