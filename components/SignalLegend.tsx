import React from 'react';

export function SignalLegend() {
    return (
        <div className="absolute bottom-4 right-4 bg-slate-900/95 backdrop-blur-sm p-4 rounded-lg shadow-2xl border border-slate-700 pointer-events-none w-48">
            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 text-slate-400">Signal (dBm)</h3>

            {/* Color Gradient Bar */}
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-red-600 via-orange-500 via-yellow-400 to-green-500 mb-2"></div>
            <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-6">
                <span>-90</span>
                <span>-70</span>
                <span>-50</span>
                <span>-30</span>
            </div>

            <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)] bg-[#22c55e]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Excellent (&gt; -50)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(132,204,22,0.8)] bg-[#84cc16]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Good (-50 to -65)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(234,179,8,0.8)] bg-[#eab308]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Fair (-65 to -80)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)] bg-[#ef4444]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Poor (-80 to -100)</span>
                </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-500 uppercase">Algorithm</span>
                    <span className="text-[9px] text-blue-400 font-bold">Dijkstra Wave</span>
                </div>
            </div>
        </div>
    );
}
