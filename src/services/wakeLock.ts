/**
 * Screen Wake Lock — keeps the display on so GPS + speaker stay reliable mid-run.
 * Released when the run ends or the page is hidden (browser may also drop it).
 */

export type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener?: (type: 'release', listener: () => void) => void
}

let sentinel: WakeLockSentinelLike | null = null
let reacquireOnVisible: (() => void) | null = null

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

export function isWakeLockActive(): boolean {
  return Boolean(sentinel && !sentinel.released)
}

export async function requestScreenWakeLock(): Promise<boolean> {
  if (!isWakeLockSupported()) return false

  try {
    // Already held
    if (sentinel && !sentinel.released) return true

    const lock = await (
      navigator as Navigator & {
        wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
      }
    ).wakeLock.request('screen')

    sentinel = lock
    lock.addEventListener?.('release', () => {
      if (sentinel === lock) sentinel = null
    })

    // Re-request when user returns to the tab (browsers release on hide)
    if (!reacquireOnVisible) {
      reacquireOnVisible = () => {
        if (document.visibilityState === 'visible' && sentinel === null) {
          // Caller must re-request intentionally; we only reacquire if marked
          void reacquireIfWanted()
        }
      }
      document.addEventListener('visibilitychange', reacquireOnVisible)
    }

    wanted = true
    return true
  } catch {
    sentinel = null
    return false
  }
}

/** When true, visibilitychange will try to re-acquire after tab is shown again */
let wanted = false

async function reacquireIfWanted() {
  if (!wanted) return
  await requestScreenWakeLock()
}

export async function releaseScreenWakeLock(): Promise<void> {
  wanted = false
  const current = sentinel
  sentinel = null
  if (current && !current.released) {
    try {
      await current.release()
    } catch {
      // ignore
    }
  }
}

/**
 * Start wake lock for a run session if the user opted in.
 * Returns whether the lock is active.
 */
export async function enableRunWakeLock(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await releaseScreenWakeLock()
    return false
  }
  return requestScreenWakeLock()
}
