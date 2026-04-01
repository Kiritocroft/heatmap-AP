# WiFi Signal Heatmap Simulator (Enterprise Standard)

A physically accurate WiFi signal propagation simulator designed for enterprise network planning. This tool simulates the coverage of **Aruba Access Point 315** and **Ubiquiti UniFi U6 Pro** in complex indoor environments, accounting for material attenuation, reflection, and diffraction.

![Preview](https://i.imgur.com/lmlYoeF.png)

## 🚀 Key Features

### 📡 Physically Accurate Simulation
-   **Propagation Model**: Uses **Dijkstra's Algorithm** (Wave Propagation) adapted for radio frequency decay (FSPL) using **Euclidean Distance** for perfect circular coverage logic.
-   **Hardware Model**: Calibrated for industry-standard 2.4GHz deployments (e.g., **Aruba AP-315**, **UniFi U6 Pro**) including adjustable Tx Power and Antenna Gain (EIRP).
-   **Antenna Pattern**: Supports **Omni & Directional** antennas with adjustable Azimuth, Beamwidth, and Front-to-Back ratio.
-   **Material Physics** (Calibrated to **NIST IR 6055** & **Aruba VRD** standards for 2.4GHz):
    -   **Glass**: -2 dB (Standard Clear)
    -   **Drywall**: -3 dB (Hollow Gypsum)
    -   **Wood**: -4 dB (Solid Wood / Door)
    -   **Brick**: -12 dB (Red Brick)
    -   **Concrete**: -18 dB (Reinforced Concrete)
    -   **Metal**: -100 dB (Effective Blocking / Faraday Cage)

### 🧮 Mathematical Model (2.4GHz Physics)
- **EIRP (Equivalent Isotropically Radiated Power)**: `Tx Power (dBm) + Antenna Gain (dBi) = EIRP (dBm)`
- **Free Space Path Loss (FSPL)**: `PL(d) = 40.0 + 28 * log10(d)` (Standard 2.4GHz Log-Distance Path Loss Model for indoor environments where n=2.8)
- **Received Signal**: `EIRP - (FSPL + Total Wall Attenuation)`
-   **Advanced Wave Physics**:
    -   **Reflection**: Implements **Image Source Method** for realistic signal bouncing off metal surfaces.
    -   **Diffraction**: Simulates signal bending around corners and through door gaps.
    -   **Shadowing**: Accurate occlusion behind thick walls.

### ⚡ High Performance
-   **Web Worker**: All heavy physics calculations (Dijkstra/Pathfinding) are offloaded to a background thread to prevent UI freezing.
-   **Optimized Rendering**: Uses **OffscreenCanvas** and **Pixel Manipulation (ImageData)** for smooth 60FPS visualization even with high-resolution grids.
-   **Binary Heap Priority Queue**: Optimized algorithm (O(log N)) for instant simulation updates.

### 🛠️ Planner Tools
-   **Autosave**: Your work is automatically saved to the browser's local storage, preventing data loss on refresh.
-   **Floorplan Upload**: Import your own layout images.
-   **Wall Drawing**: Draw walls with **Real-time Length Measurement (meters)**.
-   **Architectural Doors**: Add doors with visual **Swing Arcs** (Single/Double, Left/Right Hinge) for professional floorplan visualization.
-   **Interactive Elements**: Drag & Drop APs, Doors, and Walls.
-   **Zoom & Pan**: Infinite canvas with stable grid resolution (1m grid).

## 🔧 Technology Stack
-   **Framework**: Next.js 14 (React)
-   **Language**: TypeScript
-   **Rendering**: HTML5 Canvas API (2D Context)
-   **Styling**: Tailwind CSS
-   **State Management**: React Hooks & Refs
-   **Multithreading**: Web Workers API

## 📦 Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/Kiritocroft/heatmap-AP.git
    cd heatmap-AP
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Run the development server:
    ```bash
    npm run dev
    ```

4.  Open [http://localhost:3000](http://localhost:3000) with your browser.

## 📖 Usage Guide

1.  **Upload Floorplan**: Click "Upload Image" to use your building layout as a background.
2.  **Draw Walls**: Select "Draw Wall", choose a material (Concrete, Glass, Metal, etc.), and draw on the canvas.
    -   *Note: Metal walls will reflect signals!*
3.  **Add Access Points**: Click "Add AP" to place an Aruba AP 315.
4.  **Add Doors**: Place doors on walls. They will automatically render with architectural swing arcs.
5.  **Visualize**: The heatmap updates automatically. Red areas indicate poor signal (< -85dBm), while Green indicates excellent coverage (> -65dBm).

## 🏗️ Standards Compliance
This simulator follows the industries standards for WiFi planning:
-   **Signal Cutoff**: -90 dBm
-   **Good Signal Threshold**: -65 dBm
-   **Scale**: 1 meter = 40 pixels (High Resolution)
-   **Reference**: NIST IR 6055, Aruba Networks Validated Reference Design (VRD)

---
Developed using Next.js and Physics-based algorithms.
