// --- Worker for Wave Propagation Simulation ---
// Avoids blocking the main thread during heavy Dijkstra calculations.

// --- Constants & Types (Inlined to avoid import issues) ---
const PIXELS_PER_METER = 40;

const MATERIAL_ATTENUATION = {
    glass: 3,
    wood: 5,
    drywall: 5,
    brick: 12,
    concrete: 20,
    metal: 45,
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
function buildAttenuationGrid(walls, doors, width, height, cellSize) {
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
        const thicknessMeters = thicknessPixels / PIXELS_PER_METER;
        
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

const FREQUENCY_MHZ = 2400; 
const CONSTANT_FSPL = 20 * Math.log10(FREQUENCY_MHZ) - 27.55;

function runDijkstra(startPoint, startSignal, attenuationGrid, cols, rows, cellSize, maskFn) {
    const size = cols * rows;
    const signalGrid = new Float32Array(size);
    signalGrid.fill(-120);

    const startCol = Math.floor(startPoint.x / cellSize);
    const startRow = Math.floor(startPoint.y / cellSize);

    if (startCol < 0 || startCol >= cols || startRow < 0 || startRow >= rows) {
        return signalGrid;
    }

    const startIdx = startRow * cols + startCol;
    
    const pq = new PriorityQueue();
    
    const distState = new Float32Array(size);
    distState.fill(Infinity);
    
    distState[startIdx] = 0.1; 
    signalGrid[startIdx] = startSignal;
    
    pq.enqueue(startIdx, -startSignal);

    const stepSizeMeters = cellSize / PIXELS_PER_METER;
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
        const currentSignal = signalGrid[currentIdx];
        const currentDist = distState[currentIdx];

        if (currentSignal <= -120) continue;

        const r = Math.floor(currentIdx / cols);
        const c = currentIdx % cols;

        for (const dir of directions) {
            const nr = r + dir.dr;
            const nc = c + dir.dc;

            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                if (maskFn && !maskFn(nc, nr)) continue;

                const newIdx = nr * cols + nc;
                
                const newDist = currentDist + dir.dist;
                const fsplLoss = 20 * Math.log10(newDist / currentDist);
                const cellAttenuationDensity = attenuationGrid[newIdx];
                const wallLoss = cellAttenuationDensity * dir.dist;
                const newSignal = currentSignal - fsplLoss - wallLoss;

                if (newSignal > signalGrid[newIdx]) {
                    signalGrid[newIdx] = newSignal;
                    distState[newIdx] = newDist;
                    pq.enqueue(newIdx, -newSignal);
                }
            }
        }
    }

    return signalGrid;
}

function propagateWave(ap, walls, doors, canvasWidth, canvasHeight, cellSize = 5) {
    const cols = Math.ceil(canvasWidth / cellSize);
    const rows = Math.ceil(canvasHeight / cellSize);
    
    const baseAttenuationGrid = buildAttenuationGrid(walls, doors, canvasWidth, canvasHeight, cellSize);
    
    const mainSignalGrid = runDijkstra(
        { x: ap.x, y: ap.y },
        ap.txPower - (20 * Math.log10(0.1) + CONSTANT_FSPL), 
        baseAttenuationGrid,
        cols,
        rows,
        cellSize
    );

    const metalWalls = walls.filter(w => w.material === 'metal');
    
    if (metalWalls.length === 0) {
        return mainSignalGrid;
    }

    for (const wall of metalWalls) {
        const virtualAPPos = mirrorPointAcrossLine({ x: ap.x, y: ap.y }, wall.start, wall.end);
        
        const reflectionAttenuationGrid = buildAttenuationGrid(
            walls.filter(w => w.id !== wall.id), 
            doors, 
            canvasWidth, 
            canvasHeight, 
            cellSize
        );

        const apSide = getSideOfLine(wall.start, wall.end, { x: ap.x, y: ap.y });

        const reflectionSignalGrid = runDijkstra(
            virtualAPPos,
            ap.txPower - (20 * Math.log10(0.1) + CONSTANT_FSPL) - 2.2, 
            reflectionAttenuationGrid,
            cols,
            rows,
            cellSize,
            (c, r) => {
                const cellX = c * cellSize + cellSize / 2;
                const cellY = r * cellSize + cellSize / 2;
                const cellSide = getSideOfLine(wall.start, wall.end, { x: cellX, y: cellY });
                return cellSide === apSide;
            }
        );

        for (let i = 0; i < mainSignalGrid.length; i++) {
            const mainVal = mainSignalGrid[i];
            const refVal = reflectionSignalGrid[i];

            if (refVal > -120) {
                if (mainVal <= -120) {
                    mainSignalGrid[i] = refVal;
                } else {
                    const p1 = Math.pow(10, mainVal / 10);
                    const p2 = Math.pow(10, refVal / 10);
                    mainSignalGrid[i] = 10 * Math.log10(p1 + p2);
                }
            }
        }
    }

    return mainSignalGrid;
}

// --- Message Handler ---
self.onmessage = function(e) {
    const { aps, walls, doors, width, height, cellSize } = e.data;

    if (!aps || aps.length === 0) {
        self.postMessage({ signalGrid: null, minDistGrid: null, rows: 0, cols: 0 });
        return;
    }

    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const size = cols * rows;

    const combinedGrid = new Float32Array(size);
    const minDistGrid = new Float32Array(size);
    combinedGrid.fill(-120);
    minDistGrid.fill(Infinity);

    for (const ap of aps) {
        const waveGrid = propagateWave(ap, walls, doors, width, height, cellSize);

        for (let i = 0; i < size; i++) {
            const existing = combinedGrid[i];
            const newSignal = waveGrid[i];

            if (newSignal > -120) {
                if (existing <= -120) {
                    combinedGrid[i] = newSignal;
                } else {
                    const p1 = Math.pow(10, existing / 10);
                    const p2 = Math.pow(10, newSignal / 10);
                    combinedGrid[i] = 10 * Math.log10(p1 + p2);
                }

                const r = Math.floor(i / cols);
                const c = i % cols;
                const px = c * cellSize + cellSize / 2;
                const py = r * cellSize + cellSize / 2;
                const dist = Math.hypot(px - ap.x, py - ap.y) / PIXELS_PER_METER;
                if (dist < minDistGrid[i]) minDistGrid[i] = dist;
            }
        }
    }

    self.postMessage({
        signalGrid: combinedGrid,
        minDistGrid: minDistGrid,
        rows,
        cols
    }, [combinedGrid.buffer, minDistGrid.buffer]); // Transferable objects
};
