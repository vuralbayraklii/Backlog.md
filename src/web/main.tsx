import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider, isCentralPage } from './contexts/AuthContext';
import { HealthCheckProvider } from './contexts/HealthCheckContext';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <AuthProvider>{isCentralPage(window.location.pathname) && !/^\/projects\/[1-9]\d*(?:\/|$)/.test(window.location.pathname) ? <App /> : <HealthCheckProvider><App /></HealthCheckProvider>}</AuthProvider>
  </React.StrictMode>
);
