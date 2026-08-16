---
name: file-performance-health-auditor
description: Performs an in-depth performance, 60 FPS frame-budget, canvas 2D overdraw, memory GC, DOM reflow, and code maintainability audit of a target file in TileWeaver. Integrates with automated test scripts and browser profiling standards to generate prioritized refactoring reports.
---

# TileWeaver Performance, Rendering & Health Auditor Skill

> **Usage Instruction**: Reference or invoke this skill whenever auditing a file in **TileWeaver** for 60 FPS rendering bottlenecks, canvas 2D overdraw, heap allocations / GC pauses in hot mousemove loops, state snapshot memory footprint, DOM layout thrashing, or code tech debt. Generates a structured `performance_audit_[filename].md` report with benchmark measurements and prioritized diffs.

---

## 1. TileWeaver Performance & Architecture Standards

When auditing a file in TileWeaver, evaluate against these core browser performance standards:

- **60 FPS Canvas Render Loop Budget**: 60 FPS = **16.6ms total frame budget** ([`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js)). Functions executed inside `requestAnimationFrame` or triggered by pointer move events must execute in sub-millisecond windows.
- **Viewport Frustum Culling & Overdraw**: Canvas rendering must cull non-visible grid cells outside the current viewport bounds:
  $$\text{startX} = \max\left(0, \left\lfloor \frac{-\text{panX}}{\text{tileSize} \cdot \text{zoom}} \right\rfloor\right), \quad \text{endX} = \min\left(\text{mapWidth}, \left\lceil \frac{\text{canvasWidth} - \text{panX}}{\text{tileSize} \cdot \text{zoom}} \right\rceil\right)$$
  Avoid repeated `ctx.save()` / `ctx.restore()`, font parsing, or color string formatting in inner cell loops.
- **Hot-Path Zero-Allocation Rule**: Brush painting, continuous drag strokes, and autotile hover previews must not instantiate temporary objects, array literals, or closures in mouse event handlers to prevent Garbage Collection (GC) stutters.
- **Sub-Pixel Seams & Extrusion Integrity**: Tile drawing coordinates must use integer pixel snapping or 1px extruded textures ([`js/engine/extruder.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/extruder.js)) to eliminate floating-point bilinear texture bleeding seams.
- **History Snapshot Coalescing & Memory Clamping**: Map mutations during continuous pointer drag must coalesce into a single history snapshot recorded on `pointerup` ([`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js)). Depth must be strictly clamped to `MAX_HISTORY = 50`.
- **DOM Layout Thrashing Elimination**: Avoid interleaving style reads (`getBoundingClientRect()`, `offsetWidth`) with style writes inside UI resize, zoom, or drag listeners.
- **Automated Test Suite & Verification Mapping**:
  - Full Application Test Suite $\rightarrow$ `npm test`
  - Viewport Pan & Center-Locked Zoom $\rightarrow$ `node scripts/test_viewport_zoom.js`
  - Tileset Scrolling & Zoom Isolation $\rightarrow$ `node scripts/test_tileset_scroll_zoom.js`
  - Spritesheet & Collection Tilesets $\rightarrow$ `node scripts/test_collection_tileset.js` & `node scripts/test_unified_add_tileset.js`
  - Tiled TMJ Export/Import Integrity $\rightarrow$ `node scripts/test_tiled_export_import.js`
  - Extruder 1px Seam Clamping $\rightarrow$ `node scripts/test_extruder.js`
  - Asset Management System & Dependency Graph $\rightarrow$ `node scripts/test_asset_management_system.js`
  - Material Swatches Studio & HUD Ribbon $\rightarrow$ `node scripts/test_material_swatches_studio.js`
  - Inspector Collapse & UI Layout $\rightarrow$ `node scripts/test_right_inspector_collapse.js` & `node scripts/test_tab_locking_autoswitch.js`

---

## 2. Mandatory 4-Axis Audit Checklist

### Axis 1: Canvas 2D Rendering & 60 FPS Budget
- **Frustum Culling**: Does the code restrict rendering and coordinate math to visible tiles within viewport bounds?
- **Canvas State Churn**: Does the file invoke excessive `ctx.save()` / `ctx.restore()`, font re-parsing, or color string allocations inside inner tile iteration loops?
- **Dirty-Rect / Repaint Throttling**: Are tool hover previews, grid overlays, or selection stamps efficiently redrawn without triggering expensive global layer re-compositing?
- **Sub-Pixel Seams**: Are canvas coordinates rendered using integer pixel alignments or extruded tile textures to eliminate bilinear interpolation bleeding seams?

### Axis 2: Memory Allocations, GC Pauses & Algorithmic Complexity
- **Hot Loop Heap Allocations**: Are temporary vectors, bitmask arrays, or coordinate objects allocated during `onMouseMove`, brush strokes, or render loops?
- **Autotile Recalculation Bounding**: Are autotile/dual-grid updates bounded to touched cells and their immediate neighbors ($\pm 1$), or do they trigger wasteful whole-map scans?
- **Flood Fill & Geometry Safety**: Does bucket fill or line drawing use iterative queues/typed arrays to eliminate call stack overflow risks?

### Axis 3: State Mutation Invariants & History Stack Safety
- **History Snapshot Efficiency**: Does the code record history snapshots cleanly without duplicate snapshots during continuous pointer drags?
- **Memory Clamping**: Does the state store or history stack enforce strict depth limits (`MAX_HISTORY = 50`) to prevent memory leaks on large maps (100x100+ with 10+ layers)?
- **Array Bounds & Coordinate Safety**: Are 2D matrix lookups `layer.data[y][x]` protected against out-of-bounds, negative coordinates, or undefined layer structures?

### Axis 4: DOM Performance, UI Responsiveness & DX Tech Debt
- **Layout Thrashing**: Are DOM queries cached or decoupled from style writes in UI event listeners?
- **Asset / Tileset Virtualization**: Are large sprite sheets and multi-asset collections managed efficiently without overloading the browser DOM?
- **Coupling & Modularity**: Is the file cleanly decoupled from unrelated subsystems, using [`js/state.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/state.js) as the single source of truth?

---

## 3. Performance & Health Audit Report Blueprint

Generate a markdown artifact titled `performance_audit_[filename].md` structured as follows:

```markdown
# ⚡ Performance & Health Audit: [File Name]

## 1. Executive Summary & Health Score
- **Overall Health Score**: 🟢 Good / 🟡 Moderate Risk / 🔴 Critical Bottleneck
- **60 FPS Render Budget Impact**: Estimated $\mu\text{s}$ per frame window (< 16.6ms).
- **Large Map Scalability Rating**: Assessment for $100\times100+$ maps with $5+$ active layers.
- **Memory & GC Footprint**: Low / Moderate / High (Heap churn during active drawing).

## 2. Canvas Context & Hot-Path Metric Profiling
| Profiling Metric | Observed Pattern | Performance Standard | Status |
| :--- | :--- | :--- | :--- |
| **Viewport Frustum Culling** | Culled to visible viewport | Clamped to visible bounding box | 🟢 Pass |
| **`ctx.save()` / `restore()` in Inner Loops** | 0 calls in cell loop | $\le 1$ call per layer | 🟢 Pass |
| **Hot Path Pointer Allocations** | Vector re-used | Zero allocations per mousemove | 🟢 Pass |
| **History Snapshot Coalescing** | Coalesced on `pointerup` | 1 snapshot per stroke | 🟢 Pass |

## 3. Prioritized Issue Breakdown

### P0: Critical Blockers (Frame Freezes / Canvas Jank / Memory Leaks)
- **Location**: `functionName()` ([`file.js:LXX-LYY`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/path/to/file.js#LXX-LYY))
- **Impact**: Detailed explanation of frame drop, stack overflow, or memory leak mechanism.
- **Proposed Fix (Code Diff)**:
  ```diff
  - // Unoptimized pattern (e.g. allocating objects inside hot mousemove loop)
  + // Optimized pattern (e.g. cached reusable vector / integer-bounded lookup)
  ```

### P1: High GC Churn / Canvas Overdraw / DOM Reflows
- Breakdown of redundant canvas state saves, unbounded autotile updates, or unthrottled DOM measurements.

### P2: DX & Maintainability Tech Debt
- Opportunities for modular decoupling, DRY helper refactoring, and code clarity.

## 4. Benchmark Verification & Test Suite
- **Automated Test Command**: `npm test`
- **Specific Subsystem Test**: e.g. `node scripts/test_viewport_zoom.js` ([`scripts/test_viewport_zoom.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/scripts/test_viewport_zoom.js)).
```

---

## 4. Core Execution Rules

- **Empirical Diagnostics**: Base performance ratings on exact code analysis, hot-path inspection, and automated test script verification.
- **Clickable Links**: All file and symbol references must use clickable markdown syntax (`[file.js](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/file.js#L10-L25)`).
- **Web & Canvas Focus**: Keep audits laser-focused on browser 2D canvas rendering, 60 FPS animation loops, zero-allocation hot paths, and deterministic state updates.
