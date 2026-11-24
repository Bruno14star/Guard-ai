import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldAlert } from 'lucide-react';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { isFirebaseConfigured, missingFirebaseEnvVars } from './firebase.ts';

function MissingFirebaseConfigScreen() {
  return (
    <div className="min-h-screen bg-[#050B14] text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[#0C1626] border border-[#FF2D55]/50 rounded-3xl p-6 space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#FF2D55]/15 text-[#FF2D55] flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-extrabold text-white">
          Firebase Configuration Missing
        </h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          Guard AI cannot start without valid Firebase environment variables. Please configure the
          required keys in your deployment environment and restart the app.
        </p>
        <div className="p-3.5 rounded-2xl bg-[#050B14] border border-slate-800 space-y-1.5">
          <p className="text-xs font-bold text-[#FFC400]">Missing Environment Variables:</p>
          <ul className="text-xs font-mono text-slate-300 space-y-1">
            {missingFirebaseEnvVars.map((keyName) => (
              <li key={keyName}>• {keyName}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isFirebaseConfigured ? <App /> : <MissingFirebaseConfigScreen />}
    </ErrorBoundary>
  </StrictMode>
);
