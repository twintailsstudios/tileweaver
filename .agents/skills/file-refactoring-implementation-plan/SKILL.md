---
name: file-refactoring-implementation-plan
description: Synthesizes findings from Onboarding, Performance Health Audits, and Risk Analysis along with developer directives to generate an actionable, milestone-driven implementation plan for executing code refactors and optimizations in TileWeaver.
---

# TileWeaver Refactoring Implementation Plan Synthesizer Skill

> **Usage Instruction**: Reference or invoke this skill whenever synthesizing Onboarding analysis, Performance Health audits, Risk analysis, and developer feedback into a milestone-driven `implementation_plan_[filename].md` artifact for **TileWeaver**. Enforces structured verification gates, contract migration tables, mathematical state invariant proofs, and non-breaking backward compatibility.

---

## 1. Synthesis & Sequencing Protocol

### Step 1: Input Gathering & Developer Directive Integration
1. Read the target file completely using `view_file`.
2. Gather developer requirements, approved performance/refactoring proposals, and developer overrides.
3. Explicitly audit for underspecified requirements, breaking state schema changes, or UI workflow ambiguities before proposing edits.

### Step 2: Contract & Interface Migration Mapping
Map all function signatures, state properties (`js/state.js`), bitmask lookup tables (`js/constants.js`), or export schemas being modified:
- Identify every downstream caller file in the workspace using `grep_search`.
- Ensure changes preserve API backward compatibility or schedule caller updates in Milestone 3.

### Step 3: Milestone Sequencing with Verification Gates
Structure implementation into 3 ordered milestones:
- **Milestone 1: Foundational Abstractions, Invariant Guards & Math Utilities**:
  - Reusable coordinate helpers, bitmask tables, zero-allocation buffers, array bounds guards.
  - *State Invariants*: All 2D array coordinates bounded $0 \le x < \text{mapWidth} \land 0 \le y < \text{mapHeight}$.
  - *Verification Gate*: Run focused subsystem test (e.g. `node scripts/test_extruder.js` or `node scripts/test_viewport_zoom.js`).
- **Milestone 2: Core File Refactoring & Hot-Path Optimization**:
  - Refactor target module, streamline 60 FPS canvas hot paths, eliminate heap churn, and enforce clean state mutations with history tracking.
  - *State Invariants*: Single history snapshot per pointer drag stroke, zero allocation on mousemove.
  - *Verification Gate*: Run feature-specific test suites (e.g. `node scripts/test_asset_management_system.js`, `node scripts/test_material_swatches_studio.js`, `node scripts/test_tiled_export_import.js`).
- **Milestone 3: Downstream Callers Sync & Full Regression Suite**:
  - Update all caller sites across UI, canvas rendering, tools, and export/import modules.
  - *Verification Gate*: Run full automated test suite (`npm test`).

---

## 2. Implementation Plan Artifact Blueprint

Generate `implementation_plan_[filename].md` structured as follows:

```markdown
# 🛠️ Implementation Plan: Refactoring [File Name]

## 1. Developer Directives & Feedback Incorporated
- **Approved Refactors**: Accepted performance, 60 FPS rendering, GC, and DX improvements.
- **Developer Overrides**: Rejected proposals, architectural constraints, or custom guidelines.

## 2. Clarifying Questions & Open Ambiguities
> [!IMPORTANT]
> Highlight any underspecified requirements, breaking state schema changes, or UI layout choices requiring developer review before execution.

## 3. Pre-Execution Safety & Regression Audit
- **Canvas Rendering & 60 FPS Stability**: Confirms `requestAnimationFrame` render loop ([`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js)), pan/zoom coordinate math ([`js/ui/viewport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/viewport.js)), and 1px extrusion ([`js/engine/extruder.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/extruder.js)) operate without regressions.
- **Autotiling & Terrain Invariants**: Confirms bitmask slots (`MODE_SLOTS` in [`js/constants.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/constants.js)) and all 5 autotile algorithms in [`js/engine/autotile.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/autotile.js) remain bitmask-compliant.
- **State Store & Undo/Redo Integrity**: Confirms state is cleanly serialized in [`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js) without circular references or memory leaks.
- **Export / Import Compatibility**: Confirms Native JSON v3.3 and Tiled TMJ (.json) transformation flags (`0x80000000` H-flip, `0x40000000` V-flip, `0x20000000` diag-flip) round-trip accurately in [`js/engine/exportImport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/exportImport.js).
- **UI & DOM Structure**: Confirms dark theme design tokens ([`css/styles.css`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/css/styles.css)), dock collapse states, and modal dialogs remain fully responsive.

## 4. API & State Schema Contract Mapping
| Symbol / State Property | Proposed Changes | Downstream Caller Files | Backward Compatibility |
| :--- | :--- | :--- | :--- |
| `functionName()` ([`file.js:LXX`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/path/to/file.js#LXX)) | Add coordinate bounds check | [`tools.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tools.js#LYY) | 100% Compatible |

## 5. Milestone Execution Plan & Verification Gates

### Milestone 1: Foundational Abstractions & Defensive Guards
- [ ] Implement reusable math helpers, zero-allocation buffers, or boundary guards.
- **State Invariants**: Coordinate clamping strictly enforced.
- **Verification Gate**: `node scripts/test_viewport_zoom.js` (or relevant subsystem script)

### Milestone 2: Core Module Refactoring
- [ ] Refactor hot loops, eliminate heap churn, and ensure clean state updates with history snapshots.
- **State Invariants**: Single history snapshot per pointer drag stroke.
- **Verification Gate**: `node scripts/test_asset_management_system.js` & `node scripts/test_material_swatches_studio.js`

### Milestone 3: Downstream Callers Sync & Full Regression Suite
- [ ] Update caller sites across dependent workspace files.
- **Verification Gate**: `npm test` (100% test pass rate)
```

---

## 3. Core Execution Rules

- **No Unverifiable Milestones**: Every milestone must be paired with an automated test command in `scripts/` or `npm test`.
- **Clickable Links**: All file and symbol references must use clickable markdown syntax (`[file.js](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/file.js#L10-L25)`).
- **Zero Regressions**: Strictly preserve single-source-of-truth state management, undo/redo history safety, and format compatibility with external engines (Tiled/Phaser).
