'use client';

import React, { useEffect, useRef } from 'react';
import { AccessPoint, AP_PRESETS } from '@/types';
import { X } from 'lucide-react';

interface AntennaVisualizerProps {
    ap: AccessPoint | null;
    onClose: () => void;
}

export function AntennaVisualizer({ ap, onClose }: AntennaVisualizerProps) {
    const azimuthRef = useRef<HTMLCanvasElement>(null);
    const elevationRef = useRef<HTMLCanvasElement>(null);

    // Draw Polar Plot
    const drawPolar = (canvas: HTMLCanvasElement, title: string, dataFn: (angle: number) => number, color: string = '#3b82f6') => {
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
        
        // Concentric circles representing -10dB steps
        for (let r = 0.2; r <= 1; r += 0.2) {
            ctx.beginPath();
            ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
            ctx.stroke();
            
            // dB labels
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            const dbLabel = `${Math.round((1 - r) * 30 - 30)}dB`;
            ctx.fillText(dbLabel, cx + 4, cy - radius * r + 9);
        }

        // Spokes (every 30 degrees)
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
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        for (let a = 0; a <= 360; a++) {
            const rad = (a * Math.PI) / 180;
            // Get normalized value (0-1)
            const val = dataFn(rad);

            const r = val * radius;
            const x = cx + Math.cos(rad) * r;
            const y = cy + Math.sin(rad) * r;

            if (a === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        // Fill
        ctx.fillStyle = color.replace(')', ', 0.15)').replace('rgb', 'rgba');
        ctx.fill();
    };

    useEffect(() => {
        if (!ap) return;
        
        const model = ap.model || 'aruba-315';
        const preset = AP_PRESETS[model];
        
        if (azimuthRef.current) {
            if (model === 'aruba-315') {
                // Aruba AP-315 Azimuth (Horizontal) Pattern
                // Source: Aruba AP-315 Datasheet
                // 4x4 MIMO with integrated omni-directional antennas
                // Very circular pattern with minimal ripple (< 0.5dB variation)
                drawPolar(azimuthRef.current, "Azimuth - Omni Directional", (angle) => {
                    // Near-perfect circle with slight variations from 4x4 array
                    // Normalized to show the pattern shape
                    return 0.98 + Math.sin(angle * 4) * 0.02;
                }, '#2563eb');
            } else if (model === 'unifi-u6-pro') {
                // UniFi U6 Pro Azimuth Pattern
                // Source: UniFi U6 Pro Datasheet
                // 4x4 MU-MIMO with omni-directional antennas
                drawPolar(azimuthRef.current, "Azimuth - Omni Directional", (angle) => {
                    // Omni pattern with slight variations
                    return 0.97 + Math.sin(angle * 4) * 0.03;
                }, '#9333ea');
            } else {
                // Generic omni pattern
                drawPolar(azimuthRef.current, "Azimuth - Omni Directional", () => 0.95, '#6b7280');
            }
        }
        
        if (elevationRef.current) {
            if (model === 'aruba-315') {
                // Aruba AP-315 Elevation (Vertical) Pattern
                // Source: Aruba AP-315 Datasheet
                // Ceiling mount optimized with downtilt
                // Characteristics: Main lobe downward (0 degrees = down/nadir)
                // Typical ceiling AP pattern: strong signal below, attenuated above
                drawPolar(elevationRef.current, "Elevation - Ceiling Mount", (angle) => {
                    // Convert angle: 0 = down (nadir), PI = up (zenith)
                    // Ceiling APs have strong downward radiation
                    // cos(angle) gives 1 at 0 (down), -1 at PI (up)
                    const downwardFactor = Math.cos(angle);
                    // Strong signal below horizon, weaker above
                    if (downwardFactor > 0) {
                        // Below ceiling: 0.9 to 1.0
                        return 0.9 + downwardFactor * 0.1;
                    } else {
                        // Above ceiling: attenuated (0.3 to 0.5)
                        return 0.5 + Math.abs(downwardFactor) * 0.2;
                    }
                }, '#2563eb');
            } else if (model === 'unifi-u6-pro') {
                // UniFi U6 Pro Elevation Pattern
                // Source: UniFi U6 Pro Datasheet
                // Similar ceiling mount pattern with downtilt
                drawPolar(elevationRef.current, "Elevation - Ceiling Mount", (angle) => {
                    const downwardFactor = Math.cos(angle);
                    if (downwardFactor > 0) {
                        return 0.92 + downwardFactor * 0.08;
                    } else {
                        return 0.45 + Math.abs(downwardFactor) * 0.25;
                    }
                }, '#9333ea');
            } else {
                // Generic elevation pattern
                drawPolar(elevationRef.current, "Elevation Pattern", (angle) => {
                    return 0.7 + Math.cos(angle) * 0.25;
                }, '#6b7280');
            }
        }
    }, [ap]);

    if (!ap) return null;

    const model = ap.model || 'aruba-315';
    const preset = AP_PRESETS[model];
    const modelName = preset?.modelName || 'Unknown Model';
    const antennaGain = preset?.antennaGain || 0;

    return (
        <div className="absolute top-4 right-4 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50 animate-in fade-in slide-in-from-right-10">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                <div>
                    <h3 className="font-bold text-gray-800">Antenna Pattern</h3>
                    <p className="text-xs text-gray-500">{modelName}</p>
                    <p className="text-[10px] text-gray-400">{antennaGain} dBi Gain</p>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full text-gray-500">
                    <X size={16} />
                </button>
            </div>

            <div className="p-4 space-y-4">
                <canvas ref={azimuthRef} width={280} height={180} className="w-full" />
                <canvas ref={elevationRef} width={280} height={180} className="w-full" />

                <div className="text-xs text-gray-400 text-center pt-2 border-t">
                    <p className="font-medium text-gray-600">{preset?.vendor} {preset?.modelName}</p>
                    <p className="text-[10px]">EIRP: {preset?.totalEIRP} dBm | Gain: {antennaGain} dBi</p>
                </div>
            </div>
        </div>
    );
}
