/**
 * @fileoverview TileWeaver - Terrain Material Properties & Variation Manager Module
 * @subsystem Modals, Wizards & Material Studio
 * @frameBudget Sub-millisecond execution (<1.0ms per simulation/transition canvas tick)
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> DualGridVertexXY
 * @stateInvariants Synchronizes state.materials, state.autotiles, and state.tilesets
 * @historyTracked Coalesced snapshot recorded on modal close / pair deletion via history.pushHistoryState()
 * @exportCompatibility Native JSON v3.3 & Tiled TMJ 1.10+
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state, getSlotVariations } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;

    let currentEditingMaterialId = null;
    let isPickerPopoverOpen = false;
    let activeModalTab = 'variations'; // 'variations' | 'transitions'

    /** Smart-Anchor Variation Preview State */
    let previewSeedOffset = 0;
    let previewDistributionMode = 'uniform'; // 'uniform' | 'organic'

    /** Preset color accents for material badges */
    const ACCENT_COLORS = [
        '#22c55e', '#d97706', '#06b6d4', '#a855f7',
        '#ec4899', '#eab308', '#3b82f6', '#14b8a6',
        '#ef4444', '#8b5cf6', '#10b981', '#f97316'
    ];

    /** Multi-tile picker state */
    const pickerSelectedTiles = new Set();
    let isDraggingPicker = false;
    let pickerDragStartCol = -1;
    let pickerDragStartRow = -1;
    let pickerHoverCol = -1;
    let pickerHoverRow = -1;

    /** Transition Matrix Preview State */
    let transMatB_Id = null;
    let transMatC_Id = null;
    let transMatD_Id = null;
    let activeTransBrushIndex = 0; // 0=A, 1=B, 2=C, 3=D
    let transPreviewVertices = []; // 9x9 vertex grid for 8x8 cell canvas
    let isPaintingTransVertices = false;
    let hoveredTransCellCol = -1;
    let hoveredTransCellRow = -1;
    let showTransVertexOverlay = false;

    // OPTIMIZATION (60 FPS Canvas): Pre-allocated static 9x9 mapped vertex buffer to eliminate GC allocations during transition matrix painting
    const cachedMappedVertices = Array.from({ length: 9 }, () => new Int32Array(9));
    const cachedTempLayer = { terrainVertices: cachedMappedVertices };

    /** Cached usage vertex count to prevent full-map scans during rate slider adjustments */
    let cachedPaintedVerticesCount = 0;

    /**
     * Initializes modal event listeners, tabs, and tileset picker popover controls.
     */
    function initMaterialPropertiesUI() {
        document.getElementById('btn-close-mat-props')?.addEventListener('click', closeMaterialPropertiesModal);
        document.getElementById('btn-save-mat-props')?.addEventListener('click', closeMaterialPropertiesModal);
        document.getElementById('btn-mat-prop-remap-wizard')?.addEventListener('click', () => {
            const matId = currentEditingMaterialId;
            closeMaterialPropertiesModal();
            if (matId && window.TileWeaver.autotileWizard) {
                window.TileWeaver.autotileWizard.openTerrainWizardForMaterial(matId);
            }
        });

        // Navigation Tabs
        document.getElementById('mat-prop-tab-variations')?.addEventListener('click', () => switchModalTab('variations'));
        document.getElementById('mat-prop-tab-transitions')?.addEventListener('click', () => switchModalTab('transitions'));

        // Form change listeners with responsive input throttling
        const nameInput = document.getElementById('mat-prop-name');
        if (nameInput) {
            nameInput.addEventListener('input', handleNameInput);
            nameInput.addEventListener('change', commitNameChange);
            nameInput.addEventListener('blur', commitNameChange);
        }

        document.getElementById('mat-prop-priority')?.addEventListener('change', handlePriorityChange);
        document.getElementById('mat-prop-color')?.addEventListener('change', handleColorChange);

        // Smart-Anchor Toolbar Listeners
        document.getElementById('select-mat-dist-mode')?.addEventListener('change', (e) => {
            previewDistributionMode = e.target.value;
            if (currentEditingMaterialId) {
                const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
                if (mat) renderLivePreviewCanvas(mat);
            }
        });
        document.getElementById('btn-mat-balance-unlocked')?.addEventListener('click', balanceUnlockedVariations);
        document.getElementById('btn-mat-reroll-seed')?.addEventListener('click', () => {
            previewSeedOffset += 17.53;
            if (currentEditingMaterialId) {
                const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
                if (mat) renderLivePreviewCanvas(mat);
            }
        });

        // Priority step buttons inside modal
        document.getElementById('btn-mat-prop-priority-up')?.addEventListener('click', () => {
            const input = document.getElementById('mat-prop-priority');
            if (input) {
                input.value = (parseInt(input.value, 10) || 0) + 1;
                handlePriorityChange();
            }
        });
        document.getElementById('btn-mat-prop-priority-down')?.addEventListener('click', () => {
            const input = document.getElementById('mat-prop-priority');
            if (input) {
                input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
                handlePriorityChange();
            }
        });

        // Add variation popover & multi-tile confirm/clear buttons
        document.getElementById('btn-mat-add-variation')?.addEventListener('click', toggleTilesetPickerPopover);
        document.getElementById('btn-close-mat-tileset-picker')?.addEventListener('click', hideTilesetPickerPopover);
        document.getElementById('btn-mat-picker-confirm')?.addEventListener('click', confirmAddSelectedVariations);
        document.getElementById('btn-mat-picker-clear')?.addEventListener('click', clearSelectedPickerTiles);

        // Transition Matrix Controls & Presets
        document.getElementById('trans-mat-b-select')?.addEventListener('change', (e) => {
            transMatB_Id = e.target.value;
            renderTransitionMatrixPanel();
        });
        document.getElementById('trans-mat-c-select')?.addEventListener('change', (e) => {
            transMatC_Id = e.target.value === '__none__' ? null : e.target.value;
            renderTransitionMatrixPanel();
        });
        document.getElementById('trans-mat-d-select')?.addEventListener('change', (e) => {
            transMatD_Id = e.target.value === '__none__' ? null : e.target.value;
            renderTransitionMatrixPanel();
        });

        document.getElementById('btn-trans-preset-2mat')?.addEventListener('click', apply2MatPatchPreset);
        document.getElementById('btn-trans-preset-3mat')?.addEventListener('click', apply3MatSplitPreset);
        document.getElementById('btn-trans-preset-4mat')?.addEventListener('click', apply4MatJunctionPreset);
        document.getElementById('btn-toggle-trans-vertex-dots')?.addEventListener('click', () => {
            showTransVertexOverlay = !showTransVertexOverlay;
            const btn = document.getElementById('btn-toggle-trans-vertex-dots');
            if (btn) {
                btn.className = showTransVertexOverlay
                    ? "px-2 py-1 bg-teal-950 hover:bg-teal-900 border border-teal-600 rounded text-[11px] font-bold text-teal-200 transition-colors flex items-center gap-1 shadow-sm"
                    : "px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-slate-300 transition-colors flex items-center gap-1";
            }
            renderTransitionMatrixCanvas();
        });

        // Transition Matrix Brush Buttons
        document.getElementById('btn-trans-brush-a')?.addEventListener('click', () => setTransBrushIndex(0));
        document.getElementById('btn-trans-brush-b')?.addEventListener('click', () => setTransBrushIndex(1));
        document.getElementById('btn-trans-brush-c')?.addEventListener('click', () => setTransBrushIndex(2));
        document.getElementById('btn-trans-brush-d')?.addEventListener('click', () => setTransBrushIndex(3));

        // Canvas Painting & Hover Listeners
        initTransMatrixCanvasListeners();

        // Palette color buttons
        renderColorSwatchesSelector();

        // Initialize 9x9 preview vertex grid
        initTransPreviewVerticesGrid();
    }

    /**
     * Initializes 9x9 preview vertex grid filled with 0 (Material A).
     */
    function initTransPreviewVerticesGrid() {
        transPreviewVertices = [];
        for (let r = 0; r < 9; r++) {
            const row = [];
            for (let c = 0; c < 9; c++) {
                row.push(0);
            }
            transPreviewVertices.push(row);
        }
    }

    /**
     * Switches between modal tabs ('variations' | 'transitions').
     * @param {'variations' | 'transitions'} tabName - Target tab identifier.
     */
    function switchModalTab(tabName) {
        activeModalTab = tabName;
        const panelVariations = document.getElementById('mat-prop-panel-variations');
        const panelTransitions = document.getElementById('mat-prop-panel-transitions');
        const btnTabVariations = document.getElementById('mat-prop-tab-variations');
        const btnTabTransitions = document.getElementById('mat-prop-tab-transitions');

        if (tabName === 'variations') {
            if (panelVariations) panelVariations.classList.remove('hidden');
            if (panelTransitions) panelTransitions.classList.add('hidden');

            if (btnTabVariations) {
                btnTabVariations.className = "px-3.5 py-1.5 rounded-lg bg-teal-600 text-white font-bold transition-all flex items-center gap-1.5 shadow";
            }
            if (btnTabTransitions) {
                btnTabTransitions.className = "px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium transition-all flex items-center gap-1.5";
            }
            renderMaterialPropertiesForm(false);
        } else {
            if (panelVariations) panelVariations.classList.add('hidden');
            if (panelTransitions) panelTransitions.classList.remove('hidden');

            if (btnTabTransitions) {
                btnTabTransitions.className = "px-3.5 py-1.5 rounded-lg bg-teal-600 text-white font-bold transition-all flex items-center gap-1.5 shadow";
            }
            if (btnTabVariations) {
                btnTabVariations.className = "px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium transition-all flex items-center gap-1.5";
            }
            renderTransitionMatrixPanel();
        }
    }

    /**
     * Renders palette color buttons in modal.
     */
    function renderColorSwatchesSelector() {
        const container = document.getElementById('mat-prop-color-palette');
        if (!container) return;
        container.innerHTML = '';

        ACCENT_COLORS.forEach(color => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = "w-5 h-5 rounded-full border border-slate-700 hover:scale-110 transition-transform cursor-pointer shadow-sm";
            btn.style.backgroundColor = color;
            btn.addEventListener('click', () => {
                const colorInput = document.getElementById('mat-prop-color');
                if (colorInput) {
                    colorInput.value = color;
                    handleColorChange();
                }
            });
            container.appendChild(btn);
        });
    }

    /**
     * Opens Terrain Material Properties modal for target material ID.
     * @param {string} materialId - Material ID to edit.
     */
    function openMaterialPropertiesModal(materialId) {
        const mat = window.TileWeaver.terrainSwatches
            ? window.TileWeaver.terrainSwatches.getMaterialById(materialId)
            : null;
        if (!mat) return;

        currentEditingMaterialId = materialId;
        const modal = document.getElementById('terrain-material-properties-modal');
        if (!modal) return;

        modal.classList.remove('hidden');
        hideTilesetPickerPopover();

        // Calculate initial painted vertex usage metrics once on open
        calculateMapUsageVertexCount(mat);

        // Default to Variations tab or current tab
        switchModalTab(activeModalTab);
    }

    /**
     * Closes the modal, commits pending edits, saves state to history, and refreshes UI & rendering.
     */
    function closeMaterialPropertiesModal() {
        // Commit any active name change
        commitNameChange();

        const modal = document.getElementById('terrain-material-properties-modal');
        if (modal) modal.classList.add('hidden');

        currentEditingMaterialId = null;
        hideTilesetPickerPopover();

        // Refresh swatch cards and map canvas
        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }
        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }

        // Capture state snapshot for undo/redo
        pushHistoryState();
    }

    /**
     * Resolves the primary autotile object and slot key ('grid_0' or 'grid_15') for a material.
     * @param {Object} mat - Material object.
     * @returns {{autotile: Object|null, slotKey: string}|null}
     */
    function getMaterialAutotileSlotInfo(mat) {
        if (!mat) return null;
        let targetAT = null;
        let slotKey = 'grid_0';

        if (mat.autotileIds && mat.autotileIds.length > 0) {
            targetAT = state.autotiles.find(a => a.id === mat.autotileIds[0]);
        }

        if (!targetAT) {
            const nameLower = mat.name.toLowerCase();
            targetAT = state.autotiles.find(a => 
                (a.mat1Name && a.mat1Name.toLowerCase() === nameLower) ||
                (a.mat2Name && a.mat2Name.toLowerCase() === nameLower)
            );
        }

        if (targetAT) {
            const isMat1 = targetAT.mat1Name && targetAT.mat1Name.toLowerCase() === mat.name.toLowerCase();
            slotKey = isMat1 ? 'grid_0' : 'grid_15';
        }

        return { autotile: targetAT, slotKey };
    }

    /**
     * Resolves normalized variations array for the active material.
     * @param {Object} mat - Material object.
     * @returns {Array<Object>} Normalized variations array.
     */
    function getMaterialVariations(mat) {
        if (!mat) return [];
        const info = getMaterialAutotileSlotInfo(mat);
        if (info && info.autotile && info.autotile.mapping) {
            const variations = getSlotVariations(info.autotile.mapping, info.slotKey);
            if (variations.length > 0) return variations;
        }
        return [{ tx: mat.tx || 0, ty: mat.ty || 0, weight: 100 }];
    }

    /**
     * Saves variations back into autotile mapping and material metadata.
     * @param {Object} mat - Material object.
     * @param {Array<Object>} variations - Variations array to commit.
     */
    function saveMaterialVariations(mat, variations) {
        if (!mat || !variations || variations.length === 0) return;

        // Update mat default coords
        mat.tx = variations[0].tx;
        mat.ty = variations[0].ty;

        // Synchronize with all linked autotiles
        const nameLower = mat.name.toLowerCase();
        state.autotiles.forEach(at => {
            if (at.mode !== 'dualgrid' && at.mode !== 'overlay_dualgrid') return;
            const isMat1 = at.mat1Name && at.mat1Name.toLowerCase() === nameLower;
            const isMat2 = at.mat2Name && at.mat2Name.toLowerCase() === nameLower;

            if (isMat1 || isMat2) {
                if (!at.mapping) at.mapping = {};
                const slotKey = isMat1 ? 'grid_0' : 'grid_15';
                at.mapping[slotKey] = variations.length === 1 ? variations[0] : variations;
            }
        });
    }

    /**
     * Calculates map painted vertex usage count once upon opening the modal.
     * @param {Object} mat - Target material.
     */
    function calculateMapUsageVertexCount(mat) {
        cachedPaintedVerticesCount = 0;
        if (!mat || typeof mat.vertexVal !== 'number') return;

        state.mapLayers.forEach(layer => {
            if (layer.terrainVertices && Array.isArray(layer.terrainVertices)) {
                for (let r = 0; r < layer.terrainVertices.length; r++) {
                    const row = layer.terrainVertices[r];
                    if (row && Array.isArray(row)) {
                        for (let c = 0; c < row.length; c++) {
                            if (row[c] === mat.vertexVal) {
                                cachedPaintedVerticesCount++;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Populates all inputs, cards, preview simulation, and usage metrics in the properties form.
     * @param {boolean} [recalculateStats=false] - If true, re-scans map layer vertices.
     */
    function renderMaterialPropertiesForm(recalculateStats = false) {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        // Title and Header Badges
        const titleBadge = document.getElementById('mat-prop-header-badge');
        if (titleBadge) titleBadge.textContent = mat.name;

        // Section 1: Inputs
        const inputName = document.getElementById('mat-prop-name');
        if (inputName && inputName.value !== mat.name) inputName.value = mat.name;

        const inputPriority = document.getElementById('mat-prop-priority');
        if (inputPriority) inputPriority.value = mat.priority || 0;

        const inputColor = document.getElementById('mat-prop-color');
        if (inputColor) inputColor.value = mat.color || '#22c55e';

        const vertexBadge = document.getElementById('mat-prop-vertex-val');
        if (vertexBadge) vertexBadge.textContent = `Vertex: ${mat.vertexVal}`;

        // Render Tile Variations List & Budget Meter
        renderVariationsList(mat);

        // Render Live Stochastic Simulation Preview
        renderLivePreviewCanvas(mat);

        // Render Usage Statistics Cards
        if (recalculateStats) calculateMapUsageVertexCount(mat);
        renderUsageStatistics(mat);
    }

    /**
     * Handles fast local name input typing (immediate header badge update without heavy DOM regeneration).
     */
    function handleNameInput() {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const newName = (document.getElementById('mat-prop-name')?.value || '').trim();
        if (!newName) return;

        mat.name = newName;
        const titleBadge = document.getElementById('mat-prop-header-badge');
        if (titleBadge) titleBadge.textContent = newName;
    }

    /**
     * Commits material renaming, synchronizing autotiles and refreshing the swatch studio.
     */
    function commitNameChange() {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const newName = (document.getElementById('mat-prop-name')?.value || '').trim();
        if (!newName) return;

        mat.name = newName;
        const nameLower = newName.toLowerCase();

        // Update autotiles mat1Name and mat2Name
        state.autotiles.forEach(at => {
            if (at.mat1Name && at.mat1Name.toLowerCase() === nameLower) {
                at.mat1Name = newName;
            }
            if (at.mat2Name && at.mat2Name.toLowerCase() === nameLower) {
                at.mat2Name = newName;
            }
        });

        const titleBadge = document.getElementById('mat-prop-header-badge');
        if (titleBadge) titleBadge.textContent = newName;

        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }
    }

    /**
     * Handles priority updates and triggers re-sort.
     */
    function handlePriorityChange() {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const newPriority = parseInt(document.getElementById('mat-prop-priority')?.value, 10) || 0;
        mat.priority = newPriority;

        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }
        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }
    }

    /**
     * Handles color accent change.
     */
    function handleColorChange() {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        mat.color = document.getElementById('mat-prop-color')?.value || '#22c55e';

        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }
    }

    /**
     * Converts rate percentage (0.001..100) to logarithmic slider value (0..100).
     * @param {number} rate - Rate percentage.
     * @returns {number} Logarithmic slider position [0..100].
     */
    function rateToSlider(rate) {
        const r = Math.max(0.001, Math.min(100, parseFloat(rate) || 0.001));
        return ((Math.log10(r) + 3) / 5) * 100;
    }

    /**
     * Converts logarithmic slider value (0..100) to rate percentage (0.001..100).
     * @param {number} sliderVal - Slider position [0..100].
     * @returns {number} Rate percentage.
     */
    function sliderToRate(sliderVal) {
        const s = Math.max(0, Math.min(100, parseFloat(sliderVal) || 0));
        const logVal = (s / 100) * 5 - 3;
        const raw = Math.pow(10, logVal);
        if (raw < 0.1) return parseFloat(raw.toFixed(3));
        if (raw < 1) return parseFloat(raw.toFixed(2));
        if (raw < 10) return parseFloat(raw.toFixed(1));
        return Math.round(raw);
    }

    /**
     * Evenly distributes remaining unallocated percentage across unlocked decorator cards.
     */
    function balanceUnlockedVariations() {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const variations = getMaterialVariations(mat);
        if (variations.length <= 1) {
            showMessage("Add more variations to balance!", "info");
            return;
        }

        const decorators = variations.slice(1);
        const unlockedDecorators = decorators.filter(v => !v.locked);
        if (unlockedDecorators.length === 0) {
            showMessage("All variations are locked (🔒). Unlock at least one to balance.", "warning");
            return;
        }

        const lockedSum = decorators.filter(v => v.locked).reduce((sum, v) => sum + (v.rate || 0), 0);
        const availableBudget = Math.max(0, 100 - lockedSum);
        const splitCount = unlockedDecorators.length + 1; // Base Anchor also gets 1 fair share
        const perShare = parseFloat((availableBudget / splitCount).toFixed(2));

        unlockedDecorators.forEach(v => {
            v.rate = perShare;
            v.weight = perShare;
        });

        saveMaterialVariations(mat, variations);
        renderMaterialPropertiesForm(false);
        showMessage(`Balanced ${unlockedDecorators.length} variation(s) to ${perShare}% each!`, "success");
    }

    /**
     * Renders visual multi-segment budget progress bar.
     * @param {Array<Object>} variations - Variations list.
     * @param {number} baseRate - Computed base anchor percentage.
     * @param {number} decoratorSum - Sum of decorator variation percentages.
     * @param {boolean} isOverBudget - True if total exceeds 100%.
     */
    function renderBudgetMeter(variations, baseRate, decoratorSum, isOverBudget) {
        const statusEl = document.getElementById('mat-props-budget-status');
        const barEl = document.getElementById('mat-props-budget-bar');
        if (!statusEl || !barEl) return;

        if (isOverBudget) {
            statusEl.className = "text-rose-400 font-bold font-mono";
            statusEl.textContent = `⚠️ Budget Overflow: ${decoratorSum.toFixed(1)}% (> 100%)`;
        } else {
            statusEl.className = "text-teal-300 font-bold font-mono";
            statusEl.textContent = `100.0% Budget Allocated (Base: ${baseRate.toFixed(1)}% | Decorators: ${decoratorSum.toFixed(1)}%) ✅`;
        }

        barEl.innerHTML = '';

        // Base Anchor Segment
        if (baseRate > 0) {
            const baseSeg = document.createElement('div');
            baseSeg.className = "bg-teal-500 h-full transition-all";
            baseSeg.style.width = `${Math.min(100, baseRate)}%`;
            baseSeg.title = `Base Ground Anchor: ${baseRate.toFixed(1)}%`;
            barEl.appendChild(baseSeg);
        }

        // Decorator Segments
        const colors = ['bg-emerald-400', 'bg-amber-400', 'bg-purple-400', 'bg-blue-400', 'bg-pink-400', 'bg-indigo-400'];
        for (let i = 1; i < variations.length; i++) {
            const v = variations[i];
            const r = Math.max(0, parseFloat(v.rate) || 0);
            if (r > 0) {
                const seg = document.createElement('div');
                const colClass = v.locked ? 'bg-indigo-500' : (colors[(i - 1) % colors.length]);
                seg.className = `${colClass} h-full transition-all`;
                seg.style.width = `${r}%`;
                seg.title = `Variation ${i + 1} (${v.tx}, ${v.ty}): ${r}% ${v.locked ? '(Locked)' : ''}`;
                barEl.appendChild(seg);
            }
        }
    }

    /**
     * Renders Smart-Anchor variation cards into `#mat-props-variations-list`.
     * @param {Object} mat - Target material.
     */
    function renderVariationsList(mat) {
        const container = document.getElementById('mat-props-variations-list');
        if (!container) return;
        container.innerHTML = '';

        const variations = getMaterialVariations(mat);
        window.TileWeaver.stateModule.calculateVariationRates(variations);
        const baseRate = variations[0].rate;
        const ts = state.tilesets.find(t => t.id === mat.tilesetId) || state.tilesets[0];

        // 1. Calculate Decorator Load & Budget Allocation
        const decoratorSum = variations.slice(1).reduce((sum, v) => sum + (v.rate || 0), 0);
        const isOverBudget = decoratorSum > 100;

        // 2. Render Budget Meter Bar
        renderBudgetMeter(variations, baseRate, decoratorSum, isOverBudget);

        // 3. Render Cards
        variations.forEach((v, idx) => {
            const card = document.createElement('div');
            const isBase = idx === 0;

            card.className = isBase
                ? "bg-slate-900/95 p-3 rounded-lg border-2 border-teal-500/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-md transition-all relative overflow-hidden"
                : "bg-slate-900 p-3 rounded-lg border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-sm hover:border-slate-700 transition-colors";

            // Thumbnail Canvas
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 44;
            thumbCanvas.height = 44;
            thumbCanvas.className = "w-11 h-11 rounded border border-slate-700 bg-slate-950 checkerboard shrink-0 shadow-inner";
            const ctx = thumbCanvas.getContext('2d');

            if (ts && ts.image) {
                ctx.imageSmoothingEnabled = false;
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const step = state.TILE_SIZE + spacing;
                const sx = margin + (v.tx || 0) * step;
                const sy = margin + (v.ty || 0) * step;
                ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 44, 44);
            }

            if (isBase) {
                // ================= BASE ANCHOR CARD =================
                const infoBox = document.createElement('div');
                infoBox.className = "flex-1 flex flex-col gap-1.5 min-w-0";
                infoBox.innerHTML = `
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-1.5">
                            <span class="font-mono font-bold text-teal-300 text-xs">Variation 1: (${v.tx}, ${v.ty})</span>
                            <span class="px-2 py-0.5 rounded-full bg-teal-950 text-teal-300 border border-teal-600/80 text-[10px] font-bold font-mono flex items-center gap-1 shadow-sm">
                                <i class="ph ph-anchor-simple"></i> Base Ground Anchor
                            </span>
                        </div>
                        <span class="px-2.5 py-0.5 rounded bg-slate-950 border border-teal-500/40 text-teal-300 font-mono font-bold text-xs shadow-inner">
                            ${baseRate.toFixed(1)}% Spawn Chance
                        </span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Primary background texture. Auto-absorbs remaining unallocated map probability space.</span>
                        <span class="font-mono text-[10px] text-teal-400 font-bold shrink-0">~${Math.round(baseRate * 10.24)} / 1024 tiles</span>
                    </div>
                `;

                const actionsBox = document.createElement('div');
                actionsBox.className = "flex items-center gap-1 shrink-0 self-center";
                const primaryBadge = document.createElement('span');
                primaryBadge.className = "px-2 py-1 bg-teal-950 text-teal-300 border border-teal-700 rounded text-[10px] font-bold flex items-center gap-1";
                primaryBadge.innerHTML = `<i class="ph ph-star-fill text-amber-400"></i> Swatch Icon`;
                actionsBox.appendChild(primaryBadge);

                card.appendChild(thumbCanvas);
                card.appendChild(infoBox);
                card.appendChild(actionsBox);
            } else {
                // ================= DECORATOR VARIATION CARD =================
                const currentRate = Math.max(0, parseFloat(v.rate) || 0);
                const currentRatio = currentRate > 0 ? Math.max(1, Math.round(100 / currentRate)) : 99999;
                const isLocked = !!v.locked;

                const infoBox = document.createElement('div');
                infoBox.className = "flex-1 flex flex-col gap-1.5 min-w-0";
                infoBox.innerHTML = `
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-bold text-slate-200 text-xs">Variation ${idx + 1}: (${v.tx}, ${v.ty})</span>
                            <button class="btn-lock-toggle px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 ${
                                isLocked
                                    ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                            }" title="${isLocked ? 'Locked: rate is frozen during auto-balance' : 'Unlocked: rate will adjust during auto-balance'}">
                                <i class="ph ${isLocked ? 'ph-lock-simple-fill' : 'ph-lock-simple-open'}"></i>
                                ${isLocked ? 'Locked' : 'Unlocked'}
                            </button>
                        </div>
                        <div class="flex items-center gap-1 text-[11px]">
                            <label class="text-[10px] text-slate-400 font-bold uppercase">Rate:</label>
                            <input type="number" step="0.1" min="0.001" max="100" value="${currentRate}" class="input-var-rate w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-center text-xs font-mono font-bold text-teal-300 focus:outline-none focus:border-teal-500">
                            <span class="font-bold text-teal-400">%</span>
                        </div>
                    </div>

                    <!-- Dual Slider & Frequency Helper Bar -->
                    <div class="flex items-center gap-2 mt-0.5">
                        <input type="range" min="0" max="100" step="0.5" value="${rateToSlider(currentRate)}" class="input-var-slider flex-1 accent-teal-500 h-1.5 bg-slate-800 rounded cursor-pointer">
                        <div class="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-[10px] font-mono shrink-0">
                            <span class="text-slate-400 font-bold">1 in</span>
                            <input type="number" min="1" max="100000" step="1" value="${currentRatio}" class="input-var-ratio w-12 bg-transparent text-center font-bold text-amber-300 focus:outline-none">
                            <span class="text-slate-400">tiles</span>
                        </div>
                    </div>

                    <!-- Quick Preset Chips -->
                    <div class="flex items-center gap-1 flex-wrap pt-0.5">
                        <span class="text-[9px] text-slate-400 uppercase font-bold mr-0.5">Presets:</span>
                        <button class="btn-var-preset px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono transition-colors" data-rate="0.1">✨ 0.1% (1:1k)</button>
                        <button class="btn-var-preset px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono transition-colors" data-rate="0.2">🌸 0.2% (1:500)</button>
                        <button class="btn-var-preset px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono transition-colors" data-rate="1.0">🌿 1.0% (1:100)</button>
                        <button class="btn-var-preset px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono transition-colors" data-rate="5.0">🍀 5.0% (1:20)</button>
                        <button class="btn-var-preset px-1.5 py-0.2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-mono transition-colors" data-rate="25.0">Common 25%</button>
                    </div>
                `;

                // Bind inputs defensively
                const rateInput = infoBox.querySelector('.input-var-rate');
                const ratioInput = infoBox.querySelector('.input-var-ratio');
                const sliderInput = infoBox.querySelector('.input-var-slider');
                const lockBtn = infoBox.querySelector('.btn-lock-toggle');

                const updateRate = (newRateVal) => {
                    const r = Math.max(0.001, parseFloat(newRateVal) || 0);
                    v.rate = r;
                    v.weight = r;
                    saveMaterialVariations(mat, variations);
                    renderMaterialPropertiesForm(false);
                };

                rateInput?.addEventListener('change', (e) => updateRate(e.target.value));
                sliderInput?.addEventListener('input', (e) => {
                    const computedRate = sliderToRate(e.target.value);
                    if (rateInput) rateInput.value = computedRate;
                    if (ratioInput) ratioInput.value = Math.max(1, Math.round(100 / (computedRate || 0.001)));
                    v.rate = computedRate;
                    v.weight = computedRate;
                    saveMaterialVariations(mat, variations);
                    renderLivePreviewCanvas(mat);
                });
                sliderInput?.addEventListener('change', () => {
                    renderMaterialPropertiesForm(false);
                });

                ratioInput?.addEventListener('change', (e) => {
                    const ratio = Math.max(1, parseInt(e.target.value, 10) || 1);
                    const computedRate = parseFloat((100 / ratio).toFixed(3));
                    updateRate(computedRate);
                });

                lockBtn?.addEventListener('click', () => {
                    v.locked = !v.locked;
                    saveMaterialVariations(mat, variations);
                    renderMaterialPropertiesForm(false);
                });

                infoBox.querySelectorAll('.btn-var-preset').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const targetRate = parseFloat(e.target.getAttribute('data-rate'));
                        if (!isNaN(targetRate)) {
                            updateRate(targetRate);
                        }
                    });
                });

                // Action Buttons (Make Base / Delete)
                const actionsBox = document.createElement('div');
                actionsBox.className = "flex items-center gap-1 shrink-0 self-center";

                const btnMakeBase = document.createElement('button');
                btnMakeBase.title = "Make this variation the Base Anchor tile";
                btnMakeBase.className = "px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 hover:text-white border border-slate-700 transition-colors text-[10px] font-bold flex items-center gap-1";
                btnMakeBase.innerHTML = `<i class="ph ph-anchor-simple"></i> Make Base`;
                btnMakeBase.addEventListener('click', () => {
                    const picked = variations.splice(idx, 1)[0];
                    variations.unshift(picked);
                    saveMaterialVariations(mat, variations);
                    renderMaterialPropertiesForm(false);
                    showMessage(`Promoted Tile (${picked.tx}, ${picked.ty}) to Base Anchor!`, "success");
                });
                actionsBox.appendChild(btnMakeBase);

                const btnDelete = document.createElement('button');
                btnDelete.title = "Delete this tile variation";
                btnDelete.className = "p-1.5 rounded bg-red-950/60 hover:bg-red-900 text-red-400 hover:text-red-200 border border-red-800/60 transition-colors text-xs";
                btnDelete.innerHTML = `<i class="ph ph-trash"></i>`;
                btnDelete.addEventListener('click', () => {
                    variations.splice(idx, 1);
                    saveMaterialVariations(mat, variations);
                    renderMaterialPropertiesForm(false);
                    showMessage("Removed tile variation.", "info");
                });
                actionsBox.appendChild(btnDelete);

                card.appendChild(thumbCanvas);
                card.appendChild(infoBox);
                card.appendChild(actionsBox);
            }

            container.appendChild(card);
        });
    }

    /**
     * Renders sample 16x16 terrain preview simulation grid and populates distribution statistics.
     * @param {Object} mat - Target material.
     */
    function renderLivePreviewCanvas(mat) {
        const canvas = document.getElementById('mat-props-preview-canvas');
        const statsEl = document.getElementById('mat-props-distribution-stats');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const variations = getMaterialVariations(mat);
        window.TileWeaver.stateModule.calculateVariationRates(variations);
        const ts = state.tilesets.find(t => t.id === mat.tilesetId) || state.tilesets[0];

        if (!ts || !ts.image) return;
        ctx.imageSmoothingEnabled = false;

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;

        const gridCols = 16;
        const gridRows = 16;
        const totalCells = gridCols * gridRows; // 256 cells
        const cellSize = canvas.width / gridCols; // 8px per cell

        const counts = new Map();
        variations.forEach(v => counts.set(v, 0));

        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const selectedVar = window.TileWeaver.autotile.resolveSlotEntry(
                    variations,
                    c + previewSeedOffset,
                    r + previewSeedOffset,
                    previewDistributionMode
                ) || variations[0];

                counts.set(selectedVar, (counts.get(selectedVar) || 0) + 1);

                const sx = margin + selectedVar.tx * step;
                const sy = margin + selectedVar.ty * step;
                ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, c * cellSize, r * cellSize, cellSize, cellSize);
            }
        }

        // Render Distribution Statistics Breakdown
        if (statsEl) {
            statsEl.innerHTML = variations.map((v, idx) => {
                const count = counts.get(v) || 0;
                const pct = ((count / totalCells) * 100).toFixed(1);
                const label = idx === 0 ? 'Base Ground' : `Var ${idx + 1}`;
                const color = idx === 0 ? 'text-teal-300' : 'text-slate-300';
                return `<span class="${color} font-bold">• ${label}: <span class="text-white">${count}</span> (${pct}%)</span>`;
            }).join('');
        }
    }

    /**
     * Calculates map usage statistics for this material using cached vertex count.
     * @param {Object} mat - Target material.
     */
    function renderUsageStatistics(mat) {
        const statsContainer = document.getElementById('mat-props-usage-stats');
        if (!statsContainer || !mat) return;

        const linkedAutotilesCount = mat.autotileIds ? mat.autotileIds.length : 0;
        const variationsCount = getMaterialVariations(mat).length;

        statsContainer.innerHTML = `
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="bg-slate-900 p-2 rounded border border-slate-800">
                    <span class="text-teal-400 font-bold font-mono text-sm block">${variationsCount}</span>
                    <span class="text-[10px] text-slate-400">Variations</span>
                </div>
                <div class="bg-slate-900 p-2 rounded border border-slate-800">
                    <span class="text-emerald-400 font-bold font-mono text-sm block">${cachedPaintedVerticesCount}</span>
                    <span class="text-[10px] text-slate-400">Painted Vertices</span>
                </div>
                <div class="bg-slate-900 p-2 rounded border border-slate-800">
                    <span class="text-amber-400 font-bold font-mono text-sm block">${linkedAutotilesCount}</span>
                    <span class="text-[10px] text-slate-400">Linked Autotiles</span>
                </div>
            </div>
        `;
    }

    // =========================================================================
    // Multi-Material Transition Matrix Subsystem
    // =========================================================================

    /**
     * Renders Multi-Material Transition Matrix Panel (Tab 2).
     */
    function renderTransitionMatrixPanel() {
        if (!currentEditingMaterialId) return;
        const matA = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!matA) return;

        // 1. Update Material A Label & Swatch
        const labelA = document.getElementById('trans-mat-a-label');
        if (labelA) labelA.textContent = matA.name;

        // 2. Populate Dropdowns for Mat B, Mat C, Mat D
        const allMaterials = state.materials || [];
        const otherMaterials = allMaterials.filter(m => m.id !== matA.id);

        const selectB = document.getElementById('trans-mat-b-select');
        const selectC = document.getElementById('trans-mat-c-select');
        const selectD = document.getElementById('trans-mat-d-select');

        if (selectB) {
            selectB.innerHTML = otherMaterials.length > 0
                ? otherMaterials.map(m => `<option value="${m.id}">${m.name}</option>`).join('')
                : `<option value="">None Available</option>`;

            if (transMatB_Id && otherMaterials.some(m => m.id === transMatB_Id)) {
                selectB.value = transMatB_Id;
            } else if (otherMaterials.length > 0) {
                transMatB_Id = otherMaterials[0].id;
                selectB.value = transMatB_Id;
            }
        }

        if (selectC) {
            selectC.innerHTML = `<option value="__none__">-- None --</option>` +
                otherMaterials.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            if (transMatC_Id) selectC.value = transMatC_Id;
        }

        if (selectD) {
            selectD.innerHTML = `<option value="__none__">-- None --</option>` +
                otherMaterials.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            if (transMatD_Id) selectD.value = transMatD_Id;
        }

        // Update Brush Button Labels
        const matB = otherMaterials.find(m => m.id === transMatB_Id);
        const matC = otherMaterials.find(m => m.id === transMatC_Id);
        const matD = otherMaterials.find(m => m.id === transMatD_Id);

        const btnA = document.getElementById('btn-trans-brush-a');
        const btnB = document.getElementById('btn-trans-brush-b');
        const btnC = document.getElementById('btn-trans-brush-c');
        const btnD = document.getElementById('btn-trans-brush-d');

        if (btnA) btnA.textContent = matA ? matA.name : 'Mat A';
        if (btnB) btnB.textContent = matB ? matB.name : 'Mat B';
        if (btnC) btnC.textContent = matC ? matC.name : 'Mat C (None)';
        if (btnD) btnD.textContent = matD ? matD.name : 'Mat D (None)';

        // 3. Render Canvas & Rules Summary
        renderTransitionMatrixCanvas();
        renderTransitionRulesSummary();
    }

    /**
     * Sets active transition paint brush index (0=A, 1=B, 2=C, 3=D).
     * @param {number} idx - Brush index [0..3].
     */
    function setTransBrushIndex(idx) {
        activeTransBrushIndex = idx;
        const labels = ['Material A', 'Material B', 'Material C', 'Material D'];
        const brushLabel = document.getElementById('trans-brush-label');
        if (brushLabel) brushLabel.textContent = `Active Brush: ${labels[idx]}`;

        [0, 1, 2, 3].forEach(i => {
            const btn = document.getElementById(`btn-trans-brush-${['a','b','c','d'][i]}`);
            if (btn) {
                if (i === idx) {
                    btn.classList.add('border-teal-500', 'font-bold');
                    btn.classList.remove('border-slate-700');
                } else {
                    btn.classList.remove('border-teal-500', 'font-bold');
                    btn.classList.add('border-slate-700');
                }
            }
        });
    }

    /**
     * Preset 1: 2-Material Patch (Mat A background, Mat B center patch).
     */
    function apply2MatPatchPreset() {
        initTransPreviewVerticesGrid();
        for (let r = 2; r <= 6; r++) {
            for (let c = 2; c <= 6; c++) {
                transPreviewVertices[r][c] = 1; // Mat B
            }
        }
        renderTransitionMatrixCanvas();
        showMessage("Applied 2-Material Patch Preset!", "info");
    }

    /**
     * Preset 2: 3-Material Split (Mat A left, Mat B top-right, Mat C bottom-right).
     */
    function apply3MatSplitPreset() {
        initTransPreviewVerticesGrid();
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (c >= 4 && r < 4) transPreviewVertices[r][c] = 1; // Mat B
                else if (c >= 4 && r >= 4) transPreviewVertices[r][c] = 2; // Mat C
                else transPreviewVertices[r][c] = 0; // Mat A
            }
        }
        renderTransitionMatrixCanvas();
        showMessage("Applied 3-Material Split Preset!", "info");
    }

    /**
     * Preset 3: 4-Material Junction (4 quadrants meeting at center).
     */
    function apply4MatJunctionPreset() {
        initTransPreviewVerticesGrid();
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (r < 4 && c < 4) transPreviewVertices[r][c] = 0; // Mat A
                else if (r < 4 && c >= 4) transPreviewVertices[r][c] = 1; // Mat B
                else if (r >= 4 && c < 4) transPreviewVertices[r][c] = 2; // Mat C
                else transPreviewVertices[r][c] = 3; // Mat D
            }
        }
        renderTransitionMatrixCanvas();
        showMessage("Applied 4-Material Junction Preset!", "info");
    }

    /**
     * Initializes mouse listeners on #trans-matrix-canvas for vertex painting and cell inspection.
     */
    function initTransMatrixCanvasListeners() {
        const canvas = document.getElementById('trans-matrix-canvas');
        if (!canvas) return;

        const getCellAndVertexCoords = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            const cellSize = canvas.width / 8; // 32px per cell
            const col = Math.floor(clickX / cellSize);
            const row = Math.floor(clickY / cellSize);

            const vx = Math.round(clickX / cellSize);
            const vy = Math.round(clickY / cellSize);

            return {
                cellCol: Math.max(0, Math.min(7, col)),
                cellRow: Math.max(0, Math.min(7, row)),
                vx: Math.max(0, Math.min(8, vx)),
                vy: Math.max(0, Math.min(8, vy))
            };
        };

        canvas.onmousedown = (e) => {
            isPaintingTransVertices = true;
            const { vx, vy } = getCellAndVertexCoords(e);
            transPreviewVertices[vy][vx] = activeTransBrushIndex;
            renderTransitionMatrixCanvas();
        };

        canvas.onmousemove = (e) => {
            const { cellCol, cellRow, vx, vy } = getCellAndVertexCoords(e);

            if (isPaintingTransVertices) {
                transPreviewVertices[vy][vx] = activeTransBrushIndex;
                renderTransitionMatrixCanvas();
            }

            if (cellCol !== hoveredTransCellCol || cellRow !== hoveredTransCellRow) {
                hoveredTransCellCol = cellCol;
                hoveredTransCellRow = cellRow;
                inspectTransCell(cellCol, cellRow);
            }
        };

        canvas.onmouseup = () => { isPaintingTransVertices = false; };
        canvas.onmouseleave = () => { isPaintingTransVertices = false; };
    }

    /**
     * Renders multi-material dual-grid terrain transitions onto #trans-matrix-canvas.
     * OPTIMIZATION (60 FPS Canvas): Uses static pre-allocated cachedMappedVertices to eliminate heap allocations per frame.
     */
    function renderTransitionMatrixCanvas() {
        const canvas = document.getElementById('trans-matrix-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;

        const matA = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        const matB = window.TileWeaver.terrainSwatches.getMaterialById(transMatB_Id);
        const matC = window.TileWeaver.terrainSwatches.getMaterialById(transMatC_Id);
        const matD = window.TileWeaver.terrainSwatches.getMaterialById(transMatD_Id);

        const materialsList = [matA, matB || matA, matC || matA, matD || matA];

        // OPTIMIZATION: Populate static 9x9 mapped vertex buffer directly with guaranteed boundary guards
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const vIdx = transPreviewVertices[r] ? transPreviewVertices[r][c] : 0;
                const mat = materialsList[vIdx];
                cachedMappedVertices[r][c] = (mat && typeof mat.vertexVal === 'number') ? mat.vertexVal : 0;
            }
        }

        // Grid cell rendering (8x8 cells, 32px per cell)
        const cellPixelSize = canvas.width / 8;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                // Call dualgrid engine evaluator using cached temporary layer
                const tileEntry = window.TileWeaver.autotile
                    ? window.TileWeaver.autotile.getDualGridTileForCell(cachedTempLayer, c, r, null)
                    : null;

                if (tileEntry) {
                    const ts = state.tilesets.find(t => t.id === tileEntry.tilesetId) || state.tilesets[0];
                    if (ts && ts.image) {
                        const margin = ts.margin || 0;
                        const spacing = ts.spacing || 0;
                        const step = state.TILE_SIZE + spacing;
                        const sx = margin + tileEntry.tx * step;
                        const sy = margin + tileEntry.ty * step;

                        ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, c * cellPixelSize, r * cellPixelSize, cellPixelSize, cellPixelSize);
                    }

                    // Render overlay passes for multi-material transition cutouts
                    if (tileEntry.overlays && Array.isArray(tileEntry.overlays)) {
                        tileEntry.overlays.forEach(ov => {
                            const ovTs = state.tilesets.find(t => t.id === ov.tilesetId) || ts;
                            if (ovTs && ovTs.image) {
                                const ovMargin = ovTs.margin || 0;
                                const ovSpacing = ovTs.spacing || 0;
                                const ovStep = state.TILE_SIZE + ovSpacing;
                                const ovSx = ovMargin + ov.tx * ovStep;
                                const ovSy = ovMargin + ov.ty * ovStep;
                                ctx.drawImage(ovTs.image, ovSx, ovSy, state.TILE_SIZE, state.TILE_SIZE, c * cellPixelSize, r * cellPixelSize, cellPixelSize, cellPixelSize);
                            }
                        });
                    }
                } else {
                    // Fallback swatch fill if unmapped
                    ctx.fillStyle = '#1e293b';
                    ctx.fillRect(c * cellPixelSize, r * cellPixelSize, cellPixelSize, cellPixelSize);
                }

                // Cell outline grid lines
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.strokeRect(c * cellPixelSize, r * cellPixelSize, cellPixelSize, cellPixelSize);
            }
        }

        // Draw vertex dots at corner intersections if overlay enabled
        if (showTransVertexOverlay) {
            const brushColors = [
                matA ? matA.color : '#22c55e',
                matB ? matB.color : '#d97706',
                matC ? matC.color : '#06b6d4',
                matD ? matD.color : '#a855f7'
            ];

            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    const matIdx = transPreviewVertices[r][c];
                    const vx = c * cellPixelSize;
                    const vy = r * cellPixelSize;

                    ctx.fillStyle = brushColors[matIdx] || '#ffffff';
                    ctx.beginPath();
                    ctx.arc(vx, vy, 4, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = '#020617';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }

    /**
     * Inspects target preview cell (col, row) and displays bitmask and rule details.
     * @param {number} col - Cell column [0..7].
     * @param {number} row - Cell row [0..7].
     */
    function inspectTransCell(col, row) {
        const inspectorBox = document.getElementById('trans-inspector-box');
        if (!inspectorBox) return;

        const matA = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        const matB = window.TileWeaver.terrainSwatches.getMaterialById(transMatB_Id);
        const matC = window.TileWeaver.terrainSwatches.getMaterialById(transMatC_Id);
        const matD = window.TileWeaver.terrainSwatches.getMaterialById(transMatD_Id);

        const materialsList = [matA, matB || matA, matC || matA, matD || matA];

        const idxTL = transPreviewVertices[row][col];
        const idxTR = transPreviewVertices[row][col + 1];
        const idxBL = transPreviewVertices[row + 1][col];
        const idxBR = transPreviewVertices[row + 1][col + 1];

        const matTL = materialsList[idxTL] || matA;
        const matTR = materialsList[idxTR] || matA;
        const matBL = materialsList[idxBL] || matA;
        const matBR = materialsList[idxBR] || matA;

        // Calculate highest priority among 4 corners
        const highestPriority = Math.max(matTL.priority || 0, matTR.priority || 0, matBL.priority || 0, matBR.priority || 0);

        // Bitmask calculations
        const bitTL = (matTL.priority || 0) === highestPriority ? 1 : 0;
        const bitTR = (matTR.priority || 0) === highestPriority ? 2 : 0;
        const bitBL = (matBL.priority || 0) === highestPriority ? 4 : 0;
        const bitBR = (matBR.priority || 0) === highestPriority ? 8 : 0;
        const bitmask = bitTL + bitTR + bitBL + bitBR;

        inspectorBox.innerHTML = `
            <div class="flex items-center justify-between font-mono font-bold text-teal-300">
                <span>Cell (${col}, ${row})</span>
                <span class="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">Bitmask: ${bitmask} (${bitmask.toString(2).padStart(4, '0')})</span>
            </div>
            <div class="grid grid-cols-2 gap-1.5 text-[10px] font-mono mt-1">
                <div class="bg-slate-900 p-1.5 rounded border border-slate-800">TL: <span style="color:${matTL.color}">${matTL.name}</span></div>
                <div class="bg-slate-900 p-1.5 rounded border border-slate-800">TR: <span style="color:${matTR.color}">${matTR.name}</span></div>
                <div class="bg-slate-900 p-1.5 rounded border border-slate-800">BL: <span style="color:${matBL.color}">${matBL.name}</span></div>
                <div class="bg-slate-900 p-1.5 rounded border border-slate-800">BR: <span style="color:${matBR.color}">${matBR.name}</span></div>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 pt-1 border-t border-slate-800">
                Overlay Governance: <span class="text-amber-300 font-bold">${bitmask === 0 || bitmask === 15 ? 'Solid Material Slot' : 'Transition Corner Cutout'}</span>
            </div>
        `;
    }

    /**
     * Renders autotile rules summary list connecting Mat A with B, C, D with Edit in Wizard and Prune Pair actions.
     */
    function renderTransitionRulesSummary() {
        const rulesBox = document.getElementById('trans-rules-box');
        if (!rulesBox) return;
        rulesBox.innerHTML = '';

        const matA = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!matA) return;

        const connectedAutotiles = state.autotiles.filter(a =>
            a.mode === 'dualgrid' || a.mode === 'overlay_dualgrid'
        ).filter(a =>
            (a.mat1Name && a.mat1Name.toLowerCase() === matA.name.toLowerCase()) ||
            (a.mat2Name && a.mat2Name.toLowerCase() === matA.name.toLowerCase())
        );

        if (connectedAutotiles.length === 0) {
            rulesBox.innerHTML = `<p class="text-slate-500 italic text-[10px]">No transition autotiles registered for ${matA.name} yet.</p>`;
            return;
        }

        connectedAutotiles.forEach(at => {
            const card = document.createElement('div');
            card.className = "bg-slate-900 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-1.5 text-[10px] hover:border-slate-700 transition-colors";
            
            const headerRow = document.createElement('div');
            headerRow.className = "flex items-center justify-between gap-1.5";
            headerRow.innerHTML = `
                <div class="flex flex-col min-w-0">
                    <span class="font-bold text-white text-xs truncate">${at.name}</span>
                    <span class="text-teal-400 font-mono text-[10px]">${at.mat1Name} ↔ ${at.mat2Name}</span>
                </div>
                <span class="px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800 font-mono text-[9px] shrink-0">${at.mode}</span>
            `;

            const actionsRow = document.createElement('div');
            actionsRow.className = "flex items-center justify-end gap-1.5 pt-1 border-t border-slate-800/80";

            const btnEditWiz = document.createElement('button');
            btnEditWiz.className = "px-2 py-1 bg-slate-800 hover:bg-teal-900/60 text-teal-300 hover:text-teal-100 border border-slate-700 hover:border-teal-500 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors";
            btnEditWiz.innerHTML = `<i class="ph ph-pencil-simple"></i> Edit in Wizard`;
            btnEditWiz.addEventListener('click', () => {
                closeMaterialPropertiesModal();
                if (window.TileWeaver.autotileWizard) {
                    window.TileWeaver.autotileWizard.openTerrainWizardForAutotile(at.id);
                }
            });

            const btnPrune = document.createElement('button');
            btnPrune.className = "px-2 py-1 bg-slate-800 hover:bg-red-950/80 text-red-400 hover:text-red-200 border border-slate-700 hover:border-red-600 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors";
            btnPrune.innerHTML = `<i class="ph ph-trash"></i> Prune Pair`;
            btnPrune.title = "Delete only this autotile transition pair without deleting either parent material";
            btnPrune.addEventListener('click', () => {
                deleteTransitionPair(at.id);
            });

            actionsRow.appendChild(btnEditWiz);
            actionsRow.appendChild(btnPrune);

            card.appendChild(headerRow);
            card.appendChild(actionsRow);
            rulesBox.appendChild(card);
        });
    }

    /**
     * Surgically deletes a single autotile transition pair without deleting either parent material.
     * @param {string} autotileId - ID of transition autotile to delete.
     */
    function deleteTransitionPair(autotileId) {
        const at = (state.autotiles || []).find(a => a.id === autotileId);
        if (!at) return;

        const confirmPrune = typeof window.confirm === 'function'
            ? window.confirm(`Are you sure you want to prune transition pair '${at.name}' (${at.mat1Name} ↔ ${at.mat2Name})?\n\nBoth materials will remain active in your project, but automatic dual-grid transitions between them will be removed.`)
            : true;
        if (!confirmPrune) return;

        const idx = state.autotiles.findIndex(a => a.id === autotileId);
        if (idx !== -1) {
            state.autotiles.splice(idx, 1);
        }

        // Resync and refresh UI
        if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.renderAutotileSelect === 'function') {
            window.TileWeaver.tilesetManager.renderAutotileSelect();
        }
        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }

        renderTransitionRulesSummary();
        renderTransitionMatrixCanvas();

        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        showMessage(`Pruned transition pair '${at.name}'. Both materials remain active!`, "info");
    }

    /** Multi-tile picker state */
    function toggleTilesetPickerPopover() {
        if (isPickerPopoverOpen) hideTilesetPickerPopover();
        else showTilesetPickerPopover();
    }

    /**
     * Displays tileset picker popover and initializes multi-tile mouse listeners.
     */
    function showTilesetPickerPopover() {
        const popover = document.getElementById('mat-tileset-picker-popover');
        if (!popover) return;

        isPickerPopoverOpen = true;
        popover.classList.remove('hidden');
        pickerSelectedTiles.clear();

        const canvas = document.getElementById('mat-picker-tileset-canvas');
        if (!canvas) return;

        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        const ts = state.tilesets.find(t => t.id === (mat ? mat.tilesetId : '')) || state.tilesets[state.activeTilesetIndex] || state.tilesets[0];

        if (!ts || !ts.image) return;

        canvas.width = ts.image.width;
        canvas.height = ts.image.height;

        renderPickerTilesetCanvas();

        const getTileCoords = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const margin = ts.margin || 0;
            const spacing = ts.spacing || 0;
            const step = state.TILE_SIZE + spacing;
            const tx = Math.floor((clickX - margin) / step);
            const ty = Math.floor((clickY - margin) / step);
            return { tx, ty };
        };

        canvas.onmousedown = (e) => {
            const { tx, ty } = getTileCoords(e);
            if (tx >= 0 && ty >= 0) {
                isDraggingPicker = true;
                pickerDragStartCol = tx;
                pickerDragStartRow = ty;
                pickerHoverCol = tx;
                pickerHoverRow = ty;
                renderPickerTilesetCanvas();
            }
        };

        canvas.onmousemove = (e) => {
            const { tx, ty } = getTileCoords(e);
            if (tx !== pickerHoverCol || ty !== pickerHoverRow) {
                pickerHoverCol = tx;
                pickerHoverRow = ty;
                if (isDraggingPicker) {
                    renderPickerTilesetCanvas();
                }
            }
        };

        canvas.onmouseup = (e) => {
            if (!isDraggingPicker) return;
            const { tx, ty } = getTileCoords(e);
            
            const minCol = Math.max(0, Math.min(pickerDragStartCol, tx));
            const maxCol = Math.max(0, Math.max(pickerDragStartCol, tx));
            const minRow = Math.max(0, Math.min(pickerDragStartRow, ty));
            const maxRow = Math.max(0, Math.max(pickerDragStartRow, ty));

            if (minCol === maxCol && minRow === maxRow) {
                // Toggle single tile selection
                const key = `${minCol},${minRow}`;
                if (pickerSelectedTiles.has(key)) {
                    pickerSelectedTiles.delete(key);
                } else {
                    pickerSelectedTiles.add(key);
                }
            } else {
                // Add all tiles in drag selection rectangle
                for (let r = minRow; r <= maxRow; r++) {
                    for (let c = minCol; c <= maxCol; c++) {
                        pickerSelectedTiles.add(`${c},${r}`);
                    }
                }
            }

            isDraggingPicker = false;
            pickerHoverCol = -1;
            pickerHoverRow = -1;
            renderPickerTilesetCanvas();
        };

        canvas.onmouseleave = () => {
            if (isDraggingPicker) {
                isDraggingPicker = false;
                pickerHoverCol = -1;
                pickerHoverRow = -1;
                renderPickerTilesetCanvas();
            }
        };
    }

    /**
     * Re-renders tileset canvas in popover with selection highlights and drag box overlay.
     * OPTIMIZATION (Zero GC Allocation): Parses integer tile coordinates without string array splitting.
     */
    function renderPickerTilesetCanvas() {
        const canvas = document.getElementById('mat-picker-tileset-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        const ts = state.tilesets.find(t => t.id === (mat ? mat.tilesetId : '')) || state.tilesets[state.activeTilesetIndex] || state.tilesets[0];

        if (!ts || !ts.image) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ts.image, 0, 0);

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;

        // 1. Draw persistent selection highlights for chosen tiles
        pickerSelectedTiles.forEach(key => {
            const commaIdx = key.indexOf(',');
            if (commaIdx === -1) return;
            const tx = parseInt(key.substring(0, commaIdx), 10);
            const ty = parseInt(key.substring(commaIdx + 1), 10);
            if (isNaN(tx) || isNaN(ty)) return;

            const sx = margin + tx * step;
            const sy = margin + ty * step;

            ctx.fillStyle = 'rgba(20, 184, 166, 0.4)';
            ctx.fillRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);

            ctx.strokeStyle = '#2dd4bf';
            ctx.lineWidth = 2;
            ctx.strokeRect(sx + 1, sy + 1, state.TILE_SIZE - 2, state.TILE_SIZE - 2);

            // Small check icon badge
            ctx.fillStyle = '#14b8a6';
            ctx.beginPath();
            ctx.arc(sx + state.TILE_SIZE - 6, sy + 6, 5, 0, Math.PI * 2);
            ctx.fill();
        });

        // 2. Draw active drag selection box highlight
        if (isDraggingPicker && pickerDragStartCol >= 0 && pickerHoverCol >= 0) {
            const minCol = Math.max(0, Math.min(pickerDragStartCol, pickerHoverCol));
            const maxCol = Math.max(0, Math.max(pickerDragStartCol, pickerHoverCol));
            const minRow = Math.max(0, Math.min(pickerDragStartRow, pickerHoverRow));
            const maxRow = Math.max(0, Math.max(pickerDragStartRow, pickerHoverRow));

            const boxX = margin + minCol * step;
            const boxY = margin + minRow * step;
            const boxW = (maxCol - minCol + 1) * step - spacing;
            const boxH = (maxRow - minRow + 1) * step - spacing;

            ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
            ctx.fillRect(boxX, boxY, boxW, boxH);

            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.strokeRect(boxX, boxY, boxW, boxH);
        }

        // 3. Update counter badge & confirm button state
        const countBadge = document.getElementById('mat-picker-selected-count');
        const confirmBtn = document.getElementById('btn-mat-picker-confirm');

        const count = pickerSelectedTiles.size;
        if (countBadge) countBadge.textContent = `${count} Selected`;
        if (confirmBtn) {
            confirmBtn.disabled = count === 0;
            confirmBtn.textContent = count > 1 ? `Add ${count} Variations` : 'Add Variation';
        }
    }

    /**
     * Clears multi-tile picker selection.
     */
    function clearSelectedPickerTiles() {
        pickerSelectedTiles.clear();
        renderPickerTilesetCanvas();
    }

    /**
     * Confirms adding all selected multi-tile variations to the material.
     */
    function confirmAddSelectedVariations() {
        if (!currentEditingMaterialId || pickerSelectedTiles.size === 0) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const variations = getMaterialVariations(mat);
        let addedCount = 0;

        pickerSelectedTiles.forEach(key => {
            const commaIdx = key.indexOf(',');
            if (commaIdx === -1) return;
            const tx = parseInt(key.substring(0, commaIdx), 10);
            const ty = parseInt(key.substring(commaIdx + 1), 10);
            if (isNaN(tx) || isNaN(ty)) return;

            if (!variations.some(v => v.tx === tx && v.ty === ty)) {
                variations.push({ tx, ty, rate: 20, weight: 20, locked: false, isBase: false });
                addedCount++;
            }
        });

        if (addedCount > 0) {
            window.TileWeaver.stateModule.calculateVariationRates(variations);
            saveMaterialVariations(mat, variations);
            renderMaterialPropertiesForm(false);
            hideTilesetPickerPopover();
            showMessage(`Successfully added ${addedCount} new Tile Variation${addedCount > 1 ? 's' : ''}!`, "success");
        } else {
            showMessage("Selected tiles are already variations for this material.", "warning");
        }
    }

    /**
     * Hides tileset picker popover.
     */
    function hideTilesetPickerPopover() {
        const popover = document.getElementById('mat-tileset-picker-popover');
        if (popover) popover.classList.add('hidden');
        isPickerPopoverOpen = false;
        pickerSelectedTiles.clear();
    }

    /**
     * Adds a single tile variation (tx, ty) to current material.
     * @param {number} tx - Tile column.
     * @param {number} ty - Tile row.
     */
    function addTileVariation(tx, ty) {
        if (!currentEditingMaterialId) return;
        const mat = window.TileWeaver.terrainSwatches.getMaterialById(currentEditingMaterialId);
        if (!mat) return;

        const variations = getMaterialVariations(mat);
        if (!variations.some(v => v.tx === tx && v.ty === ty)) {
            variations.push({ tx, ty, rate: 20, weight: 20, locked: false, isBase: false });
            window.TileWeaver.stateModule.calculateVariationRates(variations);
            saveMaterialVariations(mat, variations);
            renderMaterialPropertiesForm(false);
            showMessage(`Added Tile Variation (${tx}, ${ty})!`, "success");
        } else {
            showMessage(`Tile (${tx}, ${ty}) is already a variation for this material!`, "warning");
        }
    }

    // Expose subsystem on window.TileWeaver namespace
    window.TileWeaver.materialProperties = {
        initMaterialPropertiesUI,
        openMaterialPropertiesModal,
        closeMaterialPropertiesModal,
        addTileVariation,
        deleteTransitionPair,
        balanceUnlockedVariations,
        getMaterialVariations,
        saveMaterialVariations,
        rateToSlider,
        sliderToRate
    };
})();
