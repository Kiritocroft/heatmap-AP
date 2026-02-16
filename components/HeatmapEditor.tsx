'use client';

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Point, Wall, AccessPoint, WallMaterial, PIXELS_PER_METER, Door } from '@/types';
// import { propagateWave, getWaveColor } from '@/utils/waveEngine'; // REMOVED: Moved to Worker

interface HeatmapEditorProps {
    activeTool: 'select' | 'wall' | 'ap' | 'door';
    selectedMaterial: WallMaterial;
    scale: number;
    onSelectionChange: (hasSelection: boolean, entity: { type: 'wall' | 'ap' | 'door', id: string } | null) => void;
    backgroundImage: string | null;
    imageOpacity: number;
}

export interface HeatmapEditorRef {
    deleteSelected: () => void;
    clearAll: () => void;
}

export const HeatmapEditor = forwardRef<HeatmapEditorRef, HeatmapEditorProps>(({
    activeTool,
    selectedMaterial,
    scale,
    onSelectionChange,
    backgroundImage,
    imageOpacity
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [walls, setWalls] = useState<Wall[]>([]);
    const [aps, setAps] = useState<AccessPoint[]>([]);
    const [doors, setDoors] = useState<Door[]>([]);

    const signalGridRef = useRef<Float32Array | null>(null);
    const minDistGridRef = useRef<Float32Array | null>(null);
    const gridDimsRef = useRef({ rows: 0, cols: 0 });
    const bgImageRef = useRef<HTMLImageElement | null>(null);
    const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageDataRef = useRef<ImageData | null>(null);
    
    // --- Constants for Fixed Simulation ---
    const SIM_WIDTH = 3000;  // 75m
    const SIM_HEIGHT = 2000; // 50m
    const GRID_SIZE = 10;    // 25cm resolution (Balanced Performance/Quality)

    // Color Constants for Performance (R, G, B, A_255)
    const COLORS = {
        EXCELLENT: [34, 197, 94, 204], // -40
        GOOD: [132, 204, 22, 204],     // -55
        FAIR: [234, 179, 8, 204],      // -65
        WEAK: [249, 115, 22, 204],     // -75
        BAD: [239, 68, 68, 204],       // -85
        TRANSPARENT: [0, 0, 0, 0]
    };

    const getPixelColor = (dbm: number) => {
        if (dbm > -40) return COLORS.EXCELLENT;
        if (dbm > -55) return COLORS.GOOD;
        if (dbm > -65) return COLORS.FAIR;
        if (dbm > -75) return COLORS.WEAK;
        if (dbm > -85) return COLORS.BAD;
        return COLORS.TRANSPARENT;
    };

    // Load Background Image
    useEffect(() => {
        if (backgroundImage) {
            const img = new Image();
            img.src = backgroundImage;
            img.onload = () => {
                bgImageRef.current = img;
            };
        } else {
            bgImageRef.current = null;
        }
    }, [backgroundImage]);

    // Interaction State
    const [isDrawingWall, setIsDrawingWall] = useState(false);
    const [wallStart, setWallStart] = useState<Point | null>(null);
    const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);

    const [selectedEntity, setSelectedEntity] = useState<{ type: 'wall' | 'ap' | 'door', id: string } | null>(null);
    const [draggedApId, setDraggedApId] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, dbm: number, distance: number } | null>(null);

    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

    const requestRef = useRef<number>(0);
    const timeRef = useRef<number>(0);

    // --- Autosave & Load ---
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('heatmap_autosave');
            if (saved) {
                const data = JSON.parse(saved);
                if (Array.isArray(data.walls)) setWalls(data.walls);
                if (Array.isArray(data.aps)) setAps(data.aps);
                if (Array.isArray(data.doors)) setDoors(data.doors);
                console.log("Restored from autosave");
            }
        } catch (e) {
            console.error("Failed to load autosave", e);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (!isLoaded) return;
        const data = { walls, aps, doors };
        localStorage.setItem('heatmap_autosave', JSON.stringify(data));
    }, [walls, aps, doors, isLoaded]);

    // --- Exposed Methods ---
    useImperativeHandle(ref, () => ({
        deleteSelected: () => {
            if (!selectedEntity) return;
            if (selectedEntity.type === 'ap') {
                setAps(prev => prev.filter(ap => ap.id !== selectedEntity.id));
            } else if (selectedEntity.type === 'door') {
                setDoors(prev => prev.filter(d => d.id !== selectedEntity.id));
            } else {
                setWalls(prev => prev.filter(w => w.id !== selectedEntity.id));
                setDoors(prev => prev.filter(d => d.wallId !== selectedEntity.id));
            }
            setSelectedEntity(null);
            onSelectionChange(false, null);
            setDraggedApId(null);
        },
        clearAll: () => {
            if (confirm('Are you sure you want to clear the entire canvas? This will remove all walls, APs, and doors.')) {
                setWalls([]);
                setAps([]);
                setDoors([]);
                setSelectedEntity(null);
                onSelectionChange(false, null);
                localStorage.removeItem('heatmap_autosave');
            }
        }
    }));

    // Worker Ref
    const workerRef = useRef<Worker | null>(null);

    const [debugInfo, setDebugInfo] = useState({
        status: 'Idle',
        lastCalcTime: 0,
        apsCount: 0,
        wallsCount: 0,
        gridSize: 0,
        currentId: 0,
        receivedId: 0
    });

    // Initialize Worker
    const calculationIdRef = useRef<number>(0);

    // Global Mouse Up to prevent stuck drag state
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            if (draggedApId) {
                setDraggedApId(null);
            }
            if (isPanning) {
                setIsPanning(false);
            }
            if (isDrawingWall) {
                setIsDrawingWall(false);
                setWallStart(null);
            }
        };

        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [draggedApId, isPanning, isDrawingWall]);

    // Initial Resize
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight,
                });
            }
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Compute Heatmap Cache using Web Worker
    // Lifecycle Management: Initialize Worker ONCE on mount
    useEffect(() => {
        const worker = new Worker('/wave-worker.js');
        workerRef.current = worker;
        
        // Warmup: Force JIT compilation immediately
        worker.postMessage({ type: 'WARMUP' });

        worker.onerror = (err) => {
            console.error("Worker Error:", err);
            setDebugInfo(prev => ({ ...prev, status: 'Error' }));
        };

        worker.onmessage = (e) => {
            const { signalGrid, minDistGrid, rows, cols, id } = e.data;
            
            // Race Condition Fix: Discard if ID doesn't match latest request
            if (id !== calculationIdRef.current) {
                // console.warn(`[Worker] Discarding stale result ID: ${id}, expected: ${calculationIdRef.current}`);
                return;
            }

            setDebugInfo(prev => ({
                ...prev,
                status: 'Done',
                receivedId: id,
                gridSize: signalGrid ? signalGrid.length : 0
            }));

            if (signalGrid && minDistGrid) {
                signalGridRef.current = signalGrid;
                minDistGridRef.current = minDistGrid;
                gridDimsRef.current = { rows, cols };
            } else {
                signalGridRef.current = null;
                minDistGridRef.current = null;
                gridDimsRef.current = { rows: 0, cols: 0 };
            }
        };

        return () => {
            worker.terminate();
        };
    }, []); // Empty dependency array = run once on mount

    // Trigger Calculation when Data Changes
    useEffect(() => {
        // Optimization: Do not re-calculate while dragging an AP to avoid lag
        if (draggedApId) return;
        
        const worker = workerRef.current;
        if (!worker) return;

        // Increment ID for this new calculation
        const currentId = ++calculationIdRef.current;
        
        setDebugInfo(prev => ({
            ...prev,
            status: 'Processing...',
            apsCount: aps.length,
            wallsCount: walls.length,
            currentId: currentId,
            lastCalcTime: Date.now()
        }));

        if (aps.length === 0) {
            signalGridRef.current = null;
            minDistGridRef.current = null;
            setDebugInfo(prev => ({ ...prev, status: 'Idle (No APs)' }));
            return;
        }

        // Post message to worker (Worker is already warm and waiting)
        worker.postMessage({
            id: currentId,
            aps,
            walls,
            doors,
            width: SIM_WIDTH,
            height: SIM_HEIGHT,
            cellSize: GRID_SIZE
        });
        
    }, [walls, aps, doors, draggedApId]);


    const getUserPos = (e: React.MouseEvent): Point => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - pan.x) / scale,
            y: (e.clientY - rect.top - pan.y) / scale,
        };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const pos = getUserPos(e);
        setCurrentMousePos(pos);

        if (activeTool === 'ap') {
            const newAp: AccessPoint = {
                id: crypto.randomUUID(),
                x: pos.x,
                y: pos.y,
                txPower: 18,
                channel: 6,
                color: '#34d399',
            };
            setAps(prev => [...prev, newAp]);
            return;
        }

        if (activeTool === 'wall') {
            setIsDrawingWall(true);
            setWallStart(pos);
            setSelectedEntity(null);
            onSelectionChange(false, null);
            return;
        }

        if (activeTool === 'door') {
            const clickedWall = walls.find(w => {
                const { start, end, thickness } = w;
                const l2 = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);
                if (l2 === 0) return false;
                let t = ((pos.x - start.x) * (end.x - start.x) + (pos.y - start.y) * (end.y - start.y)) / l2;
                t = Math.max(0, Math.min(1, t));
                const projX = start.x + t * (end.x - start.x);
                const projY = start.y + t * (end.y - start.y);
                const dist = Math.hypot(pos.x - projX, pos.y - projY);
                return dist < (thickness / 2 + 5);
            });

            if (clickedWall) {
                const wallLen = Math.hypot(clickedWall.end.x - clickedWall.start.x, clickedWall.end.y - clickedWall.start.y);
                const distFromStart = Math.hypot(pos.x - clickedWall.start.x, pos.y - clickedWall.start.y);
                const ratio = Math.max(0, Math.min(1, distFromStart / wallLen));

                const newDoor: Door = {
                    id: crypto.randomUUID(),
                    wallId: clickedWall.id,
                    ratio: ratio,
                    width: 40,
                    swingType: 'single',
                    hinge: 'left',
                    openDirection: 'left'
                };
                setDoors(prev => [...prev, newDoor]);
            }
            return;
        }

        if (activeTool === 'select') {
            for (const wall of walls) {
                const wallDoors = doors.filter(d => d.wallId === wall.id);
                for (const door of wallDoors) {
                    const cx = wall.start.x + (wall.end.x - wall.start.x) * door.ratio;
                    const cy = wall.start.y + (wall.end.y - wall.start.y) * door.ratio;
                    const dist = Math.hypot(pos.x - cx, pos.y - cy);
                    if (dist < 15) {
                        setSelectedEntity({ type: 'door', id: door.id });
                        onSelectionChange(true, { type: 'door', id: door.id });
                        return;
                    }
                }
            }

            const clickedAp = aps.find(ap => Math.hypot(ap.x - pos.x, ap.y - pos.y) < 20);
            if (clickedAp) {
                setDraggedApId(clickedAp.id);
                setSelectedEntity({ type: 'ap', id: clickedAp.id });
                onSelectionChange(true, { type: 'ap', id: clickedAp.id });
                return;
            }

            const clickedWall = walls.find(w => {
                const { start, end, thickness } = w;
                const l2 = Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);
                if (l2 === 0) return false;
                let t = ((pos.x - start.x) * (end.x - start.x) + (pos.y - start.y) * (end.y - start.y)) / l2;
                t = Math.max(0, Math.min(1, t));
                const projX = start.x + t * (end.x - start.x);
                const projY = start.y + t * (end.y - start.y);
                const dist = Math.hypot(pos.x - projX, pos.y - projY);
                return dist < (thickness / 2 + 5);
            });

            if (clickedWall) {
                setSelectedEntity({ type: 'wall', id: clickedWall.id });
                onSelectionChange(true, { type: 'wall', id: clickedWall.id });
                return;
            }

            setSelectedEntity(null);
            onSelectionChange(false, null);
            
            // Start Panning if no entity clicked
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y
            });
            return;
        }

        const pos = getUserPos(e);
        setCurrentMousePos(pos);

        if (activeTool === 'select' && draggedApId) {
            setAps(prev => prev.map(ap =>
                ap.id === draggedApId ? { ...ap, x: pos.x, y: pos.y } : ap
            ));
        }

        if (signalGridRef.current && gridDimsRef.current.cols > 0) {
            const col = Math.floor(pos.x / GRID_SIZE);
            const row = Math.floor(pos.y / GRID_SIZE);
            const { cols, rows } = gridDimsRef.current;

            if (col >= 0 && col < cols && row >= 0 && row < rows) {
                const dbm = signalGridRef.current[row * cols + col];
                let minMeterDist = Infinity;
                aps.forEach(ap => {
                    const d = Math.hypot(pos.x - ap.x, pos.y - ap.y) / PIXELS_PER_METER;
                    if (d < minMeterDist) minMeterDist = d;
                });

                setHoverInfo({
                    x: e.clientX,
                    y: e.clientY,
                    dbm,
                    distance: minMeterDist === Infinity ? 0 : minMeterDist
                });
            } else {
                setHoverInfo(null);
            }
        } else {
            setHoverInfo(null);
        }
    };

    const handleMouseLeave = () => {
        setHoverInfo(null);
    };

    const handleMouseUp = () => {
        if (isPanning) {
            setIsPanning(false);
        }
        if (isDrawingWall && wallStart && currentMousePos) {
            const dx = currentMousePos.x - wallStart.x;
            const dy = currentMousePos.y - wallStart.y;
            if (Math.hypot(dx, dy) > 5) {
                let endX = currentMousePos.x;
                let endY = currentMousePos.y;
                if (Math.abs(dx) < 10) endX = wallStart.x;
                if (Math.abs(dy) < 10) endY = wallStart.y;

                const newWall: Wall = {
                    id: crypto.randomUUID(),
                    start: wallStart,
                    end: { x: endX, y: endY },
                    material: selectedMaterial,
                    thickness: selectedMaterial === 'metal' ? 20 : 12, // Thicker metal walls
                };
                setWalls(prev => [...prev, newWall]);
            }
            setIsDrawingWall(false);
            setWallStart(null);
        }
        if (draggedApId) setDraggedApId(null);
    };

    useEffect(() => {
        const animate = () => {
            requestRef.current = requestAnimationFrame(animate);
            const canvas = canvasRef.current;
            if (!canvas || dimensions.width === 0) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            timeRef.current += 0.05;
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;

            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, dimensions.width, dimensions.height);

            ctx.save();
            ctx.translate(pan.x, pan.y);
            ctx.scale(scale, scale);

            if (bgImageRef.current) {
                ctx.globalAlpha = imageOpacity;
                const img = bgImageRef.current;
                const vw = dimensions.width / scale;
                const vh = dimensions.height / scale;
                const fScale = Math.min(vw / img.width, vh / img.height);
                const dw = img.width * fScale;
                const dh = img.height * fScale;
                ctx.drawImage(img, (vw - dw) / 2, (vh - dh) / 2, dw, dh);
                ctx.globalAlpha = 1.0;
            }

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            // Draw grid for the entire simulation area
            for (let x = 0; x <= SIM_WIDTH; x += PIXELS_PER_METER) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIM_HEIGHT); ctx.stroke();
            }
            for (let y = 0; y <= SIM_HEIGHT; y += PIXELS_PER_METER) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIM_WIDTH, y); ctx.stroke();
            }

            if (signalGridRef.current && aps.length > 0) {
                const { rows, cols } = gridDimsRef.current;
                const grid = signalGridRef.current;

                // Render Full Grid (Simplified for robustness and Panning support)
                // Since we use Offscreen Canvas, rendering 600x400 pixels is fast.
                const endCol = cols;
                const endRow = rows;

                // Initialize Offscreen Canvas
                if (!offscreenCanvasRef.current) {
                    offscreenCanvasRef.current = document.createElement('canvas');
                }
                const offCanvas = offscreenCanvasRef.current;

                // Resize if necessary (only when visible grid size changes)
                if (offCanvas.width !== endCol || offCanvas.height !== endRow) {
                    offCanvas.width = endCol;
                    offCanvas.height = endRow;
                    // Reset cache when resized
                    imageDataRef.current = null;
                }

                const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
                if (offCtx) {
                    // Reuse ImageData if available
                    if (!imageDataRef.current) {
                        imageDataRef.current = offCtx.createImageData(endCol, endRow);
                    }
                    const imgData = imageDataRef.current;
                    const data = imgData.data;

                    for (let r = 0; r < endRow; r++) {
                        for (let c = 0; c < endCol; c++) {
                            const idx = r * cols + c;
                            const val = grid[idx];
                            const pixelIdx = (r * endCol + c) * 4;

                            if (val <= -120) {
                                data[pixelIdx + 3] = 0;
                                continue;
                            }

                            const minDist = minDistGridRef.current ? minDistGridRef.current[idx] : 0;
                            const [R, G, B, A_BASE] = getPixelColor(val);
                            
                            // Wave Animation
                            const wave = Math.sin(minDist * 0.3 - timeRef.current * 0.5);
                            const alphaMod = 1 + wave * 0.15;
                            const finalAlpha = Math.max(0, Math.min(255, A_BASE * alphaMod));

                            data[pixelIdx] = R;
                            data[pixelIdx + 1] = G;
                            data[pixelIdx + 2] = B;
                            data[pixelIdx + 3] = finalAlpha;
                        }
                    }

                    offCtx.putImageData(imgData, 0, 0);

                    ctx.globalCompositeOperation = 'screen';
                    ctx.imageSmoothingEnabled = false; // Keep sharp grid blocks
                    ctx.drawImage(offCanvas, 0, 0, endCol * GRID_SIZE, endRow * GRID_SIZE);
                    ctx.imageSmoothingEnabled = true; // Reset
                    ctx.globalCompositeOperation = 'source-over';
                }
            }

            walls.forEach(w => {
                const isSelected = selectedEntity?.id === w.id;
                let strokeColor = '#525252';
                if (w.material === 'wood') strokeColor = '#A05A2C';
                if (w.material === 'concrete') strokeColor = '#525252';
                if (w.material === 'metal') strokeColor = '#1e293b';
                if (w.material === 'glass') strokeColor = '#60a5fa';
                if (isSelected) strokeColor = '#2563eb';

                ctx.beginPath();
                ctx.moveTo(w.start.x, w.start.y); ctx.lineTo(w.end.x, w.end.y);
                ctx.lineWidth = w.thickness || 12;
                ctx.strokeStyle = strokeColor;
                ctx.lineCap = 'butt'; ctx.stroke();

                if (w.material !== 'glass') {
                    ctx.beginPath(); ctx.moveTo(w.start.x, w.start.y); ctx.lineTo(w.end.x, w.end.y);
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2; ctx.stroke();
                }

                const lenMet = (Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) / PIXELS_PER_METER).toFixed(1);
                const midX = (w.start.x + w.end.x) / 2, midY = (w.start.y + w.end.y) / 2;
                ctx.fillStyle = 'white'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
                ctx.fillText(`${lenMet}m`, midX, midY + 15);

                doors.filter(d => d.wallId === w.id).forEach(d => {
                    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
                    const len = Math.hypot(dx, dy);
                    const ux = dx / len, uy = dy / len; // Unit vector along wall

                    const cx = w.start.x + dx * d.ratio, cy = w.start.y + dy * d.ratio;
                    const halfWidth = (d.width || 40) / 2;
                    
                    // Clear wall for door opening
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.beginPath();
                    ctx.moveTo(cx - ux * halfWidth, cy - uy * halfWidth);
                    ctx.lineTo(cx + ux * halfWidth, cy + uy * halfWidth);
                    ctx.lineWidth = (w.thickness || 12) + 2;
                    ctx.stroke();
                    ctx.globalCompositeOperation = 'source-over';

                    // Draw Door
                    ctx.strokeStyle = selectedEntity?.id === d.id ? '#ef4444' : '#333';
                    ctx.lineWidth = 2;
                    
                    const swingType = d.swingType || 'single';
                    const hinge = d.hinge || 'left';
                    const openDir = d.openDirection || 'left'; // 'left' or 'right' relative to wall vector

                    const wallAngle = Math.atan2(dy, dx);
                    // 'left' open direction means -90 deg (CCW) relative to wall vector
                    // 'right' open direction means +90 deg (CW)
                    const baseSweep = openDir === 'left' ? -Math.PI / 2 : Math.PI / 2;

                    if (swingType === 'single') {
                        const pivotX = hinge === 'left' ? cx - ux * halfWidth : cx + ux * halfWidth;
                        const pivotY = hinge === 'left' ? cy - uy * halfWidth : cy + uy * halfWidth;
                        
                        // Start Angle depends on hinge side
                        const startAngle = hinge === 'left' ? wallAngle : wallAngle + Math.PI;
                        const endAngle = startAngle + baseSweep;

                        ctx.beginPath();
                        ctx.moveTo(pivotX, pivotY);
                        ctx.lineTo(pivotX + Math.cos(endAngle) * (d.width || 40), pivotY + Math.sin(endAngle) * (d.width || 40));
                        ctx.stroke();

                        ctx.beginPath();
                        ctx.arc(pivotX, pivotY, d.width || 40, startAngle, endAngle, baseSweep < 0);
                        ctx.strokeStyle = selectedEntity?.id === d.id ? '#fca5a5' : '#ccc';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    } else {
                        // Double Door
                        const leftPivotX = cx - ux * halfWidth;
                        const leftPivotY = cy - uy * halfWidth;
                        const rightPivotX = cx + ux * halfWidth;
                        const rightPivotY = cy + uy * halfWidth;
                        
                        const panelWidth = (d.width || 40) / 2;
                        
                        // Left Panel
                        const startAngleL = wallAngle;
                        const endAngleL = startAngleL + baseSweep;
                        
                        ctx.strokeStyle = selectedEntity?.id === d.id ? '#ef4444' : '#333';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(leftPivotX, leftPivotY);
                        ctx.lineTo(leftPivotX + Math.cos(endAngleL) * panelWidth, leftPivotY + Math.sin(endAngleL) * panelWidth);
                        ctx.stroke();
                        
                        // Right Panel (Sweep is opposite to meet/open same way)
                        const startAngleR = wallAngle + Math.PI;
                        const endAngleR = startAngleR - baseSweep;
                        
                        ctx.beginPath();
                        ctx.moveTo(rightPivotX, rightPivotY);
                        ctx.lineTo(rightPivotX + Math.cos(endAngleR) * panelWidth, rightPivotY + Math.sin(endAngleR) * panelWidth);
                        ctx.stroke();

                        // Arcs
                        ctx.strokeStyle = selectedEntity?.id === d.id ? '#fca5a5' : '#ccc';
                        ctx.lineWidth = 1;
                        
                        ctx.beginPath();
                        ctx.arc(leftPivotX, leftPivotY, panelWidth, startAngleL, endAngleL, baseSweep < 0);
                        ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.arc(rightPivotX, rightPivotY, panelWidth, startAngleR, endAngleR, baseSweep > 0); // Opposite CCW
                        ctx.stroke();
                    }
                });
            });

            if (isDrawingWall && wallStart && currentMousePos) {
                let endX = currentMousePos.x, endY = currentMousePos.y;
                if (Math.abs(endX - wallStart.x) < 10) endX = wallStart.x; if (Math.abs(endY - wallStart.y) < 10) endY = wallStart.y;
                ctx.beginPath(); ctx.moveTo(wallStart.x, wallStart.y); ctx.lineTo(endX, endY);
                ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);

                // Draw Length Preview
                const lenMet = (Math.hypot(endX - wallStart.x, endY - wallStart.y) / PIXELS_PER_METER).toFixed(1);
                const midX = (wallStart.x + endX) / 2;
                const midY = (wallStart.y + endY) / 2;
                
                ctx.save();
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const metrics = ctx.measureText(`${lenMet}m`);
                const bgW = metrics.width + 10;
                const bgH = 18;
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(midX - bgW/2, midY - bgH/2, bgW, bgH);
                
                ctx.fillStyle = '#fff';
                ctx.fillText(`${lenMet}m`, midX, midY);
                ctx.restore();
            }

            aps.forEach(ap => {
                const isSelected = selectedEntity?.id === ap.id;
                if (isSelected) {
                    ctx.beginPath(); ctx.arc(ap.x, ap.y, 22, 0, Math.PI * 2);
                    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([4, 2]); ctx.stroke(); ctx.setLineDash([]);
                }
                const bx = ap.x - 13, by = ap.y - 5;
                ctx.beginPath(); ctx.roundRect(bx, by, 26, 10, 2); ctx.fillStyle = '#f5f5f5'; ctx.fill();
                ctx.strokeStyle = '#525252'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(ap.x + 8, ap.y, 1, 0, Math.PI * 2); ctx.fill();
            });

            ctx.restore();
        };
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [dimensions, walls, aps, doors, isDrawingWall, wallStart, currentMousePos, scale, selectedEntity, imageOpacity]);

    return (
        <div
            ref={containerRef}
            className="flex-1 relative bg-slate-900 overflow-hidden cursor-crosshair select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0 block touch-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            />

            {hoverInfo && (
                <div
                    className="fixed pointer-events-none z-50 bg-black/80 backdrop-blur-sm border border-white/20 text-white p-2 rounded-lg shadow-xl text-xs flex flex-col gap-1"
                    style={{ left: hoverInfo.x + 15, top: hoverInfo.y + 15 }}
                >
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Signal:</span>
                        <span className={cn("font-bold", hoverInfo.dbm > -65 ? "text-green-400" : hoverInfo.dbm > -80 ? "text-yellow-400" : "text-red-400")}>
                            {Math.round(hoverInfo.dbm)} dBm
                        </span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Dist:</span>
                        <span className="font-mono">{hoverInfo.distance.toFixed(1)}m</span>
                    </div>
                    <div className="h-1 w-full bg-gray-700 rounded-full mt-1 overflow-hidden">
                        <div
                            className={cn("h-full transition-all duration-300", hoverInfo.dbm > -65 ? "bg-green-500" : hoverInfo.dbm > -80 ? "bg-yellow-500" : "bg-red-500")}
                            style={{ width: `${Math.max(0, Math.min(100, (hoverInfo.dbm + 120) * (100 / 90)))}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Debug Panel */}
            <div className="absolute top-16 right-4 pointer-events-none">
                <div className="bg-black/80 backdrop-blur px-3 py-2 rounded-md border border-slate-700 text-[10px] font-mono text-slate-300 flex flex-col gap-1 w-48 shadow-lg">
                    <div className="font-bold border-b border-slate-600 pb-1 mb-1 text-slate-200">System Monitor</div>
                    <div className="flex justify-between"><span>Status:</span> <span className={debugInfo.status.includes('Processing') ? 'text-yellow-400' : 'text-green-400'}>{debugInfo.status}</span></div>
                    <div className="flex justify-between"><span>APs / Walls:</span> <span>{debugInfo.apsCount} / {debugInfo.wallsCount}</span></div>
                    <div className="flex justify-between"><span>Req ID:</span> <span>#{debugInfo.currentId}</span></div>
                    <div className="flex justify-between"><span>Recv ID:</span> <span>#{debugInfo.receivedId}</span></div>
                    <div className="flex justify-between"><span>Grid Points:</span> <span>{(debugInfo.gridSize/1000).toFixed(0)}k</span></div>
                    {debugInfo.lastCalcTime > 0 && (
                         <div className="flex justify-between text-gray-500 text-[9px] mt-1"><span>Last Upd:</span> <span>{new Date(debugInfo.lastCalcTime).toLocaleTimeString()}</span></div>
                    )}
                </div>
            </div>

            <div className="absolute top-4 right-4 pointer-events-none">
                <div className="bg-slate-800/80 backdrop-blur px-3 py-2 rounded-md border border-slate-700 text-[10px] font-mono text-slate-300">
                    <div>Zoom: {Math.round(scale * 100)}% | Grid: 1m</div>
                    <div>Entities: W:{walls.length} A:{aps.length} D:{doors.length}</div>
                </div>
            </div>
        </div>
    );
});

HeatmapEditor.displayName = 'HeatmapEditor';
