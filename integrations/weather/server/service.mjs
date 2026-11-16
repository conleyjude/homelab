import { OpenMeteoClient } from './open-meteo.mjs';

export class WeatherService {
  #cached = null;
  #inFlight = null;

  constructor({ config, fetchImpl = fetch, now = Date.now }) {
    this.now = now;
    this.client = new OpenMeteoClient({ config, fetchImpl, now });
  }

  async snapshot({ refresh = false } = {}) {
    if (!refresh && this.#cached && this.#cached.expiresAt > this.now()) return this.#cached.snapshot;
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.client.fetchForecast().then(({ snapshot, lifetimeSeconds }) => {
      this.#cached = lifetimeSeconds > 0
        ? { snapshot, expiresAt: this.now() + lifetimeSeconds * 1000 }
        : null;
      return snapshot;
    }).finally(() => { this.#inFlight = null; });
    return this.#inFlight;
  }
}