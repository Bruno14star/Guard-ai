import React from 'react';

export const AdBanner: React.FC<{ label?: string }> = ({ label }) => {
  return (
    <div
      aria-label="Google AdMob Banner Slot"
      className="w-full h-[50px] shrink-0 bg-[#08101D] border-t border-slate-800/80 flex items-center justify-between px-4 text-xs text-slate-500 select-none"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono text-slate-400 border border-slate-700 rounded px-1 py-0.5 shrink-0">
          Ad
        </span>
        <span className="truncate text-slate-400">
          {label || 'Google AdMob • Sponsored Safety Partner'}
        </span>
      </div>
      <span className="text-[10px] text-slate-600 font-mono shrink-0">320×50</span>
    </div>
  );
};
