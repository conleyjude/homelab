import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class OAuthStateStore {
  #entries = new Map();

  constructor({ ttlMs = 10 * 60 * 1000, now = Date.now, createState } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.createState = createState ?? (() => randomBytes(6).toString('base64url'));
  }

  create() {
    this.#prune();
    while (this.#entries.size >= 32) this.#entries.delete(this.#entries.keys().next().value);
    const state = this.createState();
    this.#entries.set(this.#key(state), { state, expiresAt: this.now() + this.ttlMs });
    return state;
  }

  consume(candidate) {
    if (typeof candidate !== 'string') return false;
    const key = this.#key(candidate);
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    this.#entries.delete(key);
    if (entry.expiresAt <= this.now()) return false;

    const expected = Buffer.from(entry.state);
    const submitted = Buffer.from(candidate);
    return expected.length === submitted.length && timingSafeEqual(expected, submitted);
  }

  #key(state) {
    return createHash('sha256').update(state).digest('hex');
  }

  #prune() {
    const now = this.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}