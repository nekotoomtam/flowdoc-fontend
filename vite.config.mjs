import {defineConfig} from 'vite';
import {engineBridge} from './scripts/engine-bridge.mjs';
import {libraryBridge} from './scripts/library-bridge.mjs';
import {phase1Bridge} from './scripts/phase1-bridge.mjs';

export default defineConfig({
  plugins: [engineBridge(), libraryBridge(), phase1Bridge()],
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  build: {rolldownOptions: {input: ['index.html', 'library.html', 'phase1-editor.html']}},
});
