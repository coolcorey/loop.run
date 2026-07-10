# Loop — AI integration ideas

Product-shaped ideas for Grok / xAI in Loop. Not generic fitness-chatbot fluff.

## Shipped / shipping (1–6, quiet UI)

These run **automatically** or live under **Settings → Coach & AI**. No extra screens.

| # | Idea | Behavior |
|---|------|----------|
| 1 | **Post-run debrief** | On finish, one short AI summary stored on the log; optional speak; shown as muted text on History |
| 2 | **Split commentary** | Auto voice when a split lands — pace vs target if set, else local smart line |
| 3 | **Route narrative** | Plan response `aiNotes` — why this loop feels the way it does |
| 4 | **Regenerate with intent** | “Different route” + plan prefs push *true loop / no doubling back* into routing |
| 5 | **Session brief** | Starting a Train session speaks a one-breath plan (warmup / pace / focus) |
| 6 | **Injury / fatigue notes** | Settings athlete notes feed plan generation + debriefs |

**Auto vocal narrative (progress / completion)** — yes. Milestone cues (25 / 50 / 75%), splits, off-route, finish + debrief can all fire from progress without extra buttons. Settings toggles keep it quiet if you want.

---

## High leverage (next)

7. **Free run → count as session?** — After free run, optional one-line: “Count as Day 12 base?”  
8. **Adaptive plan** — Missed days or crushed sessions → rebalance remaining plan days  
9. **Goal realism check** — Before generating: “18:00 5K in 3 weeks is aggressive; here are two paths”  
10. **Race strategy** — Even vs negative split narrative for half/marathon goals  

## During the run

11. **Climb-aware cues** — Altitude deltas → “hill coming / crest it”  
12. **Shorter cues over music** — “Up. Now.” when mid-hard effort  
13. **Safety / light** — Time of day → stick to busier streets (soft suggestion only)  

## Motivation (optional, spicy)

14. **Rival ghost** — Slightly faster ghost from your history  
15. **Weekly story** — Sunday narrative card, not a spreadsheet  
16. **Tone preset** — Trash-talk vs zen (same facts)  

## Heavier / later

17. Race bib / course photo → seed plan  
18. Import Strava summary → calibrate paces  
19. Voice-in at home (“make tomorrow easy 3”) — not mid-stride  

## Avoid for now

- Always-on conversational voice agent (cost, battery, PWA limits)  
- Fake form analysis from camera  
- Anything that needs a huge proprietary dataset  

---

## Cost notes

| Call | When | Rough cost |
|------|------|------------|
| Route notes | Per plan | Small |
| Training plan | Per generate | Medium (long JSON) |
| Coach nudge | ~every 45s or manual | Small each |
| Debrief | Once per finish | Small |
| Session brief | Once per session start | Small |
| Split commentary | Prefer **local** first | Free if local |

Prefer **local templates** for high-frequency cues (splits, milestones); reserve Grok for debrief, plans, and narrative.

---

## Routing quality (related)

Loop planning should prefer **true loops** and **avoid out-and-back / doubling back** on the same road. See server routing + plan preferences.
