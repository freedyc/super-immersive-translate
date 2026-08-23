/**
 * 弹窗入口。这里不包 MuiBridge —— 弹窗刻意不引入 MUI（见 App.jsx 顶部说明），
 * 包一层只会把 @mui/material 拉进弹窗的依赖图，白白拖慢首屏。
 */
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
