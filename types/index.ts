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
  swingType: 'single' | 'double';
  hinge: 'left' | 'right'; // 'left' (start-side) or 'right' (end-side)
  openDirection: 'left' | 'right'; // Relative to wall vector direction
}

export interface AccessPoint extends Point {
  id: string;
  txPower: number; // Default: 20 dBm (Aruba AP 315 Standard)
  channel: number;
  color: string;
}

// Telkomsel Corporate Standards for Material Attenuation
// Industry-Standard Values for 5GHz (High Accuracy Mode)
// Source: NIST IR 6055 & Aruba VRD
export const MATERIAL_ATTENUATION: Record<WallMaterial, number> = {
  glass: 3,      // -3 dB (Standard Clear Glass)
  drywall: 3,    // -3 dB (Hollow Drywall/Gypsum)
  wood: 4,       // -4 dB (Standard Door/Plywood)
  brick: 10,     // -10 dB (Red Brick Wall)
  concrete: 15,  // -15 dB (Standard Concrete)
  metal: 50,     // -50 dB (Effective Blocking/Faraday Cage)
};

// Physics Constants
export const DEFAULT_PIXELS_PER_METER = 40; // High Res Scale (1m = 40px)
export const SIGNAL_CUTOFF = -90;   // Industry standard "no service" threshold
export const SIGNAL_STRONG = -50;   // Excellent signal threshold
