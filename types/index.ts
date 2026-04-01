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
  name: string; // User-friendly name or Model Name
  model: string; // Key from AP_PRESETS
  txPower: number; // EIRP (Tx + Gain) in dBm
  channel: number;
  color: string;
  // Installation Properties
  height?: number; // Installation height in meters (Default: 3m)
  // Directional Antenna Properties
  isDirectional?: boolean; // If false, Omni-directional (default)
  azimuth?: number; // 0-360 degrees (0 = North/Up)
  beamwidth?: number; // 30-360 degrees (Horizontal Beamwidth)
  frontToBackRatio?: number; // dB (Attenuation for back lobe)
}

export interface APModel {
  id: string;
  vendor: string;
  modelName: string;
  defaultTxPower: number; // Base Radio Power (dBm)
  antennaGain: number; // Antenna Gain (dBi)
  totalEIRP: number; // Effective Isotropic Radiated Power (dBm) - This goes to simulation
}

// Enterprise AP Database - Real World Specs
// Data sourced from official manufacturer datasheets
export const AP_PRESETS: Record<string, APModel> = {
  'custom': {
    id: 'custom',
    vendor: 'Custom',
    modelName: 'Manual Configuration',
    defaultTxPower: 20,
    antennaGain: 0,
    totalEIRP: 20
  },
  // --- ARUBA AP-315 (802.11ac Wave 2) ---
  // Source: Aruba AP-315 Datasheet (310 Series)
  // 5GHz: 4x4 MIMO, 4 spatial streams, +18 dBm per chain, +24 dBm aggregate
  // 2.4GHz: 2x2 MIMO, 2 spatial streams, +18 dBm per chain, +21 dBm aggregate
  // Antenna Gain: 5.7 dBi (5GHz), 3.1 dBi (2.4GHz)
  // EIRP: 29 dBm (5GHz), 24.1 dBm (2.4GHz)
  'aruba-315': {
    id: 'aruba-315',
    vendor: 'Aruba',
    modelName: 'AP-315',
    defaultTxPower: 18, // 2.4GHz aggregate conducted power (2x2)
    antennaGain: 3.9,   // 2.4GHz max antenna gain
    totalEIRP: 21.9       // 18 dBm + 3.9 dBi = 21.9 dBm EIRP (2.4GHz)
  },
  // --- UBIQUITI UNIFI U6 PRO (WiFi 6) ---
  // Source: UniFi U6 Pro Datasheet
  // 5GHz: 4x4 MU-MIMO, max 26 dBm TX power, 6 dBi antenna gain
  // 2.4GHz: 2x2 MU-MIMO, max 22 dBm TX power, 4 dBi antenna gain
  // EIRP: 32 dBm (5GHz), 26 dBm (2.4GHz)
  'unifi-u6-pro': {
    id: 'unifi-u6-pro',
    vendor: 'Ubiquiti',
    modelName: 'UniFi U6 Pro',
    defaultTxPower: 22, // 2.4GHz max conducted power
    antennaGain: 4.0,   // 2.4GHz antenna gain
    totalEIRP: 26       // 22 dBm + 4 dBi = 26 dBm EIRP (2.4GHz)
  }
};

export interface Device extends Point {
  id: string;
  type: 'phone' | 'laptop';
  name: string;
}

// Enterprise Standards for Material Attenuation at 5GHz
// Sources: NIST IR 6055, Aruba VRD, Cisco Wireless Design Guide, IEEE 802.11
// Values represent dB attenuation per wall penetration at 5GHz
export const MATERIAL_ATTENUATION: Record<WallMaterial, number> = {
  glass: 2,      // -2 dB (Standard clear glass - minimal attenuation at 5GHz)
  drywall: 3,    // -3 dB (Hollow drywall/gypsum board - typical office partition)
  wood: 4,       // -4 dB (Solid wood door/cabinet - light attenuation)
  brick: 12,     // -12 dB (Red brick wall - significant attenuation)
  concrete: 18,  // -18 dB (Reinforced concrete - heavy attenuation)
  metal: 100,    // -100 dB (Metal/elevator - effectively blocks all signal)
};

// Physics Constants
export const DEFAULT_PIXELS_PER_METER = 40; // High Res Scale (1m = 40px)
export const SIGNAL_CUTOFF = -90;   // Industry standard "no service" threshold
export const SIGNAL_STRONG = -50;   // Excellent signal threshold
