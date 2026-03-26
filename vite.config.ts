import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['react', 'react-dom', 'react-dom/client']
  },
  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client', '@toolbox/sdk']
    }
  }
});
