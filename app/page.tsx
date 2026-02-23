'use client';

import { useState, useRef, useEffect } from 'react';
import { Toolbar } from '@/components/Toolbar';
import { HeatmapEditor, HeatmapEditorRef, HeatmapData } from '@/components/HeatmapEditor';
import { AntennaVisualizer } from '@/components/AntennaVisualizer';
import { SignalLegend } from '@/components/SignalLegend';
import { WallMaterial, DEFAULT_PIXELS_PER_METER } from '@/types';

type ToolType = 'select' | 'wall' | 'ap' | 'door' | 'scale' | 'device';

interface Floor {
  id: string;
  name: string;
}

interface SavedFloorState extends HeatmapData {
  backgroundImage: string | null;
  imageOpacity: number;
  scale: number;
}

export default function Home() {
  // --- Multi-Floor State ---
  const [floors, setFloors] = useState<Floor[]>([{ id: 'floor-1', name: 'Floor 1' }]);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor-1');
  const floorsDataRef = useRef<Record<string, SavedFloorState>>({});
  const [isLoaded, setIsLoaded] = useState(false); // Track if initial load is done

  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [scale, setScale] = useState(1);
  const [selectedMaterial, setSelectedMaterial] = useState<WallMaterial>('concrete');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [imageOpacity, setImageOpacity] = useState<number>(0.5);
  const [canDelete, setCanDelete] = useState(false);
  const [showAntenna, setShowAntenna] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<{ type: 'wall' | 'ap' | 'door' | 'device', id: string } | null>(null);

  // Database State
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [autoSaveDb, setAutoSaveDb] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load Autosave Preference
  useEffect(() => {
      const saved = localStorage.getItem('heatmap_autosave_db');
      if (saved) setAutoSaveDb(JSON.parse(saved));
  }, []);

  // Save Autosave Preference
  useEffect(() => {
      localStorage.setItem('heatmap_autosave_db', JSON.stringify(autoSaveDb));
  }, [autoSaveDb]);

  const editorRef = useRef<HeatmapEditorRef>(null);

  // --- Persistence Logic ---

  // 1. Load Global State (Floors List & Last Active Floor) on Mount
  useEffect(() => {
    try {
      const savedFloors = localStorage.getItem('heatmap_floors');
      const savedCurrentId = localStorage.getItem('heatmap_current_floor_id');

      if (savedFloors) {
        setFloors(JSON.parse(savedFloors));
      }
      if (savedCurrentId) {
        setCurrentFloorId(savedCurrentId);
      }
      setIsLoaded(true);
    } catch (e) {
      console.error("Failed to load global state", e);
      setIsLoaded(true);
    }
  }, []);

  const isDataLoadedRef = useRef(false);

  const loadFloorData = () => {
    if (!editorRef.current) return;

    // Reset loaded flag before loading
    isDataLoadedRef.current = false;

    // Check in-memory ref first
    let data = floorsDataRef.current[currentFloorId];
    
    // If not in memory, try localStorage
    if (!data) {
        const savedData = localStorage.getItem(`heatmap_floor_data_${currentFloorId}`);
        if (savedData) {
            data = JSON.parse(savedData);
            floorsDataRef.current[currentFloorId] = data; // Cache it
        }
    }

    if (data) {
        // Restore state
        setBackgroundImage(data.backgroundImage);
        setImageOpacity(data.imageOpacity);
        setScale(data.scale);
        // Load editor data
        editorRef.current.loadData(data);
    } else {
        // New/Empty Floor or Reset
        setBackgroundImage(null);
        setImageOpacity(0.5);
        setScale(1);
        editorRef.current.loadData({
            walls: [],
            aps: [],
            doors: [],
            pixelsPerMeter: DEFAULT_PIXELS_PER_METER
        });
    }

    // Mark as loaded ONLY after attempting load
    isDataLoadedRef.current = true;
  };

  // 2. Load Floor Data when Floor ID changes (or after initial load)
  useEffect(() => {
    if (!isLoaded) return;
    loadFloorData();
    
    // Save current active floor ID
    localStorage.setItem('heatmap_current_floor_id', currentFloorId);
  }, [currentFloorId, isLoaded]);

  // 3. Save Function (Updates Ref & LocalStorage)
  const saveCurrentFloor = () => {
    // GUARD: Do not save if editor is not ready or data hasn't been loaded yet
    // This prevents overwriting data with empty state during hot-reload/remount
    if (!editorRef.current || !isDataLoadedRef.current) return;

    setSaveStatus('saving');
    const data = editorRef.current.getData();
    
    const floorState: SavedFloorState = {
      ...data,
      backgroundImage,
      imageOpacity,
      scale
    };

    // Update Memory
    floorsDataRef.current[currentFloorId] = floorState;

    // Update LocalStorage
    try {
        localStorage.setItem(`heatmap_floor_data_${currentFloorId}`, JSON.stringify(floorState));
        setSaveStatus('saved');
        // Reset status after a delay
        setTimeout(() => setSaveStatus('idle'), 1000);
    } catch (e) {
        console.error("Failed to save to localStorage:", e);
        setSaveStatus('error');
    }
  };

  // 4. Auto-Save Interval (Every 2 seconds)
  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(() => {
        saveCurrentFloor();
    }, 2000);
    return () => clearInterval(interval);
  }, [currentFloorId, backgroundImage, imageOpacity, scale, isLoaded]);

  // 5. Save Floors List whenever it changes
  useEffect(() => {
      if (!isLoaded) return;
      localStorage.setItem('heatmap_floors', JSON.stringify(floors));
  }, [floors, isLoaded]);


  const handleFloorChange = (newFloorId: string) => {
    if (newFloorId === currentFloorId) return;

    // 1. Save current floor (Sync)
    saveCurrentFloor();

    // 2. Switch ID (Triggers useEffect to load new data)
    setCurrentFloorId(newFloorId);
  };

  const updateFloorNames = (currentFloors: Floor[]) => {
      return currentFloors.map((floor, index) => ({
          ...floor,
          name: `Floor ${index + 1}`
      }));
  };

  const handleAddFloor = () => {
    const newId = `floor-${Date.now()}`; 
    // Just add to end, renaming handles the numbers
    const newFloors = [...floors, { id: newId, name: 'Temp' }];
    const reordered = updateFloorNames(newFloors);
    
    setFloors(reordered);
    handleFloorChange(newId);
  };

  const handleDeleteFloor = (id: string) => {
    if (floors.length <= 1) return; 

    const remainingFloors = floors.filter(f => f.id !== id);
    const reordered = updateFloorNames(remainingFloors);
    setFloors(reordered);

    // If we deleted the current floor, switch to the first available one
    if (id === currentFloorId) {
        handleFloorChange(reordered[0].id);
    }

    // Cleanup storage
    delete floorsDataRef.current[id];
    localStorage.removeItem(`heatmap_floor_data_${id}`);
  };

  const handleReorderFloors = (dragIndex: number, hoverIndex: number) => {
      const newFloors = [...floors];
      const [draggedItem] = newFloors.splice(dragIndex, 1);
      newFloors.splice(hoverIndex, 0, draggedItem);
      
      const reordered = updateFloorNames(newFloors);
      setFloors(reordered);
  };


  const handleDelete = () => {
    editorRef.current?.deleteSelected();
  };

  const handleClear = () => {
    editorRef.current?.clearAll();
  };

  // --- Database Sync ---
  const saveToDatabase = async () => {
    if (!editorRef.current || !isLoaded) return;
    setIsSavingToDb(true);

    try {
        // 1. Ensure current floor is saved to memory/localStorage
        saveCurrentFloor();
        
        // 2. Prepare Payload
        const payload: Record<string, any> = {
            'heatmap_floors': floors,
            'heatmap_current_floor_id': currentFloorId,
        };

        // 3. Collect Data for ALL floors
        floors.forEach(floor => {
            const key = `heatmap_floor_data_${floor.id}`;
            let data = floorsDataRef.current[floor.id];
            
            // If not in memory, try localStorage
            if (!data) {
                const local = localStorage.getItem(key);
                if (local) {
                    try {
                        data = JSON.parse(local);
                    } catch (e) {
                        console.error("Failed to parse local data for key", key, e);
                    }
                }
            }
            
            if (data) {
                payload[key] = data;
            }
        });

        // 4. Send to API
        const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save to database');
        
    } catch (error) {
        console.error("Database Save Error:", error);
        alert("Failed to save to database! Check console for details.");
    } finally {
        setIsSavingToDb(false);
    }
  };

  // Auto-save to DB Effect
  useEffect(() => {
    if (!autoSaveDb || !isLoaded) return;

    const interval = setInterval(() => {
        saveToDatabase();
    }, 10000); // Save every 10 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveDb, isLoaded, floors, currentFloorId]); // Re-create interval if critical state changes

  return (
    <main className="flex h-screen w-full flex-row overflow-hidden bg-neutral-100">
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        scale={scale}
        setScale={setScale}
        selectedMaterial={selectedMaterial}
        onMaterialChange={setSelectedMaterial}
        onUploadImage={setBackgroundImage}
        imageOpacity={imageOpacity}
        onOpacityChange={setImageOpacity}
        onClearAll={handleClear}
        canDelete={canDelete}
        onDeleteSelected={handleDelete}
        selectedEntity={selectedEntity?.type || null}
        showAntenna={showAntenna}
        onToggleAntenna={() => setShowAntenna(!showAntenna)}
        
        floors={floors}
        currentFloorId={currentFloorId}
        onFloorChange={handleFloorChange}
        onAddFloor={handleAddFloor}
        onDeleteFloor={handleDeleteFloor}
        onReorderFloors={handleReorderFloors}

        onSaveToDb={saveToDatabase}
        isSavingToDb={isSavingToDb}
        autoSaveDb={autoSaveDb}
        onToggleAutoSaveDb={() => setAutoSaveDb(!autoSaveDb)}
      />

      {/* Auto-save Status Indicator */}
      <div className="absolute bottom-6 left-80 z-50 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-xs font-medium shadow-md border border-slate-200 pointer-events-none flex items-center gap-2 transition-all duration-300">
          {saveStatus === 'saving' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"/>}
          {saveStatus === 'saved' && <span className="w-2 h-2 rounded-full bg-green-500"/>}
          {saveStatus === 'error' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>}
          {saveStatus === 'idle' && <span className="w-2 h-2 rounded-full bg-slate-300"/>}
          
          <span className={saveStatus === 'error' ? 'text-red-600' : 'text-slate-600'}>
              {saveStatus === 'saving' ? 'Saving changes...' : 
               saveStatus === 'saved' ? 'All changes saved' : 
               saveStatus === 'error' ? 'Storage Full! Use DB Save' : 'Ready'}
          </span>
      </div>
      <div className="flex-1 flex flex-col relative shadow-inner">
        <HeatmapEditor
          ref={editorRef}
          activeTool={activeTool}
          selectedMaterial={selectedMaterial}
          scale={scale}
          onEditorReady={loadFloorData}
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
