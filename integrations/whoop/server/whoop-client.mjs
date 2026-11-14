export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';

export class WhoopError extends Error {
  constructor(code, status, retryAfterSeconds) {
    super(code);
    this.name = 'WhoopError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, Math.ceil((timestamp - now) / 1000));
}

export function rateLimitDelaySeconds(headers, now = Date.now()) {
  const retryAfter = retryAfterSeconds(headers.get('retry-after'), now);
  if (retryAfter !== undefined) return retryAfter;
  const relativeResetText = headers.get('x-ratelimit-reset-after') ?? headers.get('x-rate-limit-reset-after');
  const relativeReset = Number(relativeResetText);
  if (relativeResetText !== null && Number.isFinite(relativeReset) && relativeReset >= 0) return Math.ceil(relativeReset);
  const reset = headers.get('x-ratelimit-reset') ?? headers.get('x-rate-limit-reset');
  if (!reset) return undefined;
  const resetNumber = Number(reset);
  if (Number.isFinite(resetNumber)) {
    if (resetNumber > 1e12) return Math.max(0, Math.ceil((resetNumber - now) / 1000));
    if (resetNumber > 1e9) return Math.max(0, Math.ceil(resetNumber - now / 1000));
    return Math.max(0, Math.ceil(resetNumber));
  }
  const resetAt = Date.parse(reset);
  return Number.isNaN(resetAt) ? undefined : Math.max(0, Math.ceil((resetAt - now) / 1000));
}

export function mapWhoopStatus(status, retryAfter) {
  if (status === 401) return new WhoopError('reauthorization_required', status);
  if (status === 403) return new WhoopError('permission_denied', status);
  if (status === 404) return new WhoopError('data_not_found', status);
  if (status === 429) return new WhoopError('rate_limited', status, retryAfter);
  return new WhoopError(status >= 500 ? 'provider_unavailable' : 'provider_request_failed', status);
}

export function requiredScopesGranted(scopeText) {
  const scopes = new Set(typeof scopeText === 'string' ? scopeText.split(/\s+/).filter(Boolean) : []);
  return ['read:sleep', 'read:recovery', 'read:body_measurement', 'read:cycles'].every((scope) => scopes.has(scope));
}

export class WhoopClient {
  constructor({ clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async exchangeCode(code, redirectUri) {
    return this.#tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  async refresh(refreshToken) {
    return this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' });
  }

  async get(path, accessToken) {
    const response = await this.#request(`${WHOOP_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!response.ok) throw mapWhoopStatus(response.status, response.status === 429 ? rateLimitDelaySeconds(response.headers, this.now()) : retryAfterSeconds(response.headers.get('retry-after'), this.now()));
    try {
      return { data: await response.json(), cacheControl: response.headers.get('cache-control'), expires: response.headers.get('expires'), age: response.headers.get('age') };
    } catch {
      throw new WhoopError('invalid_provider_response', response.status);
    }
  }

  async revoke(accessToken) {
    const response = await this.#request(`${WHOOP_API_BASE}/v2/user/access`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 204) throw mapWhoopStatus(response.status, response.status === 429 ? rateLimitDelaySeconds(response.headers, this.now()) : retryAfterSeconds(response.headers.get('retry-after'), this.now()));
  }

  async #tokenRequest(values) {
    const body = new URLSearchParams({
      ...values,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await this.#request(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!response.ok) throw mapWhoopStatus(response.status, response.status === 429 ? rateLimitDelaySeconds(response.headers, this.now()) : retryAfterSeconds(response.headers.get('retry-after'), this.now()));
    try {
      return await response.json();
    } catch {
      throw new WhoopError('invalid_provider_response', response.status);
    }
  }

  async #request(url, options) {
    try {
      return await this.fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' });
    } catch {
      throw new WhoopError('provider_unavailable');
    }
  }
}