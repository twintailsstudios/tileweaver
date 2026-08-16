---
name: tileweaver-troubleshooter
description: Deep-dive root-cause investigator and troubleshooting engine for TileWeaver. Use whenever debugging canvas rendering, autotiling/dual-grid bitmask calculation desync, undo/redo history corruption, layer matrix issues, or export/import format regressions.
---

# TileWeaver Technical Troubleshooting & Root-Cause Remediation Skill

> **Usage Instruction**: Reference or activate this skill whenever you need to investigate, troubleshoot, debug, or repair an issue in **TileWeaver**. It enforces a 5-phase lifecycle: Codebase Investigation -> Diagnostic Breakdown Report -> Implementation Plan & Comprehensive Safety Impact Audit -> Execution & Verification -> Diagnostic Logging & Root-Cause Reset Loop.

---

## 1. Project Architecture Reference Map

When investigating issues across TileWeaver, keep these core modules and systems in mind:

- **Application Entry Point & Bootstrapper**: Namespace initialization (`window.TileWeaver`), state store bootstrapping, canvas 2D context setup, history callbacks, UI module listeners, and animation loop start in [`js/app.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/app.js).
- **Central Reactive Application State Store**: Single source of truth for grid dimensions (`TILE_SIZE`, `mapWidth`, `mapHeight`), viewport scale/pan (`zoomLevel`, `panX`, `panY`), layer stack (`mapLayers`), passability grid (`passabilityGrid`), region grid (`regionGrid`), tilesets (`tilesets`), autotiles (`autotiles`), animated tiles (`animatedTiles`), selected stamp transform (`selectedStamp`, `stampTransform`), and wizard state in [`js/state.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/state.js).
- **Constants & Configuration Registry**: Tile size constants, max history depth, tool IDs, preset autotile configurations, and bitmask slot lookup maps (`MODE_SLOTS`) in [`js/constants.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/constants.js).
- **Autotiling & Dual-Grid Bitmask Engine**: 5-mode autotiling engine (`9slice`, `dualgrid`, `16tile`, `25tile`, `47tile`), 4-corner vertex bitmask matching (0..15), and sub-quadrant compositing in [`js/engine/autotile.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/autotile.js).
- **Canvas Rendering & Animation Engine**: Dual-canvas architecture (`map-canvas`, `tileset-canvas`), `requestAnimationFrame` loop, transformed tile rendering (`drawTileTransformed`), overlay rendering (grid, passability O/X/*, region IDs), and tool hover preview in [`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js).
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

## 2. Mandatory 5-Phase Troubleshooting Lifecycle

```
 Phase 1: Deep Codebase Investigation & Mapping
    |
    v
 Phase 2: Diagnostic Breakdown Report & Clarification Callouts
    |  (Requires User Approval to Proceed)
    v
 Phase 3: Implementation Plan & Comprehensive Safety Impact Audit
    |  (Requires Pre-Execution Safety Audit & User Approval)
    v
 Phase 4: Code Execution, Automated Testing & Verification Walkthrough
    |
    +---> [If Fixed] ---> DONE!
    |
    +---> [If Bug Persists] ---> Phase 5: Diagnostic Logging & Root-Cause Reset Loop
```

---

### PHASE 1: DEEP CODEBASE INVESTIGATION & MAPPING
When presented with a bug report or symptom description (e.g., "autotiles desync when erasing" or "undo breaks terrain vertices"):
1. **Never guess code logic, schemas, or file locations**.
2. Inspect relevant codebase files to identify **all** code paths, DOM event listeners, canvas rendering contexts, state properties, bitmask lookup tables, and history snapshots connected to the issue.
3. Map the complete end-to-end component interaction flow from user click/drag down to state mutations, history stack pushes, and canvas redraws.
4. Formulate an empirical hypothesis based strictly on authoritative code inspection.

---

### PHASE 2: DIAGNOSTIC BREAKDOWN REPORT & CLARIFICATION ARTIFACT
Create a markdown report artifact named `diagnostic_report.md` structured as follows:

```markdown
# Diagnostic Breakdown Report: [Issue Summary]

## 1. Problem Understanding & System Mapping
- Detailed description of the reported symptom and mapped codebase workflow.
- Component Interaction Matrix (showing how affected modules communicate).

## 2. Root Cause Analysis & Potential Triggers
- Primary suspected root cause with clickable file links ([`file.js:LXX`](file:///path/to/file.js#LXX)).
- Secondary contributing factors (canvas transform desync, bitmask evaluation ordering, state snapshot omissions, event bubble issues).

## 3. Clarifying Questions & Open Ambiguities
> [!IMPORTANT]
> Highlight any underspecified requirements, ambiguities in the user's issue description, or missing domain assumptions here.

## 4. Recommended Fix Strategy & Trade-Offs
- Step-by-step remediation strategy.
- Potential performance or downstream system trade-offs.
```

**Gate Requirement**: Conclude the report by asking:
> *"Would you like me to generate a detailed, step-by-step Implementation Plan to apply the recommended fixes?"*

**STOP and wait for explicit user review and approval before proceeding to Phase 3.**

---

### PHASE 3: IMPLEMENTATION PLAN & COMPREHENSIVE SAFETY IMPACT AUDIT
Upon receiving user approval, create or update `implementation_plan.md` detailing exact file changes, functions to modify, and validation procedures.

#### Mandatory Pre-Execution Safety & Feature Regression Audit
Before touching any code, perform a comprehensive safety audit against surrounding systems and document the results in `implementation_plan.md`:

1. **Canvas & Rendering Engine Safety**:
   - **Transforms & Zoom/Pan**: Verify that modifications do not break canvas pan/zoom matrices, pixel-perfect image smoothing disabling (`imageSmoothingEnabled = false`), or viewport offset calculations ([`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js)).
   - **Sub-Quadrant Compositing**: Ensure autotile rendering preserves sub-quadrant splitting (`drawAutotileCellSubQuadrants`) without introducing visual seam gaps.
   - **Animation Loop**: Confirm requestAnimationFrame loop remains intact for animated tiles (`animatedTiles`) without memory leaks or duplicate animation timers.
2. **Autotile & Dual-Grid Bitmask Integrity**:
   - **5 Engine Modes**: Verify bitmask logic across `9slice`, `dualgrid`, `16tile`, `25tile`, and `47tile` modes.
   - **Terrain Vertices Array**: Ensure dual-grid vertex array dimensions (`(height + 1) x (width + 1)`) remain synchronized with layer grid dimensions (`height x width`).
3. **State Store & Undo/Redo Stack Safety**:
   - **Deep Serialization**: Confirm all new state additions (layers, passability, regions, custom properties) are included in `pushHistoryState` snapshots ([`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js)).
   - **Layer References**: Verify that active layer index (`activeLayerIndex`) and layer IDs (`layer.id`) stay valid across undo/redo actions and layer deletions.
4. **Export & Import Schema Safety**:
   - **Native JSON v3.3**: Ensure export/import data schemas retain all required keys (`mapWidth`, `mapHeight`, `tileSize`, `layers`, `passabilityGrid`, `regionGrid`, `autotiles`, `animatedTiles`).
   - **Tiled TMJ Compatibility**: Verify Tiled bitwise transformation flags (`0x80000000` H-flip, `0x40000000` V-flip, `0x20000000` diagonal flip) are calculated correctly in [`js/engine/exportImport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/exportImport.js).

> [!IMPORTANT]
> If any requirements, file locations, existing conventions, or safety audit items reveal ambiguity, embed clarifying questions directly in `implementation_plan.md` using `> [!IMPORTANT]` alerts.

**Gate Requirement**: Present the implementation plan and safety audit to the user and wait for explicit approval to execute.

---

### PHASE 4: EXECUTION, AUTOMATED TESTING & VERIFICATION WALKTHROUGH
Upon user approval of the implementation plan:
1. Apply the precise code modifications using atomic file replacement tools.
2. Verify application loading and functionality (e.g. running dev server via `npm start` or checking script load order).
3. Create or update `walkthrough.md` summarizing:
   - Code modifications applied (with clickable file links).
   - Verification results.
   - **Step-by-Step Manual Verification Checklist**: Detailed instructions guiding the user on how to manually test both the primary fix AND surrounding features (drawing tools, autotiles, layers, undo/redo, export/import).

---

### PHASE 5: DIAGNOSTIC LOGGING & ROOT-CAUSE RESET LOOP (IF BUG PERSISTS)
If the user reports that the issue persists after testing:
1. **Immediate Step-Back**: Do NOT apply ad-hoc blind trial-and-error patches. Reset your diagnostic assumptions and re-evaluate the problem from first principles.
2. **Instrument Targeted Diagnostic Logging**:
   - Inject precision `console.log` / diagnostic tracing instrumentation into key execution paths (tool event handlers, autotile bitmask resolution, viewport canvas renders, history snapshot updates).
   - Ensure logs include cell coordinates `(col, row)`, bitmask integers, active tool states, layer indices, and array length snapshots.
3. **User Logging Instructions**:
   - Present specific, clear instructions to the user on what action to trigger and what exact browser console output to copy and paste back into the chat.
4. **Log Analysis & Re-Diagnosis**:
   - Once the user provides the log output, analyze the empirical data to uncover hidden state anomalies, bitmask mismatches, or unhandled event branches.
   - Create an updated `diagnostic_report.md` explaining:
     - New insights revealed by the diagnostic logs.
     - Why the initial fix was insufficient.
     - The updated root cause and proposed new fixes.
5. Proceed back through Phase 3 (Implementation Plan & Safety Audit -> Approval -> Execution -> Verification Walkthrough).

---

## 3. Core Execution Rules
- **No Symptom Masking**: Never swallow exceptions, mask canvas errors, or return dummy defaults to hide underlying bugs.
- **Preserve Contracts & UI Integration**: Preserving DOM element IDs, Tailwind CSS styling tokens, Phosphor icon bindings, autotile bitmask maps, and undo/redo snapshot schemas is mandatory.
- **Clickable Markdown Links**: Always include clickable markdown links for all modified files using standard file URI notation ([`basename.js`](file:///path/to/basename.js#L10)).
