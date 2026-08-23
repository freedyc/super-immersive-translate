import { createRoot } from 'react-dom/client';
// 朗读设置页要试听，得有 window.ttsManager
import '../utils/tts.js';
import { MuiBridge } from '../utils/mui-theme.tsx';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <MuiBridge>
    <App />
  </MuiBridge>,
);
