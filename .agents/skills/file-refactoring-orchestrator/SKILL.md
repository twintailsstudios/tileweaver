---
name: file-refactoring-orchestrator
description: Master orchestrator skill that executes the complete 5-phase file refactoring pipeline (Onboarding → Performance Audit → Risk Analysis → Implementation Plan → Verifier & Annotator) in TileWeaver with phase gates for developer review.
---

# TileWeaver 5-Phase Refactoring Pipeline Orchestrator

> **Usage Instruction**: Invoke or reference this master skill whenever you want to conduct an end-to-end, fully verified refactor of a single file in **TileWeaver** (e.g. *"Run the refactoring orchestrator on `js/engine/rendering.js`"* or *"Orchestrate refactoring for `js/ui/tools.js`"*). It automatically coordinates Phase 1 through Phase 5 in order, pausing at each phase gate for developer review and feedback.

---

## 🔄 The 5-Phase Pipeline Lifecycle & Data Flow

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ PHASE 1: file-onboarding-analyzer                                       │
 │ Outputs: onboarding_guide_[filename].md                                 │
 │ Context: Subsystem classification, Mermaid call graphs, symbols & state │
 └───────────────────────────────────┬─────────────────────────────────────┘
                                     │ (Developer Review Gate 1)
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ PHASE 2: file-performance-health-auditor                                │
 │ Inputs: Target File + onboarding_guide_[filename].md                    │
 │ Outputs: performance_audit_[filename].md                                │
 │ Context: 60 FPS frame budget (<16.6ms), GC churn, P0/P1/P2 diffs        │
 └───────────────────────────────────┬─────────────────────────────────────┘
                                     │ (Developer Review Gate 2)
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ PHASE 3: file-refactoring-risk-analyzer                                 │
 │ Inputs: Target File + Onboarding Guide + Performance Audit              │
 │ Outputs: risk_assessment_[filename].md                                  │
 │ Context: Bitmask desync, history bloat, > [!WARNING]s, hardened diffs   │
 └───────────────────────────────────┬─────────────────────────────────────┘
                                     │ (Developer Review Gate 3)
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ PHASE 4: file-refactoring-implementation-plan                           │
 │ Inputs: Target File + Onboarding + Audit + Risk + Developer Comments    │
 │ Outputs: implementation_plan_[filename].md                              │
 │ Context: Milestone sequencing, Verification Gates, Pre-flight safety    │
 └───────────────────────────────────┬─────────────────────────────────────┘
                                     │ (Developer Approval Gate 4)
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ PHASE 5: file-refactoring-verifier-and-annotator                        │
 │ Inputs: Target File + Approved Implementation Plan                      │
 │ Outputs: Code edits, JSDoc/inline annotations, walkthrough_[filename].md │
 │ Context: Test execution (npm test, scripts/test_*.js), QA Walkthrough   │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Step-by-Step Orchestration Protocol

When launched on a target file in TileWeaver (e.g. `js/engine/rendering.js` or `js/ui/tools.js`):

### PHASE 1: ONBOARDING & MAP GENERATION
1. Activate skill **`file-onboarding-analyzer`**.
2. Inspect the target file, map exports, state bindings (`js/state.js`), incoming triggers (mouse/pointer events, animation ticks, modal actions), coordinate transformations, and downstream callers.
3. Generate the artifact **`onboarding_guide_[filename].md`**.
4. **Phase Gate 1**: Present the Onboarding Guide to the developer and ask:
   > *"Phase 1 Complete. Please review the Onboarding Guide. Would you like me to proceed to Phase 2: Performance & Health Audit?"*

---

### PHASE 2: 60 FPS PERFORMANCE & HEALTH AUDIT
1. Upon developer approval, activate skill **`file-performance-health-auditor`**.
2. Consume the target file and `onboarding_guide_[filename].md`.
3. Audit against the 60 FPS frame budget (<16.6ms), canvas overdraw, heap GC allocations during pointer drag, state snapshot memory footprint, and DOM layout thrashing.
4. **Mandatory Pre-Refactor Baseline Protocol**:
   - Run baseline test suites before making changes: `npm test` or specific subsystem test scripts in `scripts/` (e.g. `node scripts/test_viewport_zoom.js`, `node scripts/test_asset_management_system.js`, `node scripts/test_material_swatches_studio.js`).
5. Generate the artifact **`performance_audit_[filename].md`** with pre-refactor baseline measurements and prioritized P0/P1/P2 diffs.
6. **Phase Gate 2**: Present the Performance Audit to the developer and ask:
   > *"Phase 2 Complete. Please review the Performance Audit. Would you like me to proceed to Phase 3: Risk Assessment & Mitigation?"*

---

### PHASE 3: RISK ASSESSMENT & MITIGATION
1. Upon developer approval, activate skill **`file-refactoring-risk-analyzer`**.
2. Consume the target file, Onboarding Guide, and Performance Audit.
3. Cross-examine optimizations against TileWeaver risk vectors:
   - Autotile & Dual-Grid bitmask calculations and neighbor dirty updates.
   - 2D layer matrix array bounds (`layer.data[y][x]`) and layer stack ordering.
   - History stack memory bloat and pointerup coalescing (`js/utils/history.js`).
   - Viewport center-locked zoom math and 1px extrusion seam bleeding (`js/engine/extruder.js`).
   - Native JSON v3.3 and Tiled TMJ 32-bit GID transformation bitflags (`0x80000000`, `0x40000000`, `0x20000000`).
4. Generate the artifact **`risk_assessment_[filename].md`** with hardened code diffs, `> [!WARNING]` callouts, and rollback commands.
5. **Phase Gate 3**: Present the Risk Assessment to the developer and ask:
   > *"Phase 3 Complete. Please review the Risk Assessment. Would you like me to synthesize these reports into Phase 4: Implementation Plan?"*

---

### PHASE 4: IMPLEMENTATION PLAN SYNTHESIS
1. Upon developer approval, activate skill **`file-refactoring-implementation-plan`**.
2. Synthesize Phase 1, Phase 2, Phase 3 outputs along with all developer directives and overrides.
3. Map API and state contract changes and define 3 ordered milestones with strict Verification Gates and mathematical state invariant proofs.
4. Perform the Pre-Execution Safety & Regression Audit.
5. Generate the artifact **`implementation_plan_[filename].md`**.
6. **Phase Gate 4**: Present the Implementation Plan to the developer and ask:
   > *"Phase 4 Complete. Please review the Implementation Plan. Once approved, I will execute the code changes, run automated test suites, apply JSDoc annotations, and generate the final Walkthrough."*

---

### PHASE 5: EXECUTION, TEST VERIFICATION & CODE ANNOTATION
1. Upon receiving explicit developer approval of the plan, activate skill **`file-refactoring-verifier-and-annotator`**.
2. Apply code modifications using precise, atomic code replacement tools.
3. **Mandatory Post-Refactor Verification Protocol**:
   - Execute all 11 automated test suites in `npm test` and verify 100% pass rate.
   - If new algorithmic behaviors were added, author and run `scripts/test_[feature].js`.
4. Apply TileWeaver JSDoc headers (`@subsystem`, `@frameBudget`, `@coordinateSpace`, `@stateInvariants`, `@historyTracked`, `@exportCompatibility`) and inline optimization/invariant comments.
5. Generate the final artifact **`walkthrough_[filename].md`** with empirical test verification results, clickable line links, and manual QA checklists.

---

## 4. Execution Modes

The orchestrator supports 3 flexible invocation modes depending on project needs:
- **Full Refactoring Pipeline (Default)**: Executes all 5 phases sequentially with phase review gates.
- **Audit & Risk Diagnostic (`audit`)**: Executes Phase 1, Phase 2, and Phase 3 to generate a full health and risk assessment without writing code.
- **Plan & Execute (`execute`)**: Assumes analysis is complete and executes Phase 4 and Phase 5 directly.

---

## 5. Core Execution Rules

- **Respect Phase Gates**: NEVER leap ahead to code execution without explicit developer approval at Phase Gate 4.
- **Continuous Context Flow**: Ensure each phase reads and builds directly upon the markdown artifacts generated by previous phases.
- **Clickable Links**: All file and symbol references across all artifacts must use clickable markdown syntax (`[file.js](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/file.js#L10-L25)`).
- **Web Canvas & State Integrity**: Ensure every refactor maintains 60 FPS smoothness, zero-allocation hot paths, single-source-of-truth state, and robust undo/redo capabilities.
