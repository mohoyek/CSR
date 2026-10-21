import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import { installNetworkGuard } from '../core/noNetwork';

// The app is fully offline: block every network API in production builds.
// (In dev mode Vite's HMR needs a WebSocket, so the guard stays off there.)
if (import.meta.env.PROD) {
  installNetworkGuard();
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
