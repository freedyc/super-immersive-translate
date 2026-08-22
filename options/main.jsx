import { createRoot } from 'react-dom/client';
import { MuiBridge } from '../utils/mui-theme.jsx';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(
  <MuiBridge>
    <App />
  </MuiBridge>,
);
