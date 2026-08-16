---
name: file-refactoring-risk-analyzer
description: Evaluates proposed refactors and performance optimizations for unintended side effects, downstream breaking changes, canvas rendering artifacts, state desynchronization, and history stack corruption in TileWeaver. Generates a risk mitigation and hardened code implementation report.
---

# TileWeaver Refactoring Impact & Risk Mitigation Skill

> **Usage Instruction**: Reference or invoke this skill whenever evaluating proposed code refactors or performance optimizations in **TileWeaver** for side-effect risks, canvas rendering glitches, autotile bitmask desync, undo/redo history corruption, or export/import schema breakage. Generates a `risk_assessment_[filename].md` report artifact with hardened defensive code diffs and rollback protocols.

---

## 1. TileWeaver Specific Risk Audit Vectors

Cross-examine every proposed refactor against these 5 critical project risk vectors:

1. **Autotiling, Dual-Grid Bitmask & Neighborhood Desync**:
   - *Risk*: Optimizing autotile calculations in [`js/engine/autotile.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/autotile.js) or terrain painting in [`js/ui/terrainSwatches.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/terrainSwatches.js) might calculate bitmasks incorrectly, miss diagonally adjacent cells in 47-tile/25-tile modes, or fail to invalidate dirty neighbor cells during brush strokes.
   - *Dual-Grid Vertex Bounds*: Vertex array indexing must strictly enforce $vIndex = y \cdot (\text{mapWidth} + 1) + x$ over $(0 \le x \le \text{mapWidth}, 0 \le y \le \text{mapHeight})$ without 1-off array out-of-bounds corruption.
   - *Mitigation*: Defensive bitmask clamping, explicit neighbor cell bounds checks $(x \pm 1, y \pm 1)$, and bitmask lookup validation against `MODE_SLOTS` in [`js/constants.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/constants.js).

2. **2D Layer Matrix & Transactional State Mutation Safety**:
   - *Risk*: Refactoring layer manipulations in [`js/ui/layerManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/layerManager.js) or [`js/ui/tools.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tools.js) might produce out-of-bounds array reads/writes `layer.data[y][x]`, corrupt sparse/dense layer grids, or leave state half-mutated if an exception is thrown midway through a multi-tile stamp operation.
   - *Mitigation*: Coordinate boundary guards (`0 <= x < mapWidth && 0 <= y < mapHeight`), defensive layer existence assertions, atomic batch updates, and safe default fallback cells.

3. **History Stack Desynchronization & Snapshot Bloat**:
   - *Risk*: Refactoring state updates or tool handlers might cause `history.pushHistoryState()` in [`js/utils/history.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/history.js) to fire on every frame of a mouse drag (causing memory leaks and UI stutter), or mutate state objects *after* a shallow snapshot has been pushed (corrupting past undo states).
   - *Mitigation*: Strict pointerup-coalesced history recording, deep snapshot isolation, and history stack depth clamping (`MAX_HISTORY = 50`).

4. **Viewport Transform, Zoom Clamping & Sub-Pixel Bleed Seams**:
   - *Risk*: Refactoring viewport math in [`js/ui/viewport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/viewport.js) or canvas rendering in [`js/engine/rendering.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/rendering.js) might break center-locked zooming, introduce floating-point coordinate drift, or bypass 1px extrusion in [`js/engine/extruder.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/extruder.js), causing visible tile bleeding seams.
   - *Mitigation*: Coordinate clamping, integer pixel snapping for tile source/destination rectangles, and validation with `test_viewport_zoom.js` and `test_extruder.js`.

5. **Export / Import Schema & 32-Bit Unsigned Bitflag Integrity**:
   - *Risk*: Refactoring serialization in [`js/engine/exportImport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/engine/exportImport.js) or asset IDs in [`js/ui/assetManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/assetManager.js) might corrupt 32-bit GID transformation bitflags in JavaScript (where bitwise operators coerce to 32-bit signed integers, turning `0x80000000` into `-2147483648` without unsigned right shift `>>> 0`).
   - *Mitigation*: Unsigned bitwise operations `(gid >>> 0)`, bitwise mask assertions, schema validation on import/export, and automated round-trip testing via `node scripts/test_tiled_export_import.js`.

---

## 2. Risk Mitigation & Hardened Code Protocol

1. **Risk Categorization**:
   - 🟢 **Low Risk**: Pure internal refactors with zero contract or timing changes.
   - 🟡 **Medium Risk**: Caching internal calculations, modifying internal helper signatures, caller updates required.
   - 🔴 **High Risk**: Altering central state schema (`js/state.js`), 60 FPS canvas render loop (`js/engine/rendering.js`), undo/redo history mechanics (`js/utils/history.js`), or Tiled export bitflags.
2. **High Risk Alert Callout**: Embed a `> [!WARNING]` alert block for any 🔴 High Risk refactor requesting explicit developer confirmation.
3. **Hardened Code Diffs**: Wrap optimizations in defensive assertions, boundary checks, unsigned bitmask shifts, and state validation fallbacks.
4. **Emergency Rollback Protocol**: Define step-by-step git commands and test verification steps to back out changes cleanly if regressions appear.

---

## 3. Risk Assessment Artifact Blueprint

Generate `risk_assessment_[filename].md` structured as follows:

```markdown
# 🛡️ Refactoring Risk & Mitigation Report: [File Name]

## 1. Executive Risk Matrix
| Proposed Refactor | Risk Level | Potential Side Effect / Regression | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| *[Refactor Description]* | 🟢 Low / 🟡 Med / 🔴 High | *[Autotile desync / Canvas tear / Memory leak / Export break]* | *[Defensive boundary guard / Integer clamp / Test suite]* |

## 2. High-Risk Warnings & Clarification Requests
> [!WARNING]
> Highlight any 🔴 High Risk refactors that alter core state schemas, 60 FPS canvas rendering hot paths, history snapshots, or export bitmasks.

## 3. Hardened Code Implementation Diffs
For each proposed optimization:
- **Proposed Optimization**: What was suggested during performance audit.
- **Specific Side-Effect Risk**: Exact failure mode on canvas rendering, layer matrix, history, or autotiling.
- **Hardened Code Implementation**:
  ```diff
  - // Unmitigated Pattern (e.g. signed bitwise shift or unconstrained matrix access)
  + // Hardened Implementation (with boundary guards, unsigned >>> 0 shift, and state fallback)
  ```

## 4. Pre-Merge Safety & Emergency Rollback Plan
- **Automated Verification**: Commands (`npm test`, `node scripts/test_viewport_zoom.js`, `node scripts/test_tiled_export_import.js`).
- **Emergency Rollback Commands**: Step-by-step git commands for reverting cleanly if visual artifacts or regressions occur.
```

---

## 4. Core Execution Rules

- **No Unmitigated High Risks**: Never propose a 🔴 High Risk refactor without a hardened code diff and rollback plan.
- **Clickable Links**: All file and symbol references must use clickable markdown syntax (`[file.js](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/file.js#L10-L25)`).
- **Zero Regressions**: Strictly preserve 60 FPS canvas smoothness, single-source-of-truth reactive state, undo/redo reliability, and export compatibility.
