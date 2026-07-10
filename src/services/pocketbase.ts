import PocketBase from 'pocketbase'

/**
 * PocketBase client — optional while we run guest mode on localStorage.
 * Wire collections (runs, plans) when auth lands.
 */
const url = import.meta.env.VITE_POCKETBASE_URL as string | undefined

export const pb = url ? new PocketBase(url) : null

export function isPocketBaseConfigured(): boolean {
  return Boolean(pb)
}
