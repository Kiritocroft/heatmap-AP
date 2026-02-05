import { Point, Wall } from "@/types";

// Check if two line segments intersect
// Returns intersection point or null
export function getIntersection(
    p0: Point, p1: Point, // Line 1 (Ray)
    p2: Point, p3: Point  // Line 2 (Wall)
): Point | null {
    const s1_x = p1.x - p0.x;
    const s1_y = p1.y - p0.y;
    const s2_x = p3.x - p2.x;
    const s2_y = p3.y - p2.y;

    const s = (-s1_y * (p0.x - p2.x) + s1_x * (p0.y - p2.y)) / (-s2_x * s1_y + s1_x * s2_y);
    const t = (s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / (-s2_x * s1_y + s1_x * s2_y);

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        // Collision detected
        return {
            x: p0.x + (t * s1_x),
            y: p0.y + (t * s1_y)
        };
    }

    return null; // No collision
}

export function distance(p1: Point, p2: Point): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}
