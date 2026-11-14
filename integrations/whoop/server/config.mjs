export const REQUIRED_SCOPES = ['read:sleep', 'read:recovery', 'read:body_measurement', 'read:cycles'];
export const CALLBACK_URI = 'https://connect.surviveness.com/oauth/whoop/callback';

export function createConfig(env = process.env) {
  const keyText = env.WHOOP_TOKEN_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32 || key.toString('base64') !== keyText) {
    throw new Error('WHOOP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) {
    throw new Error('WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are required');
  }

  const cacheMaxSeconds = Number(env.WHOOP_CACHE_MAX_SECONDS ?? '0');
  if (!Number.isInteger(cacheMaxSeconds) || cacheMaxSeconds < 0) {
    throw new Error('WHOOP_CACHE_MAX_SECONDS must be a non-negative integer');
  }

  const dashboardUrl = new URL(env.DASHBOARD_ORIGIN ?? 'http://localhost:4001/');
  if (!['http:', 'https:'].includes(dashboardUrl.protocol) || dashboardUrl.username || dashboardUrl.password
    || dashboardUrl.pathname !== '/' || dashboardUrl.search || dashboardUrl.hash) {
    throw new Error('DASHBOARD_ORIGIN must be one exact HTTP(S) origin without path, credentials, query, or fragment');
  }
  const timeZone = env.PI_TIMEZONE ?? 'America/Chicago';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error('PI_TIMEZONE must be a valid IANA timezone');
  }

  return {
    clientId: env.WHOOP_CLIENT_ID,
    clientSecret: env.WHOOP_CLIENT_SECRET,
    tokenEncryptionKey: key,
    tokenFile: env.TOKEN_FILE ?? '/var/lib/homelab/whoop/tokens.enc',
    cacheMaxSeconds,
    timeZone,
    dashboardOrigin: dashboardUrl.origin,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? '4001'),
  };
}