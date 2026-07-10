import type { AiProvider } from './types'
import { mockAi } from './mock'
import { remoteAi } from './remote'

/**
 * AI facade.
 * - mock: local only
 * - xai / remote: Loop API (road routing + xAI) with mock fallback
 */
function createProvider(): AiProvider {
  const kind = (import.meta.env.VITE_AI_PROVIDER as string | undefined) ?? 'xai'
  switch (kind) {
    case 'mock':
      return mockAi
    case 'xai':
    case 'remote':
    default:
      return remoteAi
  }
}

export const ai: AiProvider = createProvider()
export type { AiProvider, PlanRouteInput, GeneratePlanInput } from './types'
