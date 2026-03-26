import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

window.__TOOLBOX_HOST__ = {
  version: '0.1.0',
  startedAt: Date.now()
};

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
