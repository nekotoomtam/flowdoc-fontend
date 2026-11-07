import {defineConfig} from 'vite';
import {engineBridge} from './scripts/engine-bridge.mjs';
export default defineConfig({plugins:[engineBridge()],server:{host:'127.0.0.1',port:5173,strictPort:true}});
