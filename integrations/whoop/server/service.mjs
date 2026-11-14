import { CALLBACK_URI, REQUIRED_SCOPES } from './config.mjs';
import { OAuthStateStore } from './oauth-state.mjs';
import { SnapshotCache } from './snapshot-cache.mjs';
import { WhoopClient, WhoopError, requiredScopesGranted } from './whoop-client.mjs';

function validTokenResponse(response) {
  return response && typeof response.access_token === 'string' && response.access_token.length > 0
    && Number.isFinite(Number(response.expires_in)) && Number(response.expires_in) > 0;
}

function mappedScore(record, fields) {
  if (!record) return { state: 'MISSING', values: null };
  const state = typeof record.score_state === 'string' ? record.score_state : 'PENDING_SCORE';
  if (state !== 'SCORED' || !record.score) return { state, values: null };
  return { state, values: Object.fromEntries(fields.map((field) => [field, record.score[field] ?? null])) };
}

export class WhoopService {
  #refreshInFlight = null;
  #dataRefreshes = new Map();
  #authCallbacks = new Set();
  #disconnecting = false;
  #reconnectRequired = false;

  constructor({ config, tokenStore, fetchImpl = fetch, now = Date.now, stateStore, cache } ) {
    this.config = config;
    this.tokenStore = tokenStore;
    this.now = now;
    this.states = stateStore ?? new OAuthStateStore({ now });
    this.cache = cache ?? new SnapshotCache({ timeZone: config.timeZone, maxSeconds: config.cacheMaxSeconds, now });
    this.client = new WhoopClient({ clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl, now });
  }

  authorizationUrl() {
    const state = this.states.create();
    const url = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: CALLBACK_URI,
      scope: [...REQUIRED_SCOPES, 'offline'].join(' '),
      state,
    }).toString();
    return url.toString();
  }

  async callback(query) {
    const operation = this.#handleCallback(query);
    this.#authCallbacks.add(operation);
    try {
      return await operation;
    } finally {
      this.#authCallbacks.delete(operation);
    }
  }

  async #handleCallback(query) {
    const states = query.getAll('state');
    if (states.length !== 1 || !this.states.consume(states[0])) return { result: 'invalid_state' };
    if (this.#disconnecting) return { result: 'disconnecting' };
    if (query.has('error')) return { result: 'denied' };
    const codes = query.getAll('code');
    if (codes.length !== 1 || !codes[0]) return { result: 'invalid_callback' };

    try {
      const response = await this.client.exchangeCode(codes[0], CALLBACK_URI);
      if (!validTokenResponse(response)) return { result: 'token_exchange_failed' };
      if (this.#disconnecting) {
        await this.#revokeTokenBestEffort(response.access_token);
        return { result: 'disconnecting' };
      }
      if (!requiredScopesGranted(response.scope)) {
        await this.#revokeTokenBestEffort(response.access_token);
        return { result: 'missing_scopes' };
      }
      await this.tokenStore.write({
        accessToken: response.access_token,
        refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : null,
        expiresAt: this.now() + Number(response.expires_in) * 1000,
        scopes: response.scope.split(/\s+/).filter(Boolean),
      });
      this.#reconnectRequired = false;
      return { result: 'connected' };
    } catch (error) {
      return { result: error instanceof WhoopError ? error.code : 'token_exchange_failed' };
    }
  }

  async status() {
    const tokens = await this.tokenStore.read();
    if (!tokens) return { connection: 'disconnected', canFetch: false, scopes: [] };
    const canRefresh = Boolean(tokens.refreshToken);
    const hasValidAccessToken = tokens.expiresAt > this.now() + 30000;
    if (this.#reconnectRequired || !canRefresh) {
      return { connection: 'reconnect_required', canFetch: hasValidAccessToken || canRefresh, scopes: tokens.scopes ?? [] };
    }
    return { connection: 'connected', canFetch: true, scopes: tokens.scopes ?? [] };
  }

  snapshot(period) {
    return this.cache.get(period);
  }

  async refresh(period) {
    if (this.#disconnecting) throw new WhoopError('reconnect_required', 401);
    if (this.#dataRefreshes.has(period)) return this.#dataRefreshes.get(period);
    const operation = this.#refreshSnapshot(period).finally(() => this.#dataRefreshes.delete(period));
    this.#dataRefreshes.set(period, operation);
    return operation;
  }

  async #refreshSnapshot(period) {
    const accessToken = await this.#accessToken();
    const paths = period === 'morning'
      ? [
          '/v2/activity/sleep?limit=5',
          '/v2/recovery?limit=1',
          '/v2/user/measurement/body',
        ]
      : ['/v2/cycle?limit=1'];
    const results = await Promise.all(paths.map((path) => this.#getWithRefresh(path, accessToken)));
    const headers = results.map(({ cacheControl, expires, age }) => ({ cacheControl, expires, age }));
    const data = period === 'morning'
      ? this.#mapMorning(results.map(({ data: value }) => value))
      : this.#mapEvening(results[0].data);
    const retained = this.cache.set(period, data, headers);
    return { data, fetchedAt: new Date(this.now()).toISOString(), retained };
  }

  async disconnect() {
    let revoked = false;
    let attempted = false;
    this.#disconnecting = true;
    try {
      await Promise.allSettled([...this.#authCallbacks]);
      await Promise.allSettled([...this.#dataRefreshes.values()]);
      await this.#refreshInFlight?.catch(() => {});
      const tokens = await this.tokenStore.read();
      if (tokens) {
        let accessToken = tokens.accessToken;
        if (tokens.expiresAt <= this.now() + 30000) {
          if (tokens.refreshToken) {
            try { accessToken = await this.#refreshTokens(tokens); } catch { accessToken = null; }
          } else {
            accessToken = null;
          }
        }
        if (accessToken) {
          attempted = true;
          try {
            await this.client.revoke(accessToken);
            revoked = true;
          } catch { /* Local deletion still proceeds. */ }
        }
      }
    } finally {
      this.cache.clear();
      this.#reconnectRequired = false;
      try {
        await this.tokenStore.clear();
      } finally {
        this.#disconnecting = false;
      }
    }
    return { revoked, attempted };
  }

  cleanup() {
    this.cache.cleanup();
  }

  async #accessToken() {
    if (this.#disconnecting) throw new WhoopError('reconnect_required', 401);
    const tokens = await this.tokenStore.read();
    if (this.#disconnecting) throw new WhoopError('reconnect_required', 401);
    if (!tokens) throw new WhoopError('reconnect_required', 401);
    if (tokens.expiresAt > this.now() + 30000) return tokens.accessToken;
    if (!tokens.refreshToken) {
      this.#reconnectRequired = true;
      throw new WhoopError('reconnect_required', 401);
    }
    return this.#refreshStoredTokens(tokens);
  }

  async #refreshStoredTokens(current) {
    if (this.#disconnecting) throw new WhoopError('reconnect_required', 401);
    if (!this.#refreshInFlight) {
      this.#refreshInFlight = (async () => {
        const latest = await this.tokenStore.read();
        if (this.#disconnecting) throw new WhoopError('reconnect_required', 401);
        if (!latest) throw new WhoopError('reconnect_required', 401);
        if (latest.accessToken !== current.accessToken && latest.expiresAt > this.now() + 30000) return latest.accessToken;
        return this.#refreshTokens(latest);
      })().finally(() => { this.#refreshInFlight = null; });
    }
    return this.#refreshInFlight;
  }

  async #refreshTokens(current) {
    try {
      const response = await this.client.refresh(current.refreshToken);
      if (!validTokenResponse(response)) throw new WhoopError('invalid_provider_response');
      if (response.scope && !requiredScopesGranted(response.scope)) throw new WhoopError('missing_scopes', 403);
      const tokens = {
        accessToken: response.access_token,
        refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : null,
        expiresAt: this.now() + Number(response.expires_in) * 1000,
        scopes: response.scope ? response.scope.split(/\s+/).filter(Boolean) : current.scopes,
      };
      try {
        await this.tokenStore.write(tokens);
      } catch {
        this.cache.clear();
        await this.tokenStore.clear();
        throw new WhoopError('token_rotation_storage_failed', 500);
      }
      this.#reconnectRequired = !tokens.refreshToken;
      return tokens.accessToken;
    } catch (error) {
      this.#reconnectRequired = true;
      if (error instanceof WhoopError && (error.status === 401 || error.status === 400 || error.code === 'missing_scopes')) {
        this.cache.clear();
        await this.tokenStore.clear();
      }
      throw new WhoopError('reconnect_required', error.status ?? 401, error.retryAfterSeconds);
    }
  }

  async #getWithRefresh(path, initialAccessToken) {
    try {
      return await this.client.get(path, initialAccessToken);
    } catch (error) {
      if (error instanceof WhoopError && error.status === 404) {
        return { data: null, cacheControl: null, expires: null, age: null };
      }
      if (!(error instanceof WhoopError) || error.status !== 401) throw error;
      const tokens = await this.tokenStore.read();
      if (!tokens?.refreshToken) throw new WhoopError('reconnect_required', 401);
      const accessToken = await this.#refreshStoredTokens(tokens);
      return this.client.get(path, accessToken);
    }
  }

  async #revokeTokenBestEffort(accessToken) {
    try { await this.client.revoke(accessToken); } catch { /* Local credentials were never saved. */ }
  }

  #mapMorning([sleepResponse, recoveryResponse, bodyResponse]) {
    const sleepRecords = Array.isArray(sleepResponse?.records) ? sleepResponse.records : [];
    const sleep = sleepRecords.find((record) => record?.nap === false) ?? sleepRecords[0] ?? null;
    const recovery = Array.isArray(recoveryResponse?.records) ? recoveryResponse.records[0] ?? null : null;
    return {
      sleep: {
        start: sleep?.start ?? null,
        end: sleep?.end ?? null,
        timezoneOffset: sleep?.timezone_offset ?? null,
        nap: sleep?.nap ?? null,
        ...mappedScore(sleep, ['sleep_performance_percentage', 'sleep_efficiency_percentage', 'stage_summary', 'sleep_needed']),
      },
      recovery: {
        ...mappedScore(recovery, ['recovery_score', 'hrv_rmssd_milli', 'resting_heart_rate', 'spo2_percentage', 'skin_temp_celsius']),
      },
      body: bodyResponse ? {
        heightMeter: bodyResponse.height_meter ?? null,
        weightKilogram: bodyResponse.weight_kilogram ?? null,
        maxHeartRate: bodyResponse.max_heart_rate ?? null,
      } : null,
    };
  }

  #mapEvening(response) {
    const cycle = Array.isArray(response?.records) ? response.records[0] ?? null : null;
    const score = mappedScore(cycle, ['strain', 'kilojoule', 'average_heart_rate', 'max_heart_rate']);
    return {
      cycle: {
        start: cycle?.start ?? null,
        end: cycle?.end ?? null,
        timezoneOffset: cycle?.timezone_offset ?? null,
        stepCount: cycle?.step_count ?? null,
        ...score,
      },
    };
  }
}