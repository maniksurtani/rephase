import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loungeAssetsPlugin } from './scripts/lounge-assets.mjs';

export default defineConfig({
  plugins: [react(), loungeAssetsPlugin()],
  server: { port: 5173, strictPort:true, proxy: { '/api': `http://127.0.0.1:${process.env.REPHASE_WORKER_PORT ?? '8787'}` } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
