/**
 * 快捷翻译页入口。
 * translator / tts 都靠模块副作用挂到 window 上，必须在 App 之前 import。
 */
import { createRoot } from 'react-dom/client';
import '../utils/translator.js';
import '../utils/tts.js';
import { MuiBridge } from '../utils/mui-theme.tsx';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <MuiBridge>
    <App />
  </MuiBridge>,
);
