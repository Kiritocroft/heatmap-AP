// --- Worker for Wave Propagation Simulation ---
// Avoids blocking the main thread during heavy Dijkstra calculations.

// --- Constants & Types (Inlined to avoid import issues) ---
const DEFAULT_PIXELS_PER_METER = 40;

const MATERIAL_ATTENUATION = {
    glass: 3,     // Transparent to RF, slightly reflective
    drywall: 5,   // Typical interior wall (Increased for realism)
    wood: 8,      // Door/Cabinet (Increased)
    brick: 20,    // Light masonry (Double standard value to force shadow)
    concrete: 35, // Structural (Significantly increased to prevent bleed-through)
    metal: 80,    // Elevators/Server Racks (Total Blockage)
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

// Priority Queue for Dijkstra's Algorithm (Binary Heap Implementation for O(log N))
class PriorityQueue {
    constructor() {
        this.heap = [];
    }

    enqueue(element, priority) {
        const node = { element, priority };
        this.heap.push(node);
        this.bubbleUp();
    }

    dequeue() {
        if (this.heap.length === 0) return undefined;
        const min = this.heap[0];
        const end = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = end;
            this.sinkDown();
        }
        return min.element;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    bubbleUp() {
        let idx = this.heap.length - 1;
        const element = this.heap[idx];
        while (idx > 0) {
            let parentIdx = Math.floor((idx - 1) / 2);
            let parent = this.heap[parentIdx];
            if (element.priority >= parent.priority) break;
            this.heap[parentIdx] = element;
            this.heap[idx] = parent;
            idx = parentIdx;
        }
    }

    sinkDown() {
        let idx = 0;
        const length = this.heap.length;
        const element = this.heap[0];
        while (true) {
            let leftChildIdx = 2 * idx + 1;
            let rightChildIdx = 2 * idx + 2;
            let leftChild, rightChild;
            let swap = null;

            if (leftChildIdx < length) {
                leftChild = this.heap[leftChildIdx];
                if (leftChild.priority < element.priority) {
                    swap = leftChildIdx;
                }
            }

            if (rightChildIdx < length) {
                rightChild = this.heap[rightChildIdx];
                if (
                    (swap === null && rightChild.priority < element.priority) ||
                    (swap !== null && rightChild.priority < leftChild.priority)
                ) {
                    swap = rightChildIdx;
                }
            }

            if (swap === null) break;
            this.heap[idx] = this.heap[swap];
            this.heap[swap] = element;
            idx = swap;
        }
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
        // For thin walls in grid, we boost the density to ensure minimum penalty
        const totalAttenuation = MATERIAL_ATTENUATION[wall.material] || 0;
        let attenuationDensity = totalAttenuation / thicknessMeters;

        // ENTERPRISE FIX: Ensure high-loss materials act as solid barriers
        // If material is concrete/brick/metal, apply a minimum density multiplier
        // This compensates for "grid skipping" or partial cell coverage
        if (['concrete', 'brick', 'metal'].includes(wall.material)) {
            attenuationDensity *= 2.0; 
        }

        // Determine drawing radius based on thickness
        // Always ensure at least 1 cell radius (3x3 block) for solid walls to prevent diagonal leakage
        const minThicknessCells = ['concrete', 'brick', 'metal'].includes(wall.material) ? 1.5 : 0.5;
        const thicknessInCells = Math.max(minThicknessCells * 2, thicknessPixels / cellSize);
        const radius = Math.ceil(thicknessInCells / 2);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;

            const baseCol = Math.floor(x / cellSize);
            const baseRow = Math.floor(y / cellSize);

            // Door Logic
            const wallDoors = doors.filter(d => d.wallId === wall.id);
            let isGap = false;
            for (const door of wallDoors) {
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

const FREQUENCY_MHZ = 5000; // 5GHz (Enterprise Standard)
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
    
    const pq = new PriorityQueue();
    
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

                // FSPL Calculation
                const PATH_LOSS_EXPONENT = 3.5;
                let fsplLoss = (10 * PATH_LOSS_EXPONENT) * Math.log10(Math.max(0.1, effectiveDist)) + CONSTANT_FSPL; 
                
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

function propagateWave(ap, walls, doors, canvasWidth, canvasHeight, cellSize = 10, pixelsPerMeter = DEFAULT_PIXELS_PER_METER) {
    const cols = Math.ceil(canvasWidth / cellSize);
    const rows = Math.ceil(canvasHeight / cellSize);
    
    const baseAttenuationGrid = buildAttenuationGrid(walls, doors, canvasWidth, canvasHeight, cellSize, pixelsPerMeter);
    
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
            frontToBackRatio: ap.frontToBackRatio
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

    if (aps && aps.length > 0) {
        aps.forEach(ap => {
            const { signalGrid, distGrid } = propagateWave(ap, walls, doors, width, height, cellSize, pixelsPerMeter);
            
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
        lastEnvironmentHash = currentEnvHash;
    }

    // 2. Prepare Final Grids
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const size = cols * rows;
    
    const finalSignalGrid = new Float32Array(size);
    const finalMinDistGrid = new Float32Array(size);
    
    finalSignalGrid.fill(-120);
    finalMinDistGrid.fill(Infinity);

    // 3. Process each requested AP (using Cache if available)
    if (aps && aps.length > 0) {
        aps.forEach(ap => {
            const apHash = getApHash(ap);
            let cached = apCache.get(ap.id);

            // Check if cache exists and is valid (properties match)
            if (!cached || cached.hash !== apHash) {
                // Cache Miss or Stale -> Calculate
                const { signalGrid, distGrid } = propagateWave(ap, walls, doors, width, height, cellSize, pixelsPerMeter);
                
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

            // Using loop unrolling or typed array methods could be faster, but simple loop is fine for now
            for (let i = 0; i < size; i++) {
                if (apSignal[i] > finalSignalGrid[i]) {
                    finalSignalGrid[i] = apSignal[i];
                    finalMinDistGrid[i] = apDist[i];
                }
            }
        });
    }

    // Return ID to validate request freshness
    self.postMessage({ 
        signalGrid: finalSignalGrid, 
        minDistGrid: finalMinDistGrid,
        rows, 
        cols, 
        id 
    });
};