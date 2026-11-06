import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './state/AuthContext';
import { ThemeProvider } from './state/ThemeContext';
import { ToastProvider } from './state/ToastContext';
import './styles/tokens.css';
import './styles/app.css';
import './styles/pages.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('BeatSync root element missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
