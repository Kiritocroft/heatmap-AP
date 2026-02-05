'use client';

import React from 'react';
import { MousePointer2, Pencil, Router, Trash2, ZoomIn, ZoomOut, Save, DoorOpen, Upload, Square, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WallMaterial } from '@/types';

type ToolType = 'select' | 'wall' | 'ap' | 'door';

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
}

export function Toolbar({
    activeTool, onToolChange,
    scale, setScale,
    selectedMaterial, onMaterialChange,
    onClearAll, canDelete, onDeleteSelected,
    onUploadImage, imageOpacity, onOpacityChange,
    selectedEntity, showAntenna, onToggleAntenna
}: ToolbarProps) {

    const tools = [
        { id: 'select', icon: MousePointer2, label: 'Select / Move' },
        { id: 'wall', icon: Square, label: 'Draw Wall' },
        { id: 'door', icon: DoorOpen, label: 'Add Door' },
        { id: 'ap', icon: Router, label: 'Add AP' },
    ] as const;

    const materials: { id: WallMaterial, label: string }[] = [
        { id: 'concrete', label: 'Concrete (-20dB)' },
        { id: 'brick', label: 'Brick (-12dB)' },
        { id: 'wood', label: 'Wood (-5dB)' },
        { id: 'drywall', label: 'Drywall (-5dB)' },
        { id: 'glass', label: 'Glass (-3dB)' },
        { id: 'metal', label: 'Metal (-45dB)' },
    ];

    return (
        <div className="w-72 bg-white border-r border-neutral-200 flex flex-col h-full shadow-xl z-20">
            <div className="p-5 border-b border-neutral-100">
                <h1 className="font-bold text-xl text-neutral-800 tracking-tight">WiFi Planner</h1>
                <p className="text-xs text-neutral-400 mt-1">Advanced Signal Simulation</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-8">

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
                                    const url = URL.createObjectURL(file);
                                    onUploadImage(url);
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
                        <Trash2 className="w-4 h-4" />
                        Delete Selected
                    </button>

                    <button
                        onClick={onClearAll}
                        className="w-full text-xs text-neutral-400 hover:text-red-500 underline py-2 transition-colors"
                    >
                        Clear Canvas
                    </button>
                </div>

            </div>
        </div>
    );
}
