import { createConfig } from '../../../integrations/whoop/server/config.mjs';
import { EncryptedTokenStore } from '../../../integrations/whoop/server/encrypted-token-store.mjs';
import { WhoopService } from '../../../integrations/whoop/server/service.mjs';
import { createWeatherConfig } from '../../../integrations/weather/server/config.mjs';
import { WeatherService } from '../../../integrations/weather/server/service.mjs';
import { fileURLToPath } from 'node:url';
import { createApiServer } from './server.mjs';

const config = createConfig();
const tokenStore = new EncryptedTokenStore({ filePath: config.tokenFile, key: config.tokenEncryptionKey });
const service = new WhoopService({ config, tokenStore });
const weatherConfig = createWeatherConfig();
const weatherService = new WeatherService({ config: weatherConfig });
const dashboardDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const server = createApiServer({ service, weatherService, config, dashboardDirectory });

server.listen(config.port, config.host);
const cleanupTimer = setInterval(() => service.cleanup(), 30000);
cleanupTimer.unref();

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);