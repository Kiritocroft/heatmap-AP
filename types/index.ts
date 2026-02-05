export type Point = {
  x: number;
  y: number;
};

export type WallMaterial = 'concrete' | 'brick' | 'drywall' | 'glass' | 'wood' | 'metal';

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  material: WallMaterial;
  thickness: number; // in pixels
}

export interface Door {
  id: string;
  wallId: string;
  ratio: number; // Position along the wall (0 to 1)
  width: number; // Width in pixels (default ~16px for 80cm)
}

export interface AccessPoint extends Point {
  id: string;
  txPower: number; // Default: 15 dBm (Standard Indoor AP)
  channel: number;
  color: string;
}

// Telkomsel Corporate Standards for Material Attenuation
// Industry-Standard Values for 5GHz (High Accuracy Mode)
export const MATERIAL_ATTENUATION: Record<WallMaterial, number> = {
  glass: 3,      // -3 dB (minimal loss)
  wood: 5,       // -5 dB (light partition)
  drywall: 5,    // -5 dB (same as wood)
  brick: 12,     // -12 dB (solid masonry)
  concrete: 20,  // -20 dB (thick structural walls)
  metal: 45,     // -45 dB (elevator shafts, immediate cutoff)
};

// Physics Constants
export const PIXELS_PER_METER = 40; // High Res Scale (1m = 40px)
export const SIGNAL_CUTOFF = -90;   // Industry standard "no service" threshold
export const SIGNAL_STRONG = -50;   // Excellent signal threshold
