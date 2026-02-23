'use client';

import React, { DragEvent } from 'react';
import { MousePointer2, Pencil, Router, Trash2, ZoomIn, ZoomOut, Save, DoorOpen, Upload, Square, Radio, Ruler, Layers, Plus, GripVertical, RefreshCw, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WallMaterial } from '@/types';

type ToolType = 'select' | 'wall' | 'ap' | 'door' | 'scale' | 'device';

interface ToolbarProps {
    activeTool: ToolType;
    onToolChange: (tool: ToolType) => void;
    scale: number;
    setScale: (scale: number) => void;
    selectedMaterial: WallMaterial;
    onMaterialChange: (material: WallMaterial) => void;
    onUploadImage: (url: string | null) => void;
    imageOpacity: number;
    onOpacityChange: (val: number) => void;
    onClearAll: () => void;
    canDelete: boolean;
    onDeleteSelected: () => void;
    selectedEntity: 'wall' | 'ap' | 'door' | null;
    showAntenna: boolean;
    onToggleAntenna: () => void;
    
    // Multi-Floor Props
    floors: { id: string, name: string }[];
    currentFloorId: string;
    onFloorChange: (id: string) => void;
    onAddFloor: () => void;
    onDeleteFloor: (id: string) => void;
    onReorderFloors?: (dragIndex: number, hoverIndex: number) => void;
    
    // Database Props
    onSaveToDb: () => void;
    isSavingToDb: boolean;
    autoSaveDb: boolean;
    onToggleAutoSaveDb: () => void;
}

export function Toolbar({
    activeTool, onToolChange,
    scale, setScale,
    selectedMaterial, onMaterialChange,
    onClearAll, canDelete, onDeleteSelected,
    onUploadImage, imageOpacity, onOpacityChange,
    selectedEntity, showAntenna, onToggleAntenna,
    floors, currentFloorId, onFloorChange, onAddFloor, onDeleteFloor, onReorderFloors,
    onSaveToDb, isSavingToDb, autoSaveDb, onToggleAutoSaveDb
}: ToolbarProps) {

    // --- Drag & Drop ---
    const [draggedFloorIndex, setDraggedFloorIndex] = React.useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedFloorIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Make the ghost image transparent or custom if needed
        // e.dataTransfer.setDragImage(e.currentTarget, 20, 20);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        if (draggedFloorIndex === null || draggedFloorIndex === index) return;
        
        // Optimistic UI update could happen here, but for simplicity let's just trigger onDrop
        // Actually, for live reordering we might want to call onReorderFloors continuously
        // But to avoid too many updates, let's just do it on drop for now, or handle drag enter.
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
        e.preventDefault();
        if (draggedFloorIndex === null || draggedFloorIndex === targetIndex) return;
        
        if (onReorderFloors) {
            onReorderFloors(draggedFloorIndex, targetIndex);
        }
        setDraggedFloorIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedFloorIndex(null);
    };


    const tools = [
        { id: 'select', icon: MousePointer2, label: 'Select / Move' },
        { id: 'wall', icon: Square, label: 'Draw Wall' },
        { id: 'door', icon: DoorOpen, label: 'Add Door' },
        { id: 'ap', icon: Router, label: 'Add AP' },
        { id: 'device', icon: Smartphone, label: 'Add Device' },
        { id: 'scale', icon: Ruler, label: 'Set Scale' },
    ] as const;

    const materials: { id: WallMaterial, label: string }[] = [
        { id: 'concrete', label: 'Concrete (-15dB)' },
        { id: 'brick', label: 'Brick (-10dB)' },
        { id: 'wood', label: 'Wood (-4dB)' },
        { id: 'drywall', label: 'Drywall (-3dB)' },
        { id: 'glass', label: 'Glass (-3dB)' },
        { id: 'metal', label: 'Metal (-50dB)' },
    ];

    // const [saved, setSaved] = React.useState(false);

    return (
        <div className="w-72 bg-white border-r border-neutral-200 flex flex-col h-full shadow-xl z-20">
            <div className="p-5 border-b border-neutral-100">
                <h1 className="font-bold text-xl text-neutral-800 tracking-tight">WiFi Planner</h1>
                <p className="text-xs text-neutral-400 mt-1">Advanced Signal Simulation</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-8">

                {/* FLOOR SELECTOR */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Floors</label>
                        <button 
                            onClick={onAddFloor}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                            title="Add New Floor"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                    <div className="flex flex-col gap-2 relative">
                        {floors.map((floor, index) => (
                            <div 
                                key={floor.id} 
                                className={cn(
                                    "flex items-center gap-1 w-full rounded-lg transition-all duration-200 border",
                                    draggedFloorIndex === index ? "opacity-50 border-dashed border-blue-400 bg-blue-50" : "border-transparent"
                                )}
                                draggable={!!onReorderFloors}
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    // Optional: Add visual indicator of where item will drop
                                }}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                            >
                                <div className="pl-1 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500">
                                    <GripVertical size={14} />
                                </div>
                                <button
                                    onClick={() => onFloorChange(floor.id)}
                                    className={cn(
                                        "flex items-center gap-2 p-2 rounded-lg transition-all duration-200 flex-1 text-sm text-left overflow-hidden",
                                        currentFloorId === floor.id
                                            ? "bg-blue-600 text-white shadow-md"
                                            : "hover:bg-gray-100 text-gray-700"
                                    )}
                                >
                                    <Layers size={16} className="shrink-0" />
                                    <span className="truncate">{floor.name}</span>
                                    {currentFloorId === floor.id && <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0 ml-auto"></span>}
                                </button>
                                
                                {floors.length > 1 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if(confirm(`Are you sure you want to delete ${floor.name}?`)) {
                                                onDeleteFloor(floor.id);
                                            }
                                        }}
                                        className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Delete Floor"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* TOOLS */}
                <div className="space-y-3">
                    <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Tools</label>
                    <div className="grid grid-cols-1 gap-2">
                        {tools.map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <button
                                    key={tool.id}
                                    onClick={() => onToolChange(tool.id)}
                                    className={cn(
                                        "flex items-center gap-2 p-2 rounded-lg transition-all duration-200 w-full",
                                        activeTool === tool.id
                                            ? "bg-blue-600 text-white shadow-md transform scale-105"
                                            : "hover:bg-gray-100 text-gray-700 hover:scale-105"
                                    )}
                                >
                                    <Icon className="w-5 h-5" />
                                    {tool.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* MATERIAL SELECTOR (Only active when Wall tool is selected) */}
                {activeTool === 'wall' && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-300">
                        <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Wall Material</label>
                        <div className="grid grid-cols-1 gap-2">
                            {materials.map((mat) => (
                                <button
                                    key={mat.id}
                                    onClick={() => onMaterialChange(mat.id)}
                                    className={cn(
                                        "flex items-center justify-between p-2 rounded-lg text-sm w-full transition-colors",
                                        selectedMaterial === mat.id
                                            ? "bg-blue-50 text-blue-700 border border-blue-200 font-medium"
                                            : "hover:bg-gray-50 text-gray-600 border border-transparent"
                                    )}
                                >
                                    <span>{mat.label.split(' (')[0]}</span>
                                    <span className="text-xs opacity-70">{mat.label.split(' (')[1].replace(')', '')}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Floor Plan Section */}
                <div className="space-y-3">
                    <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Floor Plan</label>

                    <label className="flex items-center gap-2 w-full p-2 bg-white border border-neutral-200 rounded-lg cursor-pointer hover:bg-neutral-50 transition-colors">
                        <Upload size={16} className="text-neutral-500" />
                        <span className="text-sm text-neutral-600">Upload Image</span>
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    // Compress and convert to Base64
                                    const reader = new FileReader();
                                    reader.onload = (event) => {
                                        const img = new Image();
                                        img.onload = () => {
                                            const canvas = document.createElement('canvas');
                                            let width = img.width;
                                            let height = img.height;
                                            
                                            // Resize logic: Max dimension 1920px
                                            const MAX_DIMENSION = 1920;
                                            if (width > height) {
                                                if (width > MAX_DIMENSION) {
                                                    height *= MAX_DIMENSION / width;
                                                    width = MAX_DIMENSION;
                                                }
                                            } else {
                                                if (height > MAX_DIMENSION) {
                                                    width *= MAX_DIMENSION / height;
                                                    height = MAX_DIMENSION;
                                                }
                                            }

                                            canvas.width = width;
                                            canvas.height = height;
                                            const ctx = canvas.getContext('2d');
                                            ctx?.drawImage(img, 0, 0, width, height);
                                            
                                            // Compress to JPEG 70% quality
                                            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                                            onUploadImage(dataUrl);
                                        };
                                        img.src = event.target?.result as string;
                                    };
                                    reader.readAsDataURL(file);
                                }
                            }}
                        />
                    </label>

                    <div className="px-1">
                        <div className="flex justify-between mb-1">
                            <span className="text-[10px] text-neutral-400">Opacity</span>
                            <span className="text-[10px] text-neutral-500">{Math.round(imageOpacity * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={imageOpacity}
                            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                            className="w-full h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                    </div>
                </div>

                {/* ACTIONS */}
                <div className="space-y-3">
                    <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Database</label>

                    {/* Manual Save Button */}
                    <button
                        onClick={onSaveToDb}
                        disabled={isSavingToDb}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors border mb-2",
                            isSavingToDb 
                                ? "bg-blue-50 text-blue-600 border-blue-200 cursor-wait"
                                : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                        )}
                    >
                        {isSavingToDb ? <RefreshCw className="animate-spin w-4 h-4" /> : <Save size={16} />}
                        {isSavingToDb ? "Saving..." : "Save Project"}
                    </button>
                    
                    <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer select-none px-1">
                        <input 
                            type="checkbox" 
                            checked={autoSaveDb} 
                            onChange={onToggleAutoSaveDb}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Auto-save to Database</span>
                    </label>

                    <div className="h-px bg-neutral-100 my-2"></div>
                    
                    <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Actions</label>

                    {selectedEntity === 'ap' && (
                        <button
                            onClick={onToggleAntenna}
                            className={cn(
                                "flex items-center gap-2 p-2 rounded-lg text-sm w-full transition-colors mb-2",
                                showAntenna
                                    ? "bg-blue-600 text-white"
                                    : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                                )}
                        >
                            <Radio size={16} />
                            <span>Antenna Pattern</span>
                        </button>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={() => setScale(Math.min(3, scale + 0.1))}
                            className="flex-1 flex justify-center items-center py-2 bg-neutral-100 hover:bg-neutral-200 rounded-md text-neutral-700"
                            title="Zoom In"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setScale(Math.max(0.5, scale - 0.1))}
                            className="flex-1 flex justify-center items-center py-2 bg-neutral-100 hover:bg-neutral-200 rounded-md text-neutral-700"
                            title="Zoom Out"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setScale(1)}
                            className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-md text-xs font-mono text-neutral-600"
                        >
                            {Math.round(scale * 100)}%
                        </button>
                    </div>

                    <button
                        onClick={onDeleteSelected}
                        disabled={!canDelete}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors border",
                            canDelete
                                ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300"
                                : "border-neutral-100 text-neutral-300 cursor-not-allowed"
                            )}
                    >
                        <Trash2 size={16} />
                        Delete Selected
                    </button>

                    <button
                        onClick={onClearAll}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-neutral-200 rounded-md text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-red-600 transition-colors"
                    >
                        <Trash2 size={16} />
                        Clear All
                    </button>
                </div>

            </div>
            
            {/* Status Bar */}
            <div className="p-3 bg-neutral-50 border-t border-neutral-200 text-[10px] text-neutral-400 flex justify-between">
                <span>v1.2.0 (Telkomsel)</span>
                <span>Aruba AP-315</span>
            </div>
        </div>
    );
}
