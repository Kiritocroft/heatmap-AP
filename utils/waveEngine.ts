import { AccessPoint, Wall, Point, MATERIAL_ATTENUATION, DEFAULT_PIXELS_PER_METER, Door } from "@/types";

// --- Helper Functions ---

function getSideOfLine(a: Point, b: Point, p: Point): number {
    return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

function mirrorPointAcrossLine(point: Point, lineStart: Point, lineEnd: Point): Point {
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

// Priority Queue for Dijkstra's Algorithm
class PriorityQueue<T> {
    private items: Array<{ element: T; priority: number }> = [];

    enqueue(element: T, priority: number) {
        const item = { element, priority };
        // Insert in order (highest priority/signal first)
        let added = false;
        for (let i = 0; i < this.items.length; i++) {
            if (item.priority > this.items[i].priority) {
                this.items.splice(i, 0, item);
                added = true;
                break;
            }
        }

        if (!added) {
            this.items.push(item);
        }
    }

    dequeue(): T | undefined {
        return this.items.shift()?.element;
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }
}

// Build attenuation density grid (dB per meter)
export function buildAttenuationGrid(
    walls: Wall[],
    doors: Door[],
    width: number,
    height: number,
    cellSize: number,
    pixelsPerMeter: number = DEFAULT_PIXELS_PER_METER
): Float32Array {
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
        const steps = Math.ceil(wallLength / (cellSize / 2)); // Finer steps

        // Wall properties
        const thicknessPixels = wall.thickness || 12;
        const thicknessMeters = thicknessPixels / pixelsPerMeter;
        
        // STRICT METAL BLOCKING
        // If metal, we set a massive attenuation density that will effectively block signals
        // in a single cell step.
        // e.g., 200dB per cell step.
        const isMetal = wall.material === 'metal';
        let attenuationDensity = 0;

        if (isMetal) {
            attenuationDensity = 2000; // 2000 dB/m -> ~250dB per cell (0.125m) -> BLOCKED
        } else {
            const totalAttenuation = MATERIAL_ATTENUATION[wall.material];
            attenuationDensity = totalAttenuation / thicknessMeters;
        }

        const thicknessInCells = Math.max(1, Math.ceil(thicknessPixels / cellSize));
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;

            const baseCol = Math.floor(x / cellSize);
            const baseRow = Math.floor(y / cellSize);

            // Check for doors
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
                // Mark cells
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

// Aruba AP 315 Constants
const FREQUENCY_MHZ = 2400; // 2.4 GHz
const CONSTANT_FSPL = 20 * Math.log10(FREQUENCY_MHZ) - 27.55;
const PATH_LOSS_EXPONENT = 3.0; // Indoor Office

// Core Propagation Logic (Dijkstra)
function runDijkstra(
    startPoint: { x: number, y: number },
    startSignal: number,
    attenuationGrid: Float32Array,
    cols: number,
    rows: number,
    cellSize: number,
    pixelsPerMeter: number = DEFAULT_PIXELS_PER_METER,
    maskFn?: (c: number, r: number) => boolean
): Float32Array {
    const size = cols * rows;
    const signalGrid = new Float32Array(size);
    signalGrid.fill(-120);

    const startCol = Math.floor(startPoint.x / cellSize);
    const startRow = Math.floor(startPoint.y / cellSize);

    if (startCol < 0 || startCol >= cols || startRow < 0 || startRow >= rows) {
        return signalGrid;
    }

    const startIdx = startRow * cols + startCol;
    
    const pq = new PriorityQueue<number>();
    
    // State arrays
    const distState = new Float32Array(size); // Physical distance in meters
    distState.fill(Infinity);
    
    distState[startIdx] = 0.1; // Small initial distance
    signalGrid[startIdx] = startSignal;
    
    pq.enqueue(startIdx, startSignal);

    // Directions (8 neighbors)
    const stepSizeMeters = cellSize / pixelsPerMeter;
    const diagStepMeters = stepSizeMeters * 1.4142;
    
    const directions = [
        { dr: -1, dc: 0, dist: stepSizeMeters },      // Up
        { dr: 1, dc: 0, dist: stepSizeMeters },       // Down
        { dr: 0, dc: -1, dist: stepSizeMeters },      // Left
        { dr: 0, dc: 1, dist: stepSizeMeters },       // Right
        { dr: -1, dc: -1, dist: diagStepMeters },     // Diagonals
        { dr: -1, dc: 1, dist: diagStepMeters },
        { dr: 1, dc: -1, dist: diagStepMeters },
        { dr: 1, dc: 1, dist: diagStepMeters },
    ];

    while (!pq.isEmpty()) {
        const currentIdx = pq.dequeue()!;
        const currentSignal = signalGrid[currentIdx];
        const currentDist = distState[currentIdx];

        // Optimization: Stop if signal is too weak
        if (currentSignal <= -120) continue;

        const r = Math.floor(currentIdx / cols);
        const c = currentIdx % cols;

        for (const dir of directions) {
            const nr = r + dir.dr;
            const nc = c + dir.dc;

            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                // MASK CHECK (for reflections)
                if (maskFn && !maskFn(nc, nr)) continue;

                const newIdx = nr * cols + nc;
                
                // Calculate new signal
                // 1. New Distance
                const newDist = currentDist + dir.dist;
                
                // 2. FSPL Loss for this step (Incremental)
                // FSPL = 10 * n * log10(d) + C
                // Delta FSPL = 10 * n * log10(newDist) - 10 * n * log10(currentDist)
                const fsplLoss = (10 * PATH_LOSS_EXPONENT) * Math.log10(newDist / currentDist);
                
                // 3. Wall Loss
                const cellAttenuationDensity = attenuationGrid[newIdx];
                const wallLoss = cellAttenuationDensity * dir.dist;
                
                // 4. New Signal
                const newSignal = currentSignal - fsplLoss - wallLoss;

                if (newSignal > signalGrid[newIdx]) {
                    signalGrid[newIdx] = newSignal;
                    distState[newIdx] = newDist;
                    pq.enqueue(newIdx, newSignal);
                }
            }
        }
    }

    return signalGrid;
}

// Main Exported Function
export function propagateWave(
    ap: AccessPoint,
    walls: Wall[],
    doors: Door[],
    canvasWidth: number,
    canvasHeight: number,
    cellSize: number = 5,
    pixelsPerMeter: number = DEFAULT_PIXELS_PER_METER
): Float32Array {
    const cols = Math.ceil(canvasWidth / cellSize);
    const rows = Math.ceil(canvasHeight / cellSize);
    
    // 1. Build Base Attenuation Grid (Metal = Blocking)
    const baseAttenuationGrid = buildAttenuationGrid(walls, doors, canvasWidth, canvasHeight, cellSize, pixelsPerMeter);
    
    // 2. Main Propagation (Direct + Diffraction)
    const mainSignalGrid = runDijkstra(
        { x: ap.x, y: ap.y },
        ap.txPower - ((10 * PATH_LOSS_EXPONENT) * Math.log10(0.1) + CONSTANT_FSPL), // Init signal at 0.1m
        baseAttenuationGrid,
        cols,
        rows,
        cellSize,
        pixelsPerMeter
    );

    // 3. Reflections (Metal Only)
    const metalWalls = walls.filter(w => w.material === 'metal');
    
    if (metalWalls.length === 0) {
        return mainSignalGrid;
    }

    // Merge reflections
    for (const wall of metalWalls) {
        // A. Virtual AP Position
        const virtualAPPos = mirrorPointAcrossLine({ x: ap.x, y: ap.y }, wall.start, wall.end);
        
        // B. Check if Virtual AP is within reasonable range (30m)
        // If it's too far, reflection won't matter
        // (Skipping for now to ensure robustness)

        // C. Build Attenuation Grid WITHOUT this wall
        // We can optimize this by cloning and zeroing out this wall's cells,
        // but rebuilding is safer for correctness first.
        const reflectionAttenuationGrid = buildAttenuationGrid(
            walls.filter(w => w.id !== wall.id), 
            doors, 
            canvasWidth, 
            canvasHeight, 
            cellSize,
            pixelsPerMeter
        );

        // D. Determine Valid Side (Source Side)
        const apSide = getSideOfLine(wall.start, wall.end, { x: ap.x, y: ap.y });

        // E. Run Dijkstra for Virtual AP
        const reflectionSignalGrid = runDijkstra(
            virtualAPPos,
            ap.txPower - ((10 * PATH_LOSS_EXPONENT) * Math.log10(0.1) + CONSTANT_FSPL) - 2.2, // -2.2dB for Metal Reflection (60%)
            reflectionAttenuationGrid,
            cols,
            rows,
            cellSize,
            pixelsPerMeter,
            (c, r) => {
                // Masking: Only update cells on the SAME side as the real AP
                const cellX = c * cellSize + cellSize / 2;
                const cellY = r * cellSize + cellSize / 2;
                const cellSide = getSideOfLine(wall.start, wall.end, { x: cellX, y: cellY });
                return cellSide === apSide;
            }
        );

        // F. Merge (Power Sum)
        for (let i = 0; i < mainSignalGrid.length; i++) {
            const mainVal = mainSignalGrid[i];
            const refVal = reflectionSignalGrid[i];

            if (refVal > -120) {
                if (mainVal <= -120) {
                    mainSignalGrid[i] = refVal;
                } else {
                    // Power Sum: 10 * log10(10^(S1/10) + 10^(S2/10))
                    const p1 = Math.pow(10, mainVal / 10);
                    const p2 = Math.pow(10, refVal / 10);
                    mainSignalGrid[i] = 10 * Math.log10(p1 + p2);
                }
            }
        }
    }

    return mainSignalGrid;
}

export function getWaveColor(dbm: number): string {
    // New Standard Heatmap Colors
    if (dbm > -45) return 'rgba(255, 0, 100, 0.8)'; // Too Hot (Pink/Red)
    if (dbm > -60) return 'rgba(255, 165, 0, 0.8)'; // Excellent (Orange)
    if (dbm > -65) return 'rgba(255, 255, 0, 0.8)'; // Good (Yellow)
    if (dbm > -75) return 'rgba(34, 197, 94, 0.8)'; // Fair (Green)
    if (dbm > -85) return 'rgba(56, 189, 248, 0.8)'; // Weak (Light Blue)
    return 'rgba(0, 0, 0, 0)'; // Dead Zone
}
