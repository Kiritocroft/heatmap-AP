import React from 'react';
import { CoverageStats } from '@/utils/coverageAnalysis';
import { AccessPoint, Wall } from '@/types';

interface ExportDialogProps {
    aps: AccessPoint[];
    walls: Wall[];
    coverage: CoverageStats;
    frequency: string;
    onClose: () => void;
    onExport: () => void;
}

export function ExportDialog({ aps, walls, coverage, frequency, onClose, onExport }: ExportDialogProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-2xl p-6 max-w-2xl w-full mx-4">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-neutral-800">Coverage Report</h2>
                    <button
                        onClick={onClose}
                        className="text-neutral-500 hover:text-neutral-700 text-2xl"
                    >
                        ×
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Network Info */}
                    <div className="bg-neutral-50 p-4 rounded-lg">
                        <h3 className="font-semibold text-neutral-700 mb-2">Network Configuration</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>Frequency: <span className="font-mono">{frequency}</span></div>
                            <div>Access Points: <span className="font-mono">{aps.length}</span></div>
                            <div>Walls: <span className="font-mono">{walls.length}</span></div>
                        </div>
                    </div>

                    {/* Coverage Stats */}
                    <div>
                        <h3 className="font-semibold text-neutral-700 mb-3">Coverage Statistics</h3>
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="w-24 text-sm text-neutral-600">Excellent</div>
                                <div className="flex-1 bg-neutral-200 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="bg-green-500 h-full flex items-center justify-end px-2"
                                        style={{ width: `${coverage.excellentPercent}%` }}
                                    >
                                        <span className="text-xs font-bold text-white">
                                            {coverage.excellentPercent.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-24 text-sm text-neutral-600">Good</div>
                                <div className="flex-1 bg-neutral-200 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="bg-yellow-500 h-full flex items-center justify-end px-2"
                                        style={{ width: `${coverage.goodPercent}%` }}
                                    >
                                        <span className="text-xs font-bold text-white">
                                            {coverage.goodPercent.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-24 text-sm text-neutral-600">Weak</div>
                                <div className="flex-1 bg-neutral-200 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="bg-orange-500 h-full flex items-center justify-end px-2"
                                        style={{ width: `${coverage.weakPercent}%` }}
                                    >
                                        <span className="text-xs font-bold text-white">
                                            {coverage.weakPercent.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-24 text-sm text-neutral-600">No Signal</div>
                                <div className="flex-1 bg-neutral-200 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="bg-neutral-400 h-full flex items-center justify-end px-2"
                                        style={{ width: `${coverage.deadPercent}%` }}
                                    >
                                        <span className="text-xs font-bold text-white">
                                            {coverage.deadPercent.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                            <div className="text-sm font-semibold text-blue-900">
                                Total Usable Coverage: {(coverage.excellentPercent + coverage.goodPercent).toFixed(1)}%
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t">
                        <button
                            onClick={onExport}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                        >
                            📄 Download Report (.txt)
                        </button>
                        <button
                            onClick={onClose}
                            className="px-6 py-3 border border-neutral-300 hover:bg-neutral-50 rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
