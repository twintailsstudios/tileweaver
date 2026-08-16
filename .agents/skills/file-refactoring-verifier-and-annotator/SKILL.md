---
name: file-refactoring-verifier-and-annotator
description: Verifies refactored code using TileWeaver automated tests, applies rich JSDoc/inline developer annotations to the target file, and produces a final Walkthrough report with manual QA verification steps.
---

# TileWeaver Refactoring Verifier & Developer Annotator Skill

> **Usage Instruction**: Reference or invoke this skill whenever completing a code refactor in **TileWeaver**. Executes automated test suites (`npm test`, `node scripts/test_*.js`), creates new automated tests if coverage is missing, applies rich TileWeaver JSDoc annotations and inline rationale comments, and generates a structured `walkthrough_[filename].md` artifact.

---

## 1. Mandatory Empirical Verification Protocol

Run the project automated test suites:
1. **Full Test Suite**: `npm test` (Runs all 11 automated test suites; 100% pass required).
2. **Subsystem Targeted Test Suites**:
   - Asset Management & Dependency Graph $\rightarrow$ `node scripts/test_asset_management_system.js`
   - Material Swatches Studio & HUD Ribbon $\rightarrow$ `node scripts/test_material_swatches_studio.js`
   - Viewport Center-Locked Zoom $\rightarrow$ `node scripts/test_viewport_zoom.js`
   - Tileset Scroll & Ctrl-Zoom Isolation $\rightarrow$ `node scripts/test_tileset_scroll_zoom.js`
   - Tiled TMJ Export/Import & 32-Bit Transform Flags $\rightarrow$ `node scripts/test_tiled_export_import.js`
   - 1px Seam Clamping Extrusion $\rightarrow$ `node scripts/test_extruder.js`
   - Spritesheet & Collection Tilesets $\rightarrow$ `node scripts/test_collection_tileset.js` & `node scripts/test_unified_add_tileset.js`
   - UI Layout & Inspector Collapse $\rightarrow$ `node scripts/test_right_inspector_collapse.js` & `node scripts/test_tab_locking_autoswitch.js`
3. **Automated Headless Test Script Authoring Rule**:
   - If the refactored code introduces new behavior or algorithmic logic that is not currently exercised by existing scripts, author a dedicated test script `scripts/test_[feature].js` and execute it.

---

## 2. TileWeaver Developer Annotation Standard

Apply rich JSDoc and inline rationale comments directly to the target file:

### 1. File Header JSDoc
```javascript
/**
 * @fileoverview [File Name] - [Brief Purpose]
 * @subsystem [Core State / Canvas Rendering / Autotile Engine / Drawing Tools / Asset Manager / Layer Manager / History / Exporter]
 * @frameBudget [Budgeted execution cost within 16.6ms 60 FPS window]
 * @coordinateSpace [ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY]
 * @stateInvariants [Reads/Mutates window.TileWeaver.state]
 * @historyTracked [Snapshots recorded via history.pushHistoryState()]
 * @exportCompatibility [Native JSON v3.3 / Tiled TMJ 1.10+]
 */
```

### 2. Method JSDoc & Optimization / Invariant Rationale
```javascript
/**
 * [Function Purpose]
 * @param {number} mapX - Target tile column index
 * @param {number} mapY - Target tile row index
 * @returns {boolean} True if tile was updated successfully
 */

// OPTIMIZATION (60 FPS Canvas): Reusing coordinate vector to eliminate heap GC churn during pointer drag.
// INVARIANT: Coordinate clamped within (0 <= x < mapWidth && 0 <= y < mapHeight).
```

---

## 3. Walkthrough Artifact Blueprint

Generate `walkthrough_[filename].md` structured as follows:

```markdown
# 🚀 Walkthrough: Refactored [File Name]

## 1. Empirical Verification Summary
- **Status**: 🟢 Passed All Verification Gates
- **Full Test Suite**: Passed `npm test` (11/11 test scripts passed)
- **Targeted Subsystem Test**: Passed `node scripts/test_[feature].js`

### Empirical Performance & Invariant Status
| Metric / Invariant | Baseline | Refactored | Target Goal | Status |
| :--- | :--- | :--- | :--- | :--- |
| **60 FPS Render Budget** | | | $\le 16.6\text{ ms}$ | 🟢 Pass |
| **Hot-Path Allocations** | | | Zero heap allocations on mousemove | 🟢 Pass |
| **Undo/Redo History** | | | 1 snapshot per pointer stroke | 🟢 Pass |
| **Tiled TMJ Compatibility**| | | 100% roundtrip with 32-bit flags | 🟢 Pass |

## 2. Code Annotations & File Links Applied
- **Target File**: [`file.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/path/to/targetfile.js#L1-L100)
- **Applied Annotations**: TileWeaver JSDoc headers, custom `@subsystem` tags, and inline optimization/invariant comments.

## 3. Manual UI Verification Checklist
- [ ] **Canvas Rendering & Zoom**: Test center-locked zooming (0.25x to 4x) and panning with Space+Drag.
- [ ] **Tool Painting & Hotkeys**: Test Paint `[B]`, Erase `[E]`, Autotile `[A]`, Terrain `[T]`, and Material HUD slots `[1-5]`.
- [ ] **Autotile / Dual-Grid Bitmasks**: Paint autotiles and confirm neighbor corners adapt smoothly.
- [ ] **Undo / Redo ([Ctrl+Z] / [Ctrl+Y])**: Verify single-step undo per stroke without history desync.
- [ ] **Export / Import**: Export Native JSON and Tiled TMJ map; reload and verify pixel-perfect parity.
```

---

## 4. Core Execution Rules

- **Clean Up Debug Statements**: Remove temporary `console.log` statements before finalizing code.
- **Clickable Links**: All file and symbol references must use clickable markdown syntax (`[file.js](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/file.js#L10-L25)`).
- **Zero Regressions**: All 11 automated test suites in `npm test` must exit with code 0 before concluding.
