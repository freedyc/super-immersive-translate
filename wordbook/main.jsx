/**
 * 单词本页面的 React 入口。
 *
 * tts.js 直接 import 进来，不再靠 index.html 里的独立 <script type="module">：
 * 打包后 Vite 会把那种并列的模块脚本合进主 bundle，标签本身消失，
 * window.ttsManager 就没人挂了（发音按钮全哑）。import 能保证它一定被执行。
 */
import { createRoot } from 'react-dom/client';
import '../utils/tts.js';
import { MuiBridge } from '../utils/mui-theme.jsx';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <MuiBridge>
    <App />
  </MuiBridge>,
);
