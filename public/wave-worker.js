// --- Worker for Wave Propagation Simulation ---
// Avoids blocking the main thread during heavy Dijkstra calculations.

// --- Constants & Types (Inlined to avoid import issues) ---
const DEFAULT_PIXELS_PER_METER = 40;

// Enterprise Standards for Material Attenuation at 2.4GHz
// Sources: NIST IR 6055, Aruba VRD, Cisco Wireless Design Guide
const MATERIAL_ATTENUATION = {
    glass: 2,     // Standard clear glass - minimal attenuation
    drywall: 3,   // Hollow drywall/gypsum - typical office partition
    wood: 3,      // Solid wood door/cabinet - light attenuation at 2.4GHz
    brick: 10,    // Red brick wall - significant attenuation at 2.4GHz
    concrete: 15, // Reinforced concrete - heavy attenuation at 2.4GHz
    metal: 100,   // Metal/elevator - effectively blocks all signal
};

// --- Helper Functions ---

function getSideOfLine(a, b, p) {
    return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

function mirrorPointAcrossLine(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) return point;

    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2;
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    return {
        x: 2 * projX - point.x,
        y: 2 * projY - point.y
    };
}

// // Priority Queue for Dijkstra's Algorithm (Typed Array Implementation for Massive Performance Boost)
class PriorityQueue {
    constructor(maxSize) {
        this.elements = new Uint32Array(maxSize);
        this.priorities = new Float32Array(maxSize);
        this.length = 0;
    }

    enqueue(element, priority) {
        let idx = this.length++;
        while (idx > 0) {
            let parentIdx = (idx - 1) >>> 1;
            let parentPriority = this.priorities[parentIdx];
            if (priority >= parentPriority) break;
            
            this.elements[idx] = this.elements[parentIdx];
            this.priorities[idx] = parentPriority;
            idx = parentIdx;
        }
        this.elements[idx] = element;
        this.priorities[idx] = priority;
    }

    dequeue() {
        if (this.length === 0) return undefined;
        const minElement = this.elements[0];
        
        const lastIdx = --this.length;
        if (lastIdx > 0) {
            const endElement = this.elements[lastIdx];
            const endPriority = this.priorities[lastIdx];
            
            let idx = 0;
            const length = this.length;
            const halfLength = length >>> 1;
            
            while (idx < halfLength) {
                let leftIdx = (idx << 1) + 1;
                let rightIdx = leftIdx + 1;
                let minIdx = leftIdx;
                let minPriority = this.priorities[leftIdx];
                
                if (rightIdx < length && this.priorities[rightIdx] < minPriority) {
                    minIdx = rightIdx;
                    minPriority = this.priorities[rightIdx];
                }

                if (endPriority <= minPriority) break;
                
                this.elements[idx] = this.elements[minIdx];
                this.priorities[idx] = minPriority;
                idx = minIdx;
            }
            this.elements[idx] = endElement;
            this.priorities[idx] = endPriority;
        }
        return minElement;
    }

    isEmpty() {
        return this.length === 0;
    }
}

// Build attenuation density grid (dB per meter) with Conservative Rasterization
function buildAttenuationGrid(walls, doors, width, height, cellSize, pixelsPerMeter) {
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const grid = new Float32Array(cols * rows);

    grid.fill(0);

    for (const wall of walls) {
        const x1 = wall.start.x;
        const y1 = wall.start.y;
        const x2 = wall.end.x;
        const y2 = wall.end.y;

        const wallLength = Math.hypot(x2 - x1, y2 - y1);
        // Oversample steps to prevent gaps (0.25 of cell size)
        const steps = Math.ceil(wallLength / (cellSize / 4));

        const thicknessPixels = wall.thickness || 12;
        const thicknessMeters = thicknessPixels / pixelsPerMeter;
        
        // Calculate Attenuation Density (dB/m)
        // For accurate simulation, we need to ensure the total attenuation is applied
        // regardless of how many cells the wall occupies
        const totalAttenuation = MATERIAL_ATTENUATION[wall.material] || 0;
        
        // Use higher density to ensure full attenuation is applied
        // The step size is (cellSize/4), so we need density that applies full loss in ~1-2 steps
        const stepSizeMeters = (cellSize / 4) / pixelsPerMeter;
        // Target: apply ~80% of attenuation per step through the wall
        let attenuationDensity = (totalAttenuation * 0.8) / stepSizeMeters;
        
        // Ensure minimum density for solid barriers
        if (wall.material === 'concrete') {
            attenuationDensity = Math.max(attenuationDensity, 200); // At least 200 dB/m
        } else if (wall.material === 'brick') {
            attenuationDensity = Math.max(attenuationDensity, 150);
        } else if (wall.material === 'metal') {
            attenuationDensity = 1000; // Complete blocker
        }

        // Determine drawing radius based on thickness
        // Always ensure at least 1 cell radius (3x3 block) for solid walls to prevent diagonal leakage
        const minThicknessCells = ['concrete', 'brick', 'metal'].includes(wall.material) ? 1.0 : 0.5;
        const thicknessInCells = Math.max(minThicknessCells * 2, thicknessPixels / cellSize);
        const radius = Math.ceil(thicknessInCells / 2);

        // Pre-filter doors for this specific wall to avoid doing it inside the geometry loop
        const wallDoors = doors.filter(d => d.wallId === wall.id);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;

            const baseCol = Math.floor(x / cellSize);
            const baseRow = Math.floor(y / cellSize);

            // Door Logic 
            let isGap = false;
            for (let j = 0; j < wallDoors.length; j++) {
                const door = wallDoors[j];
                const doorPos = door.ratio * wallLength;
                const distAlongWall = t * wallLength;
                const halfWidth = door.width / 2;
                if (distAlongWall >= (doorPos - halfWidth) && distAlongWall <= (doorPos + halfWidth)) {
                    isGap = true;
                    break;
                }
            }

            if (!isGap) {
                // Draw a solid block around the point
                for (let dr = -radius; dr <= radius; dr++) {
                    for (let dc = -radius; dc <= radius; dc++) {
                        const r = baseRow + dr;
                        const c = baseCol + dc;

                        if (r >= 0 && r < rows && c >= 0 && c < cols) {
                            const idx = r * cols + c;
                            // Use MAX to keep the strongest barrier
                            grid[idx] = Math.max(grid[idx], attenuationDensity);
                        }
                    }
                }
            }
        }
    }

    return grid;
}

// --- Physics Constants (2.4GHz Enterprise WiFi) ---
const FREQUENCY_MHZ = 2400; // 2.4GHz (Enterprise Standard)
const WAVELENGTH_M = 299792458 / (FREQUENCY_MHZ * 1000000); // ~0.125m

// Log-Distance Path Loss Model Constants
// Reference: "Wireless Communications" by Andrea Goldsmith, IEEE 802.11 standards
const PL_D0_2_4GHZ = 40.05; // Path loss at 1m for 2.4GHz (free space reference)
const PATH_LOSS_EXPONENT = 3.0; // Indoor office environment (2.7-3.5 typical range)

// Standard FSPL formula: PL(d) = 20*log10(d) + 20*log10(f) - 27.55
// For 2.4GHz at distance d (meters): PL(d) = 20*log10(d) + 40.05
const CONSTANT_FSPL = 20 * Math.log10(FREQUENCY_MHZ) - 27.55;

function runDijkstra(startPoint, startSignal, attenuationGrid, cols, rows, cellSize, pixelsPerMeter, maskFn, antennaProps = {}) {
    const size = cols * rows;
    const signalGrid = new Float32Array(size);
    const distGrid = new Float32Array(size); // Store distances for animation
    
    signalGrid.fill(-120);
    distGrid.fill(Infinity);

    const startCol = Math.floor(startPoint.x / cellSize);
    const startRow = Math.floor(startPoint.y / cellSize);

    if (startCol < 0 || startCol >= cols || startRow < 0 || startRow >= rows || Number.isNaN(startCol) || Number.isNaN(startRow)) {
        return { signalGrid, distGrid };
    }

    const startIdx = startRow * cols + startCol;
    
    const pq = new PriorityQueue(size);
    
    // State now tracks MINIMUM TOTAL LOSS (Signal Strength Inverted)
    // We want to minimize (FSPL + WallLoss + DirectionalLoss) => Maximize Signal
    const totalLossState = new Float32Array(size);
    totalLossState.fill(Infinity);
    
    // We also need to track the components that made up this loss to propagate correctly
    const wallLossState = new Float32Array(size);
    const distState = new Float32Array(size);
    
    wallLossState[startIdx] = 0; 
    distState[startIdx] = 0;
    totalLossState[startIdx] = 0;
    
    signalGrid[startIdx] = startSignal;
    distGrid[startIdx] = 0;
    
    // Priority is TOTAL LOSS (FSPL + Wall)
    pq.enqueue(startIdx, 0);

    const stepSizeMeters = cellSize / pixelsPerMeter;
    const diagStepMeters = stepSizeMeters * 1.4142;
    
    const directions = [
        { dr: -1, dc: 0, dist: stepSizeMeters },
        { dr: 1, dc: 0, dist: stepSizeMeters },
        { dr: 0, dc: -1, dist: stepSizeMeters },
        { dr: 0, dc: 1, dist: stepSizeMeters },
        { dr: -1, dc: -1, dist: diagStepMeters },
        { dr: -1, dc: 1, dist: diagStepMeters },
        { dr: 1, dc: -1, dist: diagStepMeters },
        { dr: 1, dc: 1, dist: diagStepMeters },
    ];

    // Pre-calculate Antenna properties if directional
    const isDirectional = antennaProps.isDirectional;
    // Normalize azimuth to 0-360, then convert to radians. 
    // 0 deg = North (Up) -> -PI/2 in math atan2 (which is usually East=0)
    // Actually, in screen coords: 
    // 0 deg (Up) = -Y direction.
    // 90 deg (Right) = +X direction.
    // 180 deg (Down) = +Y direction.
    // 270 deg (Left) = -X direction.
    // atan2(y, x) returns: East=0, South=PI/2, West=PI, North=-PI/2
    // So to match 0=North, we need to adjust.
    // Let's stick to standard math angle for calculation: 
    // Target Angle = atan2(dy, dx)
    // Azimuth (User Input 0=N, 90=E) needs conversion to Math Angle.
    // 0(N) -> -PI/2
    // 90(E) -> 0
    // 180(S) -> PI/2
    // 270(W) -> PI
    // Formula: MathAngle = (Azimuth - 90) * PI / 180
    const azimuthRad = ((antennaProps.azimuth || 0) - 90) * (Math.PI / 180);
    const halfBeamRad = ((antennaProps.beamwidth || 360) / 2) * (Math.PI / 180);
    const frontToBackRatio = antennaProps.frontToBackRatio || 20; // dB

    while (!pq.isEmpty()) {
        const currentIdx = pq.dequeue();
        const currentTotalLoss = totalLossState[currentIdx];
        
        // If we found a better path to this node already, skip
        if (currentTotalLoss > totalLossState[currentIdx]) continue;

        const currentWallLoss = wallLossState[currentIdx];
        const currentDist = distState[currentIdx];
        const currentSignal = signalGrid[currentIdx];

        if (currentSignal <= -120) continue;
        
        const r = Math.floor(currentIdx / cols);
        const c = currentIdx % cols;

        for (const dir of directions) {
            const nr = r + dir.dr;
            const nc = c + dir.dc;

            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                if (maskFn && !maskFn(nc, nr)) continue;

                const newIdx = nr * cols + nc;
                const cellAttenuationDensity = attenuationGrid[newIdx];
                
                // Calculate new state components
                const additionalWallLoss = cellAttenuationDensity * dir.dist;
                const newWallLoss = currentWallLoss + additionalWallLoss;
                const newDist = currentDist + dir.dist;
                
                // Calculate new Total Loss
                const safeDist = Math.max(0.1, newDist);
                
                // Hybrid Distance Calculation for Visual Realism
                const dx = (nc * cellSize + cellSize/2) - startPoint.x;
                const dy = (nr * cellSize + cellSize/2) - startPoint.y;
                const directDist = Math.sqrt(dx*dx + dy*dy) / pixelsPerMeter;
                
                const ratio = (newDist / Math.max(0.01, directDist));
                
                let effectiveDist = newDist;
                if (ratio < 1.1) {
                    effectiveDist = directDist;
                }

                // FSPL Calculation using Log-Distance Path Loss Model
                // PL(d) = PL(d0) + 10*n*log10(d/d0) where d0 = 1m
                // For 2.4GHz: PL(1m) = 40.05 dB, n = 3.0 (indoor office)
                let fsplLoss = PL_D0_2_4GHZ + (10 * PATH_LOSS_EXPONENT) * Math.log10(Math.max(1.0, effectiveDist)); 
                
                // --- DIRECTIONAL ANTENNA LOGIC ---
                if (isDirectional) {
                    const angleToTarget = Math.atan2(dy, dx); // -PI to PI
                    
                    // Calculate smallest difference between angles
                    let angleDiff = Math.abs(angleToTarget - azimuthRad);
                    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                    
                    if (angleDiff > halfBeamRad) {
                        // Outside beamwidth -> Apply attenuation
                        // Simple step function for now, or linear roll-off
                        // For Enterprise accuracy, we should use a specific pattern, but step + slight slope is okay for general sim
                        fsplLoss += frontToBackRatio; 
                    }
                }

                const newTotalLoss = fsplLoss + newWallLoss;

                if (newTotalLoss < totalLossState[newIdx]) {
                    totalLossState[newIdx] = newTotalLoss;
                    wallLossState[newIdx] = newWallLoss;
                    distState[newIdx] = newDist;
                    
                    const newSignal = startSignal - newTotalLoss;

                    signalGrid[newIdx] = newSignal;
                    distGrid[newIdx] = safeDist;
                    
                    pq.enqueue(newIdx, newTotalLoss);
                }
            }
        }
    }

    return { signalGrid, distGrid };
}

function propagateWave(ap, walls, doors, canvasWidth, canvasHeight, cellSize, pixelsPerMeter, baseAttenuationGrid) {
    const cols = Math.ceil(canvasWidth / cellSize);
    const rows = Math.ceil(canvasHeight / cellSize);
    
    // Main Signal
    let { signalGrid: mainSignalGrid, distGrid: mainDistGrid } = runDijkstra(
        { x: ap.x, y: ap.y },
        ap.txPower, 
        baseAttenuationGrid,
        cols,
        rows,
        cellSize,
        pixelsPerMeter,
        null,
        // Pass Antenna Props
        {
            isDirectional: ap.isDirectional,
            azimuth: ap.azimuth,
            beamwidth: ap.beamwidth,
            frontToBackRatio: ap.frontToBackRatio,
            height: ap.height || 3
        }
    );

    const metalWalls = walls.filter(w => w.material === 'metal');
    
    if (metalWalls.length > 0) {
        // Optimization: Sort metal walls by distance to AP and limit reflections
        const sortedMetalWalls = metalWalls.map(w => {
            const A = w.start.x - ap.x;
            const B = w.start.y - ap.y;
            const C = w.end.x - w.start.x;
            const D = w.end.y - w.start.y;
            
            const dot = A * C + B * D;
            const len_sq = C * C + D * D;
            let param = -1;
            if (len_sq !== 0) param = -dot / len_sq;
            
            let xx, yy;
            if (param < 0) {
                xx = w.start.x; yy = w.start.y;
            } else if (param > 1) {
                xx = w.end.x; yy = w.end.y;
            } else {
                xx = w.start.x + param * C;
                yy = w.start.y + param * D;
            }
            
            const dx = ap.x - xx;
            const dy = ap.y - yy;
            return { wall: w, distSq: dx * dx + dy * dy };
        }).sort((a, b) => a.distSq - b.distSq);

        const MAX_REFLECTIONS = 6;
        const wallsToProcess = sortedMetalWalls.slice(0, MAX_REFLECTIONS).map(item => item.wall);

        for (const wall of wallsToProcess) {
            const virtualAPPos = mirrorPointAcrossLine({ x: ap.x, y: ap.y }, wall.start, wall.end);
            
            const reflectionAttenuationGrid = buildAttenuationGrid(
                walls.filter(w => w.id !== wall.id), 
                doors, 
                canvasWidth, 
                canvasHeight, 
                cellSize,
                pixelsPerMeter
            );

            const apSide = getSideOfLine(wall.start, wall.end, { x: ap.x, y: ap.y });

            const { signalGrid: reflectionSignalGrid, distGrid: reflectionDistGrid } = runDijkstra(
                virtualAPPos,
                ap.txPower, 
                reflectionAttenuationGrid,
                cols,
                rows,
                cellSize,
                pixelsPerMeter,
                (c, r) => {
                    const x = c * cellSize;
                    const y = r * cellSize;
                    return getSideOfLine(wall.start, wall.end, { x, y }) === apSide;
                },
                // Reflections generally inherit directional properties but mirrored
                // For simplicity, we assume reflections are "diffused" enough or just treat as Omni for now
                // implementing directional reflection is complex (virtual AP needs mirrored azimuth).
                // Let's keep reflections simple (Omni) or just skip directional logic for them to avoid confusion.
                // Or better: pass isDirectional: false to force Omni reflection (safe bet).
                { isDirectional: false } 
            );

            for (let i = 0; i < mainSignalGrid.length; i++) {
                if (reflectionSignalGrid[i] > mainSignalGrid[i]) {
                    mainSignalGrid[i] = reflectionSignalGrid[i];
                    mainDistGrid[i] = reflectionDistGrid[i];
                }
            }
        }
    }

    return { signalGrid: mainSignalGrid, distGrid: mainDistGrid };
}

function computeCompositeHeatmap(aps, walls, doors, width, height, cellSize, pixelsPerMeter = DEFAULT_PIXELS_PER_METER) {
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const size = cols * rows;
    
    const finalSignalGrid = new Float32Array(size);
    const finalMinDistGrid = new Float32Array(size);
    
    finalSignalGrid.fill(-120);
    finalMinDistGrid.fill(Infinity);

    const dummyBaseAttenuationGrid = buildAttenuationGrid(walls, doors, width, height, cellSize, pixelsPerMeter);
    if (aps && aps.length > 0) {
        aps.forEach(ap => {
            const { signalGrid, distGrid } = propagateWave(ap, walls, doors, width, height, cellSize, pixelsPerMeter, dummyBaseAttenuationGrid);
            
            for (let i = 0; i < size; i++) {
                if (signalGrid[i] > finalSignalGrid[i]) {
                    finalSignalGrid[i] = signalGrid[i];
                    finalMinDistGrid[i] = distGrid[i];
                }
            }
        });
    }

    return { 
        signalGrid: finalSignalGrid, 
        minDistGrid: finalMinDistGrid,
        rows,
        cols 
    };
}

// --- Caching Variables ---
const apCache = new Map(); // Key: apId, Value: { hash: string, signalGrid: Float32Array, distGrid: Float32Array }
let lastEnvironmentHash = "";
let cachedBaseAttenuationGrid = null;

// Helper to create a simple hash for environment (walls, doors, dimensions)
function getEnvironmentHash(walls, doors, width, height, cellSize, pixelsPerMeter) {
    return JSON.stringify({ 
        w: walls.length, 
        d: doors.length, 
        dim: [width, height, cellSize, pixelsPerMeter],
        // Sample first/last elements to catch changes without full deep stringify if possible, 
        // but for safety full stringify is better or a custom lighter hash.
        // Given the complexity, full stringify of critical props is safest for now.
        // Optimization: We can rely on React's immutability if passed props change ref, 
        // but worker receives copies. Let's use JSON.stringify for now, it's fast enough for these array sizes.
        walls: walls.map(w => [w.id, w.start, w.end, w.material, w.thickness]),
        doors: doors.map(d => [d.id, d.wallId, d.ratio, d.width])
    });
}

// Helper to create hash for AP properties
function getApHash(ap) {
    return JSON.stringify({
        x: ap.x,
        y: ap.y,
        p: ap.txPower,
        h: ap.height || 3, // Include height in hash
        dir: ap.isDirectional,
        az: ap.azimuth,
        bw: ap.beamwidth,
        fb: ap.frontToBackRatio
    });
}

self.onmessage = (e) => {
    const data = e.data;

    if (data.type === 'WARMUP') {
        // Run a tiny dummy simulation to force JIT compilation
        const dummyAp = { x: 0, y: 0, txPower: 18 };
        computeCompositeHeatmap([dummyAp], [], [], 100, 100, 10, DEFAULT_PIXELS_PER_METER);
        return;
    }

    const { id, aps, walls, doors, width, height, cellSize, pixelsPerMeter } = data;

    // 1. Check Environment Cache
    const currentEnvHash = getEnvironmentHash(walls, doors, width, height, cellSize, pixelsPerMeter);
    
    if (currentEnvHash !== lastEnvironmentHash) {
        // Environment changed (walls moved, added, etc) -> INVALIDATE ALL CACHE
        apCache.clear();
        cachedBaseAttenuationGrid = buildAttenuationGrid(walls, doors, width, height, cellSize, pixelsPerMeter);
        lastEnvironmentHash = currentEnvHash;
    }

    // 2. Prepare Final Grids
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const size = cols * rows;
    
    const finalSignalGrid = new Float32Array(size);
    const finalMinDistGrid = new Float32Array(size);
    const bestApIndexGrid = new Int32Array(size); // Tracks which AP provides strongest signal
    
    finalSignalGrid.fill(-120);
    finalMinDistGrid.fill(Infinity);
    bestApIndexGrid.fill(-1);

    // Prepare arrays for channel power accumulation (for Interference calculation)
    const channelPowerGrids = new Map();
    if (aps && aps.length > 0) {
        const activeChannels = new Set(aps.map(ap => ap.channel || 6));
        activeChannels.forEach(ch => {
            const grid = new Float64Array(size); // Float64 to avoid overflow with high mW
            grid.fill(0);
            channelPowerGrids.set(ch, grid);
        });
    }

    // 3. Process each requested AP (using Cache if available)
    if (aps && aps.length > 0) {
        aps.forEach((ap, apIndex) => {
            const apHash = getApHash(ap);
            let cached = apCache.get(ap.id);

            // Check if cache exists and is valid (properties match)
            if (!cached || cached.hash !== apHash) {
                // Cache Miss or Stale -> Calculate
                const { signalGrid, distGrid } = propagateWave(ap, walls, doors, width, height, cellSize, pixelsPerMeter, cachedBaseAttenuationGrid);
                
                // Save to Cache
                cached = {
                    hash: apHash,
                    signalGrid,
                    distGrid
                };
                apCache.set(ap.id, cached);
            }

            // Merge into Final Grid (Max Composition)
            const apSignal = cached.signalGrid;
            const apDist = cached.distGrid;
            const chGrid = channelPowerGrids.get(ap.channel || 6);

            for (let i = 0; i < size; i++) {
                const signal = apSignal[i];
                if (signal > -120) {
                    // Accumulate Channel Power (mW)
                    const powerMw = Math.pow(10, signal / 10);
                    chGrid[i] += powerMw;

                    if (signal > finalSignalGrid[i]) {
                        finalSignalGrid[i] = signal;
                        finalMinDistGrid[i] = apDist[i];
                        bestApIndexGrid[i] = apIndex;
                    }
                }
            }
        });
    }

    // 4. Compute SINR (Signal-to-Interference-plus-Noise Ratio)
    const sinrGrid = new Float32Array(size);
    sinrGrid.fill(-100);
    const noiseFloorMw = Math.pow(10, -95 / 10); // Noise Floor (-95 dBm)

    if (aps && aps.length > 0) {
        for (let i = 0; i < size; i++) {
            const maxSignal = finalSignalGrid[i];
            const bestIndex = bestApIndexGrid[i];
            
            if (maxSignal > -120 && bestIndex !== -1) {
                const bestAp = aps[bestIndex];
                const ch = bestAp.channel || 6;
                const totalChannelPower = channelPowerGrids.get(ch)[i];
                const maxSignalMw = Math.pow(10, maxSignal / 10);
                
                const interferenceMw = totalChannelPower - maxSignalMw;
                const totalInterferenceAndNoiseMw = interferenceMw + noiseFloorMw;
                
                const sinrDb = maxSignal - (10 * Math.log10(totalInterferenceAndNoiseMw));
                sinrGrid[i] = sinrDb;
            }
        }
    }

    // Return ID to validate request freshness
    self.postMessage({ 
        signalGrid: finalSignalGrid, 
        minDistGrid: finalMinDistGrid,
        bestApIndexGrid,
        sinrGrid,
        rows, 
        cols, 
        id 
    });
};