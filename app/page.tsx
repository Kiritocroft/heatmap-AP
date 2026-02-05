'use client';

import { useState, useRef } from 'react';
import { Toolbar } from '@/components/Toolbar';
import { HeatmapEditor, HeatmapEditorRef } from '@/components/HeatmapEditor';
import { AntennaVisualizer } from '@/components/AntennaVisualizer';
import { SignalLegend } from '@/components/SignalLegend';
import { WallMaterial } from '@/types';

type ToolType = 'select' | 'wall' | 'ap' | 'door';

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [scale, setScale] = useState(1);
  const [selectedMaterial, setSelectedMaterial] = useState<WallMaterial>('concrete');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [imageOpacity, setImageOpacity] = useState<number>(0.5);
  const [canDelete, setCanDelete] = useState(false);
  const [showAntenna, setShowAntenna] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'wall' | 'ap' | 'door', id: string } | null>(null);

  const editorRef = useRef<HeatmapEditorRef>(null);

  const handleDelete = () => {
    editorRef.current?.deleteSelected();
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear the entire canvas?')) {
      editorRef.current?.clearAll();
    }
  };

  return (
    <main className="flex h-screen w-full flex-row overflow-hidden bg-neutral-100">
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        scale={scale}
        setScale={setScale}
        selectedMaterial={selectedMaterial}
        onMaterialChange={setSelectedMaterial}
        onClearAll={handleClear}
        canDelete={canDelete}
        onDeleteSelected={handleDelete}
        onUploadImage={setBackgroundImage}
        imageOpacity={imageOpacity}
        onOpacityChange={setImageOpacity}
        selectedEntity={selectedEntity?.type || null}
        showAntenna={showAntenna}
        onToggleAntenna={() => setShowAntenna(!showAntenna)}
      />
      <div className="flex-1 flex flex-col relative shadow-inner">
        <HeatmapEditor
          ref={editorRef}
          activeTool={activeTool}
          selectedMaterial={selectedMaterial}
          scale={scale}
          onSelectionChange={(hasSel, entity) => {
            setCanDelete(hasSel);
            setSelectedEntity(entity);
            // Auto-hide antenna if deselecting AP
            if (entity?.type !== 'ap') {
              setShowAntenna(false);
            }
          }}
          backgroundImage={backgroundImage}
          imageOpacity={imageOpacity}
        />

        {/* Antenna Overlay */}
        {showAntenna && selectedEntity?.type === 'ap' && (
          <AntennaVisualizer
            ap={{ id: selectedEntity.id, x: 0, y: 0, txPower: 18 } as any}
            onClose={() => setShowAntenna(false)}
          />
        )}

        {/* Signal Legend */}
        <SignalLegend />
      </div>
    </main>
  );
}
