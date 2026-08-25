import '@excalidraw/excalidraw/index.css';
// UIF-05: loaded AFTER the canvas stylesheet on purpose. The editor surface owns its own
// styling (EDT-07/AD-008) and no rule in this sheet selects inside it; the order only makes
// that guarantee independent of specificity accidents.
import './styles/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './i18n/index.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
