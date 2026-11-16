import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiBase = environment.VITE_API_BASE_URL || 'http://localhost:5000/api';
  const apiProxyTarget = environment.VITE_API_PROXY_TARGET
    || (apiBase.startsWith('http') ? new URL(apiBase).origin : 'http://localhost:5000');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
