import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import gameDataPlugin from './tools/vite-plugin-game-data.js';

// 빌드는 index.html(게임)과 editor.html(에디터) 둘 다 포함하는 멀티 페이지다.
// 빌드 base는 './'(상대 경로)라서 GitHub Pages의 /저장소이름/ 같은 하위 경로에서도 동작한다.
// 개발 서버는 기존대로 '/'를 쓴다. 저장 API 플러그인은 apply:'serve'라 빌드에 들어가지 않는다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [gameDataPlugin()],
  server: {
    port: 5737,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
}));
