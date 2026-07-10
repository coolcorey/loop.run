import type { CoachContext, CoachVoiceMode } from '@/types'

export const COACH_VOICE_OPTIONS: {
  id: CoachVoiceMode
  label: string
  blurb: string
}[] = [
  { id: 'coach', label: 'Coach', blurb: 'Direct, useful, not cheesy' },
  { id: 'jerk', label: 'Jerk', blurb: 'Mean, sweary comedy roasts' },
  { id: 'drill', label: 'Drill sergeant', blurb: 'Absurd barked comedy orders' },
  { id: 'zen', label: 'Zen', blurb: 'Deadpan spiritual comedy' },
  { id: 'hype', label: 'Hype', blurb: 'Ridiculous stadium comedy' },
  { id: 'silent', label: 'Silent', blurb: 'No coach voice (turns still optional)' },
]

/** Injected into Grok system prompts */
export function voiceSystemAddon(mode: CoachVoiceMode): string {
  switch (mode) {
    case 'jerk':
      return `VOICE MODE: JERK. Mean sports-roast comedy. Swear freely (fuck, shit, ass, damn, hell, bullshit). Savage, funny, contemptuous of effort/pace/quitting/"fitness journey". One sentence max. Roast laziness — not identity hate.
LOCAL COLOR: invent "look left near {place} you'll see…" absurd roast fiction. Fresh each time. No real private addresses. No slurs, no self-harm, not minors.`
    case 'drill':
      return `VOICE MODE: DRILL SERGEANT COMEDY. Barked orders with absurd military theater — funny Full Metal Jacket energy, not pure seriousness. ALL CAPS flavor welcome. Invent ridiculous cadences, imaginary medals, enemy sofas, traitor sidewalks. One short command-style sentence. Funny first, still sounds like a sergeant.
LOCAL COLOR: "LEFT — {place} — [absurd barked landmark]. HOLD FORM." Invent fresh. No slurs, no self-harm, not minors.`
    case 'zen':
      return `VOICE MODE: ZEN COMEDY. Calm, spare, deadpan — but actually funny. Soft spiritual nonsense that gently mocks running culture and human striving while still sounding peaceful. Understated wit, ironic koans, absurd mindfulness. Not pure sincere wellness copy. One sentence.
LOCAL COLOR: "If you glance left near {place}, notice…" invent gently absurd ambient fiction. No slurs, no self-harm, not minors.`
    case 'hype':
      return `VOICE MODE: HYPE COMEDY. Over-the-top stadium announcer who treats a neighborhood jog like the Super Bowl. Ridiculous hyperbole, fake crowd noise energy, absurd heroic claims. Caps welcome. One sentence. Funny bombast, not bland cheerleading.
LOCAL COLOR: "LOOK LEFT AT {place} — [absurd legendary claim]!" Invent fresh. No slurs, no self-harm, not minors.`
    case 'silent':
      return `VOICE MODE: SILENT. Return a minimal empty-feeling message; the client may suppress speech.`
    case 'coach':
    default:
      return `VOICE MODE: COACH. Direct, useful, not cheesy, not comedic. One practical sentence.
LOCAL COLOR: optional brief useful landmark cue — true-sounding or lightly invented flavor, helpful not mean, no jokes required.`
  }
}

/** Offline invented local-color beats, in voice. */
export function localColorBeat(
  mode: CoachVoiceMode,
  place: string,
  salt = 0,
): string {
  const p = place.trim() || 'here'
  const i = Math.abs(salt) % 4

  switch (mode) {
    case 'jerk': {
      const lines = [
        `If you look to your left near ${p}, you'll see the current address of people who aren't fat and gasping like your slow ass.`,
        `Look right by ${p} — that's where fit people live. Your lazy ass is just polluting the sidewalk.`,
        `Ahead at ${p}: a goddamn museum of runners who finished without making that sad face.`,
        `Behind you near ${p} — every version of you that already quit. Wave, you soft bastard.`,
      ]
      return lines[i]!
    }
    case 'drill': {
      const lines = [
        `LEFT — ${p.toUpperCase()} — ENEMY BENCHES DETECTED. DESTROY THEM WITH YOUR FEET. HOLD FORM.`,
        `EYES FRONT. ${p.toUpperCase()} IS NOT A TOURIST TRAP. IT IS A KILL ZONE FOR QUITTERS.`,
        `RIGHT FLANK — ${p.toUpperCase()} — THE SIDEWALK SALUTES YOU. RETURN THE FAVOR. CADENCE.`,
        `LANDMARK ${p.toUpperCase()} — ACKNOWLEDGE. DO NOT FALL IN LOVE WITH IT. CONTINUE.`,
      ]
      return lines[i]!
    }
    case 'zen': {
      const lines = [
        `If you glance left near ${p}, notice the street does not care about your pace. Beautiful.`,
        `Near ${p}, the traffic cone has achieved more stillness than your racing thoughts.`,
        `The block around ${p} is already finished. You are the only one still negotiating.`,
        `To your right of ${p}, a parked car rests harder than you ever have. Learn from it.`,
      ]
      return lines[i]!
    }
    case 'hype': {
      const lines = [
        `LOOK LEFT AT ${p.toUpperCase()} — HISTORIANS WILL CALL THIS THE GREATEST BLOCK EVER JOGGED!`,
        `ROLLING THROUGH ${p.toUpperCase()} — THE CROWD OF ZERO PEOPLE IS LOSING ITS MIND!`,
        `AHEAD: ${p.toUpperCase()} — TREAT IT LIKE GAME SEVEN, GAME SEVEN OF YOUR OWN IMAGINATION!`,
        `YOU OWN ${p.toUpperCase()} RIGHT NOW — LOCAL WILDLIFE DEMANDS A HIGH-FIVE THEY WILL NOT GIVE!`,
      ]
      return lines[i]!
    }
    case 'silent':
      return ''
    case 'coach':
    default: {
      const lines = [
        `If you look left near ${p}, use it as a landmark and stay smooth.`,
        `Passing ${p} — check posture, keep the pace honest.`,
        `Near ${p}: settle the breath, hold your line.`,
        `Landmark ${p} — you're on track; stay tall.`,
      ]
      return lines[i]!
    }
  }
}

/** Offline / fallback nudges */
export function localNudgeLine(
  mode: CoachVoiceMode,
  ctx: CoachContext,
  place?: string | null,
): string {
  const salt =
    Math.floor((ctx.elapsedSeconds || 0) / 17) +
    Math.floor((ctx.distanceDoneMeters || 0) / 200)

  // When we have a place, prefer a full local-color beat in voice (occasional full line).
  if (place && mode !== 'silent' && !ctx.offRoute && salt % 2 === 0) {
    return localColorBeat(mode, place, salt)
  }

  if (ctx.offRoute) {
    switch (mode) {
      case 'jerk':
        return place
          ? `You're off the fucking path near ${place}. Even the GPS is embarrassed of your ass.`
          : `You're off the fucking path. Even the GPS is embarrassed of your ass.`
      case 'drill':
        return place
          ? `OFF ROUTE NEAR ${place.toUpperCase()}. THE MAP IS CRYING. CORRECT. NOW.`
          : `OFF ROUTE. THE MAP IS CRYING. CORRECT. NOW.`
      case 'zen':
        return place
          ? `You have gently abandoned the route near ${place}. The path forgives. Also: go back.`
          : `You have gently abandoned the route. The path forgives. Also: go back.`
      case 'hype':
        return place
          ? `SIDETRACKED NEAR ${place.toUpperCase()} — THAT WAS NOT THE PLOT TWIST WE PAID FOR!`
          : `SIDETRACKED — THAT WAS NOT THE PLOT TWIST WE PAID FOR!`
      case 'silent':
        return ''
      default:
        return place
          ? `Off the path near ${place} — ease back to the route.`
          : `Off the path — ease back to the route.`
    }
  }

  const phase = ctx.phase
  switch (mode) {
    case 'jerk':
      if (phase === 'finish')
        return place
          ? `Somehow your ass is still moving past ${place}. Don't get fucking cocky.`
          : `Somehow your ass is still moving. Don't get fucking cocky.`
      if (phase === 'warmup')
        return place
          ? localColorBeat('jerk', place, salt)
          : `Already looking tired. Cute. Pathetic, but cute.`
      return place
        ? localColorBeat('jerk', place, salt)
        : `That's your "hard" pace? What a load of shit.`
    case 'drill':
      if (phase === 'finish')
        return place
          ? `FINISH LINE NEAR ${place.toUpperCase()}. EMPTY THE TANK. I WANT TO SEE REGRET AND GLORY.`
          : `FINISH. EMPTY THE TANK. I WANT TO SEE REGRET AND GLORY.`
      return place
        ? localColorBeat('drill', place, salt)
        : `HEAD UP. CADENCE. YOUR LEGS ARE ON PROBATION. DRIVE.`
    case 'zen':
      if (phase === 'finish')
        return place
          ? `Almost home past ${place}. Soften the jaw. Hardship is optional theater.`
          : `Almost home. Soften the jaw. Hardship is optional theater.`
      return place
        ? localColorBeat('zen', place, salt)
        : `Steady breath. This moment is enough. Your ego disagrees. Ignore it.`
    case 'hype':
      if (phase === 'finish')
        return place
          ? `FINAL STRETCH PAST ${place.toUpperCase()} — THIS IS CINEMA AND YOU ARE THE UNLIKELY HERO!`
          : `FINAL STRETCH — THIS IS CINEMA AND YOU ARE THE UNLIKELY HERO!`
      return place
        ? localColorBeat('hype', place, salt)
        : `YOU ARE A MACHINE BUILT FROM SNACKS AND HOPE — KEEP EATING MILES!`
    case 'silent':
      return ''
    default:
      if (phase === 'finish')
        return place
          ? `Last stretch near ${place} — if you've got gas, open it up.`
          : `Last stretch — if you've got gas, open it up.`
      if (phase === 'warmup')
        return place
          ? `Ease in near ${place}. Find your rhythm.`
          : `Ease in. Find your rhythm.`
      return place ? localColorBeat('coach', place, salt) : `Steady. Stay smooth.`
  }
}

export function localSplitLine(
  mode: CoachVoiceMode,
  splitIndex: number,
  vsTarget: 'slow' | 'fast' | 'on' | 'none',
): string {
  switch (mode) {
    case 'jerk':
      if (vsTarget === 'slow') return `Split ${splitIndex}. Slow as shit. Shocking.`
      if (vsTarget === 'fast')
        return `Split ${splitIndex}. Too fucking hot. Trying to impress the trees?`
      return `Split ${splitIndex}. Mediocre as hell. Fine.`
    case 'drill':
      if (vsTarget === 'slow')
        return `SPLIT ${splitIndex}. TOO SLOW. THE ENEMY CLOCK IS LAUGHING.`
      if (vsTarget === 'fast')
        return `SPLIT ${splitIndex}. TOO HOT. SAVE SOME FOR THE WAR.`
      return `SPLIT ${splitIndex}. ACCEPTABLE. DO NOT GET EMOTIONAL ABOUT IT.`
    case 'zen':
      if (vsTarget === 'slow')
        return `Split ${splitIndex}. Time is a social construct. Also: you're slow.`
      if (vsTarget === 'fast')
        return `Split ${splitIndex}. Urgency visited. Invite it to leave gently.`
      return `Split ${splitIndex}. Perfectly ordinary. Enlightenment postponed.`
    case 'hype':
      if (vsTarget === 'slow')
        return `SPLIT ${splitIndex} — THE CROWD BOOS IN SLOW MOTION!`
      if (vsTarget === 'fast')
        return `SPLIT ${splitIndex} — TOO HOT — SOMEONE CALL THE FIRE DEPARTMENT OF PACE!`
      return `SPLIT ${splitIndex} — ON TARGET — CONFIRM THE PARADE ROUTE!`
    case 'silent':
      return ''
    default:
      if (vsTarget === 'slow')
        return `Split ${splitIndex}. A bit slow of target — settle in.`
      if (vsTarget === 'fast')
        return `Split ${splitIndex}. Hot vs target — ease a touch.`
      if (vsTarget === 'on') return `Split ${splitIndex}. Right on target. Hold.`
      return `Split ${splitIndex}. Keep it honest.`
  }
}

export function localMilestoneLine(mode: CoachVoiceMode, pct: number): string {
  const which = pct <= 0.3 ? 'quarter' : pct <= 0.55 ? 'half' : 'three-quarters'
  switch (mode) {
    case 'jerk':
      return which === 'half'
        ? 'Halfway. Still not fucking impressive.'
        : which === 'quarter'
          ? 'Only a quarter done and you already look like shit.'
          : "Three quarters. Don't collapse now, soft ass."
    case 'drill':
      return which === 'half'
        ? 'HALF. THE WAR IS NOT OVER. CONTINUE.'
        : which === 'quarter'
          ? 'QUARTER. FORM LOOKS SUSPICIOUS. HOLD IT.'
          : 'THREE QUARTERS. FINISH LIKE YOU MEAN IT, RECRUIT.'
    case 'zen':
      return which === 'half'
        ? 'Halfway. The finish line is a concept. Keep moving anyway.'
        : which === 'quarter'
          ? 'A quarter done. The remaining three quarters also exist. Soften.'
          : 'Three quarters. Attachment to finishing is strong. Cute.'
    case 'hype':
      return which === 'half'
        ? 'HALFTIME — STILL UNSTOPPABLE — SOMEONE PRINT THE MERCH!'
        : which === 'quarter'
          ? 'QUARTER MARK — THE DOCUMENTARY ALREADY HAS A TRAILER!'
          : 'THREE QUARTERS — LEGENDARY STATUS PENDING FINAL APPROVAL!'
    case 'silent':
      return ''
    default:
      if (which === 'quarter') return 'Quarter done. Smooth and steady.'
      if (which === 'half') return 'Halfway. Stay tall.'
      return 'Three quarters. Finish strong.'
  }
}
