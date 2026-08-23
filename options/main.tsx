import { createRoot } from 'react-dom/client';
import { MuiBridge } from '../utils/mui-theme.tsx';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <MuiBridge>
    <App />
  </MuiBridge>,
);
