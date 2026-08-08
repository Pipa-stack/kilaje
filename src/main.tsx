import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './ui/App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se ha encontrado el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
