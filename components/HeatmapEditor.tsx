'use client';

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Point, Wall, AccessPoint, WallMaterial, DEFAULT_PIXELS_PER_METER, Door, Device, MATERIAL_ATTENUATION } from '@/types';
import { Trash2, Smartphone, Laptop, X } from 'lucide-react';
// import { propagateWave, getWaveColor } from '@/utils/waveEngine'; // REMOVED: Moved to Worker

interface HeatmapEditorProps {
    activeTool: 'select' | 'wall' | 'ap' | 'door' | 'scale' | 'device';
    selectedMaterial: WallMaterial;
    scale: number;
    onSelectionChange: (hasSelection: boolean, entity: { type: 'wall' | 'ap' | 'door' | 'device', id: string } | null) => void;
    backgroundImage: string | null;
    imageOpacity: number;
    onEditorReady?: () => void;
}

export interface HeatmapData {
    walls: Wall[];
    aps: AccessPoint[];
    doors: Door[];
    devices?: Device[];
    pixelsPerMeter: number;
}

export interface HeatmapEditorRef {
    deleteSelected: () => void;
    clearAll: () => void;
    getData: () => HeatmapData;
    loadData: (data: HeatmapData) => void;
}

export const HeatmapEditor = forwardRef<HeatmapEditorRef, HeatmapEditorProps>(({
    activeTool,
    selectedMaterial,
    scale,
    onSelectionChange,
    backgroundImage,
    imageOpacity,
    onEditorReady
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [walls, setWalls] = useState<Wall[]>([]);
    const [aps, setAps] = useState<AccessPoint[]>([]);
    const [doors, setDoors] = useState<Door[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    
    // Scale State
    const [pixelsPerMeter, setPixelsPerMeter] = useState<number>(DEFAULT_PIXELS_PER_METER);
    const [scaleStart, setScaleStart] = useState<Point | null>(null);
    const [isSettingScale, setIsSettingScale] = useState(false);
    const [scaleDistancePixels, setScaleDistancePixels] = useState<number | null>(null);

    // Scale Input Dialog State
    const [showScaleInput, setShowScaleInput] = useState(false);
    const [pendingScalePixels, setPendingScalePixels] = useState<number | null>(null);
    const [scaleInputValue, setScaleInputValue] = useState('');

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
    // Custom Scheme: Green (Strongest) -> Yellow -> Orange -> Blue -> Red (Weakest)
    // > -45: Excellent (Green)
    // -45 to -60: Good (Yellow)
    // -60 to -65: Fair (Orange)
    // -65 to -75: Weak (Blue)
    // -75 to -85: Bad (Red)
    // < -85: Dead Zone
    const COLORS = {
        EXCELLENT: [34, 197, 94, 204],   // > -45 (Green)
        GOOD:      [234, 179, 8, 204],   // -45 to -60 (Yellow)
        FAIR:      [249, 115, 22, 204],  // -60 to -65 (Orange)
        WEAK:      [59, 130, 246, 204],  // -65 to -75 (Blue)
        BAD:       [239, 68, 68, 204],   // -75 to -85 (Red)
        DEAD:      [0, 0, 0, 0]          // < -85 (Transparent)
    };

    const getPixelColor = (dbm: number) => {
        if (dbm > -45) return COLORS.EXCELLENT;
        if (dbm > -60) return COLORS.GOOD;
        if (dbm > -65) return COLORS.FAIR;
        if (dbm > -75) return COLORS.WEAK;
        if (dbm > -85) return COLORS.BAD;
        return COLORS.DEAD;
    };

    // --- Autosave & Load ---
    // REMOVED: Internal autosave logic moved to parent component (page.tsx) to handle multi-floor support correctly.
    // const [isLoaded, setIsLoaded] = useState(false);

    // useEffect(() => {
    //    // Old load logic removed
    // }, []);

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

    const [isDrawingWall, setIsDrawingWall] = useState(false);
    const [wallStart, setWallStart] = useState<Point | null>(null);
    const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);

    const [selectedEntity, setSelectedEntity] = useState<{ type: 'wall' | 'ap' | 'door' | 'device', id: string } | null>(null);
    const [draggedApId, setDraggedApId] = useState<string | null>(null);
    const [draggedDeviceId, setDraggedDeviceId] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, dbm: number, distance: number } | null>(null);

    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

    const requestRef = useRef<number>(0);
    const timeRef = useRef<number>(0);

    // --- Autosave & Load ---
    // Derived Popup Position (No State needed to avoid cascading renders)
    const popupPos = (() => {
        if (!selectedEntity) return null;
        
        let entityX = 0;
        let entityY = 0;
        
        if (selectedEntity.type === 'ap') {
            const ap = aps.find(a => a.id === selectedEntity.id);
            if (ap) {
                entityX = ap.x;
                entityY = ap.y;
            } else return null;
        } else if (selectedEntity.type === 'wall') {
            const wall = walls.find(w => w.id === selectedEntity.id);
            if (wall) {
                entityX = (wall.start.x + wall.end.x) / 2;
                entityY = (wall.start.y + wall.end.y) / 2;
            } else return null;
        } else if (selectedEntity.type === 'device') {
            const dev = devices.find(d => d.id === selectedEntity.id);
            if (dev) {
                entityX = dev.x;
                entityY = dev.y;
            } else return null;
        } else {
            return null;
        }

        // Convert world coordinates to screen coordinates
        const screenX = entityX * scale + pan.x;
        const screenY = entityY * scale + pan.y;

        return { x: screenX, y: screenY - 20 };
    })();

    // --- Exposed Methods ---
    useImperativeHandle(ref, () => ({
        deleteSelected: () => {
            if (!selectedEntity) return;
            if (selectedEntity.type === 'ap') {
                setAps(prev => prev.filter(ap => ap.id !== selectedEntity.id));
            } else if (selectedEntity.type === 'device') {
                setDevices(prev => prev.filter(d => d.id !== selectedEntity.id));
            } else if (selectedEntity.type === 'door') {
                setDoors(prev => prev.filter(d => d.id !== selectedEntity.id));
            } else {
                setWalls(prev => prev.filter(w => w.id !== selectedEntity.id));
                setDoors(prev => prev.filter(d => d.wallId !== selectedEntity.id));
            }
            setSelectedEntity(null);
            onSelectionChange(false, null);
            setDraggedApId(null);
            setDraggedDeviceId(null);
        },
        clearAll: () => {
            if (confirm('Are you sure you want to clear the entire canvas? This will remove all walls, APs, and doors.')) {
                setWalls([]);
                setAps([]);
                setDoors([]);
                setDevices([]);
                setSelectedEntity(null);
                onSelectionChange(false, null);
                localStorage.removeItem('heatmap_autosave');
            }
        },
        getData: () => ({
            walls,
            aps,
            doors,
            devices,
            pixelsPerMeter
        }),
        loadData: (data: HeatmapData) => {
            setWalls(data.walls || []);
            // Migration: Ensure all APs have txPower
            setAps((data.aps || []).map(ap => ({
                ...ap,
                txPower: ap.txPower ?? 20 // Default to 20 dBm if missing
            })));
            setDoors(data.doors || []);
            setDevices(data.devices || []);
            setPixelsPerMeter(data.pixelsPerMeter || DEFAULT_PIXELS_PER_METER);
            setSelectedEntity(null);
            onSelectionChange(false, null);
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

    // Auto-Pan Reference
    const autoPanVel = useRef({ x: 0, y: 0 });

    // Global Mouse Up to prevent stuck drag state
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            autoPanVel.current = { x: 0, y: 0 }; // Stop auto-panning
            if (draggedApId) {
                setDraggedApId(null);
            }
            if (draggedDeviceId) {
                setDraggedDeviceId(null);
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
    }, [draggedApId, draggedDeviceId, isPanning, isDrawingWall]);

    // Notify Parent Ready
    useEffect(() => {
        if (onEditorReady) onEditorReady();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    // Handle Escape Key to Deselect
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isDrawingWall) {
                    setIsDrawingWall(false);
                    setWallStart(null);
                } else if (selectedEntity) {
                    setSelectedEntity(null);
                    onSelectionChange(false, null);
                } else if (showScaleInput) {
                    setShowScaleInput(false);
                    setPendingScalePixels(null);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDrawingWall, selectedEntity, showScaleInput, onSelectionChange]);

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

        // --- Single AP View Mode Logic ---
        // If an AP is selected, we only send that AP to the worker.
        // This makes the heatmap show ONLY the signal for the selected AP.
        let apsToProcess = aps;
        if (selectedEntity?.type === 'ap') {
            const selectedAp = aps.find(a => a.id === selectedEntity.id);
            if (selectedAp) {
                apsToProcess = [selectedAp];
            }
        }

        // Post message to worker (Worker is already warm and waiting)
        worker.postMessage({
            id: currentId,
            aps: apsToProcess,
            walls,
            doors,
            width: SIM_WIDTH,
            height: SIM_HEIGHT,
            cellSize: GRID_SIZE,
            pixelsPerMeter // Pass dynamic scale
        });
        
    }, [walls, aps, doors, draggedApId, pixelsPerMeter, selectedEntity]);


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

        if (activeTool === 'scale') {
            setIsSettingScale(true);
            setScaleStart(pos);
            setScaleDistancePixels(null);
            return;
        }

        if (activeTool === 'ap') {
            const newAp: AccessPoint = {
                id: crypto.randomUUID(),
                x: pos.x,
                y: pos.y,
                txPower: 20, // 20 dBm (100mW) - Standard Indoor AP
                channel: 6,
                color: '#34d399',
            };
            setAps(prev => [...prev, newAp]);
            return;
        }

        if (activeTool === 'device') {
            const newDevice: Device = {
                id: crypto.randomUUID(),
                x: pos.x,
                y: pos.y,
                type: 'phone',
                name: `Device ${devices.length + 1}`
            };
            setDevices(prev => [...prev, newDevice]);
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

            const clickedDevice = devices.find(d => Math.hypot(d.x - pos.x, d.y - pos.y) < 15);
            if (clickedDevice) {
                setDraggedDeviceId(clickedDevice.id);
                setSelectedEntity({ type: 'device', id: clickedDevice.id });
                onSelectionChange(true, { type: 'device', id: clickedDevice.id });
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

            // Sticky Selection: Clicking empty space does NOT deselect
            // setSelectedEntity(null);
            // onSelectionChange(false, null);
            
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

        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const w = rect.width;
            const h = rect.height;
            const threshold = 50; // Edge threshold
            const speed = 10; // Pan speed

            let velX = 0;
            let velY = 0;

            if (isDrawingWall || draggedApId || draggedDeviceId) {
                if (x < threshold) velX = speed;
                else if (x > w - threshold) velX = -speed;
                
                if (y < threshold) velY = speed;
                else if (y > h - threshold) velY = -speed;
            }
            
            autoPanVel.current = { x: velX, y: velY };
        }

        const pos = getUserPos(e);
        setCurrentMousePos(pos);

        if (isSettingScale && scaleStart) {
            const dist = Math.hypot(pos.x - scaleStart.x, pos.y - scaleStart.y);
            setScaleDistancePixels(dist);
        }

        if (activeTool === 'select' && draggedApId) {
            setAps(prev => prev.map(ap =>
                ap.id === draggedApId ? { ...ap, x: pos.x, y: pos.y } : ap
            ));
        }

        if (activeTool === 'select' && draggedDeviceId) {
            setDevices(prev => prev.map(d =>
                d.id === draggedDeviceId ? { ...d, x: pos.x, y: pos.y } : d
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
                    const d = Math.hypot(pos.x - ap.x, pos.y - ap.y) / pixelsPerMeter;
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

        if (isSettingScale && scaleStart && currentMousePos) {
            const distPixels = Math.hypot(currentMousePos.x - scaleStart.x, currentMousePos.y - scaleStart.y);
            if (distPixels > 10) { // Minimum threshold
                const currentRealMeters = (distPixels / pixelsPerMeter).toFixed(2);
                setPendingScalePixels(distPixels);
                setScaleInputValue(currentRealMeters);
                setShowScaleInput(true);
            }
            setIsSettingScale(false);
            setScaleStart(null);
            setScaleDistancePixels(null);
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

            // Auto-Pan Logic
            if (autoPanVel.current.x !== 0 || autoPanVel.current.y !== 0) {
                setPan(prev => ({
                    x: prev.x + autoPanVel.current.x,
                    y: prev.y + autoPanVel.current.y
                }));
                // We need to trigger a mouse move or re-calc mouse pos because pan changed
                // but for now, let's just let the next frame handle it.
                // However, the currentMousePos is relative to pan, so if pan changes,
                // currentMousePos (world coordinates) changes even if mouse doesn't move.
                // We should update currentMousePos here if we want continuous drawing while mouse is still.
                // But currentMousePos is derived from getUserPos(e) which needs the event.
                // So for now, the line preview might lag slightly until mouse moves,
                // but the panning itself will work.
            }

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
                
                // Fix: Scale image to fit within the fixed Simulation Bounds (World Coordinates)
                // instead of the Viewport. This ensures the image stays "stuck" to the world
                // and doesn't move/resize relative to walls when zooming.
                const fScale = Math.min(SIM_WIDTH / img.width, SIM_HEIGHT / img.height);
                const dw = img.width * fScale;
                const dh = img.height * fScale;
                
                // Center the image in the simulation area
                const dx = (SIM_WIDTH - dw) / 2;
                const dy = (SIM_HEIGHT - dh) / 2;

                ctx.drawImage(img, dx, dy, dw, dh);
                ctx.globalAlpha = 1.0;
            }

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            // Draw grid for the entire simulation area
            for (let x = 0; x <= SIM_WIDTH; x += pixelsPerMeter) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIM_HEIGHT); ctx.stroke();
            }
            for (let y = 0; y <= SIM_HEIGHT; y += pixelsPerMeter) {
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
                            
                            // Multi-Source Wave Interference Animation
                            // "Baku Tabrak" Effect: Summing waves from all APs to create interference patterns
                            let waveSum = 0;
                            const worldX = c * GRID_SIZE;
                            const worldY = r * GRID_SIZE;

                            // Optimization: Unroll loop for small number of APs or use simple for loop
                            // We use Euclidean distance for the wave PHASE (visual rings),
                            // but the Amplitude is controlled by the SignalGrid (which respects walls).
                            // This creates a realistic-looking interference pattern that fades correctly behind obstacles.
                            for (let i = 0; i < aps.length; i++) {
                                const ap = aps[i];
                                const dx = worldX - ap.x;
                                const dy = worldY - ap.y;
                                // Fast distance approximation (or just standard hypot)
                                const dist = Math.sqrt(dx*dx + dy*dy) / pixelsPerMeter;
                                
                                // Wave Function: sin(k*r - w*t)
                                // k = 2.5 (Wave density), w = 3 (Speed)
                                waveSum += Math.sin(dist * 2.5 - timeRef.current * 3.0);
                            }

                            // Normalize wave sum to keep it within reasonable bounds (-1 to 1 range roughly)
                            // We dampen it slightly so it doesn't overwhelm the heatmap colors
                            const normalizedWave = waveSum / (Math.sqrt(aps.length) || 1);
                            
                            // Combine with base alpha
                            // We map the wave (-1 to 1) to an alpha modifier (0.85 to 1.15)
                            const alphaMod = 0.9 + normalizedWave * 0.15;
                            const finalAlpha = Math.max(0, Math.min(255, A_BASE * alphaMod));

                            data[pixelIdx] = R;
                            data[pixelIdx + 1] = G;
                            data[pixelIdx + 2] = B;
                            data[pixelIdx + 3] = finalAlpha;
                        }
                    }

                    offCtx.putImageData(imgData, 0, 0);

                    ctx.globalCompositeOperation = 'screen';
                    ctx.imageSmoothingEnabled = true; // Smooth scaling
                    ctx.filter = 'blur(4px)'; // Soften the grid for organic look (Ekahau style)
                    ctx.drawImage(offCanvas, 0, 0, endCol * GRID_SIZE, endRow * GRID_SIZE);
                    ctx.filter = 'none'; // Reset filter
                    ctx.globalCompositeOperation = 'source-over';
                }
            }

            // Draw Scale Tool Preview
            if (isSettingScale && scaleStart && currentMousePos) {
                const dx = currentMousePos.x - scaleStart.x;
                const dy = currentMousePos.y - scaleStart.y;
                
                ctx.beginPath(); 
                ctx.moveTo(scaleStart.x, scaleStart.y); 
                ctx.lineTo(currentMousePos.x, currentMousePos.y);
                ctx.strokeStyle = '#facc15'; // Yellow
                ctx.lineWidth = 2; 
                ctx.setLineDash([5, 5]); 
                ctx.stroke(); 
                ctx.setLineDash([]);

                // Draw Length Preview
                // Use current pixelsPerMeter for estimation
                const distPixels = Math.hypot(dx, dy);
                const estMeters = (distPixels / pixelsPerMeter).toFixed(2);
                const midX = (scaleStart.x + currentMousePos.x) / 2;
                const midY = (scaleStart.y + currentMousePos.y) / 2;
                
                ctx.save();
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const text = `${estMeters}m`;
                const metrics = ctx.measureText(text);
                const bgW = metrics.width + 12;
                const bgH = 20;
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.roundRect(midX - bgW/2, midY - bgH/2, bgW, bgH, 4);
                ctx.fill();
                
                ctx.fillStyle = '#facc15';
                ctx.fillText(text, midX, midY);
                ctx.restore();
            }

            walls.forEach(w => {
                const isSelected = selectedEntity?.id === w.id;
                let strokeColor = '#94a3b8'; // Default Slate-400
                
                // Specific material colors
                if (w.material === 'concrete') strokeColor = '#525252'; // Neutral-600 (Dark Gray)
                if (w.material === 'brick') strokeColor = '#b91c1c';    // Red-700 (Brick Red)
                if (w.material === 'drywall') strokeColor = '#e5e5e5';  // Neutral-200 (Light Gray/White)
                if (w.material === 'wood') strokeColor = '#A05A2C';     // Brown
                if (w.material === 'metal') strokeColor = '#334155';    // Slate-700 (Blue-ish Dark Gray)
                if (w.material === 'glass') strokeColor = '#60a5fa';    // Blue-400 (Light Blue)

                if (isSelected) strokeColor = '#ef4444'; // Red-500 for selection (high visibility)

                ctx.beginPath();
                ctx.moveTo(w.start.x, w.start.y); ctx.lineTo(w.end.x, w.end.y);
                ctx.lineWidth = w.thickness || 12;
                ctx.strokeStyle = strokeColor;
                ctx.lineCap = 'butt'; ctx.stroke();

                if (w.material !== 'glass') {
                    ctx.beginPath(); ctx.moveTo(w.start.x, w.start.y); ctx.lineTo(w.end.x, w.end.y);
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2; ctx.stroke();
                }

                const lenMet = (Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) / pixelsPerMeter).toFixed(1);
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
                const lenMet = (Math.hypot(endX - wallStart.x, endY - wallStart.y) / pixelsPerMeter).toFixed(1);
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
                const isAnyApSelected = selectedEntity?.type === 'ap';
                
                // Dimming Effect: If any AP is selected but not this one, reduce opacity
                // This keeps focus on the selected AP's icon
                const opacity = (isAnyApSelected && !isSelected) ? 0.3 : 1.0;
                ctx.globalAlpha = opacity;

                if (isSelected) {
                    // --- Focus Mode Visuals ---
                    
                    // 1. Distance Rings (Every 5m, Enhanced Visibility)
                    const ringStep = 5 * pixelsPerMeter;
                    const maxRings = 4; // Up to 20m
                    
                    // Rings
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; // White, semi-transparent
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 5]);
                    
                    for(let i=1; i<=maxRings; i++) {
                        const r = i * ringStep;
                        ctx.beginPath();
                        ctx.arc(ap.x, ap.y, r, 0, Math.PI * 2);
                        ctx.stroke();
                        
                        // Label Background
                        const labelText = `${i*5}m`;
                        ctx.font = 'bold 10px sans-serif';
                        const metrics = ctx.measureText(labelText);
                        const bgW = metrics.width + 6;
                        const bgH = 14;
                        
                        ctx.save();
                        ctx.translate(ap.x, ap.y - r - 2);
                        
                        // Label Box
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                        ctx.fillRect(-bgW/2, -bgH, bgW, bgH);
                        
                        // Label Text
                        ctx.fillStyle = '#fff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(labelText, 0, -2);
                        
                        ctx.restore();
                    }
                    ctx.setLineDash([]);

                    // Selection Halo
                    ctx.beginPath(); ctx.arc(ap.x, ap.y, 22, 0, Math.PI * 2);
                    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([4, 2]); ctx.stroke(); ctx.setLineDash([]);
                }
                
                // Draw AP Body
                const bx = ap.x - 13, by = ap.y - 5;
                ctx.beginPath(); ctx.roundRect(bx, by, 26, 10, 2); ctx.fillStyle = '#f5f5f5'; ctx.fill();
                ctx.strokeStyle = '#525252'; ctx.lineWidth = 1.5; ctx.stroke();
                
                // LED Status
                ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(ap.x + 8, ap.y, 1, 0, Math.PI * 2); ctx.fill();
                
                // Reset Alpha
                ctx.globalAlpha = 1.0;
            });

            // Draw Devices
            devices.forEach(device => {
                const isSelected = selectedEntity?.id === device.id;
                
                // Draw Connection Line if selected
                if (isSelected) {
                    let bestAp: AccessPoint | null = null;
                    let maxSignal = -Infinity;
                    aps.forEach(ap => {
                        const sig = calculateSignalStrength(ap, device);
                        if (sig > maxSignal) {
                            maxSignal = sig;
                            bestAp = ap;
                        }
                    });

                    if (bestAp) {
                        ctx.beginPath();
                        ctx.moveTo(device.x, device.y);
                        ctx.lineTo(bestAp.x, bestAp.y);
                        ctx.strokeStyle = bestAp.color;
                        ctx.lineWidth = 2;
                        ctx.setLineDash([5, 5]);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }

                    // Selection Halo
                    ctx.beginPath();
                    ctx.arc(device.x, device.y, 18, 0, Math.PI * 2);
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // Device Icon (Simple Circle with Icon hint)
                ctx.beginPath();
                ctx.arc(device.x, device.y, 12, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.strokeStyle = isSelected ? '#2563eb' : '#64748b';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Draw Icon (Simplified as text/symbol for canvas)
                ctx.fillStyle = '#64748b';
                ctx.font = '12px "Lucida Console", Monaco, monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(device.type === 'phone' ? '📱' : '💻', device.x, device.y + 1);

                // Calculate Signal for Badge
                let maxSignal = -Infinity;
                aps.forEach(ap => {
                    const sig = calculateSignalStrength(ap, device);
                    if (sig > maxSignal) maxSignal = sig;
                });

                if (maxSignal > -Infinity) {
                    const color = getPixelColor(maxSignal);
                    const colorHex = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
                    
                    ctx.beginPath();
                    ctx.arc(device.x + 10, device.y - 10, 6, 0, Math.PI * 2);
                    ctx.fillStyle = colorHex;
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            });

            ctx.restore();
        };
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [dimensions, walls, aps, doors, devices, isDrawingWall, wallStart, currentMousePos, scale, selectedEntity, imageOpacity, isSettingScale, pixelsPerMeter, scaleStart]);

    // Helper to calculate signal strength between two points (AP and Device)
    const calculateSignalStrength = (ap: AccessPoint, device: Device): number => {
        const distPixels = Math.hypot(device.x - ap.x, device.y - ap.y);
        const distMeters = Math.max(0.1, distPixels / pixelsPerMeter);
        
        // FSPL (Free Space Path Loss)
        // 20log10(d) + 20log10(f) - 147.55 (for f in Hz)
        // For 5GHz (5000MHz): 20log10(5000) - 27.55 = ~74dB at 1m?
        // Let's use the simplified formula from worker:
        // PL = PL0 + 10 * n * log10(d)
        // PL0 @ 1m for 5GHz ~ 46dB
        // n = 3.5 (Indoor)
        const PL0 = 46;
        const n = 3.5;
        const fspl = PL0 + 10 * n * Math.log10(distMeters);

        // Wall Loss
        let wallLoss = 0;
        walls.forEach(wall => {
            // Check intersection
            const x1 = ap.x, y1 = ap.y;
            const x2 = device.x, y2 = device.y;
            const x3 = wall.start.x, y3 = wall.start.y;
            const x4 = wall.end.x, y4 = wall.end.y;

            // Denominator
            const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
            if (den === 0) return; // Parallel

            const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
            const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;

            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                // Intersect!
                const matLoss = MATERIAL_ATTENUATION[wall.material] || 0;
                wallLoss += matLoss;
            }
        });

        return ap.txPower - fspl - wallLoss;
    };

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

        {/* Scale Input Dialog */}
        {showScaleInput && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-[100] backdrop-blur-sm">
                <div className="bg-white p-4 rounded-lg shadow-xl w-72 flex flex-col gap-3">
                    <h3 className="font-bold text-sm text-slate-700">Set Real Distance</h3>
                    <p className="text-xs text-slate-500">Enter the actual length of the line you just drew in meters.</p>
                    
                    <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        autoFocus
                        value={scaleInputValue}
                        onChange={(e) => setScaleInputValue(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = parseFloat(scaleInputValue);
                                if (val > 0 && pendingScalePixels) {
                                    const newPPM = pendingScalePixels / val;
                                    setPixelsPerMeter(newPPM);
                                    setShowScaleInput(false);
                                    setPendingScalePixels(null);
                                }
                            }
                        }}
                    />

                    <div className="flex gap-2 justify-end mt-1">
                        <button
                            onClick={() => {
                                setShowScaleInput(false);
                                setPendingScalePixels(null);
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                const val = parseFloat(scaleInputValue);
                                if (val > 0 && pendingScalePixels) {
                                    const newPPM = pendingScalePixels / val;
                                    setPixelsPerMeter(newPPM);
                                    setShowScaleInput(false);
                                    setPendingScalePixels(null);
                                }
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded shadow-sm"
                        >
                            Apply Scale
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* --- Quick Action Popups --- */}
        
        {/* Wall Property Editor */}
        {selectedEntity?.type === 'wall' && popupPos && (
            <div 
                className="absolute z-50 bg-white/80 backdrop-blur-md rounded-lg shadow-lg border border-slate-200/50 p-2 flex flex-col gap-2 w-48 animate-in fade-in zoom-in duration-200"
                style={{ 
                    left: popupPos.x, 
                    top: popupPos.y - (60 * scale), // Scale the offset distance
                    transform: `translateX(-50%) scale(${Math.max(0.5, scale)})`, // Scale the popup, but clamp minimum size for readability if needed, or just allow it to shrink
                    transformOrigin: 'bottom center'
                }}
                onMouseDown={(e) => e.stopPropagation()} 
            >
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Edit Wall</span>
                    <button onClick={() => { setSelectedEntity(null); onSelectionChange(false, null); }} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-0.5"><X size={12} /></button>
                </div>
                <select 
                    className="text-xs p-1.5 border border-slate-200 rounded bg-white/50 w-full outline-none focus:ring-1 focus:ring-blue-500"
                    value={walls.find(w => w.id === selectedEntity.id)?.material}
                    onChange={(e) => {
                        const newMat = e.target.value as WallMaterial;
                        setWalls(prev => prev.map(w => w.id === selectedEntity.id ? { 
                            ...w, 
                            material: newMat,
                            thickness: newMat === 'metal' ? 20 : 12
                        } : w));
                    }}
                >
                    <option value="concrete">Concrete (-15dB)</option>
                    <option value="brick">Brick (-10dB)</option>
                    <option value="wood">Wood (-4dB)</option>
                    <option value="drywall">Drywall (-3dB)</option>
                    <option value="glass">Glass (-3dB)</option>
                    <option value="metal">Metal (-50dB)</option>
                </select>
                <button 
                    onClick={() => {
                        setWalls(prev => prev.filter(w => w.id !== selectedEntity.id));
                        setDoors(prev => prev.filter(d => d.wallId !== selectedEntity.id));
                        setSelectedEntity(null);
                        onSelectionChange(false, null);
                    }}
                    className="text-xs flex items-center justify-center gap-1 text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                >
                    <Trash2 size={12} /> Delete Wall
                </button>
            </div>
        )}

        {/* AP Property Editor */}
        {selectedEntity?.type === 'ap' && popupPos && (
            <div 
                className="absolute z-50 bg-white/80 backdrop-blur-md rounded-lg shadow-lg border border-slate-200/50 p-2 flex flex-col gap-2 w-52 animate-in fade-in zoom-in duration-200"
                style={{ 
                    left: popupPos.x, 
                    top: popupPos.y - (80 * scale), // Scale offset
                    transform: `translateX(-50%) scale(${Math.max(0.5, scale)})`,
                    transformOrigin: 'bottom center'
                }}
                onMouseDown={(e) => e.stopPropagation()} 
            >
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Edit Access Point</span>
                    <button onClick={() => { setSelectedEntity(null); onSelectionChange(false, null); }} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-0.5"><X size={12} /></button>
                </div>
                
                {/* Channel Selector */}
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">Channel</span>
                    <select 
                        className="text-xs p-1 border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500 w-24"
                        value={aps.find(a => a.id === selectedEntity.id)?.channel}
                        onChange={(e) => {
                            const newCh = parseInt(e.target.value);
                            setAps(prev => prev.map(a => a.id === selectedEntity.id ? { ...a, channel: newCh } : a));
                        }}
                    >
                        {[1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161].map(ch => (
                            <option key={ch} value={ch}>Ch {ch}</option>
                        ))}
                    </select>
                </div>

                {/* Tx Power Slider */}
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 font-medium">Tx Power</span>
                        <span className="text-[10px] font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                            {aps.find(a => a.id === selectedEntity.id)?.txPower} dBm
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                         <span className="text-[9px] text-slate-400">1</span>
                         <input 
                            type="range"
                            min="1"
                            max="30"
                            step="1"
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            value={aps.find(a => a.id === selectedEntity.id)?.txPower || 20}
                            onChange={(e) => {
                                const newTx = parseInt(e.target.value);
                                setAps(prev => prev.map(a => a.id === selectedEntity.id ? { ...a, txPower: newTx } : a));
                            }}
                        />
                        <span className="text-[9px] text-slate-400">30</span>
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-400 px-0.5">
                        <span>Low</span>
                        <span>Med</span>
                        <span>High</span>
                    </div>
                </div>

                <button 
                    onClick={() => {
                        setAps(prev => prev.filter(a => a.id !== selectedEntity.id));
                        setSelectedEntity(null);
                        onSelectionChange(false, null);
                    }}
                    className="mt-2 text-xs flex items-center justify-center gap-1 text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors w-full border border-red-100"
                >
                    <Trash2 size={12} /> Delete AP
                </button>
            </div>
        )}

        {/* Device Property Editor */}
        {selectedEntity?.type === 'device' && popupPos && (
            <div 
                className="absolute z-50 bg-white/80 backdrop-blur-md rounded-lg shadow-lg border border-slate-200/50 p-2 flex flex-col gap-2 w-48 animate-in fade-in zoom-in duration-200"
                style={{ 
                    left: popupPos.x, 
                    top: popupPos.y - (60 * scale), // Scale offset
                    transform: `translateX(-50%) scale(${Math.max(0.5, scale)})`,
                    transformOrigin: 'bottom center'
                }}
                onMouseDown={(e) => e.stopPropagation()} 
            >
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Edit Device</span>
                    <button onClick={() => { setSelectedEntity(null); onSelectionChange(false, null); }} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-0.5"><X size={12} /></button>
                </div>
                
                <div className="flex flex-col gap-2">
                    <input
                        type="text"
                        className="text-xs p-1.5 border border-slate-200 rounded bg-white/50 w-full outline-none focus:ring-1 focus:ring-blue-500"
                        value={devices.find(d => d.id === selectedEntity.id)?.name}
                        onChange={(e) => {
                            setDevices(prev => prev.map(d => d.id === selectedEntity.id ? { ...d, name: e.target.value } : d));
                        }}
                        placeholder="Device Name"
                    />

                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-500">Type</span>
                        <select 
                            className="text-xs p-1 border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500 flex-1"
                            value={devices.find(d => d.id === selectedEntity.id)?.type}
                            onChange={(e) => {
                                const newType = e.target.value as 'phone' | 'laptop';
                                setDevices(prev => prev.map(d => d.id === selectedEntity.id ? { ...d, type: newType } : d));
                            }}
                        >
                            <option value="phone">Smartphone</option>
                            <option value="laptop">Laptop</option>
                        </select>
                    </div>

                    {/* Signal Info */}
                    {(() => {
                        const dev = devices.find(d => d.id === selectedEntity.id);
                        if (!dev) return null;
                        
                        let bestAp: AccessPoint | null = null;
                        let maxSignal = -Infinity;

                        aps.forEach(ap => {
                            const sig = calculateSignalStrength(ap, dev);
                            if (sig > maxSignal) {
                                maxSignal = sig;
                                bestAp = ap;
                            }
                        });

                        if (!bestAp) return <div className="text-[10px] text-slate-400 italic text-center py-1">No Signal</div>;

                        return (
                            <div className="bg-slate-50 rounded p-1.5 flex flex-col gap-1 border border-slate-100">
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">Connected to:</span>
                                    <span className="font-medium text-blue-600">Ch {bestAp.channel}</span>
                                </div>
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-500">Signal:</span>
                                    <span className={cn(
                                        "font-bold",
                                        maxSignal > -45 ? "text-green-600" : maxSignal > -60 ? "text-yellow-600" : maxSignal > -65 ? "text-orange-500" : maxSignal > -75 ? "text-blue-500" : "text-red-600"
                                    )}>
                                        {Math.round(maxSignal)} dBm
                                    </span>
                                </div>
                            </div>
                        );
                    })()}
                </div>

                <button 
                    onClick={() => {
                        setDevices(prev => prev.filter(d => d.id !== selectedEntity.id));
                        setSelectedEntity(null);
                        onSelectionChange(false, null);
                        setDraggedDeviceId(null);
                    }}
                    className="text-xs flex items-center justify-center gap-1 text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors mt-1"
                >
                    <Trash2 size={12} /> Delete Device
                </button>
            </div>
        )}

            {hoverInfo && (
                <div
                    className="fixed pointer-events-none z-50 bg-black/80 backdrop-blur-sm border border-white/20 text-white p-2 rounded-lg shadow-xl text-xs flex flex-col gap-1"
                    style={{ left: hoverInfo.x + 15, top: hoverInfo.y + 15 }}
                >
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Signal:</span>
                        <span className={cn("font-bold", hoverInfo.dbm > -45 ? "text-green-400" : hoverInfo.dbm > -60 ? "text-yellow-400" : hoverInfo.dbm > -65 ? "text-orange-400" : hoverInfo.dbm > -75 ? "text-blue-400" : "text-red-400")}>
                            {Math.round(hoverInfo.dbm)} dBm
                        </span>
                    </div>
                    <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Dist:</span>
                        <span className="font-mono">{hoverInfo.distance.toFixed(1)}m</span>
                    </div>
                    <div className="h-1 w-full bg-gray-700 rounded-full mt-1 overflow-hidden">
                        <div
                            className={cn("h-full transition-all duration-300", hoverInfo.dbm > -45 ? "bg-green-500" : hoverInfo.dbm > -60 ? "bg-yellow-500" : hoverInfo.dbm > -65 ? "bg-orange-500" : hoverInfo.dbm > -75 ? "bg-blue-500" : "bg-red-500")}
                            style={{ width: `${Math.max(0, Math.min(100, (hoverInfo.dbm + 110) * (100 / 80)))}%` }}
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
