import { AccessPoint, Wall, Point, MATERIAL_ATTENUATION, PIXELS_PER_METER, Door } from "@/types";
import { getIntersection, distance } from "./geometry";

// Aruba AP 315 Physics Model
const PL_D0 = 40;
const PATH_LOSS_EXPONENT = 3.0;
const FREQUENCY_MHZ = 2400;
const CONSTANT_FSPL = 20 * Math.log10(FREQUENCY_MHZ) - 27.55;

// Reflection Coefficients (Industry Standard)
const METAL_REFLECTION_COEFFICIENT = 0.6;    // 60% energy retained after bounce
const CONCRETE_REFLECTION_COEFFICIENT = 0.1; // 10% energy retained (subtle bounce)

// Helper: Distance from point to line segment
function distanceToLineSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) return distance(p, a);

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projY = a.y + t * dy;

    return Math.hypot(p.x - projX, p.y - projY);
}

// Helper: Determine which side of a line a point is on
function getSideOfLine(a: Point, b: Point, p: Point): number {
    return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

// IMAGE SOURCE METHOD: Mirror AP across metal wall
function mirrorPointAcrossLine(point: Point, lineStart: Point, lineEnd: Point): Point {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) return point;

    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / len2;
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;

    const mirrorX = 2 * projX - point.x;
    const mirrorY = 2 * projY - point.y;

    return { x: mirrorX, y: mirrorY };
}

// Calculate direct signal from AP to target with STRICT raycasting
function calculateDirectSignal(
    target: Point,
    ap: AccessPoint,
    walls: Wall[],
    doors: Door[]
): number {
    const distPixels = distance(target, { x: ap.x, y: ap.y });
    const distMeters = Math.max(0.1, distPixels / PIXELS_PER_METER);

    if (distMeters > 30) return -120; // Beyond range

    const fspl = 20 * Math.log10(distMeters) + CONSTANT_FSPL;

    // CRITICAL FIX: Additive attenuation and strict metal blocking
    let totalAttenuation = 0;

    const rayStart = { x: ap.x, y: ap.y };
    const rayEnd = target;

    // Collect ALL wall intersections along the ray
    const intersections: Array<{ wall: Wall; hit: Point; dist: number }> = [];

    for (const wall of walls) {
        const hit = getIntersection(rayStart, rayEnd, wall.start, wall.end);

        if (hit) {
            const wallLength = distance(wall.start, wall.end);
            const hitDistFromStart = distance(wall.start, hit);
            const wallDoors = doors.filter(d => d.wallId === wall.id);
            let isGap = false;

            // Check if hit is within a door gap
            for (const door of wallDoors) {
                const doorPos = door.ratio * wallLength;
                const halfWidth = door.width / 2;
                if (hitDistFromStart >= (doorPos - halfWidth) && hitDistFromStart <= (doorPos + halfWidth)) {
                    isGap = true;
                    break;
                }
            }

            if (!isGap) {
                const distToHit = distance(rayStart, hit);
                intersections.push({ wall, hit, dist: distToHit });
            }
        }
    }

    // Sort intersections by distance from AP (closest first)
    intersections.sort((a, b) => a.dist - b.dist);

    // Process each intersection in order - ADDITIVE ATTENUATION
    for (const intersection of intersections) {
        const wall = intersection.wall;

        // STRICT METAL BLOCKING: Zero leakage, immediate cutoff
        if (wall.material === 'metal') {
            return -120; // Complete block - NO signal passes through metal
        }

        // ADDITIVE ATTENUATION: Each wall adds its loss
        totalAttenuation += MATERIAL_ATTENUATION[wall.material] || 0;
    }

    const signal = ap.txPower - fspl - totalAttenuation;

    // Hard shadow for weak signals passing through walls
    if (intersections.length > 0 && signal < -85) {
        return -120; // Hard cutoff for room containment
    }

    return signal;
}

export function calculateSignalStrength(
    target: Point,
    ap: AccessPoint,
    walls: Wall[],
    doors: Door[] = []
): number {
    // FARADAY CAGE CHECK: If AP is enclosed by metal, signal cannot escape
    const metalWalls = walls.filter(w => w.material === 'metal');

    if (metalWalls.length >= 3) {
        // Check if target is outside metal enclosure
        for (const wall of metalWalls) {
            const apSide = getSideOfLine(wall.start, wall.end, { x: ap.x, y: ap.y });
            const targetSide = getSideOfLine(wall.start, wall.end, target);

            // If on opposite sides, check if wall blocks the path
            if (apSide !== targetSide && apSide !== 0 && targetSide !== 0) {
                const hit = getIntersection({ x: ap.x, y: ap.y }, target, wall.start, wall.end);
                if (hit) {
                    // Check if this is a door gap
                    const wallLength = distance(wall.start, wall.end);
                    const hitDistFromStart = distance(wall.start, hit);
                    const wallDoors = doors.filter(d => d.wallId === wall.id);
                    let isGap = false;

                    for (const door of wallDoors) {
                        const doorPos = door.ratio * wallLength;
                        const halfWidth = door.width / 2;
                        if (hitDistFromStart >= (doorPos - halfWidth) && hitDistFromStart <= (doorPos + halfWidth)) {
                            isGap = true;
                            break;
                        }
                    }

                    if (!isGap) {
                        // Target is outside Faraday cage - no signal escapes
                        return -120;
                    }
                }
            }
        }
    }

    // 1. DIRECT SIGNAL from real AP
    const directSignal = calculateDirectSignal(target, ap, walls, doors);

    // 2. IMAGE SOURCE METHOD: Calculate reflected signals from metal walls
    let maxReflectedSignal = -Infinity;

    for (const metalWall of metalWalls) {
        const virtualAP: AccessPoint = {
            ...ap,
            ...mirrorPointAcrossLine({ x: ap.x, y: ap.y }, metalWall.start, metalWall.end)
        };

        const apSide = getSideOfLine(metalWall.start, metalWall.end, { x: ap.x, y: ap.y });
        const targetSide = getSideOfLine(metalWall.start, metalWall.end, target);

        if (apSide === targetSide && apSide !== 0) {
            const virtualDistPixels = distance(target, { x: virtualAP.x, y: virtualAP.y });
            const virtualDistMeters = Math.max(0.1, virtualDistPixels / PIXELS_PER_METER);

            if (virtualDistMeters <= 30) {
                const virtualFspl = 20 * Math.log10(virtualDistMeters) + CONSTANT_FSPL;
                const virtualSignal = ap.txPower - virtualFspl;
                const reflected = virtualSignal + 10 * Math.log10(METAL_REFLECTION_COEFFICIENT);

                maxReflectedSignal = Math.max(maxReflectedSignal, reflected);
            }
        }
    }

    // 3. SIGNAL SUMMATION
    if (directSignal > -120 && maxReflectedSignal > -120) {
        const directPower = Math.pow(10, directSignal / 10);
        const reflectedPower = Math.pow(10, maxReflectedSignal / 10);
        const totalPower = directPower + reflectedPower;
        return 10 * Math.log10(totalPower);
    } else if (directSignal > -120) {
        return directSignal;
    } else if (maxReflectedSignal > -120) {
        return maxReflectedSignal;
    } else {
        return -120;
    }
}

export function getSignalColor(dBm: number, distanceMeters?: number): string {
    if (dBm < -90) return `rgba(0,0,0,0)`;

    if (distanceMeters !== undefined) {
        if (distanceMeters < 2) {
            return `rgba(0, 255, 0, 0.95)`;
        }

        if (distanceMeters < 10) {
            const t = (distanceMeters - 2) / 8;
            const r = Math.round(0 + t * 127);
            const g = 255;
            const b = 0;
            const alpha = 0.85 - t * 0.15;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        if (distanceMeters < 20) {
            const t = (distanceMeters - 10) / 10;
            const r = Math.round(127 + t * 128);
            const g = Math.round(255 - t * 90);
            const b = 0;
            const alpha = 0.70 - t * 0.15;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        if (distanceMeters < 30) {
            const t = (distanceMeters - 20) / 10;
            const r = 255;
            const g = Math.round(165 - t * 165);
            const b = 0;
            const alpha = 0.55 - t * 0.30;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        return `rgba(0,0,0,0)`;
    }

    if (dBm >= -30) return `rgba(0, 255, 0, 0.95)`;
    if (dBm >= -50) return `rgba(64, 255, 0, 0.85)`;
    if (dBm >= -60) return `rgba(127, 255, 0, 0.75)`;
    if (dBm >= -65) return `rgba(191, 255, 0, 0.70)`;
    if (dBm >= -70) return `rgba(255, 200, 0, 0.65)`;
    if (dBm >= -75) return `rgba(255, 165, 0, 0.60)`;
    if (dBm >= -80) return `rgba(255, 100, 0, 0.50)`;
    if (dBm >= -85) return `rgba(255, 50, 0, 0.40)`;
    if (dBm >= -90) return `rgba(255, 0, 0, 0.30)`;

    return `rgba(0,0,0,0)`;
}
