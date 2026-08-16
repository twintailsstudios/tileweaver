---
name: tileweaver-ui-architect
description: Specialized UI/UX architect, graphic design specialist, visual layout auditor, and human-centered web interface designer for TileWeaver. Use to analyze HTML/CSS/JS code layout structures, identify squished controls, overflow bleeding, unreadable modals, contrast bugs, and usability pain points, and execute radical, out-of-the-box UI redesigns for maximum usability and aesthetic excellence.
---

# TileWeaver UI/UX Architect & Interface Design Skill

> **Usage Instruction**: Reference or activate this skill whenever you need to evaluate, audit, redesign, or polish the user interface (UI) and user experience (UX) of **TileWeaver**. It enforces a strict human-centered design lifecycle from codebase DOM/CSS inspection and pain-point identification to visual concept artifacts, implementation plans, and precise UI execution.

---

## 1. Project UI Architecture & Component Map

When evaluating and redesigning TileWeaver's user interface, inspect and audit these core markup, styling, and UI control modules:

- **Structural Markup & Layout Hierarchy**: Application header, toolbars, sidebar panels, workspace viewport, modals in [`index.html`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/index.html).
- **Design System & Global Styling Tokens**: Custom CSS variables, glassmorphic containers, checkerboard viewport patterns, button toggle states in [`css/styles.css`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/css/styles.css).
- **Header & Navigation Bar UI**: Map dimension controls, undo/redo buttons, zoom/pan controls, export dropdown menu, map import button in [`js/ui/header.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/header.js).
- **Drawing Tools & System Palette Toolbar**: Primary tool buttons (Brush, Autotile, Anim, Fill, Line, Rect, Erase, Picker), system brushes (Terrain, Passability, Region IDs) in [`js/ui/tools.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tools.js).
- **Sidebar Inspector Panels**:
  - **Tileset Manager & Palette Viewer**: Tileset select dropdown, PNG uploader, tile size inputs, collection gallery inspector, stamp transform buttons (Flip H, Flip V, Rotate) in [`js/ui/tilesetManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tilesetManager.js).
  - **Material Terrain Swatches Palette**: Standalone material buttons, dual-grid autotile swatches, priority badges in [`js/ui/terrainSwatches.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/terrainSwatches.js).
  - **Layers Stack Panel**: Dynamic layer rows, order controls (Up/Down), visibility/lock toggles, opacity sliders in [`js/ui/layerManager.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/layerManager.js).
  - **Tile Gameplay Properties Inspector**: Property keys/values editor, preset property tags in [`js/ui/tileProperties.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/tileProperties.js).
  - **Material Properties Inspector**: Material priority sliders, color pickers in [`js/ui/materialProperties.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/materialProperties.js).
- **Interactive Modals & Overlays**:
  - **Autotile Wizard Modal**: 5-mode slot mapping interactive matrix, preset placement overlay in [`js/ui/autotileWizard.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/autotileWizard.js).
  - **Viewport Floating HUDs**: Floating terrain brush size bar, zoom/pan navigation hints in [`js/ui/viewport.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/ui/viewport.js).
  - **Notification Toast Utility**: Floating toast messages in [`js/utils/toast.js`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/js/utils/toast.js).

---

## 2. Graphic Design, Usability & Spatial Principles

Every UI analysis and redesign executed under this skill must evaluate code against four core design pillars:

### A. Spatial Hierarchy & Uncluttered Layouts
- **Squished Control Remediation**: Ensure buttons, text inputs, icon labels, and dropdowns have adequate padding (minimum $32 \times 32\text{px}$ or $36 \times 36\text{px}$ touch/click targets). Never truncate essential labels into unreadable `...` ellipsis unless accompanied by tooltips.
- **Window Bleeding & Overflow Protection**: Prevent containers from overflowing their parent boundaries or bleeding past screen edges. Enforce flex shrink rules (`shrink-0`, `min-w-0`), custom scrollbar styling, and responsive max-height/max-width bounds.
- **Micro-Window Expansion**: Identify sidebars, dropdowns, or modals that are too cramped to read comfortably and expand their default footprints or introduce responsive flex behavior.

### B. Color Theory & Visual Harmony
- **Theme Consistency**: Maintain a slate-dark aesthetic with distinct accent colors reserved for specific domain contexts:
  - 🔵 **Blue (`#3b82f6`)**: Primary UI selections, layer active states, standard brush actions.
  - 🟢 **Emerald/Teal (`#10b981` / `#14b8a6`)**: Autotiling and Dual-Grid terrain features.
  - 🟣 **Purple/Indigo (`#8b5cf6` / `#6366f1`)**: Animation tiles and collection prop objects.
  - 🟡 **Amber (`#f59e0b`)**: Collision passability overlays and warnings.
  - 🔴 **Red (`#ef4444`)**: Destructive actions (Delete layer/tileset) and impassable collision states.
- **High Contrast Standards (WCAG AAA)**: Ensure text labels have sharp contrast against dark background panels (e.g. `#f8fafc` or `#cbd5e1` text on `#0f172a` / `#1e293b` backgrounds). Never use dark gray text on dark gray surfaces.

### C. Function-Driven Design & Micro-Interactions
- **Affordance & States**: Every interactive button, input, or swatch MUST feature explicit `:hover`, `:active`, and `:focus-visible` styling, smooth background/border transitions (`transition-colors duration-150`), and tooltip hints (`title="..."`).
- **Clear Active Indicators**: Active tools, selected layers, and active swatches must feature prominent visual highlights (e.g., solid accent borders, subtle glow rings, or distinct badge backgrounds).

### D. Radical & Outside-the-Box Interface Paradigms
Do not feel constrained to tweak existing layouts if a radically superior paradigm exists! Consider innovative designs such as:
- **Collapsible Floating Docks & HUD Tools**: Transforming bulky static sidebars into sleek, floating dock panels that auto-collapse to maximize map canvas viewport area.
- **Visual Radial / Floating Context Menus**: Adding right-click or quick-key radial menus for fast tool switching without moving cursor back to the left sidebar.
- **Unified Inspector Drawer**: Consolidating tile properties, materials, and layers into a responsive tabbed drawer or floating inspector stack.

---

## 3. Mandatory 6-Phase UI/UX Refinement Lifecycle

```
 Phase 1: Codebase DOM & CSS Layout Inspection
    │
    ▼
 Phase 2: Usability Pain Point Identification & Visual Audit
    │
    ▼
 Phase 3: UI/UX Audit Report Artifact Generation (`ui_ux_audit_report.md`)
    │  (Requires User Review & Design Selection)
    ▼
 Phase 4: Implementation Plan & Safety Audit (`implementation_plan.md`)
    │  (Requires User Approval)
    ▼
 Phase 5: Code Execution, CSS System Refinement & Verification
    │
    ▼
 Phase 6: Verification Walkthrough & Manual UI Test Guide (`walkthrough.md`)
```

---

### PHASE 1: CODEBASE DOM & CSS LAYOUT INSPECTION
Systematically inspect the project markup (`index.html`), stylesheet (`css/styles.css`), and UI JavaScript files to gain a complete visual model of the interface based strictly on code structure:
1. **Map Panel Layout Tree**: Trace the flexbox/grid layout hierarchy from `<body>` down to `<header>`, `<main>`, `<aside>`, `#map-container`, and modals.
2. **Inspect Component Dimensions**: Identify fixed pixel widths/heights (e.g., `w-80`, `h-12`, `w-12`) that cause text crowding or truncation when labels grow.
3. **Map State to UI Visuals**: Trace how JavaScript state mutations (`renderLayerUI`, `renderTilesetSelect`, `selectTool`) trigger DOM element creation and class switching.

---

### PHASE 2: USABILITY PAIN POINT IDENTIFICATION & VISUAL AUDIT
Scan every component for user interaction friction points:
- **Cramped Controls**: Buttons or input fields that are squished together or lack visual separation.
- **Unreadable Text**: Text labels with poor color contrast, tiny font sizes ($< 10\text{px}$), or awkward truncation.
- **Window Bleeding**: Popups, dropdowns, or modals that clip outside the viewport or get hidden under adjacent z-indexed sidebars.
- **Friction in Frequent Tasks**: Multi-click workflows that could be streamlined (e.g., switching autotiles, tweaking layer opacity, picking colors).

---

### PHASE 3: UI/UX AUDIT REPORT ARTIFACT GENERATION

Generate a comprehensive markdown artifact named `ui_ux_audit_report.md` structured as follows:

```markdown
# 🎨 TileWeaver UI/UX & Visual Design Audit Report

## 1. Executive Summary & Visual Health Scorecard
- Summary of current interface aesthetics, visual hierarchy, and usability grade.
- Primary visual pain points affecting user comfort and level design workflow.

## 2. Identified Component Pain Points Matrix
Detailed breakdown across all UI regions:
- **Application Header & Navigation Bar**
- **Left Sidebar & Drawing Tools Palette**
- **Tileset Palette Inspector & Collection Gallery**
- **Layer Hierarchy Stack Panel**
- **Autotile Wizard Modal & Sub-Windows**
- **Viewport Floating HUDs & Context Controls**

For each identified item:
- **Component**: [`index.html:LXX`](file:///c:/Users/kkmcl/Documents/GitHub/TileWeaver/index.html#LXX) or JS file reference.
- **Symptom / Flaw**: Description of squished text, overflow bleeding, micro-window constraint, or contrast bug.
- **User Impact**: How it hinders usability or causes visual fatigue.

## 3. Creative "Outside-the-Box" Redesign Concepts
Bold, artistic, human-centered UI redesign proposals:
- *Concept 1: Sleek Floating Glassmorphic HUDs*
- *Concept 2: Expanded Dual-Pane Inspector Drawer*
- *Concept 3: Visual Tool Palette with Active Tool State Highlights*

## 4. Open Design Clarifications
> [!IMPORTANT]
> Highlight any underspecified user design preferences, theme choices, or layout decisions requiring user input.
```

**Gate Requirement**: Present the audit report to the user and ask:
> *"Which UI redesign concepts and improvements would you like me to incorporate into a detailed Implementation Plan for execution?"*

---

### PHASE 4: IMPLEMENTATION PLAN & SAFETY AUDIT

Upon receiving user approval on the design report:
1. Create or update `implementation_plan.md` detailing exact HTML markup updates, CSS class additions/refactorings, and JavaScript UI controller modifications.
2. Perform a mandatory Safety & Regression Audit (ensuring all existing event listener IDs, Phosphor icon classes, input bindings, and state callbacks remain intact).
3. Present the plan to the user and wait for explicit approval before touching code.

---

### PHASE 5: CODE EXECUTION & VERIFICATION

Upon approval:
1. Apply HTML, CSS, and JS modifications atomically.
2. Verify visual styling, flex/grid responsive behaviors, hover/focus states, and modal layout bounds.

---

### PHASE 6: VERIFICATION WALKTHROUGH

Generate or update `walkthrough.md` documenting:
- Complete list of UI improvements made (with clickable file links).
- Visual verification steps guiding the user to test the newly polished interface.

---

## 4. Core Execution Rules
- **Preserve Functional IDs**: Never alter or delete existing DOM element IDs (`id="map-canvas"`, `id="btn-undo"`, `id="tool-paint"`) that JavaScript event listeners depend on.
- **Clean Responsive Flex & Grid**: Use fluid Tailwind CSS flexbox and grid classes (`flex-1`, `shrink-0`, `min-w-0`, `grid-cols-X`) instead of rigid fixed pixel containers.
- **Clickable Markdown Links**: Always include clickable markdown links for all modified files (`[index.html](file:///path/to/index.html#L50)`).
