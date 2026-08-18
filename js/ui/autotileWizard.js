/**
 * @fileoverview Visual Autotile & Terrain Mapper Wizard Modal Module
 * @subsystem Modals, Wizards & Material Studio
 * @frameBudget 0ms in rAF loop / < 1.5ms per modal interaction
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY
 * @stateInvariants Reads and mutates window.TileWeaver.state (state.autotiles, state.materials, state.terrainMapping, state.wizardMapping)
 * @historyTracked Snapshots recorded via history.pushHistoryState() upon autotile persistence
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+ autotile & material schema
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { MODE_SLOTS, CLIFF_7X6_MATRIX, CLIFF_7X5_MATRIX, DUALGRID_6X3_MATRIX, WALL_9X3_MATRIX } = window.TileWeaver.constants;
    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { getGridCoordinates } = window.TileWeaver.rendering;

    // Multi-Partner Carousel State for Terrain Wizard
    let wizardActiveMaterial = null;
    let wizardPartnerList = [];
    let wizardActivePartnerIndex = 0;

    // Reusable Offscreen Canvas Buffer & Color Memoization Cache
    let cachedColorCanvas = null;
    let cachedColorCtx = null;
    const dominantColorCache = new Map();

    /**
     * Returns a reusable offscreen 2D canvas rendering context with willReadFrequently optimization.
     * Eliminates temporary DOM element creation during dominant color extraction.
     * @param {number} size - Square dimension in pixels (e.g., TILE_SIZE)
     * @returns {CanvasRenderingContext2D}
     */
    function getOffscreenColorContext(size) {
        if (!cachedColorCanvas) {
            cachedColorCanvas = document.createElement('canvas');
            cachedColorCanvas.width = size;
            cachedColorCanvas.height = size;
            cachedColorCtx = cachedColorCanvas.getContext('2d', { willReadFrequently: true });
        } else if (cachedColorCanvas.width !== size || cachedColorCanvas.height !== size) {
            cachedColorCanvas.width = size;
            cachedColorCanvas.height = size;
        }
        return cachedColorCtx;
    }

    /**
     * Performs an isolated deep copy of an autotile/terrain mapping dictionary.
     * Ensures variation arrays and coordinate objects are completely cloned without JSON serialization overhead.
     * @param {Object} mapping - Source slot mapping dictionary
     * @returns {Object} Deep-cloned mapping dictionary
     */
    function cloneMapping(mapping) {
        if (!mapping || typeof mapping !== 'object') return {};
        const result = {};
        for (const [key, val] of Object.entries(mapping)) {
            if (Array.isArray(val)) {
                result[key] = val.map(v => ({
                    tx: v.tx ?? 0,
                    ty: v.ty ?? 0,
                    rate: v.rate ?? 100,
                    weight: v.weight ?? 100,
                    locked: !!v.locked,
                    isBase: !!v.isBase
                }));
            } else if (val && typeof val === 'object') {
                result[key] = { tx: val.tx ?? 0, ty: val.ty ?? 0 };
            }
        }
        return result;
    }

    /**
     * Registers modal event listeners for both Autotile Wizard and Terrain Wizard.
     */
    function initAutotileWizardUI() {
        // 1. Single-Material Autotile Wizard Listeners
        document.getElementById('btn-open-autotile-wizard')?.addEventListener('click', openAutotileWizard);
        document.getElementById('btn-close-wizard')?.addEventListener('click', closeWizard);
        document.getElementById('btn-wizard-cancel')?.addEventListener('click', closeWizard);

        // Mode Selection Tabs (Single-Material modes: 9slice, 16tile, 25tile, 47tile)
        document.getElementById('tab-mode-9slice')?.addEventListener('click', () => setWizardMode('9slice'));
        document.getElementById('tab-mode-16tile')?.addEventListener('click', () => setWizardMode('16tile'));
        document.getElementById('tab-mode-25tile')?.addEventListener('click', () => setWizardMode('25tile'));
        document.getElementById('tab-mode-47tile')?.addEventListener('click', () => setWizardMode('47tile'));

        // Quick Auto-Detect Presets
        document.getElementById('btn-wizard-auto-3x3')?.addEventListener('click', () => applyWizardPreset('3x3'));
        document.getElementById('btn-wizard-auto-4x4')?.addEventListener('click', () => applyWizardPreset('4x4'));
        document.getElementById('btn-wizard-auto-5x5')?.addEventListener('click', () => applyWizardPreset('5x5'));
        document.getElementById('btn-wizard-auto-rpgmaker')?.addEventListener('click', () => applyWizardPreset('rpgmaker'));

        document.getElementById('btn-wizard-save')?.addEventListener('click', saveWizardAutotile);

        // Click tileset canvas in Autotile Wizard
        const wizardTilesetCanvas = document.getElementById('wizard-tileset-canvas');
        if (wizardTilesetCanvas) {
            wizardTilesetCanvas.addEventListener('click', (e) => {
                const { col, row } = getGridCoordinates(wizardTilesetCanvas, e);
                if (state.wizardActiveSlotKey) {
                    state.wizardMapping[state.wizardActiveSlotKey] = { tx: col, ty: row };
                    
                    // Auto-advance to next slot
                    const slots = MODE_SLOTS[state.wizardMode] || [];
                    const currIdx = slots.findIndex(s => s.key === state.wizardActiveSlotKey);
                    if (currIdx >= 0 && currIdx < slots.length - 1) {
                        state.wizardActiveSlotKey = slots[currIdx + 1].key;
                    }

                    renderWizardSlotButtons();
                    renderWizardTilesetCanvas();
                    renderWizardPreview();
                    updateSlotTooltip();
                }
            });
        }

        // 2. Dual-Material Terrain, Cliff & Wall Wizard Listeners
        document.getElementById('btn-open-terrain-wizard')?.addEventListener('click', openTerrainWizard);
        document.getElementById('btn-close-terrain-wizard')?.addEventListener('click', closeTerrainWizard);
        document.getElementById('btn-terrain-cancel')?.addEventListener('click', closeTerrainWizard);
        document.getElementById('btn-terrain-add-partner')?.addEventListener('click', () => addNewWizardPartnerTransition());
        document.getElementById('btn-terrain-auto-overlay')?.addEventListener('click', () => toggleTerrainPresetPlacement('overlay'));
        document.getElementById('btn-terrain-auto-dualgrid')?.addEventListener('click', () => toggleTerrainPresetPlacement('dualgrid'));
        document.getElementById('btn-terrain-auto-cliff7x6')?.addEventListener('click', () => toggleTerrainPresetPlacement('cliff7x6'));
        document.getElementById('btn-terrain-auto-wall9x3')?.addEventListener('click', () => toggleTerrainPresetPlacement('wall9x3'));
        document.getElementById('btn-terrain-save')?.addEventListener('click', saveTerrainAutotile);

        // Top Mode Tabs (Ground Terrain vs Cliffside Set vs Wall / Fence Set)
        document.getElementById('tab-terrain-ground')?.addEventListener('click', () => setTerrainWizardMode('ground'));
        document.getElementById('tab-terrain-cliff')?.addEventListener('click', () => setTerrainWizardMode('cliff'));
        document.getElementById('tab-terrain-wall')?.addEventListener('click', () => setTerrainWizardMode('wall'));

        // Live Cliff Preview Wall Height Buttons
        document.getElementById('btn-preview-h1')?.addEventListener('click', () => setCliffPreviewHeight(1));
        document.getElementById('btn-preview-h2')?.addEventListener('click', () => setCliffPreviewHeight(2));
        document.getElementById('btn-preview-h3')?.addEventListener('click', () => setCliffPreviewHeight(3));

        // Header Material Swatch Card Click Listeners
        document.getElementById('btn-terrain-swatch-mat1')?.addEventListener('click', () => {
            state.terrainActiveSlotKey = state.terrainWizardMode === 'cliff' ? 'grid_15' : (state.terrainWizardMode === 'wall' ? 'post' : 'grid_0');
            renderTerrainMaterialHeaderSwatches();
            renderTerrainSlotButtons();
            renderTerrainTilesetCanvas();
            updateTerrainSlotTooltip();
        });

        document.getElementById('btn-terrain-swatch-mat2')?.addEventListener('click', () => {
            state.terrainActiveSlotKey = state.terrainWizardMode === 'cliff' ? 'cliff_face_mid' : 'grid_15';
            renderTerrainMaterialHeaderSwatches();
            renderTerrainSlotButtons();
            renderTerrainTilesetCanvas();
            updateTerrainSlotTooltip();
        });

        document.getElementById('btn-terrain-swatch-mat3')?.addEventListener('click', () => {
            state.terrainActiveSlotKey = 'cliff_base_shadow';
            renderTerrainMaterialHeaderSwatches();
            renderTerrainSlotButtons();
            renderTerrainTilesetCanvas();
            updateTerrainSlotTooltip();
        });

        // Material Select Dropdown Listeners
        document.getElementById('terrain-mat1-select')?.addEventListener('change', handleMaterial1SelectChange);
        document.getElementById('terrain-mat2-select')?.addEventListener('change', handleMaterial2SelectChange);
        document.getElementById('terrain-mat3-select')?.addEventListener('change', handleMaterial3SelectChange);

        // Name input change updates guidance card text and transition slot labels dynamically
        const handleMaterialNameChange = () => {
            if (wizardPartnerList && wizardPartnerList[wizardActivePartnerIndex]) {
                wizardPartnerList[wizardActivePartnerIndex].partnerName = document.getElementById('terrain-mat2-name')?.value.trim() || 'Partner';
                renderPartnerTabsStrip();
            }
            updateTerrainSlotTooltip();
            renderTerrainSlotButtons();
        };
        document.getElementById('terrain-mat1-name')?.addEventListener('input', handleMaterialNameChange);
        document.getElementById('terrain-mat2-name')?.addEventListener('input', handleMaterialNameChange);
        document.getElementById('terrain-mat3-name')?.addEventListener('input', handleMaterialNameChange);

        // Click tileset canvas in Terrain Wizard
        const terrainTilesetCanvas = document.getElementById('terrain-tileset-canvas');
        if (terrainTilesetCanvas) {
            terrainTilesetCanvas.addEventListener('click', (e) => {
                const { col, row } = getGridCoordinates(terrainTilesetCanvas, e);

                // Handle Interactive Preset Placement Mode Commitment (Dual-Grid, Overlay, Cliff7x6, or Wall9x3)
                if (state.terrainPresetPlacementActive) {
                    const presetType = state.presetPlacementType || 'dualgrid';
                    if (presetType === 'wall9x3' || presetType === 'wall') {
                        applyWall9x3PresetAt(col, row);
                    } else if (presetType === 'cliff7x6' || presetType === 'cliff6x5') {
                        applyCliff7x6PresetAt(col, row);
                    } else {
                        applyTerrainPresetAt(col, row);
                    }

                    state.terrainPresetPlacementActive = false;
                    state.terrainPresetHoverCol = -1;
                    state.terrainPresetHoverRow = -1;

                    updateTerrainPresetButtonsUI();

                    renderTerrainMaterialHeaderSwatches();
                    renderTerrainSlotButtons();
                    renderTerrainTilesetCanvas();
                    renderTerrainPreview();
                    updateTerrainSlotTooltip();

                    const presetName = (presetType === 'wall9x3' || presetType === 'wall') ? '9x3 Wall Matrix' : ((presetType === 'cliff7x6' || presetType === 'cliff6x5') ? '7x6 Cliffside Sheet' : (presetType === 'overlay' ? '15-Tile Overlay' : '6x3 Dual-Grid'));
                    showMessage(`Assigned ${presetName} preset at (${col}, ${row})!`, "success");
                    return;
                }

                const key = state.terrainActiveSlotKey;
                if (key) {
                    state.terrainMapping = state.terrainMapping || {};
                    const existing = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, key);

                    if (state.terrainAddVariationMode) {
                        // Append new tile variation
                        existing.push({ tx: col, ty: row, rate: 20, weight: 20, locked: false, isBase: false });
                        window.TileWeaver.stateModule.calculateVariationRates(existing);
                        state.terrainMapping[key] = existing;
                        state.terrainAddVariationMode = false;
                        showMessage(`Added variation tile (${col}, ${row})!`, "info");
                    } else {
                        // Primary tile set
                        state.terrainMapping[key] = [{ tx: col, ty: row, rate: 100, weight: 100, locked: false, isBase: true }];
                        
                        // Auto-advance to next slot in order
                        if (state.terrainWizardMode === 'wall') {
                            const wallSlots = MODE_SLOTS['wall_9x3'] || [];
                            const currIdx = wallSlots.findIndex(s => s.key === key);
                            if (currIdx >= 0 && currIdx < wallSlots.length - 1) {
                                state.terrainActiveSlotKey = wallSlots[currIdx + 1].key;
                            }
                        } else if (state.terrainWizardMode === 'cliff') {
                            if (key === 'grid_15') {
                                // Material 1 (1. Cliff Top) -> Material 2 (2. Cliff Wall)
                                state.terrainActiveSlotKey = 'cliff_face_mid';
                            } else if (key === 'cliff_face_mid') {
                                // Material 2 (2. Cliff Wall) -> Top of Transition States list (0,0)
                                const cliffSlots = MODE_SLOTS['cliff_vstretch'] || [];
                                state.terrainActiveSlotKey = cliffSlots.length > 0 ? cliffSlots[0].key : 'grid_8';
                            } else {
                                // Progress through Transition States list in book-reading order: (0,0) -> (0,1) -> (0,2)...
                                const cliffSlots = MODE_SLOTS['cliff_vstretch'] || [];
                                const currIdx = cliffSlots.findIndex(s => s.key === key);
                                if (currIdx >= 0 && currIdx < cliffSlots.length - 1) {
                                    state.terrainActiveSlotKey = cliffSlots[currIdx + 1].key;
                                }
                            }
                        } else {
                            if (key === 'grid_0') {
                                state.terrainActiveSlotKey = 'grid_15';
                            } else if (key === 'grid_15') {
                                const transitionSlots = (MODE_SLOTS['dualgrid'] || []).filter(s => s.key !== 'grid_0' && s.key !== 'grid_15');
                                state.terrainActiveSlotKey = transitionSlots.length > 0 ? transitionSlots[0].key : 'grid_7';
                            } else {
                                const transitionSlots = (MODE_SLOTS['dualgrid'] || []).filter(s => s.key !== 'grid_0' && s.key !== 'grid_15');
                                const currIdx = transitionSlots.findIndex(s => s.key === key);
                                if (currIdx >= 0 && currIdx < transitionSlots.length - 1) {
                                    state.terrainActiveSlotKey = transitionSlots[currIdx + 1].key;
                                }
                            }
                        }
                    }

                    renderTerrainMaterialHeaderSwatches();
                    renderTerrainSlotButtons();
                    scrollToActiveSlotButton();
                    renderTerrainTilesetCanvas();
                    renderTerrainPreview();
                    updateTerrainSlotTooltip();
                }
            });

            // Hover preview for Interactive 6x3 Preset Placement Box
            terrainTilesetCanvas.addEventListener('mousemove', (e) => {
                if (!state.terrainPresetPlacementActive) return;
                const { col, row } = getGridCoordinates(terrainTilesetCanvas, e);
                if (col !== state.terrainPresetHoverCol || row !== state.terrainPresetHoverRow) {
                    state.terrainPresetHoverCol = col;
                    state.terrainPresetHoverRow = row;
                    renderTerrainTilesetCanvas();
                }
            });

            terrainTilesetCanvas.addEventListener('mouseleave', () => {
                if (state.terrainPresetPlacementActive) {
                    state.terrainPresetHoverCol = -1;
                    state.terrainPresetHoverRow = -1;
                    renderTerrainTilesetCanvas();
                }
            });
        }
    }

    // =========================================================================
    // 1. Single-Material Autotile Wizard Controllers
    // =========================================================================

    /** Opens single-material Autotile Wizard modal */
    function openAutotileWizard() {
        const modal = document.getElementById('autotile-wizard-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        state.wizardMapping = {};
        setWizardMode('9slice');
        renderWizardTilesetCanvas();
    }

    /** Closes single-material Autotile Wizard modal */
    function closeWizard() {
        document.getElementById('autotile-wizard-modal')?.classList.add('hidden');
    }

    /** Sets active single-material autotile mode ('9slice', '16tile', '25tile', '47tile') */
    function setWizardMode(mode) {
        state.wizardMode = mode;
        ['9slice', '16tile', '25tile', '47tile'].forEach(m => {
            const tab = document.getElementById(`tab-mode-${m}`);
            if (tab) {
                if (m === mode) {
                    tab.className = "px-3 py-1 rounded bg-emerald-600 border border-emerald-500 text-white font-bold transition-all wizard-tab-active shadow";
                } else {
                    tab.className = "px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all";
                }
            }
        });

        const slots = MODE_SLOTS[mode] || [];
        state.wizardActiveSlotKey = slots.length > 0 ? slots[0].key : null;

        renderWizardSlotButtons();
        renderWizardPreview();
        updateSlotTooltip();
    }

    /** Updates active slot explanation text box in Autotile Wizard */
    function updateSlotTooltip() {
        const tooltipTitle = document.getElementById('tooltip-title');
        const tooltipDesc = document.getElementById('tooltip-desc');
        const activeLabel = document.getElementById('wizard-active-slot-label');

        const slots = MODE_SLOTS[state.wizardMode] || [];
        const activeSlot = slots.find(s => s.key === state.wizardActiveSlotKey);

        if (activeSlot) {
            if (tooltipTitle) tooltipTitle.textContent = activeSlot.label;
            if (tooltipDesc) tooltipDesc.textContent = activeSlot.desc;
            if (activeLabel) activeLabel.textContent = activeSlot.label;
        }
    }

    /** Renders interactive slot buttons for single-material Autotile Wizard */
    function renderWizardSlotButtons() {
        const container = document.getElementById('wizard-slots-grid');
        if (!container) return;
        container.innerHTML = '';

        const slots = MODE_SLOTS[state.wizardMode] || [];
        let currentCategory = '';

        slots.forEach(slot => {
            if (slot.category && slot.category !== currentCategory) {
                currentCategory = slot.category;
                const catHeader = document.createElement('div');
                catHeader.className = "col-span-full text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1.5 border-b border-slate-800 pb-0.5";
                catHeader.textContent = currentCategory;
                container.appendChild(catHeader);
            }

            const isMapped = !!state.wizardMapping[slot.key];
            const isActive = slot.key === state.wizardActiveSlotKey;

            const btn = document.createElement('button');
            btn.className = `p-2 rounded border text-left flex items-center justify-between transition-all ${
                isActive 
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-200 ring-2 ring-emerald-500/40 font-bold' 
                    : isMapped 
                        ? 'bg-slate-900 border-emerald-800/80 text-emerald-400 hover:bg-slate-850' 
                        : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:bg-slate-850'
            }`;

            const coords = isMapped ? `(${state.wizardMapping[slot.key].tx}, ${state.wizardMapping[slot.key].ty})` : 'Unmapped';

            btn.innerHTML = `
                <div class="flex items-center gap-2 min-w-0">
                    <i class="ph ${slot.icon || 'ph-square'} text-base ${isMapped ? 'text-emerald-400' : 'text-slate-500'}"></i>
                    <span class="text-xs truncate">${slot.label}</span>
                </div>
                <span class="text-[10px] font-mono ${isMapped ? 'text-emerald-400 font-bold' : 'text-slate-500'} ml-1">${coords}</span>
            `;

            btn.addEventListener('click', () => {
                state.wizardActiveSlotKey = slot.key;
                renderWizardSlotButtons();
                renderWizardTilesetCanvas();
                updateSlotTooltip();
            });

            container.appendChild(btn);
        });
    }

    /** Renders clickable tileset viewer canvas inside Autotile Wizard */
    function renderWizardTilesetCanvas() {
        const canvas = document.getElementById('wizard-tileset-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const ts = state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.image) return;

        canvas.width = ts.image.width;
        canvas.height = ts.image.height;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ts.image, 0, 0);

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        for (let x = margin; x <= canvas.width; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = margin; y <= canvas.height; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }

        Object.entries(state.wizardMapping).forEach(([key, val]) => {
            if (!val) return;
            const isSelected = key === state.wizardActiveSlotKey;
            const sx = margin + val.tx * step;
            const sy = margin + val.ty * step;

            ctx.fillStyle = isSelected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.3)';
            ctx.fillRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);

            ctx.strokeStyle = isSelected ? '#10b981' : '#3b82f6';
            ctx.lineWidth = isSelected ? 3 : 1.5;
            ctx.strokeRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);
        });
    }

    /** Renders live composite preview canvas in Autotile Wizard */
    function renderWizardPreview() {
        const canvas = document.getElementById('wizard-preview-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const ts = state.tilesets[state.activeTilesetIndex];
        canvas.width = 96;
        canvas.height = 96;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!ts || !ts.image) return;

        ctx.imageSmoothingEnabled = false;
        const m = state.wizardMapping;
        const drawSlot = (slotKey, destX, destY) => {
            const slot = m[slotKey];
            if (slot) {
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const srcX = margin + slot.tx * (state.TILE_SIZE + spacing);
                const srcY = margin + slot.ty * (state.TILE_SIZE + spacing);
                ctx.drawImage(ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE, destX, destY, 32, 32);
            }
        };

        drawSlot('topLeft', 0, 0);
        drawSlot('top', 32, 0);
        drawSlot('topRight', 64, 0);
        drawSlot('left', 0, 32);
        drawSlot('center', 32, 32);
        drawSlot('right', 64, 32);
        drawSlot('bottomLeft', 0, 64);
        drawSlot('bottom', 32, 64);
        drawSlot('bottomRight', 64, 64);
    }

    /** Applies preset mappings for single-material Autotile Wizard */
    function applyWizardPreset(presetType) {
        state.wizardMapping = {};
        let startCol = state.selectedStamp ? state.selectedStamp.col : 0;
        let startRow = state.selectedStamp ? state.selectedStamp.row : 0;

        if (presetType === '3x3') {
            setWizardMode('9slice');
            const map = [
                ['topLeft', 'top', 'topRight'],
                ['left', 'center', 'right'],
                ['bottomLeft', 'bottom', 'bottomRight']
            ];
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) {
                    state.wizardMapping[map[r][c]] = { tx: startCol + c, ty: startRow + r };
                }
            }
        } else if (presetType === '5x5') {
            setWizardMode('25tile');
            state.wizardMapping = {
                topLeft: {tx: startCol, ty: startRow}, top: {tx: startCol+1, ty: startRow}, topRight: {tx: startCol+2, ty: startRow},
                left: {tx: startCol, ty: startRow+1}, center: {tx: startCol+1, ty: startRow+1}, right: {tx: startCol+2, ty: startRow+1},
                bottomLeft: {tx: startCol, ty: startRow+2}, bottom: {tx: startCol+1, ty: startRow+2}, bottomRight: {tx: startCol+2, ty: startRow+2},
                innerTL: {tx: startCol+3, ty: startRow}, innerTR: {tx: startCol+4, ty: startRow},
                innerBL: {tx: startCol+3, ty: startRow+1}, innerBR: {tx: startCol+4, ty: startRow+1},
                slopeNW: {tx: startCol+3, ty: startRow+2}, slopeNE: {tx: startCol+4, ty: startRow+2},
                slopeSW: {tx: startCol+3, ty: startRow+3}, slopeSE: {tx: startCol+4, ty: startRow+3}
            };
        }

        renderWizardSlotButtons();
        renderWizardTilesetCanvas();
        renderWizardPreview();
        showMessage(`Applied '${presetType}' preset!`, "success");
    }

    /** Saves single-material autotile definition to `state.autotiles` */
    function saveWizardAutotile() {
        const nameInput = document.getElementById('wizard-autotile-name');
        const name = nameInput ? nameInput.value.trim() : 'Custom Autotile';
        const ts = state.tilesets[state.activeTilesetIndex];

        const autoId = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.generateUniqueAutotileId() : ('at_' + (state.autotileCounter++));
        const newAutotile = {
            id: autoId,
            name: name || `Autotile ${autoId.replace('at_', '')}`,
            mode: state.wizardMode,
            tilesetId: ts.id,
            mapping: { ...state.wizardMapping }
        };

        state.autotiles.push(newAutotile);
        state.activeAutotileId = newAutotile.id;

        window.TileWeaver.tilesetManager.renderAutotileSelect();
        closeWizard();
        window.TileWeaver.tools.selectTool('autotile');
        showMessage(`Autotile '${newAutotile.name}' saved!`, "success");
    }

    // =========================================================================
    // 2. Dual-Material Terrain Wizard Controllers
    // =========================================================================

    /**
     * Extracts the dominant non-transparent hex color from a mapped tile (`grid_0` or `grid_15`)
     * using 12-bit color bucket quantization with offscreen buffer reuse and memoization.
     * @param {string} slotKey - Slot key ('grid_0' or 'grid_15')
     * @returns {string} Hex color string (e.g. '#10b981')
     */
    function extractDominantTileColor(slotKey) {
        const fallbackColor = slotKey === 'grid_0' ? '#10b981' : '#f59e0b';
        const ts = state.tilesets[state.activeTilesetIndex];
        const m = state.terrainMapping || {};
        const vars = window.TileWeaver.stateModule.getSlotVariations(m, slotKey);

        if (!vars || vars.length === 0 || !ts || !ts.image) {
            return fallbackColor;
        }

        const tile = vars[0];
        const cacheKey = `${ts.id || state.activeTilesetIndex}:${tile.tx}:${tile.ty}`;
        if (dominantColorCache.has(cacheKey)) {
            return dominantColorCache.get(cacheKey);
        }

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;
        const sx = margin + tile.tx * step;
        const sy = margin + tile.ty * step;

        try {
            // OPTIMIZATION: Reuse offscreen canvas context with willReadFrequently
            const ctx = getOffscreenColorContext(state.TILE_SIZE);
            ctx.clearRect(0, 0, state.TILE_SIZE, state.TILE_SIZE);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, state.TILE_SIZE, state.TILE_SIZE);

            const imgData = ctx.getImageData(0, 0, state.TILE_SIZE, state.TILE_SIZE);
            const data = imgData.data;

            const counts = {};
            const totals = {};

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];

                // Ignore transparent or semi-transparent pixels
                if (a < 128) continue;

                // 12-bit color quantization bucket (mask lower 4 bits)
                const qR = r & 0xf0;
                const qG = g & 0xf0;
                const qB = b & 0xf0;
                const key = `${qR},${qG},${qB}`;

                if (!counts[key]) {
                    counts[key] = 0;
                    totals[key] = { r: 0, g: 0, b: 0 };
                }
                counts[key]++;
                totals[key].r += r;
                totals[key].g += g;
                totals[key].b += b;
            }

            let maxCount = 0;
            let dominantKey = null;
            for (const key of Object.keys(counts)) {
                if (counts[key] > maxCount) {
                    maxCount = counts[key];
                    dominantKey = key;
                }
            }

            if (!dominantKey || maxCount === 0) {
                dominantColorCache.set(cacheKey, fallbackColor);
                return fallbackColor;
            }

            const count = counts[dominantKey];
            const avgR = Math.round(totals[dominantKey].r / count);
            const avgG = Math.round(totals[dominantKey].g / count);
            const avgB = Math.round(totals[dominantKey].b / count);

            const toHex = (c) => c.toString(16).padStart(2, '0');
            const resultHex = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
            dominantColorCache.set(cacheKey, resultHex);
            return resultHex;
        } catch (err) {
            console.warn("Could not extract dominant color:", err);
            return fallbackColor;
        }
    }

    /**
     * Updates dynamic material colors (--mat1-color and --mat2-color) on #terrain-wizard-modal,
     * header cards, color dots, and tooltip text highlights.
     */
    function updateTerrainMaterialColors() {
        const modal = document.getElementById('terrain-wizard-modal');
        if (!modal) return;

        const hex1 = extractDominantTileColor('grid_0');
        const hex2 = extractDominantTileColor('grid_15');

        modal.style.setProperty('--mat1-color', hex1);
        modal.style.setProperty('--mat2-color', hex2);

        // Update header card color dots and text accents
        const dot1 = document.querySelector('#material-card-base span.rounded-full');
        const dot2 = document.querySelector('#material-card-overlay span.rounded-full');

        if (dot1) dot1.style.backgroundColor = hex1;
        if (dot2) dot2.style.backgroundColor = hex2;
    }

    /**
     * Renders mini canvas swatch previews and updates active selection glow states
     * for Material 1 (Solid Base `grid_0`) and Material 2 (Solid Overlay `grid_15`) header cards.
     */
    /**
     * Renders mini canvas swatch previews and updates active selection glow states
     * for Material 1, Material 2, and Material 3 header cards.
     */
    function renderTerrainMaterialHeaderSwatches() {
        updateTerrainMaterialColors();

        const mat1Card = document.getElementById('material-card-base');
        const mat2Card = document.getElementById('material-card-overlay');
        const mat3Card = document.getElementById('material-card-lowerground');

        const canvas1 = document.getElementById('terrain-canvas-mat1');
        const canvas2 = document.getElementById('terrain-canvas-mat2');
        const canvas3 = document.getElementById('terrain-canvas-mat3');

        const coords1 = document.getElementById('terrain-mat1-coords');
        const coords2 = document.getElementById('terrain-mat2-coords');
        const coords3 = document.getElementById('terrain-mat3-coords');

        const ts = state.tilesets[state.activeTilesetIndex];
        const m = state.terrainMapping || {};

        const isCliff = state.terrainWizardMode === 'cliff';
        const isWall = state.terrainWizardMode === 'wall';
        const key1 = isCliff ? 'grid_15' : (isWall ? 'post' : 'grid_0');
        const key2 = isCliff ? 'cliff_face_mid' : 'grid_15';
        const key3 = 'cliff_base_shadow';

        // Active state card glow rings
        const isMat1Active = state.terrainActiveSlotKey === key1 || (isWall && (state.terrainActiveSlotKey === 'post' || state.terrainActiveSlotKey === 'pipeH'));
        const isMat2Active = !isWall && (state.terrainActiveSlotKey === key2);
        const isMat3Active = isCliff && (state.terrainActiveSlotKey === key3);

        if (mat1Card) {
            mat1Card.classList.remove('hidden');
            mat1Card.classList.toggle('mat1-card-active', isMat1Active);
        }
        if (mat2Card) {
            mat2Card.classList.toggle('hidden', isWall);
            mat2Card.classList.toggle('mat2-card-active', isMat2Active);
        }
        if (mat3Card) {
            mat3Card.classList.toggle('hidden', !isCliff);
            mat3Card.classList.toggle('mat3-card-active', isMat3Active);
        }

        // Helper: Draw pure tile thumbnail onto 32x32 canvas
        const drawSwatchThumbnail = (canvasEl, slotKey, coordsEl) => {
            if (!canvasEl) return;
            const ctx = canvasEl.getContext('2d');
            ctx.clearRect(0, 0, 32, 32);

            let vars = window.TileWeaver.stateModule.getSlotVariations(m, slotKey);
            if ((!vars || vars.length === 0) && isWall) {
                // Fallback to pipeH or first mapped slot in wall mode
                const altKey = Object.keys(m).find(k => window.TileWeaver.stateModule.getSlotVariations(m, k).length > 0);
                if (altKey) vars = window.TileWeaver.stateModule.getSlotVariations(m, altKey);
            }

            if (vars && vars.length > 0 && ts && ts.image) {
                ctx.imageSmoothingEnabled = false;
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const step = state.TILE_SIZE + spacing;
                const sx = margin + vars[0].tx * step;
                const sy = margin + vars[0].ty * step;
                ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 32, 32);
                if (coordsEl) {
                    coordsEl.innerHTML = `<span class="text-emerald-400 font-bold flex items-center gap-0.5"><i class="ph ph-check"></i> (${vars[0].tx}, ${vars[0].ty})</span>`;
                }
            } else {
                if (coordsEl) {
                    coordsEl.innerHTML = `<span class="text-amber-400 font-bold flex items-center gap-0.5 animate-pulse"><i class="ph ph-warning"></i> Unmapped</span>`;
                }
            }
        };

        drawSwatchThumbnail(canvas1, key1, coords1);
        if (!isWall) drawSwatchThumbnail(canvas2, key2, coords2);
        if (isCliff) drawSwatchThumbnail(canvas3, key3, coords3);
    }

    /**
     * Helper: Resolves existing tile variations array for a material if already defined.
     */
    function getExistingMaterialVariations(matName) {
        if (!matName) return null;
        const nameLower = typeof matName === 'string' ? matName.toLowerCase() : (matName.name ? matName.name.toLowerCase() : '');
        if (!nameLower) return null;
        const existingAT = state.autotiles.find(a =>
            (a.mode === 'dualgrid' || a.mode === 'overlay_dualgrid' || a.isCliff || a.mode === 'cliff_vstretch' || a.mode === '16tile' || a.mode === 'wall_9x3') && (
                (a.mat1Name && a.mat1Name.toLowerCase() === nameLower) ||
                (a.mat2Name && a.mat2Name.toLowerCase() === nameLower) ||
                (a.mat3Name && a.mat3Name.toLowerCase() === nameLower)
            )
        );
        if (existingAT && existingAT.mapping) {
            const isMat1 = existingAT.mat1Name && existingAT.mat1Name.toLowerCase() === nameLower;
            const slotKey = isMat1 ? (existingAT.isCliff ? 'grid_15' : (existingAT.isWall ? 'post' : 'grid_0')) : 'grid_15';
            const vars = window.TileWeaver.stateModule.getSlotVariations(existingAT.mapping, slotKey);
            if (vars.length > 0) return vars;
        }
        return null;
    }

    /** Helper: Generates unique material name like "Cliff Top", "Cliff Top_01", "Cliff Top_02" */
    function generateUniqueMaterialName(baseName, existingMaterials) {
        const names = (existingMaterials || []).map(m => (m.name || '').trim().toLowerCase());
        if (!names.includes(baseName.toLowerCase())) {
            return baseName;
        }
        let counter = 1;
        while (true) {
            const numStr = counter < 10 ? `0${counter}` : `${counter}`;
            const candidate = `${baseName}_${numStr}`;
            if (!names.includes(candidate.toLowerCase())) {
                return candidate;
            }
            counter++;
        }
    }

    /**
     * Rebuilds and populates dropdown options for Material 1, 2, and 3 selects.
     */
    function populateTerrainMaterialSelects() {
        state.terrainMapping = state.terrainMapping || {};

        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
        }

        const select1 = document.getElementById('terrain-mat1-select');
        const select2 = document.getElementById('terrain-mat2-select');
        const select3 = document.getElementById('terrain-mat3-select');
        const input1 = document.getElementById('terrain-mat1-name');
        const input2 = document.getElementById('terrain-mat2-name');
        const input3 = document.getElementById('terrain-mat3-name');

        if (!select1 || !select2) return;

        const materials = state.materials || [];

        // Build HTML options list
        const optionsHTML = `
            <option value="__new__">+ Add New Material...</option>
            ${materials.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
        `;

        select1.innerHTML = optionsHTML;
        select2.innerHTML = optionsHTML;
        if (select3) select3.innerHTML = optionsHTML;

        // If editing a material or an existing autotile, hydrate handles the specific assignment
        if (wizardActiveMaterial || state.editingAutotileId) {
            return;
        }

        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';

        if (isWallMode) {
            select1.value = '__new__';
            if (input1) input1.value = generateUniqueMaterialName('Wall', materials);
            delete state.terrainMapping['post'];
        } else if (isCliffMode) {
            // Material 1: Default to "+ Add New Material", name "Cliff Top" (or "Cliff Top_01" if pre-existing) - UNMAPPED by default
            select1.value = '__new__';
            if (input1) input1.value = generateUniqueMaterialName('Cliff Top', materials);
            delete state.terrainMapping['grid_15'];

            // Material 2: Default to "+ Add New Material", name "Cliff Wall" (or "Cliff Wall_01" if pre-existing) - UNMAPPED by default
            select2.value = '__new__';
            if (input2) input2.value = generateUniqueMaterialName('Cliff Wall', materials);
            delete state.terrainMapping['cliff_face_mid'];

            // Material 3: Default to the first normal "Ground Terrain" created
            if (select3) {
                const firstGroundMat = materials.find(m => !m.isCliff) || materials[0];
                if (firstGroundMat) {
                    select3.value = firstGroundMat.id;
                    if (input3) input3.value = firstGroundMat.name;
                    const vars3 = getExistingMaterialVariations(firstGroundMat.name) || [{ tx: firstGroundMat.tx || 0, ty: firstGroundMat.ty || 0, weight: 100 }];
                    state.terrainMapping['cliff_base_shadow'] = vars3;
                } else {
                    select3.value = '__new__';
                    if (input3) input3.value = generateUniqueMaterialName('Lower Ground Surface', materials);
                    delete state.terrainMapping['cliff_base_shadow'];
                }
            }
        } else {
            // Set initial smart defaults while preserving existing variations in normal ground mode
            if (materials.length > 0) {
                const activeMat = state.activeMaterialId ? materials.find(m => m.id === state.activeMaterialId) : null;
                const mat1ToUse = activeMat || materials[0];
                if (mat1ToUse) {
                    select1.value = mat1ToUse.id;
                    if (input1) input1.value = mat1ToUse.name;
                    const vars1 = getExistingMaterialVariations(mat1ToUse.name) || [{ tx: mat1ToUse.tx || 0, ty: mat1ToUse.ty || 0, weight: 100 }];
                    state.terrainMapping['grid_0'] = vars1;
                }

                const secondMat = materials.find(m => m.id !== select1.value);
                if (secondMat) {
                    select2.value = secondMat.id;
                    if (input2) input2.value = secondMat.name;
                    const vars2 = getExistingMaterialVariations(secondMat.name) || [{ tx: secondMat.tx || 0, ty: secondMat.ty || 0, weight: 100 }];
                    state.terrainMapping['grid_15'] = vars2;
                } else {
                    select2.value = '__new__';
                    if (input2) input2.value = 'Dirt (Overlay)';
                }

                if (select3) {
                    const thirdMat = materials.find(m => m.id !== select1.value && m.id !== select2.value) || materials[0];
                    if (thirdMat) {
                        select3.value = thirdMat.id;
                        if (input3) input3.value = thirdMat.name;
                    } else {
                        select3.value = '__new__';
                        if (input3) input3.value = 'Lower Grass Ground';
                    }
                }
            } else {
                select1.value = '__new__';
                select2.value = '__new__';
                if (select3) select3.value = '__new__';
                if (input1) input1.value = 'Grass (Base)';
                if (input2) input2.value = 'Dirt (Overlay)';
                if (input3) input3.value = 'Lower Grass Ground';
            }
        }
    }

    /** Handles selection change on Material 1 dropdown */
    function handleMaterial1SelectChange() {
        const select1 = document.getElementById('terrain-mat1-select');
        const input1 = document.getElementById('terrain-mat1-name');
        if (!select1 || !input1) return;

        const val = select1.value;
        const materials = state.materials || [];
        let selectedMatName = state.terrainWizardMode === 'cliff' ? generateUniqueMaterialName('Cliff Top', materials) : 'New Base Material';
        const slotKey = state.terrainWizardMode === 'cliff' ? 'grid_15' : 'grid_0';

        if (val === '__new__') {
            input1.value = selectedMatName;
            if (state.terrainMapping) {
                delete state.terrainMapping[slotKey];
            }
        } else {
            const mat = materials.find(m => m.id === val);
            if (mat) {
                input1.value = mat.name;
                selectedMatName = mat.name;
                state.terrainMapping = state.terrainMapping || {};
                const vars = getExistingMaterialVariations(mat.name) || [{ tx: mat.tx || 0, ty: mat.ty || 0, weight: 100 }];
                state.terrainMapping[slotKey] = vars;
            }
        }

        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        updateTerrainSlotTooltip();
    }

    /** Handles selection change on Material 2 dropdown */
    function handleMaterial2SelectChange() {
        const select2 = document.getElementById('terrain-mat2-select');
        const input2 = document.getElementById('terrain-mat2-name');
        if (!select2 || !input2) return;

        const val = select2.value;
        const materials = state.materials || [];
        let selectedMatName = state.terrainWizardMode === 'cliff' ? generateUniqueMaterialName('Cliff Wall', materials) : 'New Overlay Material';
        const slotKey = state.terrainWizardMode === 'cliff' ? 'cliff_face_mid' : 'grid_15';

        if (val === '__new__') {
            input2.value = selectedMatName;
            if (state.terrainMapping) {
                delete state.terrainMapping[slotKey];
            }
        } else {
            const mat = materials.find(m => m.id === val);
            if (mat) {
                input2.value = mat.name;
                selectedMatName = mat.name;
                state.terrainMapping = state.terrainMapping || {};
                const vars = getExistingMaterialVariations(mat.name) || [{ tx: mat.tx || 0, ty: mat.ty || 0, weight: 100 }];
                state.terrainMapping[slotKey] = vars;
            }
        }

        if (wizardPartnerList && wizardPartnerList[wizardActivePartnerIndex]) {
            const curr = wizardPartnerList[wizardActivePartnerIndex];
            curr.partnerName = selectedMatName;
            curr.partnerMatId = val;
            const mat = materials.find(m => m.id === val);
            if (mat) {
                curr.partnerColor = mat.color;
                curr.priority = mat.priority;
                const dot = document.getElementById('terrain-mat2-color-dot');
                if (dot) dot.style.backgroundColor = mat.color;
                const priorityInput = document.getElementById('terrain-mat2-priority');
                if (priorityInput) priorityInput.value = mat.priority || 1;
            }
            renderPartnerTabsStrip();
        }

        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        updateTerrainSlotTooltip();
    }

    /** Handles selection change on Material 3 (Lower Base Ground) dropdown */
    function handleMaterial3SelectChange() {
        const select3 = document.getElementById('terrain-mat3-select');
        const input3 = document.getElementById('terrain-mat3-name');
        if (!select3 || !input3) return;

        const val = select3.value;
        const materials = state.materials || [];
        let selectedMatName = generateUniqueMaterialName('Lower Ground Surface', materials);
        if (val === '__new__') {
            input3.value = selectedMatName;
        } else {
            const mat = materials.find(m => m.id === val);
            if (mat) {
                input3.value = mat.name;
                selectedMatName = mat.name;
                state.terrainMapping = state.terrainMapping || {};
                const vars = getExistingMaterialVariations(mat.name) || [{ tx: mat.tx || 0, ty: mat.ty || 0, weight: 100 }];
                state.terrainMapping['cliff_base_shadow'] = vars;
            }
        }

        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        updateTerrainSlotTooltip();
    }

    /** Opens dual-material Terrain Wizard modal in creation mode */
    function openTerrainWizard() {
        const modal = document.getElementById('terrain-wizard-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        wizardActiveMaterial = null;
        wizardPartnerList = [];
        wizardActivePartnerIndex = 0;
        state.editingAutotileId = null;
        state.terrainMapping = state.terrainMapping || {};
        state.terrainMapping = {};
        state.terrainPresetPlacementActive = false;
        state.terrainPresetHoverCol = -1;
        state.terrainPresetHoverRow = -1;

        const editBadge = document.getElementById('terrain-wizard-edit-badge');
        if (editBadge) editBadge.classList.add('hidden');

        const saveBtn = document.getElementById('btn-terrain-save');
        if (saveBtn) {
            saveBtn.innerHTML = `Save Terrain Autotile`;
            saveBtn.className = "px-5 py-1.5 bg-teal-600 hover:bg-teal-500 rounded text-xs text-white font-bold shadow transition-colors";
        }

        const nameInput = document.getElementById('terrain-autotile-name');
        if (nameInput) nameInput.value = 'Custom Dual-Grid Terrain';

        populateTerrainMaterialSelects();
        setTerrainWizardMode(state.terrainWizardMode || 'ground');

        // Create default partner entry for creation mode
        wizardPartnerList = [{
            autotileId: null,
            autotileName: 'Custom Dual-Grid Terrain',
            partnerMatId: '__new__',
            partnerName: 'Dirt (Overlay)',
            partnerColor: '#f59e0b',
            priority: 1,
            tilesetId: state.tilesets[state.activeTilesetIndex]?.id || '',
            mapping: {},
            isOverlayMode: false,
            isCliff: false,
            isWall: false,
            isNew: true,
            isModified: false
        }];
        wizardActivePartnerIndex = 0;
        renderPartnerTabsStrip();
    }

    /**
     * Opens Terrain Wizard for a base Material Swatch, dynamically gathering all partner autotiles
     * and displaying the Partner Transition Carousel & Tab Strip for multi-transition editing.
     * @param {string} materialId - ID of base material (e.g. Grass)
     */
    function openTerrainWizardForMaterial(materialId) {
        if (!materialId) {
            openTerrainWizard();
            return;
        }

        const mat = (state.materials || []).find(m => m.id === materialId);
        if (!mat) {
            openTerrainWizard();
            return;
        }

        const modal = document.getElementById('terrain-wizard-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        wizardActiveMaterial = mat;
        wizardPartnerList = [];
        wizardActivePartnerIndex = 0;
        state.terrainPresetPlacementActive = false;
        state.terrainPresetHoverCol = -1;
        state.terrainPresetHoverRow = -1;

        const isCliffMode = !!mat.isCliff;
        const isWallMode = !!mat.isWall;
        const targetMode = isCliffMode ? 'cliff' : (isWallMode ? 'wall' : 'ground');
        state.terrainWizardMode = targetMode;

        // Query all autotiles linked to this material
        const matNameLower = mat.name.toLowerCase();
        const linkedAutotiles = (state.autotiles || []).filter(at => {
            const m1Match = at.mat1Name && at.mat1Name.toLowerCase() === matNameLower;
            const m2Match = at.mat2Name && at.mat2Name.toLowerCase() === matNameLower;
            return m1Match || m2Match;
        });

        if (linkedAutotiles.length > 0 && !isCliffMode && !isWallMode) {
            linkedAutotiles.forEach(at => {
                const isM1 = at.mat1Name && at.mat1Name.toLowerCase() === matNameLower;
                const partnerName = isM1 ? (at.mat2Name || 'Overlay') : at.mat1Name;
                const partnerMat = (state.materials || []).find(m => m.name.toLowerCase() === (partnerName || '').toLowerCase());
                
                wizardPartnerList.push({
                    autotileId: at.id,
                    autotileName: at.name,
                    partnerMatId: partnerMat ? partnerMat.id : '__new__',
                    partnerName: partnerName,
                    partnerColor: partnerMat ? partnerMat.color : '#f59e0b',
                    priority: partnerMat ? (partnerMat.priority || 1) : (at.mat2Priority || 1),
                    tilesetId: at.tilesetId || (state.tilesets[state.activeTilesetIndex]?.id || ''),
                    mapping: cloneMapping(at.mapping || {}),
                    isOverlayMode: !!at.isOverlayMode,
                    isCliff: false,
                    isWall: false,
                    isNew: false,
                    isModified: false
                });
            });
        } else if (linkedAutotiles.length > 0 && (isCliffMode || isWallMode)) {
            const at = linkedAutotiles[0];
            wizardPartnerList.push({
                autotileId: at.id,
                autotileName: at.name,
                partnerMatId: '__new__',
                partnerName: at.mat2Name || 'Overlay',
                partnerColor: '#f59e0b',
                priority: 1,
                tilesetId: at.tilesetId || (state.tilesets[state.activeTilesetIndex]?.id || ''),
                mapping: cloneMapping(at.mapping || {}),
                isOverlayMode: !!at.isOverlayMode,
                isCliff: isCliffMode,
                isWall: isWallMode,
                isNew: false,
                isModified: false
            });
        } else {
            const defaultPartnerMat = (state.materials || []).find(m => m.id !== mat.id && !m.isCliff && !m.isWall) || null;
            wizardPartnerList.push({
                autotileId: null,
                autotileName: `${mat.name} ↔ ${defaultPartnerMat ? defaultPartnerMat.name : 'Dirt'}`,
                partnerMatId: defaultPartnerMat ? defaultPartnerMat.id : '__new__',
                partnerName: defaultPartnerMat ? defaultPartnerMat.name : 'Dirt (Overlay)',
                partnerColor: defaultPartnerMat ? defaultPartnerMat.color : '#f59e0b',
                priority: defaultPartnerMat ? defaultPartnerMat.priority : 1,
                tilesetId: state.tilesets[state.activeTilesetIndex]?.id || '',
                mapping: {},
                isOverlayMode: false,
                isCliff: isCliffMode,
                isWall: isWallMode,
                isNew: true,
                isModified: true
            });
        }

        wizardActivePartnerIndex = 0;

        // UI Header Badges
        const editBadge = document.getElementById('terrain-wizard-edit-badge');
        if (editBadge) {
            editBadge.textContent = `EDITING · ${mat.name} (${wizardPartnerList.length} Transition${wizardPartnerList.length === 1 ? '' : 's'})`;
            editBadge.classList.remove('hidden');
        }

        const saveBtn = document.getElementById('btn-terrain-save');
        if (saveBtn) {
            saveBtn.innerHTML = `<i class="ph ph-check-circle text-sm"></i> Update Terrain Autotile(s)`;
            saveBtn.className = "px-5 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-bold shadow transition-colors flex items-center gap-1.5";
        }

        populateTerrainMaterialSelects();
        setTerrainWizardMode(targetMode);
        renderPartnerTabsStrip();
        hydrateActivePartnerMapping();

        showMessage(`Loaded ${wizardPartnerList.length} transition partner${wizardPartnerList.length === 1 ? '' : 's'} for '${mat.name}' in Terrain Wizard.`, "info");
    }

    /**
     * Opens Terrain Wizard pre-hydrated with an existing autotile's mapping, materials, and tileset.
     * Allows in-place editing of misclicked slots, 6x3 preset realignment, and material reassignments.
     * @param {string} autotileId - ID of autotile definition in state.autotiles to edit.
     */
    function openTerrainWizardForAutotile(autotileId) {
        if (!autotileId) return;
        const at = state.autotiles.find(a => a.id === autotileId);
        if (!at) {
            showMessage(`Autotile '${autotileId}' not found.`, "warning");
            return;
        }

        // Find parent material if available to load all sibling partners
        const m1 = (state.materials || []).find(m => at.mat1Name && m.name.toLowerCase() === at.mat1Name.toLowerCase());
        if (m1) {
            openTerrainWizardForMaterial(m1.id);
            // Focus on this specific autotile partner in the carousel
            const pIdx = wizardPartnerList.findIndex(p => p.autotileId === at.id);
            if (pIdx !== -1) {
                switchWizardPartnerTransition(pIdx);
            }
            return;
        }

        // Fallback for single autotile without registered material
        const modal = document.getElementById('terrain-wizard-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        state.editingAutotileId = autotileId;
        state.terrainPresetPlacementActive = false;
        state.terrainPresetHoverCol = -1;
        state.terrainPresetHoverRow = -1;

        state.terrainMapping = cloneMapping(at.mapping || {});
        state.isOverlayWizardMode = !!at.isOverlayMode;

        let targetMode = 'ground';
        if (at.isCliff || at.mode === 'cliff_vstretch') {
            targetMode = 'cliff';
        } else if (at.isWall || at.mode === '16tile' || at.mode === 'wall_9x3' || at.mode === 'wall') {
            targetMode = 'wall';
        }
        state.terrainWizardMode = targetMode;

        if (at.tilesetId) {
            const tsIdx = state.tilesets.findIndex(t => t.id === at.tilesetId);
            if (tsIdx !== -1) {
                state.activeTilesetIndex = tsIdx;
                if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.renderTilesetSelect === 'function') {
                    window.TileWeaver.tilesetManager.renderTilesetSelect();
                }
            }
        }

        populateTerrainMaterialSelects();

        const nameInput = document.getElementById('terrain-autotile-name');
        if (nameInput) nameInput.value = at.name || 'Custom Terrain Autotile';

        const input1 = document.getElementById('terrain-mat1-name');
        const input2 = document.getElementById('terrain-mat2-name');
        const input3 = document.getElementById('terrain-mat3-name');
        const select1 = document.getElementById('terrain-mat1-select');
        const select2 = document.getElementById('terrain-mat2-select');
        const select3 = document.getElementById('terrain-mat3-select');

        if (input1 && at.mat1Name) {
            input1.value = at.mat1Name;
            const mat1Obj = (state.materials || []).find(m => m.name.toLowerCase() === at.mat1Name.toLowerCase());
            if (select1 && mat1Obj) select1.value = mat1Obj.id;
        }
        if (input2 && at.mat2Name) {
            input2.value = at.mat2Name;
            const mat2Obj = (state.materials || []).find(m => m.name.toLowerCase() === at.mat2Name.toLowerCase());
            if (select2 && mat2Obj) select2.value = mat2Obj.id;
        }
        if (input3 && at.mat3Name) {
            input3.value = at.mat3Name;
            const mat3Obj = (state.materials || []).find(m => m.name.toLowerCase() === at.mat3Name.toLowerCase());
            if (select3 && mat3Obj) select3.value = mat3Obj.id;
        }

        setTerrainWizardMode(targetMode);

        wizardPartnerList = [{
            autotileId: at.id,
            autotileName: at.name,
            partnerMatId: select2 ? select2.value : '__new__',
            partnerName: at.mat2Name || 'Overlay',
            partnerColor: '#f59e0b',
            priority: 1,
            tilesetId: at.tilesetId || '',
            mapping: cloneMapping(at.mapping || {}),
            isOverlayMode: !!at.isOverlayMode,
            isCliff: targetMode === 'cliff',
            isWall: targetMode === 'wall',
            isNew: false,
            isModified: false
        }];
        wizardActivePartnerIndex = 0;
        renderPartnerTabsStrip();

        const editBadge = document.getElementById('terrain-wizard-edit-badge');
        if (editBadge) {
            editBadge.textContent = `EDITING · ${at.name}`;
            editBadge.classList.remove('hidden');
        }

        const saveBtn = document.getElementById('btn-terrain-save');
        if (saveBtn) {
            saveBtn.innerHTML = `<i class="ph ph-check-circle text-sm"></i> Update Autotile`;
            saveBtn.className = "px-5 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-bold shadow transition-colors flex items-center gap-1.5";
        }

        showMessage(`Loaded '${at.name}' in Terrain Wizard. Click any slot or 6x3 preset to remap!`, "info");
    }

    /**
     * Renders horizontal pill tabs for all transition partners connected to the active material.
     */
    function renderPartnerTabsStrip() {
        const container = document.getElementById('terrain-partner-tabs');
        const deckContainer = document.getElementById('terrain-partner-tabs-container');
        if (!container || !deckContainer) return;

        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';

        if (isCliffMode || isWallMode) {
            deckContainer.classList.add('hidden');
            return;
        }

        deckContainer.classList.remove('hidden');
        container.innerHTML = '';

        wizardPartnerList.forEach((partner, idx) => {
            const isActive = idx === wizardActivePartnerIndex;
            const mappedSlotsCount = Object.keys(partner.mapping || {}).length;
            const isComplete = mappedSlotsCount >= 16;
            const pColor = partner.partnerColor || '#f59e0b';

            const tabBtn = document.createElement('div');
            tabBtn.className = isActive
                ? "flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500 text-white font-bold text-xs shadow-sm ring-1 ring-amber-500/50 transition-all cursor-pointer shrink-0"
                : "flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs transition-all cursor-pointer shrink-0";

            tabBtn.innerHTML = `
                <span class="w-2.5 h-2.5 rounded-full shadow-sm shrink-0" style="background-color: ${pColor}"></span>
                <span class="truncate max-w-[110px]">${partner.partnerName}</span>
                <span class="text-[9px] px-1 py-0.2 rounded font-mono ${isComplete ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-900 text-slate-400 border border-slate-800'}">${mappedSlotsCount}/16</span>
            `;

            if (wizardPartnerList.length > 1) {
                const pruneBtn = document.createElement('button');
                pruneBtn.type = 'button';
                pruneBtn.title = `Remove ${partner.partnerName} transition partner`;
                pruneBtn.className = "hover:text-red-400 text-slate-500 ml-0.5 p-0.5 rounded transition-colors";
                pruneBtn.innerHTML = `<i class="ph ph-x text-[10px]"></i>`;
                pruneBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pruneWizardPartnerTransition(idx);
                });
                tabBtn.appendChild(pruneBtn);
            }

            tabBtn.addEventListener('click', () => {
                switchWizardPartnerTransition(idx);
            });

            container.appendChild(tabBtn);
        });
    }

    /**
     * Commits working slot mappings and switches to target transition partner in the carousel.
     * @param {number} targetIndex - Partner index to activate
     */
    function switchWizardPartnerTransition(targetIndex) {
        if (targetIndex === wizardActivePartnerIndex || targetIndex < 0 || targetIndex >= wizardPartnerList.length) return;

        // 1. Commit current working state
        const currentPartner = wizardPartnerList[wizardActivePartnerIndex];
        if (currentPartner) {
            currentPartner.mapping = cloneMapping(state.terrainMapping || {});
            currentPartner.partnerName = document.getElementById('terrain-mat2-name')?.value.trim() || currentPartner.partnerName;
            currentPartner.priority = parseInt(document.getElementById('terrain-mat2-priority')?.value) || currentPartner.priority;
            currentPartner.isModified = true;
        }

        // 2. Switch active index
        wizardActivePartnerIndex = targetIndex;

        // 3. Render tabs and hydrate target partner
        renderPartnerTabsStrip();
        hydrateActivePartnerMapping();
    }

    /**
     * Hydrates wizard slot grid, material inputs, tileset view, and live preview for the active partner.
     */
    function hydrateActivePartnerMapping() {
        const partner = wizardPartnerList[wizardActivePartnerIndex];
        if (!partner) return;

        state.editingAutotileId = partner.autotileId;
        state.terrainMapping = cloneMapping(partner.mapping || {});
        state.isOverlayWizardMode = !!partner.isOverlayMode;

        // Switch tileset if partner specifies one
        if (partner.tilesetId) {
            const tsIdx = state.tilesets.findIndex(t => t.id === partner.tilesetId);
            if (tsIdx !== -1 && tsIdx !== state.activeTilesetIndex) {
                state.activeTilesetIndex = tsIdx;
                if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.renderTilesetSelect === 'function') {
                    window.TileWeaver.tilesetManager.renderTilesetSelect();
                }
            }
        }

        // Update Material 1 Input & Card
        const input1 = document.getElementById('terrain-mat1-name');
        const select1 = document.getElementById('terrain-mat1-select');
        if (wizardActiveMaterial) {
            if (input1) input1.value = wizardActiveMaterial.name;
            if (select1) select1.value = wizardActiveMaterial.id;
        }

        // Update Material 2 Input & Card
        const input2 = document.getElementById('terrain-mat2-name');
        const select2 = document.getElementById('terrain-mat2-select');
        const priority2 = document.getElementById('terrain-mat2-priority');
        const colorDot2 = document.getElementById('terrain-mat2-color-dot');
        if (input2) input2.value = partner.partnerName;
        if (priority2) priority2.value = partner.priority || 1;
        if (colorDot2) colorDot2.style.backgroundColor = partner.partnerColor || '#f59e0b';
        if (select2) {
            select2.value = partner.partnerMatId || '__new__';
        }

        // Autotile Name
        const nameInput = document.getElementById('terrain-autotile-name');
        if (nameInput) {
            nameInput.value = partner.autotileName || `${wizardActiveMaterial ? wizardActiveMaterial.name : 'Terrain'} ↔ ${partner.partnerName}`;
        }

        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        updateTerrainSlotTooltip();
    }

    /**
     * Adds a new partner transition to the active material and immediately activates it for mapping.
     * @param {string} [customName] - Optional custom name
     */
    function addNewWizardPartnerTransition(customName) {
        // Commit current working state
        const currentPartner = wizardPartnerList[wizardActivePartnerIndex];
        if (currentPartner) {
            currentPartner.mapping = cloneMapping(state.terrainMapping || {});
            currentPartner.partnerName = document.getElementById('terrain-mat2-name')?.value.trim() || currentPartner.partnerName;
            currentPartner.priority = parseInt(document.getElementById('terrain-mat2-priority')?.value) || currentPartner.priority;
            currentPartner.isModified = true;
        }

        // Find existing materials not yet in partner list
        const existingPartnerNames = wizardPartnerList.map(p => p.partnerName.toLowerCase());
        const baseName = wizardActiveMaterial ? wizardActiveMaterial.name.toLowerCase() : '';
        const unmappedMat = (state.materials || []).find(m => 
            m.name.toLowerCase() !== baseName &&
            !existingPartnerNames.includes(m.name.toLowerCase()) &&
            !m.isCliff && !m.isWall
        );

        const newName = customName || (unmappedMat ? unmappedMat.name : `Partner ${wizardPartnerList.length + 1}`);
        const newColor = unmappedMat ? unmappedMat.color : (['#38bdf8', '#a855f7', '#ec4899', '#f97316', '#22c55e'][wizardPartnerList.length % 5]);
        const newPriority = unmappedMat ? unmappedMat.priority : (wizardPartnerList.length + 1);

        const newPartner = {
            autotileId: null,
            autotileName: `${wizardActiveMaterial ? wizardActiveMaterial.name : 'Terrain'} ↔ ${newName}`,
            partnerMatId: unmappedMat ? unmappedMat.id : '__new__',
            partnerName: newName,
            partnerColor: newColor,
            priority: newPriority,
            tilesetId: state.tilesets[state.activeTilesetIndex]?.id || '',
            mapping: {},
            isOverlayMode: false,
            isCliff: false,
            isWall: false,
            isNew: true,
            isModified: true
        };

        // Seed base solid tile (grid_0) from base material if available
        if (wizardActiveMaterial) {
            const baseVars = getExistingMaterialVariations(wizardActiveMaterial.name);
            if (baseVars && baseVars.length > 0) {
                newPartner.mapping['grid_0'] = baseVars;
            }
        }
        if (unmappedMat) {
            const overlayVars = getExistingMaterialVariations(unmappedMat.name);
            if (overlayVars && overlayVars.length > 0) {
                newPartner.mapping['grid_15'] = overlayVars;
            }
        }

        wizardPartnerList.push(newPartner);
        wizardActivePartnerIndex = wizardPartnerList.length - 1;

        renderPartnerTabsStrip();
        hydrateActivePartnerMapping();
        showMessage(`Added partner '${newName}'! Click 'Auto 6x3 Dual-Grid Preset' to map on your tileset.`, "info");
    }

    /**
     * Removes a partner transition from the wizard list and stages its autotile for pruning.
     * @param {number} index - Index of partner to prune
     */
    function pruneWizardPartnerTransition(index) {
        if (wizardPartnerList.length <= 1) {
            showMessage("At least one transition partner is required.", "warning");
            return;
        }

        const partner = wizardPartnerList[index];
        const confirmPrune = window.confirm(`Remove transition partner '${partner.partnerName}' from this terrain swatch?`);
        if (!confirmPrune) return;

        if (partner.autotileId) {
            const atIdx = (state.autotiles || []).findIndex(a => a.id === partner.autotileId);
            if (atIdx !== -1) {
                state.autotiles.splice(atIdx, 1);
            }
        }

        wizardPartnerList.splice(index, 1);
        if (wizardActivePartnerIndex >= wizardPartnerList.length) {
            wizardActivePartnerIndex = wizardPartnerList.length - 1;
        }

        renderPartnerTabsStrip();
        hydrateActivePartnerMapping();
        showMessage(`Removed transition partner '${partner.partnerName}'.`, "info");
    }

    /** Closes dual-material Terrain Wizard modal */
    function closeTerrainWizard() {
        wizardActiveMaterial = null;
        wizardPartnerList = [];
        wizardActivePartnerIndex = 0;
        state.editingAutotileId = null;
        state.terrainPresetPlacementActive = false;
        state.terrainPresetHoverCol = -1;
        state.terrainPresetHoverRow = -1;

        const editBadge = document.getElementById('terrain-wizard-edit-badge');
        if (editBadge) editBadge.classList.add('hidden');

        const saveBtn = document.getElementById('btn-terrain-save');
        if (saveBtn) {
            saveBtn.innerHTML = `Save Terrain Autotile`;
            saveBtn.className = "px-5 py-1.5 bg-teal-600 hover:bg-teal-500 rounded text-xs text-white font-bold shadow transition-colors";
        }

        updateTerrainPresetButtonsUI();
        document.getElementById('terrain-wizard-modal')?.classList.add('hidden');
    }

    /** Helper: Replaces dynamic material name placeholders in text */
    function substituteMaterialNames(text, m1Name, m2Name, m3Name) {
        if (!text) return '';
        const m1 = m1Name || 'Material 1 (Base)';
        const m2 = m2Name || 'Material 2 (Overlay)';
        const m3 = m3Name || 'Material 3 (Lower Ground)';
        return text
            .replace(/\[Material 1 Name\]/g, m1)
            .replace(/\[Material 1\]/g, m1)
            .replace(/\[Material 2 Name\]/g, m2)
            .replace(/\[Material 2\]/g, m2)
            .replace(/\[Material 3 Name\]/g, m3)
            .replace(/\[Material 3\]/g, m3);
    }

    /** Helper: Renders 2x2 color-coded quadrant micro-badge HTML */
    function render2x2QuadrantBadgeHTML(quadrants) {
        if (!quadrants) return '';
        const getMatColorClass = (matId) => {
            if (matId === 1) return 'bg-emerald-500 border-emerald-400';
            if (matId === 2) return 'bg-amber-500 border-amber-400';
            return 'bg-purple-500 border-purple-400';
        };
        const getMatName = (matId) => {
            if (matId === 1) return 'Mat 1 (Cliff Top)';
            if (matId === 2) return 'Mat 2 (Cliff Wall)';
            return 'Mat 3 (Ground)';
        };

        return `
            <div class="grid grid-cols-2 gap-0.5 w-4 h-4 bg-slate-950 p-0.5 rounded border border-slate-700 shrink-0 shadow-inner" title="(0,0): ${getMatName(quadrants.tl)} | (0,1): ${getMatName(quadrants.tr)} | (1,0): ${getMatName(quadrants.bl)} | (1,1): ${getMatName(quadrants.br)}">
                <div class="${getMatColorClass(quadrants.tl)} rounded-[1px] w-full h-full"></div>
                <div class="${getMatColorClass(quadrants.tr)} rounded-[1px] w-full h-full"></div>
                <div class="${getMatColorClass(quadrants.bl)} rounded-[1px] w-full h-full"></div>
                <div class="${getMatColorClass(quadrants.br)} rounded-[1px] w-full h-full"></div>
            </div>
        `;
    }

    /** Formats dynamic slot label with active material names (Base vs Overlay) */
    function getDynamicSlotLabel(slot, mat1Name, mat2Name, mat3Name) {
        if (!slot) return '';
        if (slot.label && slot.label.includes('[Material')) {
            return substituteMaterialNames(slot.label, mat1Name, mat2Name, mat3Name);
        }
        if (!slot.corners || slot.corners.length !== 4) return slot.label || '';
        const [c0, c1, c2, c3] = slot.corners; // TL, TR, BL, BR
        const countOverlay = c0 + c1 + c2 + c3;

        const bitmaskStr = `${c3}${c2}${c1}${c0}`; // Bitmask string (BR, BL, TR, TL)

        if (countOverlay === 0) return `${bitmaskStr} · Solid Base (${mat1Name})`;
        if (countOverlay === 4) return `${bitmaskStr} · Solid Overlay (${mat2Name})`;

        // 1 Overlay Corner (Outer Corner)
        if (countOverlay === 1) {
            let pos = 'TL';
            if (c1) pos = 'TR';
            else if (c2) pos = 'BL';
            else if (c3) pos = 'BR';
            return `${bitmaskStr} · Outer ${pos} (${mat2Name})`;
        }

        // 2 Overlay Corners (Straight Edges or Diagonals)
        if (countOverlay === 2) {
            if (c0 && c1) return `${bitmaskStr} · Top Edge (${mat2Name})`;
            if (c2 && c3) return `${bitmaskStr} · Bottom Edge (${mat2Name})`;
            if (c0 && c2) return `${bitmaskStr} · Left Edge (${mat2Name})`;
            if (c1 && c3) return `${bitmaskStr} · Right Edge (${mat2Name})`;
            if (c0 && c3) return `${bitmaskStr} · Diag TL+BR (${mat2Name})`;
            if (c1 && c2) return `${bitmaskStr} · Diag TR+BL (${mat2Name})`;
        }

        // 3 Overlay Corners (1 Base Corner Cutout)
        if (countOverlay === 3) {
            let cutoutPos = 'BR';
            if (!c0) cutoutPos = 'TL';
            else if (!c1) cutoutPos = 'TR';
            else if (!c2) cutoutPos = 'BL';
            return `${bitmaskStr} · Inner ${cutoutPos} (${mat1Name} Cutout)`;
        }

        return slot.label;
    }

    /** Updates active slot guidance card in Terrain Wizard */
    function updateTerrainSlotTooltip() {
        const titleEl = document.getElementById('terrain-tooltip-title');
        const descEl = document.getElementById('terrain-tooltip-desc');
        const activeLabel = document.getElementById('terrain-active-slot-label');

        const m1Name = document.getElementById('terrain-mat1-name')?.value.trim() || 'Material 1 (Base)';
        const m2Name = document.getElementById('terrain-mat2-name')?.value.trim() || 'Material 2 (Overlay)';
        const m3Name = document.getElementById('terrain-mat3-name')?.value.trim() || 'Material 3 (Lower Ground)';

        const modeKey = state.terrainWizardMode === 'cliff' ? 'cliff_vstretch' : 'dualgrid';
        const slots = MODE_SLOTS[modeKey] || [];
        const activeSlot = slots.find(s => s.key === state.terrainActiveSlotKey);

        if (activeSlot) {
            const dynamicLabel = getDynamicSlotLabel(activeSlot, m1Name, m2Name, m3Name);
            if (titleEl) titleEl.textContent = dynamicLabel;
            if (activeLabel) activeLabel.textContent = dynamicLabel;

            if (descEl) {
                const variations = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, activeSlot.key);
                window.TileWeaver.stateModule.calculateVariationRates(variations);

                let variationsHTML = '';
                if (variations.length > 0) {
                    const baseRate = variations[0].rate;
                    variationsHTML = `
                        <div class="mt-2 pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                                    <i class="ph ph-squares-four text-teal-400"></i> Smart Slot Variations (${variations.length}):
                                </span>
                                <button id="btn-add-terrain-variation" class="px-2 py-0.5 bg-amber-900/80 hover:bg-amber-800 border border-amber-600 rounded text-[10px] text-amber-200 font-bold transition-colors">
                                    + Add Variation Tile
                                </button>
                            </div>
                            <div class="flex flex-col gap-1.5 text-[11px]">
                                ${variations.map((v, idx) => {
                                    const isBase = idx === 0;
                                    const currentRate = isBase ? baseRate : (parseFloat(v.rate) || 0);
                                    const currentRatio = currentRate > 0 ? Math.max(1, Math.round(100 / currentRate)) : 99999;
                                    return `
                                        <div class="flex items-center justify-between bg-slate-900 px-2 py-1 rounded border ${isBase ? 'border-teal-500/70' : 'border-slate-800'} gap-2">
                                            <div class="flex items-center gap-1.5 min-w-0">
                                                <span class="font-mono ${isBase ? 'text-teal-300 font-bold' : 'text-slate-300'}">Tile (${v.tx}, ${v.ty})</span>
                                                ${isBase ? `<span class="px-1.5 py-0.2 rounded bg-teal-950 text-teal-300 border border-teal-700 text-[9px] font-bold">⚓ Base Anchor</span>` : ''}
                                            </div>
                                            <div class="flex items-center gap-1.5 shrink-0">
                                                ${isBase ? `
                                                    <span class="font-mono text-teal-300 font-bold text-[10px] bg-slate-950 px-1.5 py-0.5 rounded border border-teal-500/40">${baseRate.toFixed(1)}% (Auto)</span>
                                                ` : `
                                                    <div class="flex items-center gap-1">
                                                        <input type="number" step="0.1" min="0.001" max="100" value="${currentRate}" class="w-14 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center text-xs font-mono font-bold text-amber-400 terrain-var-rate-input" data-var-idx="${idx}">
                                                        <span class="text-amber-400 font-bold text-[10px]">%</span>
                                                        <span class="text-[9px] text-slate-500 font-mono">(1:${currentRatio})</span>
                                                    </div>
                                                    <button class="text-rose-400 hover:text-rose-300 ml-1 btn-delete-terrain-variation p-0.5" data-var-idx="${idx}" title="Delete variation"><i class="ph ph-trash"></i></button>
                                                `}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }

                if (state.terrainWizardMode === 'cliff') {
                    const tierClass = activeSlot.tier === 'top' ? 'tier-badge-top' : (activeSlot.tier === 'mid' ? 'tier-badge-mid' : 'tier-badge-base');
                    const descSubstituted = substituteMaterialNames(activeSlot.desc, m1Name, m2Name, m3Name);

                    const getMatLabelById = (matId) => {
                        if (matId === 1) return `<span class="text-emerald-400 font-bold">${m1Name}</span>`;
                        if (matId === 2) return `<span class="text-amber-400 font-bold">${m2Name}</span>`;
                        return `<span class="text-purple-400 font-bold">${m3Name}</span>`;
                    };

                    const q = activeSlot.quadrants || { tl: 1, tr: 1, bl: 1, br: 1 };
                    const quadMicroBadge = render2x2QuadrantBadgeHTML(q);

                    let mirrorLinkHTML = '';
                    if (activeSlot.mirrorKey) {
                        const mirrorSlot = slots.find(s => s.key === activeSlot.mirrorKey);
                        if (mirrorSlot) {
                            const mirrorLabel = getDynamicSlotLabel(mirrorSlot, m1Name, m2Name, m3Name);
                            mirrorLinkHTML = `
                                <button class="btn-jump-mirror px-2 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[10px] text-amber-300 font-bold transition-colors flex items-center gap-1 shrink-0" data-mirror-key="${mirrorSlot.key}">
                                    <i class="ph ph-arrows-left-right text-xs"></i> ↔️ Mirror Pair: ${mirrorLabel.split('-')[1] || mirrorLabel}
                                </button>
                            `;
                        }
                    }

                    descEl.innerHTML = `
                        <div class="flex flex-col gap-1.5 mt-1">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex items-center gap-2">
                                    <span class="cliff-anatomical-badge ${tierClass}">${activeSlot.anatomicalBadge || 'Cliff Structural Tile'}</span>
                                    ${quadMicroBadge}
                                </div>
                                ${mirrorLinkHTML}
                            </div>
                            <span class="text-slate-300 leading-tight text-xs">${descSubstituted}</span>

                            <!-- 4-Quadrant Internal Material Matrix Breakdown -->
                            <div class="bg-slate-900/90 p-2 rounded border border-amber-500/40 flex flex-col gap-1 text-[11px] mt-1 shadow">
                                <span class="font-bold text-amber-300 uppercase tracking-wider text-[10px] flex items-center justify-between">
                                    <span class="flex items-center gap-1"><i class="ph ph-grid-four text-xs"></i> Internal 4-Quadrant Material Matrix Breakdown:</span>
                                    <span class="font-mono text-[9px] text-slate-400">(0,0)..(1,1)</span>
                                </span>
                                <div class="grid grid-cols-2 gap-1.5 bg-slate-950 p-1.5 rounded border border-slate-800 font-mono text-[10px]">
                                    <div class="bg-slate-900/80 p-1 rounded border border-slate-850 flex flex-col">
                                        <span class="text-slate-500 text-[8px] font-bold">(0,0) Top-Left:</span>
                                        <div>${getMatLabelById(q.tl)}</div>
                                    </div>
                                    <div class="bg-slate-900/80 p-1 rounded border border-slate-850 flex flex-col">
                                        <span class="text-slate-500 text-[8px] font-bold">(0,1) Top-Right:</span>
                                        <div>${getMatLabelById(q.tr)}</div>
                                    </div>
                                    <div class="bg-slate-900/80 p-1 rounded border border-slate-850 flex flex-col">
                                        <span class="text-slate-500 text-[8px] font-bold">(1,0) Bottom-Left:</span>
                                        <div>${getMatLabelById(q.bl)}</div>
                                    </div>
                                    <div class="bg-slate-900/80 p-1 rounded border border-slate-850 flex flex-col">
                                        <span class="text-slate-500 text-[8px] font-bold">(1,1) Bottom-Right:</span>
                                        <div>${getMatLabelById(q.br)}</div>
                                    </div>
                                </div>
                            </div>

                            ${variationsHTML}
                        </div>
                    `;

                    descEl.querySelector('.btn-jump-mirror')?.addEventListener('click', (e) => {
                        const mirrorKey = e.currentTarget.getAttribute('data-mirror-key');
                        if (mirrorKey) {
                            state.terrainActiveSlotKey = mirrorKey;
                            renderTerrainMaterialHeaderSwatches();
                            renderTerrainSlotButtons();
                            renderTerrainTilesetCanvas();
                            updateTerrainSlotTooltip();
                        }
                    });
                } else if (activeSlot.corners && activeSlot.corners.length === 4) {
                    const c = activeSlot.corners;
                    const cText = (val) => val === 1 
                        ? `<span class="text-amber-400 font-bold">${m2Name}</span>` 
                        : `<span class="text-emerald-400 font-bold">${m1Name}</span>`;

                    descEl.innerHTML = `
                        <div class="flex flex-col gap-1 mt-1">
                            <span class="text-slate-300">${substituteMaterialNames(activeSlot.desc, m1Name, m2Name, m3Name)}</span>
                            <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 bg-slate-900/90 p-1.5 rounded border border-slate-800 text-[10px] font-mono mt-1">
                                <div>Top-Left: ${cText(c[0])}</div>
                                <div>Top-Right: ${cText(c[1])}</div>
                                <div>Bottom-Left: ${cText(c[2])}</div>
                                <div>Bottom-Right: ${cText(c[3])}</div>
                            </div>
                            ${variationsHTML}
                        </div>
                    `;
                } else {
                    descEl.innerHTML = `
                        <div class="flex flex-col gap-1 mt-1">
                            <span class="text-slate-300">${substituteMaterialNames(activeSlot.description || activeSlot.desc || '', m1Name, m2Name, m3Name)}</span>
                            ${variationsHTML}
                        </div>
                    `;
                }

                // Hook variation buttons with defensive validation
                document.getElementById('btn-add-terrain-variation')?.addEventListener('click', () => {
                    state.terrainAddVariationMode = true;
                    showMessage("Click a tile on the tileset to add it as a variation for this slot.", "info");
                });

                document.querySelectorAll('.terrain-var-rate-input').forEach(input => {
                    input.addEventListener('change', (e) => {
                        const idx = parseInt(e.target.dataset.varIdx, 10);
                        const parsed = parseFloat(e.target.value);
                        const val = isNaN(parsed) ? 10 : Math.max(0.001, Math.min(100, parsed));
                        const variations = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, activeSlot.key);
                        if (variations && idx >= 0 && idx < variations.length && variations[idx]) {
                            variations[idx].rate = val;
                            variations[idx].weight = val;
                            window.TileWeaver.stateModule.calculateVariationRates(variations);
                            state.terrainMapping[activeSlot.key] = variations;
                            updateTerrainSlotTooltip();
                            renderTerrainMaterialHeaderSwatches();
                            renderTerrainSlotButtons();
                            renderTerrainTilesetCanvas();
                            renderTerrainPreview();
                        }
                    });
                });

                document.querySelectorAll('.btn-toggle-terrain-var-lock').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const idx = parseInt(btn.dataset.varIdx, 10);
                        const variations = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, activeSlot.key);
                        if (variations && idx >= 0 && idx < variations.length && variations[idx]) {
                            variations[idx].locked = !variations[idx].locked;
                            updateTerrainSlotTooltip();
                        }
                    });
                });

                document.querySelectorAll('.btn-delete-terrain-variation').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const idx = parseInt(btn.dataset.varIdx, 10);
                        const variations = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, activeSlot.key);
                        if (variations && idx >= 0 && idx < variations.length) {
                            variations.splice(idx, 1);
                            window.TileWeaver.stateModule.calculateVariationRates(variations);
                            state.terrainMapping[activeSlot.key] = variations;
                            updateTerrainSlotTooltip();
                            renderTerrainMaterialHeaderSwatches();
                            renderTerrainSlotButtons();
                            renderTerrainTilesetCanvas();
                            renderTerrainPreview();
                        }
                    });
                });
            }
        }
    }

    /** Sets preview height for live 3D cliff terrace model (1x, 2x, or 3x) */
    function setCliffPreviewHeight(h) {
        state.cliffPreviewHeight = h;
        const btn1 = document.getElementById('btn-preview-h1');
        const btn2 = document.getElementById('btn-preview-h2');
        const btn3 = document.getElementById('btn-preview-h3');

        const activeClass = "px-1.5 py-0.5 bg-amber-600 rounded text-white font-bold transition-colors shadow";
        const inactiveClass = "px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-bold transition-colors";

        if (btn1) btn1.className = (h === 1) ? activeClass : inactiveClass;
        if (btn2) btn2.className = (h === 2) ? activeClass : inactiveClass;
        if (btn3) btn3.className = (h === 3) ? activeClass : inactiveClass;

        renderTerrainPreview();
    }

    /**
     * Updates visual styles, active highlights, and tab visibility of Terrain Wizard preset buttons.
     * Enforces tab-based visibility (hidden class) across preset toggles, commits, and mode tab changes.
     */
    function updateTerrainPresetButtonsUI() {
        const btnOverlay = document.getElementById('btn-terrain-auto-overlay');
        const btnDualGrid = document.getElementById('btn-terrain-auto-dualgrid');
        const btnCliff = document.getElementById('btn-terrain-auto-cliff7x6');
        const btnWall = document.getElementById('btn-terrain-auto-wall9x3');

        const mode = state.terrainWizardMode || 'ground';
        const isActive = !!state.terrainPresetPlacementActive;
        const activeType = state.presetPlacementType || 'dualgrid';

        const baseStyles = {
            overlay: "px-3 py-1.5 bg-amber-900/80 hover:bg-amber-800 border border-amber-600 text-amber-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow",
            dualgrid: "px-3 py-1.5 bg-teal-900/80 hover:bg-teal-800 border border-teal-600 text-teal-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow",
            cliff7x6: "px-3 py-1.5 bg-amber-700 hover:bg-amber-600 border border-amber-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow",
            wall9x3: "px-3 py-1.5 bg-blue-700 hover:bg-blue-600 border border-blue-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow"
        };

        const activeHighlightStyle = "px-3 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-400 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-lg ring-4 ring-blue-400/50 animate-pulse";

        // 1. Update active vs inactive visual styles
        if (btnOverlay) {
            btnOverlay.className = (isActive && activeType === 'overlay') ? activeHighlightStyle : baseStyles.overlay;
        }
        if (btnDualGrid) {
            btnDualGrid.className = (isActive && (activeType === 'dualgrid' || activeType === '2d')) ? activeHighlightStyle : baseStyles.dualgrid;
        }
        if (btnCliff) {
            btnCliff.className = (isActive && (activeType === 'cliff7x6' || activeType === 'cliff6x5')) ? activeHighlightStyle : baseStyles.cliff7x6;
        }
        if (btnWall) {
            btnWall.className = (isActive && (activeType === 'wall9x3' || activeType === 'wall')) ? activeHighlightStyle : baseStyles.wall9x3;
        }

        // 2. Enforce mode-based tab visibility (hidden class)
        if (mode === 'wall') {
            btnDualGrid?.classList.add('hidden');
            btnOverlay?.classList.add('hidden');
            btnCliff?.classList.add('hidden');
            btnWall?.classList.remove('hidden');
        } else if (mode === 'cliff') {
            btnDualGrid?.classList.add('hidden');
            btnOverlay?.classList.add('hidden');
            btnCliff?.classList.remove('hidden');
            btnWall?.classList.add('hidden');
        } else {
            // 'ground' mode
            btnDualGrid?.classList.remove('hidden');
            btnOverlay?.classList.remove('hidden');
            btnCliff?.classList.add('hidden');
            btnWall?.classList.add('hidden');
        }
    }

    /** Switches Terrain Wizard mode between 'ground' (2D dual-grid), 'cliff' (3D vertical 7x6 set), and 'wall' (16-tile cardinal 9x3 set) */
    function setTerrainWizardMode(mode) {
        state.terrainWizardMode = mode;
        state.terrainPresetPlacementActive = false;
        state.terrainPresetHoverCol = -1;
        state.terrainPresetHoverRow = -1;

        const tabGround = document.getElementById('tab-terrain-ground');
        const tabCliff = document.getElementById('tab-terrain-cliff');
        const tabWall = document.getElementById('tab-terrain-wall');
        const lblMat1 = document.getElementById('lbl-mat1-title');
        const lblMat2 = document.getElementById('lbl-mat2-title');
        const lblMat3 = document.getElementById('lbl-mat3-title');

        const cardBase = document.getElementById('material-card-base');
        const cardOverlay = document.getElementById('material-card-overlay');
        const cardLower = document.getElementById('material-card-lowerground');
        const controlsEl = document.getElementById('cliff-preview-height-controls');
        const previewTitle = document.getElementById('terrain-preview-title');
        const nameInput = document.getElementById('terrain-autotile-name');

        const activeTabClass = (bg) => `px-3 py-1 rounded-md ${bg} text-white shadow transition-colors flex items-center gap-1.5`;
        const inactiveTabClass = `px-3 py-1 rounded-md text-slate-400 hover:text-white transition-colors flex items-center gap-1.5`;

        if (mode === 'wall') {
            if (tabGround) tabGround.className = inactiveTabClass;
            if (tabCliff) tabCliff.className = inactiveTabClass;
            if (tabWall) tabWall.className = activeTabClass('bg-blue-600');

            if (lblMat1) lblMat1.textContent = "Wall / Fence Material";
            if (cardBase) cardBase.classList.remove('hidden');
            if (cardOverlay) cardOverlay.classList.add('hidden');
            if (cardLower) cardLower.classList.add('hidden');
            if (controlsEl) controlsEl.classList.add('hidden');
            if (previewTitle) previewTitle.textContent = "Live Assembled Wall Room Preview:";
            if (nameInput) nameInput.value = "Custom Wall Autotile";

            state.terrainActiveSlotKey = 'post';
        } else if (mode === 'cliff') {
            if (tabGround) tabGround.className = inactiveTabClass;
            if (tabCliff) tabCliff.className = activeTabClass('bg-amber-600');
            if (tabWall) tabWall.className = inactiveTabClass;

            if (lblMat1) lblMat1.textContent = "1. Cliff Top";
            if (lblMat2) lblMat2.textContent = "2. Cliff Wall";
            if (lblMat3) lblMat3.textContent = "3. Lower Ground Surface";

            if (cardBase) cardBase.classList.remove('hidden');
            if (cardOverlay) cardOverlay.classList.remove('hidden');
            if (cardLower) cardLower.classList.remove('hidden');
            if (controlsEl) controlsEl.classList.remove('hidden');
            if (previewTitle) previewTitle.textContent = "Live 3D Cliff Terrace Model:";
            if (nameInput) nameInput.value = "Custom Cliffside Set";

            state.terrainActiveSlotKey = 'grid_15';
        } else {
            if (tabGround) tabGround.className = activeTabClass('bg-teal-600');
            if (tabCliff) tabCliff.className = inactiveTabClass;
            if (tabWall) tabWall.className = inactiveTabClass;

            if (lblMat1) lblMat1.textContent = "Material 1 (Base)";
            if (lblMat2) lblMat2.textContent = "Material 2 (Overlay)";
            if (lblMat3) lblMat3.textContent = "Lower Ground Surface";

            if (cardBase) cardBase.classList.remove('hidden');
            if (cardOverlay) cardOverlay.classList.remove('hidden');
            if (cardLower) cardLower.classList.add('hidden');
            if (controlsEl) controlsEl.classList.add('hidden');
            if (previewTitle) previewTitle.textContent = "Live 4x4 Assembled Preview:";
            if (nameInput) nameInput.value = "Custom Dual-Grid Terrain";

            state.terrainActiveSlotKey = 'grid_0';
        }

        updateTerrainPresetButtonsUI();
        populateTerrainMaterialSelects();
        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        updateTerrainSlotTooltip();
    }

    /** Applies auto 7x6 cliffside preset mapping */
    function applyCliff7x6Preset() {
        let startCol = state.selectedStamp ? state.selectedStamp.col : 0;
        let startRow = state.selectedStamp ? state.selectedStamp.row : 0;

        const CLIFF_7X6_MATRIX = window.TileWeaver.constants.CLIFF_7X6_MATRIX;
        if (CLIFF_7X6_MATRIX) {
            CLIFF_7X6_MATRIX.forEach((rowSlots, rIdx) => {
                rowSlots.forEach((slotKey, cIdx) => {
                    if (slotKey) {
                        state.terrainMapping[slotKey] = [{ tx: startCol + cIdx, ty: startRow + rIdx, weight: 100 }];
                    }
                });
            });
        }

        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        showMessage("Applied Auto 7x6 Cliffside Preset (42-Tile Visual Diorama)!", "success");
    }

    /** Renders interactive slot buttons for Terrain Wizard (Ground vs Cliff vs Wall mode) */
    function renderTerrainSlotButtons() {
        const container = document.getElementById('terrain-slots-grid');
        if (!container) return;
        container.innerHTML = '';

        const m1Name = document.getElementById('terrain-mat1-name')?.value.trim() || 'Material 1 (Base)';
        const m2Name = document.getElementById('terrain-mat2-name')?.value.trim() || 'Material 2 (Overlay)';
        const m3Name = document.getElementById('terrain-mat3-name')?.value.trim() || 'Material 3 (Lower Ground)';

        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';
        const modeKey = isCliffMode ? 'cliff_vstretch' : (isWallMode ? 'wall_9x3' : 'dualgrid');
        const allSlots = MODE_SLOTS[modeKey] || [];
        const slots = (isCliffMode || isWallMode) ? allSlots : allSlots.filter(s => s.key !== 'grid_0' && s.key !== 'grid_15');

        let currentCategory = '';

        slots.forEach(slot => {
            // Group slots by Category in Wall Mode
            if (isWallMode && slot.category && slot.category !== currentCategory) {
                currentCategory = slot.category;
                const catHeader = document.createElement('div');
                catHeader.className = "col-span-full mt-2 mb-1 pt-1 pb-0.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-blue-400";
                catHeader.innerHTML = `<span><i class="ph ph-walls mr-1"></i> ${currentCategory}</span>`;
                container.appendChild(catHeader);
            } else if (isCliffMode && slot.tier && slot.tier !== currentCategory) {
                // Group slots by Elevation Tier in Cliffside Mode
                currentCategory = slot.tier;
                const tierHeader = document.createElement('div');
                tierHeader.className = "col-span-full mt-2 mb-1 pt-1 pb-0.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider";
                
                if (currentCategory === 'top') {
                    tierHeader.innerHTML = `<span class="text-amber-400 flex items-center gap-1.5"><i class="ph ph-mountains"></i> 🏔️ Tier 1: Plateau Top Surface (Rows 0-2)</span><span class="text-slate-500 font-mono">18 slots</span>`;
                } else if (currentCategory === 'mid') {
                    tierHeader.innerHTML = `<span class="text-sky-400 flex items-center gap-1.5"><i class="ph ph-walls"></i> 🧱 Tier 2: Wall Face Vertical Drop (Row 3)</span><span class="text-slate-500 font-mono">7 slots</span>`;
                } else if (currentCategory === 'base') {
                    tierHeader.innerHTML = `<span class="text-emerald-400 flex items-center gap-1.5"><i class="ph ph-plant"></i> 🌿 Tier 3: Base Footing & Shadow Join (Row 4)</span><span class="text-slate-500 font-mono">7 slots</span>`;
                } else if (currentCategory === 'top_alt') {
                    tierHeader.innerHTML = `<span class="text-purple-400 flex items-center gap-1.5"><i class="ph ph-stairs"></i> 🧗 Tier 4: Alternative Wall-Top Edges (Row 5)</span><span class="text-slate-500 font-mono">7 slots</span>`;
                }
                container.appendChild(tierHeader);
            }

            const vars = window.TileWeaver.stateModule.getSlotVariations(state.terrainMapping, slot.key);
            const isMapped = vars.length > 0;
            const isActive = slot.key === state.terrainActiveSlotKey;

            const dynamicLabel = isWallMode ? slot.label : getDynamicSlotLabel(slot, m1Name, m2Name, m3Name);

            const activeBgClass = isWallMode
                ? 'bg-blue-950/90 border-blue-500 text-blue-200 ring-2 ring-blue-500/50 font-bold shadow-lg'
                : (isCliffMode 
                    ? 'bg-amber-950/90 border-amber-500 text-amber-200 ring-2 ring-amber-500/50 font-bold shadow-lg' 
                    : 'bg-teal-950/90 border-teal-500 text-teal-200 ring-2 ring-teal-500/50 font-bold shadow-lg');

            const btn = document.createElement('button');
            btn.className = `p-1.5 rounded-lg border text-left flex items-center justify-between transition-all ${
                isActive 
                    ? activeBgClass
                    : isMapped 
                        ? 'bg-slate-900/90 border-emerald-800/60 text-slate-200 hover:bg-slate-850' 
                        : 'bg-slate-950/80 border-amber-800/60 border-dashed text-slate-400 hover:bg-slate-900'
            }`;

            // Slot Completion Status Badge
            const statusBadgeHTML = isMapped 
                ? `<span class="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-[10px] font-bold shrink-0 ml-1.5 flex items-center gap-1">
                     <i class="ph ph-check-circle text-emerald-400"></i> ${vars.length > 1 ? `(${vars[0].tx}, ${vars[0].ty}) +${vars.length - 1}` : `(${vars[0].tx}, ${vars[0].ty})`}
                   </span>`
                : `<span class="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/60 text-amber-300 text-[10px] font-bold shrink-0 ml-1.5 flex items-center gap-1 animate-pulse">
                     <i class="ph ph-warning"></i> Empty
                   </span>`;

            let iconHTML = '';
            if (isCliffMode) {
                const tierClass = slot.tier === 'top' ? 'tier-badge-top' : (slot.tier === 'mid' ? 'tier-badge-mid' : (slot.tier === 'top_alt' ? 'tier-badge-alt' : 'tier-badge-base'));
                const quadBadge = render2x2QuadrantBadgeHTML(slot.quadrants);
                iconHTML = `
                    <div class="flex items-center gap-1 shrink-0">
                        ${quadBadge}
                        <span class="cliff-anatomical-badge ${tierClass} font-mono">${slot.anatomicalBadge || 'Cliff Tile'}</span>
                    </div>
                `;
            } else if (isWallMode) {
                iconHTML = `
                    <div class="flex items-center gap-1 shrink-0">
                        <i class="ph ${slot.icon || 'ph-squares-four'} text-blue-400 text-sm"></i>
                        <span class="px-1 py-0.5 rounded bg-blue-950/80 border border-blue-600/60 text-blue-300 text-[9px] font-mono font-bold">${slot.anatomicalBadge || slot.gridCoordStr || ''}</span>
                    </div>
                `;
            } else if (slot.corners && slot.corners.length === 4) {
                const c0 = slot.corners[0] ? 'dualgrid-corner-overlay' : 'dualgrid-corner-base';
                const c1 = slot.corners[1] ? 'dualgrid-corner-overlay' : 'dualgrid-corner-base';
                const c2 = slot.corners[2] ? 'dualgrid-corner-overlay' : 'dualgrid-corner-base';
                const c3 = slot.corners[3] ? 'dualgrid-corner-overlay' : 'dualgrid-corner-base';
                iconHTML = `
                    <div class="dualgrid-badge mr-1.5" title="TL:${slot.corners[0]} TR:${slot.corners[1]} BL:${slot.corners[2]} BR:${slot.corners[3]}">
                        <div class="${c0}"></div>
                        <div class="${c1}"></div>
                        <div class="${c2}"></div>
                        <div class="${c3}"></div>
                    </div>
                `;
            } else {
                iconHTML = `<i class="ph ${slot.icon || 'ph-square'} text-slate-400"></i>`;
            }

            btn.innerHTML = `
                <div class="flex items-center gap-1.5 min-w-0">
                    ${iconHTML}
                    <span class="text-xs truncate ${isMapped ? 'text-slate-200 font-medium' : 'text-slate-400'}">${dynamicLabel}</span>
                </div>
                ${statusBadgeHTML}
            `;

            btn.addEventListener('click', () => {
                state.terrainActiveSlotKey = slot.key;
                renderTerrainMaterialHeaderSwatches();
                renderTerrainSlotButtons();
                renderTerrainTilesetCanvas();
                updateTerrainSlotTooltip();
            });

            container.appendChild(btn);
        });

        scrollToActiveSlotButton();
    }

    /** Automatically scrolls #terrain-slots-grid so that the active slot button is in view */
    function scrollToActiveSlotButton() {
        const container = document.getElementById('terrain-slots-grid');
        if (!container) return;

        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';
        const modeKey = isCliffMode ? 'cliff_vstretch' : (isWallMode ? 'wall_9x3' : 'dualgrid');
        const allSlots = MODE_SLOTS[modeKey] || [];
        const slots = (isCliffMode || isWallMode) ? allSlots : allSlots.filter(s => s.key !== 'grid_0' && s.key !== 'grid_15');
        const activeSlotIndex = slots.findIndex(s => s.key === state.terrainActiveSlotKey);

        if (activeSlotIndex >= 0) {
            const buttons = container.querySelectorAll('button');
            if (buttons && buttons[activeSlotIndex]) {
                buttons[activeSlotIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } else {
            container.scrollTop = 0;
        }
    }

    /** Renders interactive tileset viewer canvas inside Terrain Wizard with rich slot highlights */
    function renderTerrainTilesetCanvas() {
        const canvas = document.getElementById('terrain-tileset-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const ts = state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.image) return;

        canvas.width = ts.image.width;
        canvas.height = ts.image.height;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ts.image, 0, 0);

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;

        // Grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        for (let x = margin; x <= canvas.width; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = margin; y <= canvas.height; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }

        const m = state.terrainMapping || {};
        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';
        const modeKey = isCliffMode ? 'cliff_vstretch' : (isWallMode ? 'wall_9x3' : 'dualgrid');
        const allSlots = MODE_SLOTS[modeKey] || [];

        // Ghost Pass: Render Ghost Bounding Boxes for sibling partner autotiles on this tileset
        if (wizardPartnerList && wizardPartnerList.length > 1 && !isCliffMode && !isWallMode) {
            wizardPartnerList.forEach((partner, pIdx) => {
                if (pIdx === wizardActivePartnerIndex) return; // Skip active partner (rendered in solid detail below)
                if (partner.tilesetId && ts && partner.tilesetId !== ts.id) return; // Skip partners on different tilesets

                const pMap = partner.mapping || {};
                let pMinCol = Infinity, pMinRow = Infinity, pMaxCol = -Infinity, pMaxRow = -Infinity;
                let hasMapped = false;

                Object.values(pMap).forEach(val => {
                    const entries = Array.isArray(val) ? val : [val];
                    entries.forEach(entry => {
                        if (entry && typeof entry.tx === 'number' && typeof entry.ty === 'number') {
                            hasMapped = true;
                            pMinCol = Math.min(pMinCol, entry.tx);
                            pMaxCol = Math.max(pMaxCol, entry.tx);
                            pMinRow = Math.min(pMinRow, entry.ty);
                            pMaxRow = Math.max(pMaxRow, entry.ty);
                        }
                    });
                });

                if (hasMapped && pMinCol !== Infinity) {
                    const gBoxX = margin + pMinCol * step;
                    const gBoxY = margin + pMinRow * step;
                    const gBoxW = (pMaxCol - pMinCol + 1) * step - spacing;
                    const gBoxH = (pMaxRow - pMinRow + 1) * step - spacing;
                    const pCol = partner.partnerColor || '#38bdf8';

                    // Ghost subtle fill
                    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
                    ctx.fillRect(gBoxX, gBoxY, gBoxW, gBoxH);

                    // Ghost dashed border
                    ctx.save();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = pCol;
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(gBoxX + 1, gBoxY + 1, gBoxW - 2, gBoxH - 2);
                    ctx.restore();

                    // Ghost Badge Pill
                    const gBadgeText = `👻 ${partner.partnerName} (${pMaxCol - pMinCol + 1}x${pMaxRow - pMinRow + 1})`;
                    ctx.font = 'bold 9px sans-serif';
                    const gTextW = ctx.measureText(gBadgeText).width;
                    const gBadgeW = gTextW + 8;
                    const gBadgeH = 14;
                    const gBadgeX = gBoxX + 4;
                    const gBadgeY = gBoxY + 4;

                    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                    ctx.beginPath();
                    ctx.roundRect(gBadgeX, gBadgeY, gBadgeW, gBadgeH, 3);
                    ctx.fill();

                    ctx.fillStyle = pCol;
                    ctx.fillText(gBadgeText, gBadgeX + 4, gBadgeY + 10);
                }
            });
        }

        // Track active tile coordinates for final target bracket overlay rendering
        let activeTileRect = null;
        let activeSlotInfo = null;

        // First pass: Draw all assigned tiles on canvas (Highlight #2)
        // OPTIMIZATION: Hoist font settings outside inner slot iteration loop
        ctx.font = 'bold 8px monospace';
        allSlots.forEach(slot => {
            const vars = window.TileWeaver.stateModule.getSlotVariations(m, slot.key);
            if (!vars || vars.length === 0) return;

            vars.forEach(val => {
                const isSelected = slot.key === state.terrainActiveSlotKey;
                const sx = margin + val.tx * step;
                const sy = margin + val.ty * step;

                if (isSelected) {
                    activeTileRect = { sx, sy, tx: val.tx, ty: val.ty };
                    activeSlotInfo = slot;
                } else {
                    // All Assigned Tiles Highlight: Clean semi-transparent fill + border
                    ctx.fillStyle = isCliffMode ? 'rgba(217, 119, 6, 0.35)' : (isWallMode ? 'rgba(59, 130, 246, 0.35)' : 'rgba(20, 184, 166, 0.35)');
                    ctx.fillRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);

                    ctx.strokeStyle = isCliffMode ? '#f59e0b' : (isWallMode ? '#3b82f6' : '#14b8a6');
                    ctx.lineWidth = 2;
                    ctx.strokeRect(sx + 1, sy + 1, state.TILE_SIZE - 2, state.TILE_SIZE - 2);

                    // Mini badge box
                    const badgeText = isCliffMode 
                        ? (slot.anatomicalBadge || 'Cliff') 
                        : (isWallMode ? (slot.anatomicalBadge || slot.key) : slot.key.replace('grid_', '').padStart(4, '0'));
                    const textW = ctx.measureText(badgeText).width;
                    const badgeBoxW = Math.max(24, textW + 6);

                    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                    ctx.fillRect(sx + 2, sy + 2, badgeBoxW, 11);
                    ctx.fillStyle = isCliffMode ? '#fbbf24' : (isWallMode ? '#60a5fa' : '#2dd4bf');
                    ctx.fillText(badgeText, sx + 4, sy + 10);
                }
            });
        });

        // Second pass: Draw Active Selected Tile (Highlight #1) with glowing target brackets and floating badge
        if (activeTileRect && activeSlotInfo) {
            const { sx, sy } = activeTileRect;

            // Vibrant glowing fill
            ctx.fillStyle = isCliffMode ? 'rgba(245, 158, 11, 0.45)' : (isWallMode ? 'rgba(59, 130, 246, 0.45)' : 'rgba(20, 184, 166, 0.45)');
            ctx.fillRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);

            // Inner solid border
            ctx.strokeStyle = isCliffMode ? '#f59e0b' : (isWallMode ? '#3b82f6' : '#14b8a6');
            ctx.lineWidth = 3.5;
            ctx.strokeRect(sx, sy, state.TILE_SIZE, state.TILE_SIZE);

            // Outer gold glow ring
            ctx.strokeStyle = isWallMode ? '#60a5fa' : '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sx - 2, sy - 2, state.TILE_SIZE + 4, state.TILE_SIZE + 4);

            // 4 Corner Target Brackets (extending outward by 4px)
            const bLen = 8;
            const bOffset = 4;
            ctx.strokeStyle = isWallMode ? '#60a5fa' : '#fbbf24';
            ctx.lineWidth = 2.5;

            // Top-Left bracket
            ctx.beginPath();
            ctx.moveTo(sx - bOffset, sy - bOffset + bLen);
            ctx.lineTo(sx - bOffset, sy - bOffset);
            ctx.lineTo(sx - bOffset + bLen, sy - bOffset);
            ctx.stroke();

            // Top-Right bracket
            ctx.beginPath();
            ctx.moveTo(sx + state.TILE_SIZE + bOffset - bLen, sy - bOffset);
            ctx.lineTo(sx + state.TILE_SIZE + bOffset, sy - bOffset);
            ctx.lineTo(sx + state.TILE_SIZE + bOffset, sy - bOffset + bLen);
            ctx.stroke();

            // Bottom-Left bracket
            ctx.beginPath();
            ctx.moveTo(sx - bOffset, sy + state.TILE_SIZE + bOffset - bLen);
            ctx.lineTo(sx - bOffset, sy + state.TILE_SIZE + bOffset);
            ctx.lineTo(sx - bOffset + bLen, sy + state.TILE_SIZE + bOffset);
            ctx.stroke();

            // Bottom-Right bracket
            ctx.beginPath();
            ctx.moveTo(sx + state.TILE_SIZE + bOffset - bLen, sy + state.TILE_SIZE + bOffset);
            ctx.lineTo(sx + state.TILE_SIZE + bOffset, sy + state.TILE_SIZE + bOffset);
            ctx.lineTo(sx + state.TILE_SIZE + bOffset, sy + state.TILE_SIZE + bOffset - bLen);
            ctx.stroke();

            // Floating Header Badge above active tile
            const activeBadgeText = isCliffMode 
                ? `ACTIVE · ${activeSlotInfo.anatomicalBadge || 'Cliff Tile'}` 
                : (isWallMode ? `ACTIVE · [${activeSlotInfo.label || activeSlotInfo.key}]` : `ACTIVE · [${activeSlotInfo.key.replace('grid_', '').padStart(4, '0')}]`);
            ctx.font = 'bold 9px sans-serif';
            const textWidth = ctx.measureText(activeBadgeText).width;
            const badgeW = textWidth + 8;
            const badgeH = 15;
            const badgeX = sx + (state.TILE_SIZE - badgeW) / 2;
            const badgeY = sy - 20;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
            ctx.strokeStyle = isCliffMode ? '#f59e0b' : (isWallMode ? '#3b82f6' : '#14b8a6');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isCliffMode ? '#fbbf24' : (isWallMode ? '#60a5fa' : '#2dd4bf');
            ctx.fillText(activeBadgeText, badgeX + 4, badgeY + 11);
        }

        // Third pass: Draw Interactive Preset Placement Target Box (9x3 Wall, 6x3 Dual-Grid, or 7x6 Cliff Sheet)
        if (state.terrainPresetPlacementActive && state.terrainPresetHoverCol >= 0 && state.terrainPresetHoverRow >= 0) {
            const isWallPreset = state.presetPlacementType === 'wall9x3' || state.terrainWizardMode === 'wall';
            const isCliffPreset = state.presetPlacementType === 'cliff7x6' || (!isWallPreset && state.terrainWizardMode === 'cliff');
            const numCols = isWallPreset ? 9 : (isCliffPreset ? 7 : 6);
            const numRows = isWallPreset ? 3 : (isCliffPreset ? 6 : 3);

            const hCol = state.terrainPresetHoverCol;
            const hRow = state.terrainPresetHoverRow;
            const boxX = margin + hCol * step;
            const boxY = margin + hRow * step;
            const boxW = numCols * step - spacing;
            const boxH = numRows * step - spacing;

            // Semi-transparent fill over hovered region
            ctx.fillStyle = isWallPreset ? 'rgba(59, 130, 246, 0.35)' : (isCliffPreset ? 'rgba(245, 158, 11, 0.35)' : 'rgba(20, 184, 166, 0.35)');
            ctx.fillRect(boxX, boxY, boxW, boxH);

            // Sub-quadrant grid outlines with slot badges
            ctx.strokeStyle = isWallPreset ? 'rgba(96, 165, 250, 0.8)' : (isCliffPreset ? 'rgba(251, 191, 36, 0.8)' : 'rgba(45, 212, 191, 0.8)');
            ctx.lineWidth = 1.5;
            // OPTIMIZATION: Hoist font settings outside 2D matrix loop
            ctx.font = 'bold 8px monospace';
            for (let r = 0; r < numRows; r++) {
                for (let c = 0; c < numCols; c++) {
                    const slotKey = isWallPreset 
                        ? (WALL_9X3_MATRIX[r] ? WALL_9X3_MATRIX[r][c] : null) 
                        : (isCliffPreset ? (CLIFF_7X6_MATRIX[r] ? CLIFF_7X6_MATRIX[r][c] : null) : DUALGRID_6X3_MATRIX[r][c]);
                    const cellX = boxX + c * step;
                    const cellY = boxY + r * step;
                    if (slotKey) {
                        ctx.strokeRect(cellX + 1, cellY + 1, state.TILE_SIZE - 2, state.TILE_SIZE - 2);
                        const labelStr = isWallPreset ? slotKey : (isCliffPreset ? `(${r},${c})` : slotKey.replace('grid_', '').padStart(4, '0'));
                        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                        ctx.fillRect(cellX + 2, cellY + 2, 28, 11);
                        ctx.fillStyle = isWallPreset ? '#93c5fd' : (isCliffPreset ? '#fbbf24' : '#2dd4bf');
                        ctx.fillText(labelStr, cellX + 4, cellY + 10);
                    }
                }
            }

            // Outer Target Frame
            ctx.strokeStyle = isWallPreset ? '#60a5fa' : '#fbbf24';
            ctx.lineWidth = 3;
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            // 4 Corner Target Brackets
            const bLen = 12;
            const bOffset = 4;
            ctx.strokeStyle = isWallPreset ? '#60a5fa' : '#fbbf24';
            ctx.lineWidth = 3;

            // Top-Left bracket
            ctx.beginPath();
            ctx.moveTo(boxX - bOffset, boxY - bOffset + bLen);
            ctx.lineTo(boxX - bOffset, boxY - bOffset);
            ctx.lineTo(boxX - bOffset + bLen, boxY - bOffset);
            ctx.stroke();

            // Top-Right bracket
            ctx.beginPath();
            ctx.moveTo(boxX + boxW + bOffset - bLen, boxY - bOffset);
            ctx.lineTo(boxX + boxW + bOffset, boxY - bOffset);
            ctx.lineTo(boxX + boxW + bOffset, boxY - bOffset + bLen);
            ctx.stroke();

            // Bottom-Left bracket
            ctx.beginPath();
            ctx.moveTo(boxX - bOffset, boxY + boxH + bOffset - bLen);
            ctx.lineTo(boxX - bOffset, boxY + boxH + bOffset);
            ctx.lineTo(boxX - bOffset + bLen, boxY + boxH + bOffset);
            ctx.stroke();

            // Bottom-Right bracket
            ctx.beginPath();
            ctx.moveTo(boxX + boxW + bOffset - bLen, boxY + boxH + bOffset);
            ctx.lineTo(boxX + boxW + bOffset, boxY + boxH + bOffset);
            ctx.lineTo(boxX + boxW + bOffset, boxY + boxH + bOffset - bLen);
            ctx.stroke();

            // Floating Header Badge above hovered box
            const presetTitle = isWallPreset ? '9x3 WALL MATRIX' : (isCliffPreset ? '7x6 CLIFF SHEET' : (state.isOverlayWizardMode ? '15-TILE OVERLAY' : '6x3 DUAL-GRID'));
            const badgeLabel = `🎯 CLICK TO MAP ${presetTitle} AT (${hCol}, ${hRow})`;
            ctx.font = 'bold 10px sans-serif';
            const textWidth = ctx.measureText(badgeLabel).width;
            const badgeW = textWidth + 12;
            const badgeH = 18;
            const badgeX = boxX + (boxW - badgeW) / 2;
            const badgeY = boxY - 24;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
            ctx.strokeStyle = isWallPreset ? '#60a5fa' : '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isWallPreset ? '#93c5fd' : '#fbbf24';
            ctx.fillText(badgeLabel, badgeX + 6, badgeY + 13);
        }
    }

    /** Renders live composite preview canvas in Terrain Wizard (Ground 6x3, Cliffside 3D Terrace, or Wall Room Layout) */
    function renderTerrainPreview() {
        const canvas = document.getElementById('terrain-preview-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const ts = state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.image) return;

        ctx.imageSmoothingEnabled = false;
        const m = state.terrainMapping || {};
        const drawSlot = (slotKey, destX, destY) => {
            if (!slotKey) return;
            const vars = window.TileWeaver.stateModule.getSlotVariations(m, slotKey);
            if (vars && vars.length > 0) {
                const slot = vars[0];
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const srcX = margin + slot.tx * (state.TILE_SIZE + spacing);
                const srcY = margin + slot.ty * (state.TILE_SIZE + spacing);
                ctx.drawImage(ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE, destX, destY, 32, 32);
            }
        };

        if (state.terrainWizardMode === 'wall') {
            // Live Assembled 6x6 Architectural Wall Room & Corridor Preview
            canvas.width = 192;  // 6 tiles wide
            canvas.height = 192; // 6 tiles tall
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw a subtle floor grid backdrop
            ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 192; i += 32) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 192); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(192, i); ctx.stroke();
            }

            // Top Perimeter & North End Cap
            drawSlot('cornerTL', 0 * 32, 0 * 32);
            drawSlot('pipeH',    1 * 32, 0 * 32);
            drawSlot('tNorth',   2 * 32, 0 * 32);
            drawSlot('pipeH',    3 * 32, 0 * 32);
            drawSlot('cornerTR', 4 * 32, 0 * 32);
            drawSlot('capN',     5 * 32, 0 * 32);

            // Row 1: Vertical Walls & Crossroad
            drawSlot('pipeV',    0 * 32, 1 * 32);
            drawSlot('cross',    2 * 32, 1 * 32);
            drawSlot('pipeH',    3 * 32, 1 * 32);
            drawSlot('pipeV',    4 * 32, 1 * 32);

            // Row 2: T-West & T-East Intersections + Standalone Post
            drawSlot('tWest',    0 * 32, 2 * 32);
            drawSlot('pipeH',    1 * 32, 2 * 32);
            drawSlot('tEast',    2 * 32, 2 * 32);
            drawSlot('pipeV',    4 * 32, 2 * 32);
            drawSlot('post',     5 * 32, 2 * 32);

            // Row 3: Vertical Walls
            drawSlot('pipeV',    0 * 32, 3 * 32);
            drawSlot('pipeV',    2 * 32, 3 * 32);
            drawSlot('pipeV',    4 * 32, 3 * 32);

            // Row 4: Bottom Perimeter & South T-Junction
            drawSlot('cornerBL', 0 * 32, 4 * 32);
            drawSlot('pipeH',    1 * 32, 4 * 32);
            drawSlot('tSouth',   2 * 32, 4 * 32);
            drawSlot('pipeH',    3 * 32, 4 * 32);
            drawSlot('cornerBR', 4 * 32, 4 * 32);

            // Row 5: End Caps (West, South, East)
            drawSlot('capW',     0 * 32, 5 * 32);
            drawSlot('capS',     2 * 32, 5 * 32);
            drawSlot('capE',     4 * 32, 5 * 32);

        } else if (state.terrainWizardMode === 'cliff') {
            canvas.width = 192;  // 6 tiles wide
            canvas.height = 192; // 6 tiles high for full terrace preview
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const wallH = state.cliffPreviewHeight || 2;

            // Render 3D Cliff Terrace Model (6 cols x 6 rows)
            // Row 0: Elevated Top Ground Surface (using Top Ground Dual-Grid grid_0 or grid_15)
            for (let c = 0; c < 6; c++) drawSlot('grid_0', c * 32, 0);

            // Row 1: Top Lip Edge Rim (using Top Ground Lip Overhang grid_12, Outer TL grid_1, Outer TR grid_2)
            drawSlot('grid_1', 0, 32);
            for (let c = 1; c < 5; c++) drawSlot('grid_12', c * 32, 32);
            drawSlot('grid_2', 5 * 32, 32);

            // Rows 2 .. 1 + wallH: Middle Repeating Front Wall Face & Side Drops
            for (let h = 0; h < wallH; h++) {
                const r = 2 + h;
                if (r < 5) {
                    drawSlot('cliff_face_l', 0, r * 32);
                    for (let c = 1; c < 5; c++) drawSlot((h === 1 && c === 3) ? 'cliff_face_v1' : 'cliff_face_mid', c * 32, r * 32);
                    drawSlot('cliff_drop_side', 5 * 32, r * 32);
                }
            }

            // Row 2 + wallH: Bottom Base Footing & Shadow Join
            const baseR = Math.min(5, 2 + wallH);
            drawSlot('cliff_base_bl', 0, baseR * 32);
            for (let c = 1; c < 5; c++) drawSlot('cliff_base_shadow', c * 32, baseR * 32);
            drawSlot('cliff_base_br', 5 * 32, baseR * 32);

            // Row 3 + wallH .. 5: Lower Ground Surface
            for (let r = baseR + 1; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    drawSlot('grid_0', c * 32, r * 32);
                }
            }
        } else {
            canvas.width = 192; // 6 tiles wide
            canvas.height = 96; // 3 tiles tall
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 6; c++) {
                    const slotKey = DUALGRID_6X3_MATRIX[r][c];
                    if (slotKey) {
                        drawSlot(slotKey, c * 32, r * 32);
                    }
                }
            }
        }
    }

    /** Applies auto 6x3 dual-grid preset mapping at explicit (startCol, startRow) */
    function applyTerrainPresetAt(startCol, startRow) {
        state.terrainMapping = {};
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 6; c++) {
                const slotKey = DUALGRID_6X3_MATRIX[r][c];
                if (slotKey) {
                    state.terrainMapping[slotKey] = [{ tx: startCol + c, ty: startRow + r, weight: 100 }];
                }
            }
        }
    }

    /** Applies auto 7x6 cliff sheet preset mapping at explicit (startCol, startRow) */
    function applyCliff7x6PresetAt(startCol, startRow) {
        state.terrainMapping = {};
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 7; c++) {
                const slotKey = CLIFF_7X6_MATRIX[r] ? CLIFF_7X6_MATRIX[r][c] : null;
                if (slotKey) {
                    state.terrainMapping[slotKey] = [{ tx: startCol + c, ty: startRow + r, weight: 100 }];
                }
            }
        }
    }

    /** Applies auto 9x3 wall preset mapping at explicit (startCol, startRow) */
    function applyWall9x3PresetAt(startCol, startRow) {
        state.terrainMapping = {};
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 9; c++) {
                const slotKey = WALL_9X3_MATRIX[r] ? WALL_9X3_MATRIX[r][c] : null;
                if (slotKey) {
                    state.terrainMapping[slotKey] = [{ tx: startCol + c, ty: startRow + r, weight: 100 }];
                }
            }
        }
    }

    /** Applies auto 6x3 dual-grid preset mapping for Terrain Wizard (Artist Layout) */
    function applyTerrainPreset() {
        let startCol = state.selectedStamp ? state.selectedStamp.col : 0;
        let startRow = state.selectedStamp ? state.selectedStamp.row : 0;
        applyTerrainPresetAt(startCol, startRow);

        state.isOverlayWizardMode = false;
        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        showMessage("Applied Auto 6x3 Dual-Grid preset (Artist Layout)!", "success");
    }

    /** Applies 15-tile transparent overlay preset for Option B (46-Tile Overlay System) */
    function applyTerrainOverlayPreset() {
        let startCol = state.selectedStamp ? state.selectedStamp.col : 0;
        let startRow = state.selectedStamp ? state.selectedStamp.row : 0;
        applyTerrainPresetAt(startCol, startRow);

        state.isOverlayWizardMode = true;
        renderTerrainMaterialHeaderSwatches();
        renderTerrainSlotButtons();
        renderTerrainTilesetCanvas();
        renderTerrainPreview();
        showMessage("Applied 15-Tile Transparent Overlay Preset (Option B 46-Tile System)!", "success");
    }

    /** Toggles interactive preset placement mode (overlay, dualgrid, cliff7x6, or wall9x3) */
    function toggleTerrainPresetPlacement(presetType = 'dualgrid') {
        if (state.terrainPresetPlacementActive && state.presetPlacementType === presetType) {
            state.terrainPresetPlacementActive = false;
            state.terrainPresetHoverCol = -1;
            state.terrainPresetHoverRow = -1;
            showMessage("Preset placement cancelled.", "info");
        } else {
            state.terrainPresetPlacementActive = true;
            state.presetPlacementType = presetType;
            state.isOverlayWizardMode = (presetType === 'overlay');

            let labelName = '6x3 Dual-Grid';
            if (presetType === 'overlay') {
                labelName = '15-Tile Overlay';
            } else if (presetType === 'cliff7x6' || presetType === 'cliff6x5') {
                labelName = '7x6 Cliffside Sheet';
            } else if (presetType === 'wall9x3' || presetType === 'wall') {
                labelName = '9x3 Wall Matrix';
            }

            showMessage(`Interactive ${labelName} Preset Placement Active: Hover and CLICK on your tileset!`, "info");
        }

        updateTerrainPresetButtonsUI();
        renderTerrainTilesetCanvas();
    }

    /** Saves dual-material terrain autotile definition to `state.autotiles` */
    function saveTerrainAutotile() {
        const nameInput = document.getElementById('terrain-autotile-name');
        const name = nameInput ? nameInput.value.trim() : 'Custom Terrain Autotile';
        const ts = state.tilesets[state.activeTilesetIndex];

        const mat1 = document.getElementById('terrain-mat1-name')?.value.trim() || (wizardActiveMaterial ? wizardActiveMaterial.name : 'Material 1');
        const mat2 = document.getElementById('terrain-mat2-name')?.value.trim() || 'Material 2';
        const mat3 = document.getElementById('terrain-mat3-name')?.value.trim() || 'Lower Ground';
        const mat2PriorityVal = parseInt(document.getElementById('terrain-mat2-priority')?.value) || 1;

        const isCliffMode = state.terrainWizardMode === 'cliff';
        const isWallMode = state.terrainWizardMode === 'wall';
        const autotileMode = isWallMode ? '16tile' : (isCliffMode ? 'cliff_vstretch' : (state.isOverlayWizardMode ? 'overlay_dualgrid' : 'dualgrid'));

        // If multi-partner mode is active (ground dual-grid mode)
        if (wizardPartnerList && wizardPartnerList.length > 0 && !isCliffMode && !isWallMode) {
            // 1. Commit active partner in-memory state
            const curr = wizardPartnerList[wizardActivePartnerIndex];
            if (curr) {
                curr.mapping = cloneMapping(state.terrainMapping || {});
                curr.partnerName = mat2;
                curr.priority = mat2PriorityVal;
                curr.tilesetId = ts ? ts.id : (curr.tilesetId || '');
            }

            // 2. Persist all partners across wizardPartnerList
            wizardPartnerList.forEach((partner, pIdx) => {
                let existingAT = partner.autotileId ? state.autotiles.find(a => a.id === partner.autotileId) : null;
                const autoId = existingAT ? existingAT.id : (window.TileWeaver.stateModule ? window.TileWeaver.stateModule.generateUniqueAutotileId() : ('at_' + (state.autotileCounter++)));
                const numSuffix = autoId.replace('at_', '');

                const targetAutotile = existingAT || { id: autoId };

                targetAutotile.name = `${mat1} ↔ ${partner.partnerName}`;
                targetAutotile.mode = autotileMode;
                targetAutotile.isOverlayMode = !!state.isOverlayWizardMode;
                targetAutotile.isCliff = false;
                targetAutotile.isWall = false;
                targetAutotile.tilesetId = partner.tilesetId || (ts ? ts.id : '');
                targetAutotile.mapping = { ...partner.mapping };
                targetAutotile.mat1Name = mat1;
                targetAutotile.mat2Name = partner.partnerName;
                targetAutotile.mat3Name = null;

                // Variations preservation
                const existingVars1 = getExistingMaterialVariations(mat1);
                if (existingVars1 && existingVars1.length > 1 && (!targetAutotile.mapping['grid_0'] || targetAutotile.mapping['grid_0'].length <= 1)) {
                    targetAutotile.mapping['grid_0'] = existingVars1;
                }
                const existingVars2 = getExistingMaterialVariations(partner.partnerName);
                if (existingVars2 && existingVars2.length > 1 && (!targetAutotile.mapping['grid_15'] || targetAutotile.mapping['grid_15'].length <= 1)) {
                    targetAutotile.mapping['grid_15'] = existingVars2;
                }

                if (!existingAT) {
                    state.autotiles.push(targetAutotile);
                }
                partner.autotileId = targetAutotile.id;
                state.activeAutotileId = targetAutotile.id;
            });

            // Propagate variations across materials
            const allPartnerNames = wizardPartnerList.map(p => p.partnerName);
            [mat1, ...allPartnerNames].forEach(pName => {
                const vars = getExistingMaterialVariations(pName);
                if (vars && vars.length > 0) {
                    const nameLower = pName.toLowerCase();
                    state.autotiles.forEach(at => {
                        if (at.mode !== 'dualgrid' && at.mode !== 'overlay_dualgrid') return;
                        const isM1 = at.mat1Name && at.mat1Name.toLowerCase() === nameLower;
                        const isM2 = at.mat2Name && at.mat2Name.toLowerCase() === nameLower;
                        if (isM1 || isM2) {
                            if (!at.mapping) at.mapping = {};
                            const sKey = isM1 ? 'grid_0' : 'grid_15';
                            at.mapping[sKey] = vars.length === 1 ? vars[0] : vars;
                        }
                    });
                }
            });

            window.TileWeaver.tilesetManager.renderAutotileSelect();
            if (window.TileWeaver.terrainSwatches) {
                window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
                window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
                window.TileWeaver.terrainSwatches.setSidebarTab('swatches');
                if (wizardActiveMaterial) {
                    window.TileWeaver.terrainSwatches.selectMaterialSwatch(wizardActiveMaterial.id);
                }
            }

            if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
                window.TileWeaver.rendering.drawMap();
            }
            if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
                window.TileWeaver.history.pushHistoryState();
            }

            const countSaved = wizardPartnerList.length;
            closeTerrainWizard();
            showMessage(`Updated ${countSaved} transition autotiles for '${mat1}'!`, "success");
            return;
        }

        // Single Autotile Mode (Cliffside / Wall Sets)
        const isEditing = !!state.editingAutotileId;
        let existingAT = null;
        if (isEditing) {
            existingAT = state.autotiles.find(a => a.id === state.editingAutotileId);
        }

        const autoId = existingAT ? existingAT.id : (window.TileWeaver.stateModule ? window.TileWeaver.stateModule.generateUniqueAutotileId() : ('at_' + (state.autotileCounter++)));
        const numSuffix = autoId.replace('at_', '');
        const targetAutotile = existingAT || {
            id: autoId
        };

        targetAutotile.name = name || (isWallMode ? `Wall Set ${numSuffix}` : (isCliffMode ? `Cliffside Set ${numSuffix}` : `Terrain ${numSuffix}`));
        targetAutotile.mode = autotileMode;
        targetAutotile.isOverlayMode = !isWallMode && !!state.isOverlayWizardMode;
        targetAutotile.isCliff = isCliffMode;
        targetAutotile.isWall = isWallMode;
        targetAutotile.tilesetId = ts ? ts.id : '';
        targetAutotile.mapping = { ...state.terrainMapping };
        targetAutotile.mat1Name = mat1;
        targetAutotile.mat2Name = isWallMode ? null : mat2;
        targetAutotile.mat3Name = isCliffMode ? mat3 : null;

        if (!existingAT) {
            state.autotiles.push(targetAutotile);
        }
        state.activeAutotileId = targetAutotile.id;

        window.TileWeaver.tilesetManager.renderAutotileSelect();
        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
            
            const targetMatName = isWallMode ? (targetAutotile.mat1Name || targetAutotile.name) : (isCliffMode ? mat1 : mat2);
            const targetMatObj = (state.materials || []).find(m => m.name.toLowerCase() === targetMatName.toLowerCase()) || (state.materials || [])[0];
            if (targetMatObj && !isCliffMode && !isWallMode) {
                targetMatObj.priority = mat2PriorityVal;
            }

            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
            window.TileWeaver.terrainSwatches.setSidebarTab('swatches');
            if (targetMatObj) {
                window.TileWeaver.terrainSwatches.selectMaterialSwatch(targetMatObj.id);
            }
        }

        // Redraw map and push history
        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        closeTerrainWizard();
        if (isEditing) {
            showMessage(`Updated '${targetAutotile.name}'!`, "success");
        } else if (isWallMode) {
            window.TileWeaver.tools.selectTool('autotile');
            showMessage(`Wall Autotile '${targetAutotile.name}' saved! Selected Autotile Tool [A].`, "success");
        } else {
            window.TileWeaver.tools.selectTool('terrain');
            showMessage(`Cliffside Autotile '${targetAutotile.name}' saved!`, "success");
        }
    }

    // Expose wizard module on window.TileWeaver namespace
    window.TileWeaver.autotileWizard = {
        initAutotileWizardUI,
        openAutotileWizard,
        closeWizard,
        setWizardMode,
        applyWizardPreset,
        saveWizardAutotile,
        openTerrainWizard,
        openTerrainWizardForMaterial,
        openTerrainWizardForAutotile,
        closeTerrainWizard,
        renderPartnerTabsStrip,
        switchWizardPartnerTransition,
        addNewWizardPartnerTransition,
        pruneWizardPartnerTransition,
        applyTerrainPreset,
        saveTerrainAutotile,
        applyWall9x3PresetAt,
        setTerrainWizardMode,
        updateTerrainPresetButtonsUI,
        toggleTerrainPresetPlacement
    };
})();
