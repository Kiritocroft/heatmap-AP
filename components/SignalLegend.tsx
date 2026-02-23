import React from 'react';

export function SignalLegend() {
    return (
        <div className="absolute bottom-4 right-4 bg-slate-900/95 backdrop-blur-sm p-4 rounded-lg shadow-2xl border border-slate-700 pointer-events-none w-56">
            <h3 className="text-[10px] uppercase tracking-widest font-bold mb-4 text-slate-400">Signal Strength (dBm)</h3>

            {/* Color Gradient Bar */}
            <div className="h-2 w-full rounded-full bg-gradient-to-r from-[rgb(239,68,68)] via-[rgb(59,130,246)] via-[rgb(249,115,22)] via-[rgb(234,179,8)] to-[rgb(34,197,94)] mb-2"></div>
            <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-6">
                <span>-85</span>
                <span>-75</span>
                <span>-65</span>
                <span>-60</span>
                <span>-45</span>
            </div>

            <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)] bg-[rgb(34,197,94)]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Excellent (&gt; -45)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(234,179,8,0.8)] bg-[rgb(234,179,8)]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Good (-45 to -60)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(249,115,22,0.8)] bg-[rgb(249,115,22)]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Fair (-60 to -65)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] bg-[rgb(59,130,246)]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Weak (-65 to -75)</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)] bg-[rgb(239,68,68)]"></div>
                    <span className="text-[11px] font-medium text-slate-300">Bad (-75 to -85)</span>
                </div>
                 <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full border border-slate-600 bg-transparent"></div>
                    <span className="text-[11px] font-medium text-slate-500">Dead Zone (&lt; -85)</span>
                </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-500 uppercase">Model</span>
                    <span className="text-[9px] text-blue-400 font-bold">5GHz Log-Distance</span>
                </div>
            </div>
        </div>
    );
}
