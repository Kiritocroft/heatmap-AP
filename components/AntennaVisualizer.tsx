'use client';

import React, { useEffect, useRef } from 'react';
import { AccessPoint } from '@/types';
import { X } from 'lucide-react';

interface AntennaVisualizerProps {
    ap: AccessPoint | null;
    onClose: () => void;
}

export function AntennaVisualizer({ ap, onClose }: AntennaVisualizerProps) {
    const azimuthRef = useRef<HTMLCanvasElement>(null);
    const elevationRef = useRef<HTMLCanvasElement>(null);

    // Draw Polar Plot
    const drawPolar = (canvas: HTMLCanvasElement, title: string, dataFn: (angle: number) => number) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = (Math.min(w, h) / 2) - 20;

        ctx.clearRect(0, 0, w, h);

        // Background / Grid
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Concentric circles (-10dB steps)
        for (let r = 0.2; r <= 1; r += 0.2) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Spokes
        for (let i = 0; i < 12; i++) {
            const angle = (i * 30) * (Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            ctx.stroke();
        }

        // Title
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, cx, 15);

        // Plot Data
        ctx.beginPath();
        ctx.strokeStyle = '#3b82f6'; // Blue
        ctx.lineWidth = 2;

        for (let a = 0; a <= 360; a++) {
            const rad = (a * Math.PI) / 180;
            // Get dB value (normalized 0-1)
            const val = dataFn(rad);

            const r = val * radius;
            const x = cx + Math.cos(rad) * r;
            const y = cy + Math.sin(rad) * r; // In canvas Y is down, but for polar plots usually -sin

            if (a === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        // Fill
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fill();
    };

    useEffect(() => {
        if (!ap) return;
        if (azimuthRef.current) {
            // Simulate typical dipole/omni pattern (Perfectly round with minor wobble)
            drawPolar(azimuthRef.current, "Azimuth (Top View)", (angle) => {
                // A bit of randomness/irregularity to look "Measured"
                return 0.95 + Math.sin(angle * 4) * 0.05;
            });
        }
        if (elevationRef.current) {
            // Simulate doughnut shape (Dipole side view) - nulls at top/bottom (90/270)
            drawPolar(elevationRef.current, "Elevation (Side View)", (angle) => {
                // Butterfly shape: dip at 90 (PI/2) and 270 (3PI/2)
                // angle 0 is Right. 
                const v = Math.abs(Math.cos(angle)); // Simple dipole approx
                return 0.4 + (v * 0.6); // Don't go to zero, keeps it realistic
            });
        }
    }, [ap]);

    if (!ap) return null;

    return (
        <div className="absolute top-4 right-4 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50 animate-in fade-in slide-in-from-right-10">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-gray-800">Antenna Pattern</h3>
                    <p className="text-xs text-gray-500">AP: {ap.id.slice(0, 4)}...</p>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full text-gray-500">
                    <X size={16} />
                </button>
            </div>

            <div className="p-4 space-y-6">
                <canvas ref={azimuthRef} width={280} height={200} className="w-full" />
                <canvas ref={elevationRef} width={280} height={200} className="w-full" />

                <div className="text-xs text-gray-400 text-center">
                    Simulated 2.4GHz Dipole Array
                </div>
            </div>
        </div>
    );
}
