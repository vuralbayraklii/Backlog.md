import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider, isCentralPage } from './contexts/AuthContext';
import { HealthCheckProvider } from './contexts/HealthCheckContext';
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <UnsavedChangesProvider>
      <AuthProvider>{isCentralPage(window.location.pathname) && !/^\/projects\/[1-9]\d*(?:\/|$)/.test(window.location.pathname) ? <App /> : <HealthCheckProvider><App /></HealthCheckProvider>}</AuthProvider>
    </UnsavedChangesProvider>
  </React.StrictMode>
);
