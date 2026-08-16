---
name: tileweaver-performance-architect
description: Comprehensive performance audit, memory & CPU profiler, scalable architecture engine, and code optimization specialist for TileWeaver. Use to systematically inspect every project file, identify rendering bottlenecks, DOM reflow traps, memory leaks, GC pressure, scaling constraints, and generate deep out-of-the-box optimization strategies.
---

# TileWeaver Performance Architect & Code Optimization Skill

> **Usage Instruction**: Reference or activate this skill whenever you need to analyze, audit, profile, or optimize **TileWeaver** for speed, responsiveness, memory footprint, and scaling. It enforces a strict, systematic 6-phase optimization protocol to ensure buttery-smooth 60+ FPS performance even on massive maps with high layer/tileset counts.

---

## 1. Project System & Module Map

When profiling and auditing TileWeaver, inspect and evaluate performance across these core subsystems:

- **Application Entry Point & Event Wiring**: Namespace initialization, listener bindings, script bootstrapper in [`js/app.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/app.js).
- **Central State & Memory Footprint**: Core grid matrices (`mapLayers`, `passabilityGrid`, `regionGrid`), tileset registry, autotile definitions, and selection transforms in [`js/state.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/state.js).
- **Constants, Preset Enums & Lookup Tables**: Static bitmask maps, mode constants, tool slots in [`js/constants.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/constants.js).
- **Autotile & Dual-Grid Bitmask Engine**: Bitmask evaluations across 5 modes (`9slice`, `dualgrid`, `16tile`, `25tile`, `47tile`), sub-quadrant calculation overhead, terrain vertex arrays in [`js/engine/autotile.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/autotile.js).
- **Canvas Rendering & 60FPS Animation Loop**: Main viewport render loop, transform calculations, viewport culling, canvas state saves/restores, offscreen canvas usage, overlay rendering in [`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js).
- **Export, Import & Serialization Overhead**: JSON stringification, deep clones, TMJ bitwise flag conversions, high-res canvas exports in [`js/engine/exportImport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/exportImport.js).
- **Undo/Redo History Memory Footprint**: Snapshot depth, deep object serialization/cloning, garbage collection pressure during undo state pushes in [`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js).
- **UI Interaction & DOM Rendering Subsystems**:
  - Drawing Tools & High-Frequency Mouse Input: [`js/ui/tools.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tools.js)
  - Tileset Picker & Canvas Texture Cache: [`js/ui/tilesetManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tilesetManager.js)
  - Layer Stack UI & DOM Re-renders: [`js/ui/layerManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/layerManager.js)
  - Viewport Zoom, Pan & Wheel Handlers: [`js/ui/viewport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/viewport.js)
  - Autotile Wizard Modal & Sub-Canvas Preview: [`js/ui/autotileWizard.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/autotileWizard.js)
  - Tile Gameplay Properties & Event Listeners: [`js/ui/tileProperties.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tileProperties.js)
  - Material Properties UI & Palette Rerenders: [`js/ui/materialProperties.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/materialProperties.js)
  - Terrain Swatches UI: [`js/ui/terrainSwatches.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/terrainSwatches.js)
  - App Header & Status Controls: [`js/ui/header.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/header.js)
  - Toast Notifications: [`js/utils/toast.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/toast.js)
- **Markup & Layout Infrastructure**: DOM layout tree in [`index.html`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/index.html) and global styles/animations in [`css/styles.css`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/css/styles.css).

---

## 2. Mandatory 6-Phase Performance Audit Lifecycle

```
 Phase 1: Systematic File-by-File Code Inspection & Purpose Mapping
    |
    v
 Phase 2: Micro & Macro Performance Profiling (CPU, Memory, GC, DOM, Scalability)
    |
    v
 Phase 3: Industry Standard Benchmarking & Architectural Gap Analysis
    |
    v
 Phase 4: In-Depth Performance Audit Report Artifact Generation
    |  (Requires User Review & Decision)
    v
 Phase 5: Implementation Plan & Safety Audit for Selected Optimizations
    |  (Requires User Approval)
    v
 Phase 6: Code Execution, Benchmark Verification & Walkthrough
```

---

### PHASE 1: SYSTEMATIC FILE-BY-FILE CODE INSPECTION & PURPOSE MAPPING
To perform a complete audit, you **MUST inspect every file in the codebase sequentially** (do not skip any module). For each file, analyze:

1. **Functional Intended Purpose**: What is this module supposed to accomplish in the application lifecycle?
2. **Implementation Fidelity**: Is the code actually fulfilling its intended purpose correctly, or are there hidden logic bugs, unrespected settings, or ignored parameters?
3. **Execution Context & Invocation Frequency**: Where and how often is each line executed? (e.g., inside every `requestAnimationFrame` frame tick, inside `mousemove` events, upon tool selection, or only once at startup?).
4. **Data Structures & Access Overhead**: Are 2D array lookups, objects, or Maps structured optimally for $O(1)$ fast paths?

---

### PHASE 2: MICRO & MACRO PERFORMANCE PROFILING

Examine code constructs across the following critical performance vector categories:

#### A. DOM Manipulation & Layout Thrashing
- **Layout Thrashing**: Read-write-read cycles on DOM properties (e.g., querying `getBoundingClientRect()`, `offsetWidth`, `scrollTop` immediately before modifying inline styles or classes).
- **Redundant Rerenders**: Rebuilding entire DOM container elements (`innerHTML = ...` or appending children in a loop) instead of target updates, `DocumentFragment` batching, or virtualized list rendering.
- **Unbounded Event Listeners**: Accumulating event handlers or failing to detach listeners when dynamic UI components (like modals or layers) re-render.

#### B. CPU Timing Budgets & Hot Path Optimization
- **Frame Budget Overruns (> 16.6ms)**: Expensive calculations occurring inside the main `requestAnimationFrame` loop that cause frame drops or lag spikes.
- **Nested Loops & Matrix Traversals**: $O(N \times M)$ or $O(Layers \times W \times H)$ iterations over full map grids when only dirty viewport regions require updating.
- **Redundant Bitmask & Autotile Calculations**: Re-calculating 5-mode bitmasks across entire grids on every frame tick instead of memoizing or caching bitmask values on grid modification.
- **String Hashing & Key Allocations**: Constructing string keys (e.g., `${x}_${y}` or `${col},${row}`) repeatedly inside hot loops instead of bitwise combined integers (`(row << 16) | col`).

#### C. Memory Footprint & Garbage Collection (GC) Pressure
- **Hot-Loop Heap Allocations**: Allocating temporary objects (`{ x, y }`, temporary arrays, bounding box objects) inside `mousemove`, `drawTile`, or render loops, forcing frequent GC pause spikes.
- **History Snapshot Inflation**: Deep-cloning large 2D matrix arrays (`JSON.parse(JSON.stringify(...))`) on every single stroke action without delta compression or structural sharing.
- **Texture & Canvas Memory Leaks**: Retaining unused offscreen canvas instances or large image buffers without releasing references.

#### D. Scalability & Stress Factors
- **Grid Scaling**: How does performance behave as map size grows from $50 \times 50 \to 500 \times 500 \to 2000 \times 2000$?
- **Layer & Tileset Scaling**: How does performance scale with 20+ layers or hundreds of image collection tilesets?
- **Tool Flood Fill & Terrain Scaling**: Does bucket fill or terrain auto-mapping stack-overflow or freeze the main thread on large regions?

#### E. Asynchronous Integrity & Race Conditions
- **Image Load Race Conditions**: Concurrent image loading or async operations mutating global state out of order.
- **Input Throttle/Debounce Gaps**: High-frequency input events (`wheel`, `mousemove`, `resize`) missing `requestAnimationFrame` gating or proper throttling.

---

### PHASE 3: INDUSTRY STANDARD BENCHMARKING & GAP ANALYSIS

Compare TileWeaver's implementation against established industry standards in web-based 2D engine architecture (such as Tiled TMJ specs, Phaser/Pixi tilemap engines, and modern HTML5 canvas paradigms):

| Dimension | Current Pattern Audit | Industry Standard Paradigm |
| :--- | :--- | :--- |
| **Layer Data Storage** | Standard JS Arrays (`Array<Array<number\|null>>`) | TypedArrays (`Uint32Array` flat buffers with bitwise tile IDs & transform flags) |
| **Viewport Rendering** | Naive full-map or unbounded loop drawing | Viewport Bounds Culling + Offscreen Layer Canvas Caching |
| **Bitmask Recalculation** | On-the-fly recalculation during draw loops | Event-driven Dirty Region Bitmask Cache (recompute only modified 3x3 cells) |
| **Undo Stack Storage** | Full state object deep-clone serialization | Flat TypedArray delta compression or action-reversal diff logs |
| **Coordinate Hashing** | String concatenation (`"${x}_${y}"`) | Integer Bitwise packing (`(y << 16) \| x`) |
| **DOM Element Generation** | String innerHTML replacement | DocumentFragment batching, DOM reconciliation, or virtual scrolling |

---

### PHASE 4: IN-DEPTH PERFORMANCE AUDIT REPORT ARTIFACT GENERATION

Generate a comprehensive markdown artifact named `performance_audit_report.md` structured as follows:

```markdown
# Comprehensive Performance & Architectural Audit Report

## 1. Executive Summary & Health Scorecard
- Overall performance profile summary (FPS, Memory, CPU, DOM efficiency).
- Key critical bottlenecks holding back scaling and buttery-smooth user experience.

## 2. File-by-File Diagnostic Findings Matrix
For every single inspected file in the project:
- **[`path/to/file.js`](file:///path/to/file.js)**:
  - **Functional Intended Purpose**: Concise summary.
  - **Identified Issues & Bottlenecks**: (Categorized by Critical / Major / Minor).
  - **Impact Analysis**: CPU overhead, Memory allocations, DOM thrashing, or logic bugs.
  - **Clickable Line References**: [`file.js:LXX`](file:///path/to/file.js#LXX).

## 3. High-Frequency Bottlenecks & Lag Vectors
Detailed breakdown of major systemic performance issues:
- **Layout Thrashing & DOM Reflows**
- **Heap Allocations & Garbage Collection Spikes**
- **Render Loop Overheads (> 16.6ms risks)**
- **Map & Layer Scaling Bottlenecks**

## 4. Industry Standard Comparison & Benchmark Gaps
- Comparison of current architecture vs. 2D Web Engine standards (Tiled, Phaser, Pixi).

## 5. Creative "Outside-the-Box" Optimization Strategies
High-impact, innovative ideas that maintain feature intent while drastically enhancing performance:
- *Strategy 1: Flat TypedArray Layer Matrix Engine & Bitwise Flag Packing*
- *Strategy 2: Offscreen Layer Caching & Dirty Rect Viewport Rendering*
- *Strategy 3: Bitwise Spatial Hashing & Zero-Allocation Object Pools*
- *Strategy 4: Delta-Compressed Undo/Redo Buffer Stack*
```

**Gate Requirement**: Present the completed audit report artifact to the user and ask:
> *"Which optimization strategies would you like me to incorporate into a detailed Implementation Plan for execution?"*

---

### PHASE 5: IMPLEMENTATION PLAN & SAFETY AUDIT FOR OPTIMIZATIONS

Upon receiving user feedback on which optimizations to execute:
1. Create or update `implementation_plan.md` outlining exact file edits, data structure upgrades, and step-by-step code modifications.
2. Perform a mandatory Safety & Regression Audit (ensuring feature parity across Autotile 5-modes, Undo/Redo stack compatibility, Tiled TMJ export flags, layer ordering, and visual rendering).
3. Wait for explicit user review and approval before touching code.

---

### PHASE 6: CODE EXECUTION, BENCHMARK VERIFICATION & WALKTHROUGH

Upon approval:
1. Apply the optimizations atomically.
2. Test build integrity and run verification checks.
3. Generate `walkthrough.md` documenting performance improvements, visual verification steps, and benchmark comparisons.

---

## 3. Core Execution Rules
- **Thorough Inspection**: Never guess or skim. Read every file line by line to understand full intent and efficiency.
- **Empirical Rationale**: Every identified bottleneck must include exact file location references (`file.js:LXX`) and actionable root cause explanations.
- **Preserve Feature Intent**: Optimizations must increase speed and scale without compromising any feature functionality (autotiling modes, undo/redo, export formats, properties UI).
- **Clickable Links**: All file references MUST use standard Markdown clickable file links (`[basename.js](file:///path/to/basename.js#L10)`).
