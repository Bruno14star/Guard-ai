import React from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'An unexpected error occurred in Guard AI.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Guard AI ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050B14] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0C1626] border border-slate-800 rounded-2xl p-6 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-[#FF2D55]/15 flex items-center justify-center text-[#FF2D55]">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold text-white">Guard AI Recovery</h1>
            <p className="text-sm text-slate-400 break-words">
              {this.state.message.startsWith('{')
                ? 'Permission or database verification error detected. Please check your session and retry.'
                : this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 rounded-xl bg-[#2E9BFF] hover:bg-[#1e88eb] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Guard AI
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
