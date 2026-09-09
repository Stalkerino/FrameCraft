import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {rollupOptions: {output: {manualChunks: {remotion: ['remotion', '@remotion/player']}}}},
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: Object.fromEntries(['/api', '/media', '/project-media', '/thumbnails', '/exports'].map(path => [path, 'http://127.0.0.1:4318'])),
  },
});
