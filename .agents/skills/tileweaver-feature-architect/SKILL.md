---
name: tileweaver-feature-architect
description: Comprehensive tile mapping feature architect, autotile/terrain specialist, visual map tool designer, safety auditor, and developer annotation engine for building new features in TileWeaver.
---

# TileWeaver Feature Architect & Tile Domain Innovation Skill

> **Usage Instruction**: Reference or activate this skill whenever you want to design, build, and implement a brand new feature, drawing tool, autotile mode, dual-grid terrain system, procedural map generator, or export format in **TileWeaver** (e.g. *"I want to create a new smart cliff-builder tool that auto-generates multi-level height layers and drop shadows"*). It enforces an 8-phase lifecycle from deep codebase research and tile domain brainstorming to concept reports, safety audits, execution, verification walkthroughs, troubleshooting handoffs, and developer code annotations.

---

## 1. Project Architecture & Tile Domain Reference Map

When designing and building new features for TileWeaver, keep these core modules, data structures, and tile mapping fundamentals in mind:

- **Application Bootstrapper**: Namespace initialization (`window.TileWeaver`), state store bootstrapping, canvas 2D context setup, history callbacks, UI module listeners, and animation loop start in [`js/app.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/app.js).
- **Central Reactive Application State Store**: Single source of truth for grid dimensions (`TILE_SIZE`, `mapWidth`, `mapHeight`), viewport scale/pan (`zoomLevel`, `panX`, `panY`), layer stack (`mapLayers`), passability grid (`passabilityGrid`), region grid (`regionGrid`), tilesets (`tilesets`), autotiles (`autotiles`), animated tiles (`animatedTiles`), selected stamp transform (`selectedStamp`, `stampTransform`), and wizard state in [`js/state.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/state.js).
- **Constants & Lookup Tables**: Tile size constants, max history depth, tool IDs, preset autotile layout definitions, and bitmask slot lookup maps (`MODE_SLOTS`) in [`js/constants.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/constants.js).
- **Autotiling & Dual-Grid Bitmask Engine**:
  - **Autotile Fundamentals**: 5 engine modes (`9slice` 3x3 outer block, `dualgrid` 4-corner vertex, `16tile` cardinal paths, `25tile` diagonal slopes, `47tile` RPG Maker inner/outer corners) and sub-quadrant cell compositing (`drawAutotileCellSubQuadrants`) in [`js/engine/autotile.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/autotile.js).
  - **Dual-Grid Terrain Mechanics**: 4-corner vertex grid (`terrainVertices` array of size `(height+1) x (width+1)`), 4-bit binary bitmask calculation ($v_{TL} \cdot 1 + v_{TR} \cdot 2 + v_{BL} \cdot 4 + v_{BR} \cdot 8 \rightarrow 0..15$), and half-tile visual offset alignment.
- **Canvas Rendering Engine & Animation Loop**: Dual-canvas architecture (`map-canvas`, `tileset-canvas`), `requestAnimationFrame` loop, transformed tile rendering (`drawTileTransformed`), overlay rendering (grid, passability O/X/*, region IDs), and tool hover preview in [`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js).
- **Export & Import System**: Native JSON v3.3 exporter/importer, Tiled TMJ (.json) exporter with bitwise flag transformations (`0x80000000` H-flip, `0x40000000` V-flip, `0x20000000` diagonal flip), and high-res PNG canvas export in [`js/engine/exportImport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/exportImport.js).
- **Undo / Redo History Stack Manager**: Deep JSON snapshot serialization (`pushHistoryState`), state restoration (`restoreState`), and toolbar button state updates in [`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js).
- **UI Subsystems**:
  - Drawing Tools & Input Dispatcher: [`js/ui/tools.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tools.js) (paint, autotile, animtile, bucket, line, rect, erase, picker, passability, region, terrain)
  - Tileset Manager & Stamp Transformations: [`js/ui/tilesetManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tilesetManager.js)
  - Dynamic Layer Hierarchy Stack: [`js/ui/layerManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/layerManager.js)
  - Viewport Zoom, Pan & Input Handlers: [`js/ui/viewport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/viewport.js)
  - Visual Autotile Mapper Wizard Modal: [`js/ui/autotileWizard.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/autotileWizard.js)
  - Tile Gameplay Properties Inspector: [`js/ui/tileProperties.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tileProperties.js)
  - Notification Toast Utility: [`js/utils/toast.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/toast.js)
- **DOM & Structural Markup**: Main HTML structure in [`index.html`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/index.html) and custom styling rules in [`css/styles.css`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/css/styles.css).

---

## 2. Mandatory 8-Phase Feature Development Lifecycle

```
 Phase 1: Deep Codebase Research & Context Alignment
    │
    ▼
 Phase 2: Creative Brainstorming & Tile Domain Concept Expansion
    │
    ▼
 Phase 3: Feature Concept Report & Clarification Artifact
    │  (Requires User Review & Feedback)
    ▼
 Phase 4: Implementation Plan, Safety Audit & DX Extensibility Check
    │  (Requires User Approval)
    ▼
 Phase 5: Feature Execution & Automated Testing
    │
    ▼
 Phase 6: Verification Walkthrough & Manual Test Guide
    │
    ├──► [If Bugs/Issues Reported] ──► Phase 7: Seamless Troubleshooting Handoff
    │                                  (Uses tileweaver-troubleshooter skill)
    ▼
 Phase 8: Developer Annotations & Code Documentation Polish
```

---

### PHASE 1: DEEP CODEBASE RESEARCH & CONTEXT ALIGNMENT
When requested to build a new feature (e.g., "add a smart cliff builder tool" or "add a 3D perspective height map exporter"):
1. **Explore the Codebase**: Perform thorough code searches using `grep_search` and file inspection across modular JS files, canvas rendering functions, input dispatchers, state stores, and UI modals.
2. **Understand Existing Tile Patterns**: Identify how current drawing tools, autotile bitmasks, dual-grid vertex arrays, layer stacks, stamp transformations, and history snapshots operate so the new feature integrates naturally into TileWeaver's architecture.

---

### PHASE 2: CREATIVE BRAINSTORMING & TILE DOMAIN CONCEPT EXPANSION
1. **Analyze Core Feature Intent**: Understand the overarching workflow goal for level designers and map artists.
2. **Apply Tile Mapping Domain Expertise**:
   - **Autotile & Adjacency Rules**: Determine how neighboring tiles ($N, S, W, E, NW, NE, SW, SE$) match edges, handle corner cutouts, or transition between terrain types.
   - **Dual-Grid Vertices vs Cell Data**: Decide whether the feature operates on $1 \times 1$ tile cell data (`layer.data`) or $(height+1) \times (width+1)$ vertex grids (`layer.terrainVertices`).
   - **Layer Hierarchy & Stacking**: Determine whether the feature should paint onto active ground layers, automatically generate decor overlay layers, or modify collision passability flags.
   - **UX & Micro-Interactions**: Brainstorm visual hover previews, cursor feedback, keyboard modifier shortcuts (e.g. `Shift` for autotile static override), sound/toast feedback, and palette integration.

---

### PHASE 3: FEATURE CONCEPT REPORT & CLARIFICATION ARTIFACT
Generate a markdown report artifact named `feature_concept_report.md` structured as follows:

```markdown
# 💡 Feature Concept Report: [Feature Name]

## 1. Feature Goal & Core Workflows
- Detailed summary of the requested feature and how it enhances level design in TileWeaver.

## 2. Tile Mapping Mechanics & Creative Enhancements
- Specific tile layout rules, autotile mode interactions, dual-grid vertex math, or stamp transformation behaviors.
- Visual canvas previews, UI panel additions, toolbar buttons, and keyboard shortcuts.

## 3. Clarifying Questions & Open Ambiguities
> [!IMPORTANT]
> Highlight any underspecified tile rules, layer behaviors, export schema decisions, or edge cases requiring user clarification.

## 4. Proposed Architectural Blueprint
- System interaction map (`window.TileWeaver` namespace additions, state object extensions, event listeners).
- Data model extensions (`state.js` properties, export/import JSON schema impact, history snapshot compatibility).
```

**Gate Requirement**: End the report by asking for user feedback on the concept, tile mechanics, and clarifying questions before moving to Phase 4.

---

### PHASE 4: IMPLEMENTATION PLAN, SAFETY AUDIT & DX EXTENSIBILITY CHECK
Upon receiving user feedback on the concept report, create `implementation_plan.md` outlining a step-by-step development strategy.

#### 🛡️ Mandatory Safety, Performance & DX Extensibility Audit
Before writing code, evaluate the implementation plan against three critical pillars:

1. **Web Canvas & Rendering Performance Safety**:
   - Maintain a smooth 60fps `requestAnimationFrame` loop without memory leaks or heavy allocations inside render frames.
   - Ensure offscreen canvas operations retain pixel-perfect rendering (`ctx.imageSmoothingEnabled = false`).
2. **Tile Adjacency, Autotile & State Regression Prevention**:
   - Ensure new tools or algorithms do NOT break existing 5-mode autotile bitmask resolution, sub-quadrant compositing, dual-grid terrain vertex bounds, layer visibility/opacity/lock states, or history snapshot deep serializations (`pushHistoryState`).
   - Verify export compatibility for Native JSON v3.3 and Tiled TMJ bitwise rotation masks (`0x80000000`, `0x40000000`, `0x20000000`).
3. **Developer Experience (DX) & Extensibility**:
   - Code MUST strictly follow TileWeaver's modular IIFE namespace pattern (`window.TileWeaver.subsystem = { ... }`).
   - Keep state store mutations localized, transparent, and documented with clear JSDoc annotations.

> [!IMPORTANT]
> Include any final clarifying questions regarding file structures, function signatures, or edge cases directly in `implementation_plan.md` using `> [!IMPORTANT]` alerts.

**Gate Requirement**: Present the implementation plan to the user and wait for explicit approval to execute.

---

### PHASE 5: FEATURE EXECUTION & VERIFICATION
Upon user approval:
1. Build out the feature modularly, starting from state store definitions and engine math to UI event listeners and canvas rendering pipeline hooks.
2. Verify script load order in [`index.html`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/index.html) and ensure compatibility with both standard script loading and dev server execution (`npm start`).

---

### PHASE 6: VERIFICATION WALKTHROUGH & MANUAL TEST GUIDE
Create or update `walkthrough.md` detailing:
- Summary of new modules, state extensions, tools, and UI panels built (with clickable file links).
- Verification results.
- **Step-by-Step Manual Testing Guide**: Clear instructions for testing the new feature on the map canvas, verifying autotile/terrain edge cases, testing undo/redo behavior, and checking JSON/TMJ exports.

---

### PHASE 7: SEAMLESS TROUBLESHOOTING HANDOFF (IF ISSUES ARISE)
If the user reports any bugs, rendering desync, or unexpected behaviors during testing:
1. Seamlessly activate the **`tileweaver-troubleshooter`** skill ([`SKILL.md`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/.agents/skills/tileweaver-troubleshooter/SKILL.md)) while preserving all conversation context, architectural blueprints, and feature reports.
2. Execute the 5-phase troubleshooting lifecycle: Diagnostic Breakdown Report → Implementation Plan & Safety Audit → Targeted Console/Canvas Logging → Fix Execution.

---

### PHASE 8: DEVELOPER ANNOTATIONS & CODE DOCUMENTATION POLISH
Once the feature is fully verified working by the user:
1. Review all created and modified source files.
2. Apply rich, clean JSDoc headers, function signatures, parameter types, and inline developer comments explaining:
   - Subsystem responsibilities and namespace exports.
   - Autotile bitmask evaluation formulas and terrain vertex grid calculations.
   - Guidance for future developers on how to add new tools, modes, or export schemas.

---

## 3. Core Execution Rules
- **Tile Domain Integrity**: Always honor autotile sub-quadrant rules, dual-grid 4-corner vertex arrays, and stamp transform matrices.
- **Modular Namespace Pattern**: Preserve `(function() { window.TileWeaver.subsystem = { ... }; })();` modular architecture.
- **Clickable Markdown Links**: Always include clickable markdown links for all modified files using standard file URI notation ([`basename.js`](file:///path/to/basename.js#L10)).
