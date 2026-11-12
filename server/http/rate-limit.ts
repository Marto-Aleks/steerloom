interface Window {
  count: number
  expires: number
}

/** Fixed-window attempt counter, e.g. per client address or per account. */
export function attemptLimiter({
  windowMs = 15 * 60_000,
  capacity = Number.POSITIVE_INFINITY,
}: { windowMs?: number; capacity?: number } = {}) {
  const windows = new Map<string, Window>()
  const prune = () => {
    const now = Date.now()
    for (const [key, window] of windows)
      if (window.expires <= now) windows.delete(key)
  }
  return {
    /**
     * Records an attempt. Returns false when the key exceeded `limit` in the
     * current window, or when too many keys are tracked to accept a new one.
     */
    hit(key: string, limit: number): boolean {
      prune()
      let window = windows.get(key)
      if (!window) {
        if (windows.size >= capacity) return false
        window = { count: 0, expires: Date.now() + windowMs }
        windows.set(key, window)
      }
      return ++window.count <= limit
    },
    reset(key: string) {
      windows.delete(key)
    },
  }
}

/**
 * Counts work that is still running per key, e.g. one account's board loads.
 * `enter` returns the function that marks the work finished, or null when the
 * key already has `max` running.
 */
export function inFlightLimiter() {
  const running = new Map<string, number>()
  return {
    enter(key: string, max: number): (() => void) | null {
      const count = running.get(key) ?? 0
      if (count >= max) return null
      running.set(key, count + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const left = (running.get(key) ?? 1) - 1
        if (left > 0) running.set(key, left)
        else running.delete(key)
      }
    },
  }
}
