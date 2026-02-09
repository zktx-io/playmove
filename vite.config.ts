import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@zktx.io/sui-move-builder'],
  },
});
