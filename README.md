# WiFi Signal Heatmap Simulator (Enterprise Standard)

A physically accurate WiFi signal propagation simulator designed for enterprise network planning. This tool simulates the coverage of **Aruba Access Point 315** in complex indoor environments, accounting for material attenuation, reflection, and diffraction.

![Preview](preview.png)

## 🚀 Key Features

### 📡 Physically Accurate Simulation
-   **Propagation Model**: Uses **Dijkstra's Algorithm** (Wave Propagation) adapted for radio frequency decay (FSPL) using **Euclidean Distance** for perfect circular coverage logic.
-   **Hardware Model**: Calibrated for **Aruba AP 315** (2.4GHz Band, 18dBm Tx Power, 4x4:4SS MU-MIMO, ~30m effective indoor range).
-   **Antenna Pattern**: Realistic 24-sided Azimuth/Elevation plot visualization for Aruba AP-315.
-   **Material Physics** (Calibrated to **NIST IR 6055** & **Aruba VRD** standards):
    -   **Glass**: -3 dB (Standard Clear)
    -   **Drywall**: -3 dB (Hollow Gypsum)
    -   **Wood**: -4 dB (Standard Door/Plywood)
    -   **Brick**: -10 dB (Red Brick)
    -   **Concrete**: -15 dB (Standard Structural)
    -   **Metal**: -50 dB (Effective Blocking / Faraday Cage)
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
Developed with ❤️ using Next.js and Physics-based algorithms.
