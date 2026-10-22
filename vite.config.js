import { defineConfig } from 'vite';
import gameDataPlugin from './tools/vite-plugin-game-data.js';

export default defineConfig({
  plugins: [gameDataPlugin()],
  server: {
    port: 5737,
    strictPort: true,
  },
});
