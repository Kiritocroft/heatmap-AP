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

// Enterprise AP Database - Real World Specs (5GHz Band)
export const AP_PRESETS: Record<string, APModel> = {
  'custom': {
    id: 'custom',
    vendor: 'Custom',
    modelName: 'Manual Configuration',
    defaultTxPower: 20,
    antennaGain: 0,
    totalEIRP: 20
  },
  // --- ARUBA (HPE) ---
  'aruba-315': {
    id: 'aruba-315',
    vendor: 'Aruba',
    modelName: 'AP-315 (WiFi 5)',
    defaultTxPower: 18,
    antennaGain: 3.5,
    totalEIRP: 21.5
  },
  'aruba-515': {
    id: 'aruba-515',
    vendor: 'Aruba',
    modelName: 'AP-515 (WiFi 6)',
    defaultTxPower: 21,
    antennaGain: 4.5,
    totalEIRP: 25.5
  },
  'aruba-635': {
    id: 'aruba-635',
    vendor: 'Aruba',
    modelName: 'AP-635 (WiFi 6E)',
    defaultTxPower: 22,
    antennaGain: 5.0,
    totalEIRP: 27
  },
  // --- CISCO ---
  'cisco-9120': {
    id: 'cisco-9120',
    vendor: 'Cisco',
    modelName: 'Catalyst 9120AX',
    defaultTxPower: 23,
    antennaGain: 4,
    totalEIRP: 27
  },
  'meraki-mr46': {
    id: 'meraki-mr46',
    vendor: 'Cisco Meraki',
    modelName: 'MR46 (WiFi 6)',
    defaultTxPower: 23,
    antennaGain: 5.4,
    totalEIRP: 28.4
  },
  // --- UBIQUITI ---
  'unifi-u6-lite': {
    id: 'unifi-u6-lite',
    vendor: 'Ubiquiti',
    modelName: 'UniFi U6 Lite',
    defaultTxPower: 17,
    antennaGain: 2.8,
    totalEIRP: 19.8
  },
  'unifi-u6-pro': {
    id: 'unifi-u6-pro',
    vendor: 'Ubiquiti',
    modelName: 'UniFi U6 Pro',
    defaultTxPower: 22,
    antennaGain: 4.0,
    totalEIRP: 26
  },
  // --- RUCKUS ---
  'ruckus-r750': {
    id: 'ruckus-r750',
    vendor: 'Ruckus',
    modelName: 'R750 (High Density)',
    defaultTxPower: 22,
    antennaGain: 3, // + BeamFlex gain dynamic
    totalEIRP: 28 // Effective max
  }
};

export interface Device extends Point {
  id: string;
  type: 'phone' | 'laptop';
  name: string;
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
