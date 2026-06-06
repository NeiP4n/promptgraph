export class RateLimiter {
  constructor({ maxRequests, windowMs }) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.timestamps = []
    this._chain = Promise.resolve()
  }

  async acquire() {
    const prev = this._chain
    this._chain = prev.then(() => this._doAcquire())
    return this._chain
  }

  async _doAcquire() {
    while (!this.tryAcquire()) {
      const oldest = this.timestamps[0]
      const waitMs = oldest
        ? Math.max(1, oldest + this.windowMs - Date.now())
        : 100
      await new Promise(r => setTimeout(r, Math.min(waitMs, this.windowMs)))
    }
  }

  tryAcquire() {
    const now = Date.now()
    const cutoff = now - this.windowMs
    this.timestamps = this.timestamps.filter(t => t > cutoff)
    if (this.timestamps.length >= this.maxRequests) return false
    this.timestamps.push(now)
    return true
  }
}
