// --- Worker for Wave Propagation Simulation ---
// Avoids blocking the main thread during heavy Dijkstra calculations.

// --- Constants & Types (Inlined to avoid import issues) ---
const DEFAULT_PIXELS_PER_METER = 40;

const MATERIAL_ATTENUATION = {
    glass: 3,   // Transparent to RF, slightly reflective
    drywall: 4, // Typical interior wall
    wood: 6,    // Door/Cabinet
    brick: 10,  // Light masonry
    concrete: 15, // Structural
    metal: 40,  // Elevators/Server Racks (Blocks signal)
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

// Build attenuation density grid (dB per meter)
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
        const steps = Math.ceil(wallLength / (cellSize / 2));

        const thicknessPixels = wall.thickness || 12;
        const thicknessMeters = thicknessPixels / pixelsPerMeter;
        
        const isMetal = wall.material === 'metal';
        let attenuationDensity = 0;

        if (isMetal) {
            attenuationDensity = 2000; 
        } else {
            const totalAttenuation = MATERIAL_ATTENUATION[wall.material] || 0;
            attenuationDensity = totalAttenuation / thicknessMeters;
        }

        const thicknessInCells = Math.max(1, Math.ceil(thicknessPixels / cellSize));
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;

            const baseCol = Math.floor(x / cellSize);
            const baseRow = Math.floor(y / cellSize);

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
                const radius = Math.floor(thicknessInCells / 2);
                for (let dr = -radius; dr <= radius; dr++) {
                    for (let dc = -radius; dc <= radius; dc++) {
                        const r = baseRow + dr;
                        const c = baseCol + dc;

                        if (r >= 0 && r < rows && c >= 0 && c < cols) {
                            const idx = r * cols + c;
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

function runDijkstra(startPoint, startSignal, attenuationGrid, cols, rows, cellSize, pixelsPerMeter, maskFn) {
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
    // We want to minimize (FSPL + WallLoss) => Maximize Signal
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

    while (!pq.isEmpty()) {
        const currentIdx = pq.dequeue();
        const currentTotalLoss = totalLossState[currentIdx];
        
        // If we found a better path to this node already, skip
        // Note: Floating point comparison, use epsilon if needed, but < check is usually fine
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
                
                // Hybrid Distance Calculation for Visual Realism (Circle vs Octagon)
                // If the path distance is very close to Euclidean distance (Line of Sight),
                // use Euclidean distance to ensure perfect circles in open space.
                // Otherwise (diffraction/bending), use the accumulated path distance.
                
                const dx = (nc * cellSize + cellSize/2) - startPoint.x;
                const dy = (nr * cellSize + cellSize/2) - startPoint.y;
                const directDist = Math.sqrt(dx*dx + dy*dy) / pixelsPerMeter;
                
                // Ratio of Path / Direct. 
                // Grid path (Chebyshev/Octagonal) is at most ~1.08x longer than Euclidean in 8-way grid.
                // If ratio is small, we are likely in Line-Of-Sight.
                const ratio = (newDist / Math.max(0.01, directDist));
                
                let effectiveDist = newDist;
                if (ratio < 1.1) {
                    effectiveDist = directDist;
                }

                // FSPL = 20log10(d) + 20log10(f) + K
                // Refactored to Log-Distance Path Loss Model for High Density (n = 3.5)
                // PL = PL0 + 10 * n * log10(d)
                // n = 3.5 (Indoor Office / Obstacles) -> 10 * 3.5 = 35
                // PL0 = CONSTANT_FSPL (Loss at 1m, approx 40dB for 2.4GHz)
                const PATH_LOSS_EXPONENT = 3.5;
                const fsplLoss = (10 * PATH_LOSS_EXPONENT) * Math.log10(Math.max(0.1, effectiveDist)) + CONSTANT_FSPL; 
                
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
        pixelsPerMeter
    );

    const metalWalls = walls.filter(w => w.material === 'metal');
    
    if (metalWalls.length > 0) {
        // Optimization: Sort metal walls by distance to AP and limit reflections
        // This prevents exponential slowdown if user draws many metal segments
        const sortedMetalWalls = metalWalls.map(w => {
            // Distance from AP to line segment
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

        // Limit to 6 closest metal walls for reflection calculations
        const MAX_REFLECTIONS = 6;
        const wallsToProcess = sortedMetalWalls.slice(0, MAX_REFLECTIONS).map(item => item.wall);

        for (const wall of wallsToProcess) {
            const virtualAPPos = mirrorPointAcrossLine({ x: ap.x, y: ap.y }, wall.start, wall.end);
            
            // Rebuilding attenuation grid is costly but necessary for correct reflection masking
            // Optimization: If we have many walls, we could clone the base grid and just "erase" the metal wall
            // But for now, with GRID_SIZE=10, rebuilding is acceptable.
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
                    // Only allow reflection on the SAME side as the AP
                    return getSideOfLine(wall.start, wall.end, { x, y }) === apSide;
                }
            );

            // Merge Reflection
            for (let i = 0; i < mainSignalGrid.length; i++) {
                if (reflectionSignalGrid[i] > mainSignalGrid[i]) {
                    mainSignalGrid[i] = reflectionSignalGrid[i];
                    mainDistGrid[i] = reflectionDistGrid[i]; // Update distance for wave animation
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

self.onmessage = (e) => {
    const data = e.data;

    if (data.type === 'WARMUP') {
        // Run a tiny dummy simulation to force JIT compilation of the heavy functions
        const dummyAp = { x: 0, y: 0, txPower: 18 };
        const dummyWalls = [];
        const dummyDoors = [];
        // Small 10x10 grid
        computeCompositeHeatmap([dummyAp], dummyWalls, dummyDoors, 100, 100, 10, DEFAULT_PIXELS_PER_METER);
        return;
    }

    const { id, aps, walls, doors, width, height, cellSize, pixelsPerMeter } = data;

    const result = computeCompositeHeatmap(aps, walls, doors, width, height, cellSize, pixelsPerMeter);
    
    // Return ID to validate request freshness
    self.postMessage({ ...result, id });
};