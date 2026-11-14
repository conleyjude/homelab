import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(dashboardDirectory, 'node_modules/react'),
      'react-dom': resolve(dashboardDirectory, 'node_modules/react-dom'),
      'lucide-react': resolve(dashboardDirectory, 'node_modules/lucide-react'),
    },
  },
});