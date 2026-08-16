/**
 * @fileoverview TileWeaver - Global Unique Material Terrain Swatch Subsystem (V2 Studio)
 * @subsystem Modals, Wizards & Material Studio
 * @frameBudget 0.05ms Viewport HUD hotkeys, sub-16.6ms studio panel rendering with precalculated frequencies
 * @coordinateSpace 2D Vertex Array [y][x] to Dual-Grid Corner Indices (0..15)
 * @stateInvariants Single-source-of-truth state.materials, state.terrainStrokeValue, state.activeMaterialId
 * @historyTracked pushHistoryState() recorded on priority reorder, swap, duplicate, deletion, property save
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+
 * --------------------------------------------------------------------------------------
 * Handles:
 * 1. Synchronizing unique materials from registered autotiles (`state.autotiles`).
 * 2. Rendering Categorized Accordion Groups (🌿 Ground, 🏔️ Cliffs, 🧱 Walls).
 * 3. 3-Way View Density Modes (⊞ Rich, ☰ Compact List, 🔲 Visual Chips).
 * 4. Fluid Drag-and-Drop Visual Priority Reordering Stack with live map update and undo/redo.
 * 5. Procedural Composite Thumbnails (2-tier vertical cliff elevation slices, 16-tile wall connection profiles, ground transition corners).
 * 6. Floating Canvas Viewport "Active Swatch Ribbon" (HUD Hotkeys 1–5, auto-fade on painting, eyedropper auto-sync, pin/unpin).
 * 7. Real-time Fuzzy Search & Tag Filtering ('/', 'Escape' shortcuts).
 * 8. Clean, tactile swatch cards with zero button clutter on card face.
 * 9. Frictionless Right-Click & Hover [•••] Context Menu + Inline Quick Properties Drawer.
 * 10. Material selection, tool auto-switching ([T] for Terrain/Cliffs, [A] for Walls), and eyedropper handoff.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;

    /**
     * Color palette generator for material visual accent badges if no color specified.
     */
    const MATERIAL_COLORS = ['#22c55e', '#d97706', '#06b6d4', '#a855f7', '#ec4899', '#eab308', '#3b82f6', '#14b8a6'];

    /** Active context menu target material ID */
    let activeContextMenuMaterialId = null;

    /** Active dragged material ID during drag-and-drop reordering */
    let draggedMaterialId = null;

    /** Active material ID inside inline quick properties drawer */
    let activeQuickDrawerMaterialId = null;

    /**
     * Scans state.autotiles (dualgrid autotiles) to build/update state.materials map.
     * Deduplicates materials by name (case-insensitive) so that 'Grass' is a single global swatch.
     * 
     * @OPTIMIZATION Single-pass bucket classification loop over state.autotiles to eliminate 3 intermediate array allocations.
     * @returns {void}
     */
    function syncMaterialsFromAutotiles() {
        if (window.TileWeaver.stateModule && typeof window.TileWeaver.stateModule.sanitizeAutotileIds === 'function') {
            window.TileWeaver.stateModule.sanitizeAutotileIds();
        }

        state.materials = state.materials || [];
        const existingMetaMap = new Map();
        state.materials.forEach(m => {
            if (m && m.name) existingMetaMap.set(m.name.toLowerCase(), m);
        });

        const matMap = new Map();
        let colorIdx = 0;

        // Single-pass bucket classification for ground, cliff, and wall autotiles
        const groundAutotiles = [];
        const cliffAutotiles = [];
        const wallAutotiles = [];

        for (const at of (state.autotiles || [])) {
            if (!at) continue;
            if (at.isWall || at.mode === '16tile' || at.mode === 'wall_9x3' || at.mode === 'wall') {
                wallAutotiles.push(at);
            } else if (at.isCliff || at.mode === 'cliff_vstretch') {
                cliffAutotiles.push(at);
            } else if (at.mode === 'dualgrid' || at.mode === 'overlay_dualgrid') {
                groundAutotiles.push(at);
            }
        }

        const defaultTsId = (state.tilesets.find(t => !t.isCollection) || state.tilesets[0] || {}).id;

        // Step 1: Register Ground Autotiles FIRST (mat1Name -> grid_0, mat2Name -> grid_15)
        groundAutotiles.forEach(at => {
            const m = at.mapping || {};
            const name1 = (at.mat1Name || 'Base Material').trim();
            const key1 = name1.toLowerCase();
            const raw1 = m['grid_0'] || Object.values(m)[0];
            const tile1 = Array.isArray(raw1) ? raw1[0] : raw1;
            const meta1 = existingMetaMap.get(key1);
            const tsId = (state.tilesets.some(t => t.id === at.tilesetId) ? at.tilesetId : defaultTsId) || at.tilesetId;

            if (!matMap.has(key1)) {
                matMap.set(key1, {
                    id: meta1 ? meta1.id : 'mat_' + key1.replace(/\s+/g, '_'),
                    name: name1,
                    color: meta1 ? meta1.color : MATERIAL_COLORS[colorIdx++ % MATERIAL_COLORS.length],
                    tilesetId: tsId,
                    tx: tile1 ? tile1.tx : 0,
                    ty: tile1 ? tile1.ty : 0,
                    autotileIds: [at.id],
                    isCliff: false,
                    isWall: false
                });
            } else {
                const existing = matMap.get(key1);
                if (!existing.autotileIds.includes(at.id)) {
                    existing.autotileIds.push(at.id);
                }
                if (!existing.tilesetId && tsId) existing.tilesetId = tsId;
            }

            const name2 = (at.mat2Name || 'Overlay Material').trim();
            const key2 = name2.toLowerCase();
            const raw2 = m['grid_15'] || Object.values(m)[0];
            const tile2 = Array.isArray(raw2) ? raw2[0] : raw2;
            const meta2 = existingMetaMap.get(key2);

            if (!matMap.has(key2)) {
                matMap.set(key2, {
                    id: meta2 ? meta2.id : 'mat_' + key2.replace(/\s+/g, '_'),
                    name: name2,
                    color: meta2 ? meta2.color : MATERIAL_COLORS[colorIdx++ % MATERIAL_COLORS.length],
                    tilesetId: tsId,
                    tx: tile2 ? tile2.tx : 0,
                    ty: tile2 ? tile2.ty : 0,
                    autotileIds: [at.id],
                    isCliff: false,
                    isWall: false
                });
            } else {
                const existing = matMap.get(key2);
                if (!existing.autotileIds.includes(at.id)) {
                    existing.autotileIds.push(at.id);
                }
                if (!existing.tilesetId && tsId) existing.tilesetId = tsId;
            }
        });

        // Step 2: Register Cliff Autotiles SECOND (Single Unified "Cliffs" Swatch from mat1Name)
        cliffAutotiles.forEach(at => {
            const m = at.mapping || {};
            const name1 = (at.mat1Name || 'Cliffs').trim();
            const key1 = name1.toLowerCase();
            const raw1 = m['grid_15'] || m['grid_0'] || m['cliff_surface'];
            const tile1 = Array.isArray(raw1) ? raw1[0] : raw1;
            const meta1 = existingMetaMap.get(key1);
            const tsId = (state.tilesets.some(t => t.id === at.tilesetId) ? at.tilesetId : defaultTsId) || at.tilesetId;

            if (!matMap.has(key1)) {
                matMap.set(key1, {
                    id: meta1 ? meta1.id : 'mat_' + key1.replace(/\s+/g, '_'),
                    name: name1,
                    color: meta1 ? meta1.color : MATERIAL_COLORS[colorIdx++ % MATERIAL_COLORS.length],
                    tilesetId: tsId,
                    tx: tile1 ? tile1.tx : 0,
                    ty: tile1 ? tile1.ty : 0,
                    autotileIds: [at.id],
                    isCliff: true,
                    isWall: false
                });
            } else {
                const existing = matMap.get(key1);
                if (!existing.autotileIds.includes(at.id)) {
                    existing.autotileIds.push(at.id);
                }
                existing.isCliff = true;
                if (!existing.tilesetId && tsId) existing.tilesetId = tsId;
            }
        });

        // Step 3: Register Wall Autotiles THIRD (Single Unified Wall/Fence Swatch from mat1Name or name)
        wallAutotiles.forEach(at => {
            const m = at.mapping || {};
            const name1 = (at.mat1Name || at.name || 'Wall Material').trim();
            const key1 = name1.toLowerCase();
            const raw1 = m['post'] || m['solid'] || m['pipeH'] || m['cross'] || m['cornerTL'] || Object.values(m)[0];
            const tile1 = Array.isArray(raw1) ? raw1[0] : raw1;
            const meta1 = existingMetaMap.get(key1);
            const tsId = (state.tilesets.some(t => t.id === at.tilesetId) ? at.tilesetId : defaultTsId) || at.tilesetId;

            if (!matMap.has(key1)) {
                matMap.set(key1, {
                    id: meta1 ? meta1.id : 'mat_' + key1.replace(/\s+/g, '_'),
                    name: name1,
                    color: meta1 ? meta1.color : '#3b82f6',
                    tilesetId: tsId,
                    tx: tile1 ? tile1.tx : 0,
                    ty: tile1 ? tile1.ty : 0,
                    autotileIds: [at.id],
                    isCliff: false,
                    isWall: true,
                    type: 'wall'
                });
            } else {
                const existing = matMap.get(key1);
                if (!existing.autotileIds.includes(at.id)) {
                    existing.autotileIds.unshift(at.id);
                }
                existing.isWall = true;
                if (tile1) {
                    existing.tx = tile1.tx;
                    existing.ty = tile1.ty;
                }
                if (tsId) existing.tilesetId = tsId;
            }
        });

        // Convert Map to array and assign integer vertex values (0, 1, 2, ...) and priorities
        state.materials = Array.from(matMap.values()).map((mat, idx) => {
            mat.vertexVal = idx;
            if (typeof mat.priority !== 'number') {
                mat.priority = idx;
            }
            return mat;
        });

        // Initialize UI search, density mode, ribbon state, and accordion defaults if unset
        state.swatchSearchQuery = state.swatchSearchQuery || '';
        state.swatchDensityMode = state.swatchDensityMode || 'rich';
        state.materialCategoryFilter = state.materialCategoryFilter || 'all';
        state.swatchAccordionState = state.swatchAccordionState || { ground: true, cliff: true, wall: true };
        state.pinnedMaterialIds = state.pinnedMaterialIds || [];
        state.recentMaterialIds = state.recentMaterialIds || [];

        // Set default activeMaterialId if unset or invalid
        if (state.materials.length > 0 && (!state.activeMaterialId || !state.materials.some(m => m.id === state.activeMaterialId))) {
            state.activeMaterialId = state.materials[0].id;
            state.terrainStrokeValue = state.materials[0].vertexVal;
            if (state.materials[0].autotileIds && state.materials[0].autotileIds.length > 0) {
                state.activeAutotileId = state.materials[0].autotileIds[0];
            }
        }
    }

    /**
     * Swaps left sidebar panels between [Tileset Manager] and [Terrain Swatches].
     */
    function setSidebarTab(tabName) {
        state.activeSidebarTab = tabName;
        const tabTilesetBtn = document.getElementById('tab-sidebar-tileset');
        const tabTerrainBtn = document.getElementById('tab-sidebar-terrain');
        const panelTileset = document.getElementById('panel-tileset-manager');
        const panelTerrain = document.getElementById('panel-terrain-swatches');

        if (tabName === 'swatches') {
            if (tabTilesetBtn) tabTilesetBtn.className = "flex-1 py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850 transition-colors";
            if (tabTerrainBtn) tabTerrainBtn.className = "flex-1 py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 border-teal-500 text-white bg-slate-800 transition-colors font-bold";
            if (panelTileset) panelTileset.classList.add('hidden');
            if (panelTerrain) panelTerrain.classList.remove('hidden');
        } else {
            if (tabTilesetBtn) tabTilesetBtn.className = "flex-1 py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 border-blue-500 text-white bg-slate-800 transition-colors font-bold";
            if (tabTerrainBtn) tabTerrainBtn.className = "flex-1 py-2 px-3 flex items-center justify-center gap-1.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850 transition-colors";
            if (panelTileset) panelTileset.classList.remove('hidden');
            if (panelTerrain) panelTerrain.classList.add('hidden');
        }
    }

    /**
     * Selects a material swatch, updates UI active highlights, updates HUD ribbon, and switches to the appropriate drawing tool.
     */
    function selectMaterialSwatch(materialId) {
        state.activeMaterialId = materialId;
        const mat = state.materials ? state.materials.find(m => m.id === materialId) : null;

        if (mat) {
            // Update Recent Material Stack for HUD ribbon
            state.recentMaterialIds = state.recentMaterialIds || [];
            state.recentMaterialIds = state.recentMaterialIds.filter(id => id !== materialId);
            state.recentMaterialIds.unshift(materialId);
            if (state.recentMaterialIds.length > 8) {
                state.recentMaterialIds = state.recentMaterialIds.slice(0, 8);
            }

            if (mat.autotileIds && mat.autotileIds.length > 0) {
                state.activeAutotileId = mat.autotileIds[0];
                const at = state.autotiles.find(a => a.id === state.activeAutotileId);

                if (at) {
                    if (at.tilesetId) {
                        const tsIdx = state.tilesets.findIndex(t => t.id === at.tilesetId);
                        if (tsIdx !== -1) {
                            state.activeTilesetIndex = tsIdx;
                            if (window.TileWeaver.tilesetManager) {
                                window.TileWeaver.tilesetManager.renderTilesetSelect();
                            }
                            if (window.TileWeaver.rendering) {
                                window.TileWeaver.rendering.drawTileset();
                            }
                        }
                    }

                    if (at.mapping) {
                        if (at.isWall || at.mode === '16tile' || at.mode === 'wall_9x3' || at.mode === 'wall') {
                            const raw = at.mapping['post'] || at.mapping['solid'] || at.mapping['pipeH'] || at.mapping['cross'] || Object.values(at.mapping)[0];
                            const tile = Array.isArray(raw) ? raw[0] : raw;
                            if (tile) {
                                mat.tx = tile.tx;
                                mat.ty = tile.ty;
                                mat.tilesetId = at.tilesetId;
                            }
                        } else {
                            const isMat1 = at.mat1Name && at.mat1Name.toLowerCase() === mat.name.toLowerCase();
                            const slotKey = isMat1 ? 'grid_0' : 'grid_15';
                            const raw = at.mapping[slotKey] || Object.values(at.mapping)[0];
                            const tile = Array.isArray(raw) ? raw[0] : raw;
                            if (tile) {
                                mat.tx = tile.tx;
                                mat.ty = tile.ty;
                                mat.tilesetId = at.tilesetId;
                            }
                        }
                    }
                }
            }

            if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.renderAutotileSelect === 'function') {
                window.TileWeaver.tilesetManager.renderAutotileSelect();
            }

            state.terrainStrokeValue = mat.vertexVal;

            if (mat.isWall) {
                showMessage(`Selected '${mat.name}' Wall Swatch! Selected Autotile Tool [A] — paint on map.`, "success");
            } else {
                showMessage(`Selected '${mat.name}' Terrain Swatch (Priority ${mat.priority})!`, "info");
            }
        }

        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();

        // Switch tool: Autotile Brush [A] for Wall materials, Terrain Brush [T] for Ground/Cliff materials
        if (mat && mat.isWall) {
            window.TileWeaver.tools.selectTool('autotile');
        } else {
            if (state.currentTool !== 'terrain' && state.currentTool !== 'terrainBucket') {
                window.TileWeaver.tools.selectTool('terrain');
            }
        }
    }

    /**
     * Sets material category filter ('all', 'ground', 'cliff', 'wall') and re-renders swatches.
     */
    function setMaterialCategoryFilter(category) {
        state.materialCategoryFilter = category;
        updateCategoryFilterButtonStyles();
        renderTerrainSwatchesUI();
    }

    /**
     * Sets swatch density mode ('rich', 'compact', 'chips') and re-renders swatches.
     */
    function setSwatchDensityMode(mode) {
        state.swatchDensityMode = mode;
        updateDensityModeButtonStyles();
        renderTerrainSwatchesUI();
    }

    /**
     * Updates active visual styling on 3-way density toggle buttons.
     */
    function updateDensityModeButtonStyles() {
        const mode = state.swatchDensityMode || 'rich';
        const activeClass = "p-1 rounded text-[10px] bg-slate-800 text-teal-300 font-bold transition-colors";
        const inactiveClass = "p-1 rounded text-[10px] hover:text-white text-slate-400 transition-colors";

        const btnRich = document.getElementById('btn-swatch-density-rich');
        const btnCompact = document.getElementById('btn-swatch-density-compact');
        const btnChips = document.getElementById('btn-swatch-density-chips');

        if (btnRich) btnRich.className = (mode === 'rich') ? activeClass : inactiveClass;
        if (btnCompact) btnCompact.className = (mode === 'compact') ? activeClass : inactiveClass;
        if (btnChips) btnChips.className = (mode === 'chips') ? activeClass : inactiveClass;
    }

    /**
     * Updates active visual styling on category filter buttons and counts.
     */
    function updateCategoryFilterButtonStyles() {
        const cat = state.materialCategoryFilter || 'all';
        const activeClass = "px-2 py-0.5 rounded-full font-bold bg-teal-600 text-white transition-all shadow-sm flex items-center gap-0.5 shrink-0";
        const inactiveClass = "px-2 py-0.5 rounded-full font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all flex items-center gap-0.5 shrink-0";

        const btnAll = document.getElementById('btn-swatch-filter-all');
        const btnGround = document.getElementById('btn-swatch-filter-ground');
        const btnCliff = document.getElementById('btn-swatch-filter-cliff');
        const btnWall = document.getElementById('btn-swatch-filter-wall');

        if (btnAll) btnAll.className = (cat === 'all') ? activeClass : inactiveClass;
        if (btnGround) btnGround.className = (cat === 'ground') ? activeClass : inactiveClass;
        if (btnCliff) btnCliff.className = (cat === 'cliff') ? activeClass : inactiveClass;
        if (btnWall) btnWall.className = (cat === 'wall') ? activeClass : inactiveClass;

        // Update live counts
        const allMats = state.materials || [];
        const groundCount = allMats.filter(m => !m.isCliff && !m.isWall).length;
        const cliffCount = allMats.filter(m => !!m.isCliff).length;
        const wallCount = allMats.filter(m => !!m.isWall).length;

        const elTotal = document.getElementById('swatch-total-count-badge');
        const elAll = document.getElementById('count-swatch-filter-all');
        const elGround = document.getElementById('count-swatch-filter-ground');
        const elCliff = document.getElementById('count-swatch-filter-cliff');
        const elWall = document.getElementById('count-swatch-filter-wall');

        if (elTotal) elTotal.textContent = allMats.length;
        if (elAll) elAll.textContent = `(${allMats.length})`;
        if (elGround) elGround.textContent = `(${groundCount})`;
        if (elCliff) elCliff.textContent = `(${cliffCount})`;
        if (elWall) elWall.textContent = `(${wallCount})`;
    }

    /**
     * Resolves live tile coordinate, tileset, and transition partner metadata for a material.
     */
    function resolveMaterialThumbnailInfo(mat) {
        let thumbTx = mat.tx || 0;
        let thumbTy = mat.ty || 0;
        let thumbTsId = mat.tilesetId;
        const transitionPartners = new Set();
        let primaryAT = null;

        if (mat.autotileIds && mat.autotileIds.length > 0) {
            mat.autotileIds.forEach(atId => {
                const at = state.autotiles.find(a => a.id === atId);
                if (at) {
                    if (at.mat1Name && at.mat1Name.toLowerCase() !== mat.name.toLowerCase()) {
                        transitionPartners.add(at.mat1Name);
                    }
                    if (at.mat2Name && at.mat2Name.toLowerCase() !== mat.name.toLowerCase()) {
                        transitionPartners.add(at.mat2Name);
                    }
                }
            });

            primaryAT = state.autotiles.find(a => a.id === mat.autotileIds[0]);
            if (primaryAT && primaryAT.mapping) {
                thumbTsId = primaryAT.tilesetId || thumbTsId;
                if (primaryAT.isWall || primaryAT.mode === '16tile' || primaryAT.mode === 'wall_9x3' || primaryAT.mode === 'wall') {
                    const raw = primaryAT.mapping['post'] || primaryAT.mapping['solid'] || primaryAT.mapping['pipeH'] || primaryAT.mapping['cross'] || Object.values(primaryAT.mapping)[0];
                    const t = Array.isArray(raw) ? raw[0] : raw;
                    if (t) { thumbTx = t.tx; thumbTy = t.ty; }
                } else if (primaryAT.isCliff || primaryAT.mode === 'cliff_vstretch') {
                    const raw = primaryAT.mapping['grid_15'] || primaryAT.mapping['grid_0'] || primaryAT.mapping['cliff_surface'] || Object.values(primaryAT.mapping)[0];
                    const t = Array.isArray(raw) ? raw[0] : raw;
                    if (t) { thumbTx = t.tx; thumbTy = t.ty; }
                } else {
                    const isMat1 = primaryAT.mat1Name && primaryAT.mat1Name.toLowerCase() === mat.name.toLowerCase();
                    const slotKey = isMat1 ? 'grid_0' : 'grid_15';
                    const raw = primaryAT.mapping[slotKey] || Object.values(primaryAT.mapping)[0];
                    const t = Array.isArray(raw) ? raw[0] : raw;
                    if (t) { thumbTx = t.tx; thumbTy = t.ty; }
                }
            }
        }

        const ts = state.tilesets.find(t => t.id === thumbTsId) || state.tilesets.find(t => t.id === mat.tilesetId) || state.tilesets[0];
        return { thumbTx, thumbTy, ts, transitionPartners, primaryAT };
    }

    /**
     * Scans the current active map layers' terrainVertices to compute real-time
     * transition frequency counts between every pair of materials.
     * 
     * @OPTIMIZATION Pre-indexes materials by vertex value in a Map for O(1) inner loop lookup.
     * @OPTIMIZATION Allocation-free 4-variable uniqueness extraction to prevent GC churn in 2x2 cells.
     * @returns {Object.<string, Object.<string, number>>} transition frequency matrix
     */
    function calculateMapTransitionFrequencies() {
        const frequencies = {};
        if (!state.mapLayers || !state.materials || state.materials.length === 0) return frequencies;

        // Pre-index materials by integer vertex value for O(1) inner loop resolution
        const vertexToMatMap = new Map();
        for (let i = 0; i < state.materials.length; i++) {
            const m = state.materials[i];
            if (m && typeof m.vertexVal === 'number') {
                vertexToMatMap.set(m.vertexVal, m);
            }
        }

        const mapW = state.mapWidth || 0;
        const mapH = state.mapHeight || 0;

        for (let l = 0; l < state.mapLayers.length; l++) {
            const layer = state.mapLayers[l];
            if (!layer || !layer.terrainVertices || !Array.isArray(layer.terrainVertices)) continue;
            const verts = layer.terrainVertices;
            const maxR = Math.min(mapH, verts.length - 1);

            for (let r = 0; r < maxR; r++) {
                const row0 = verts[r];
                const row1 = verts[r + 1];
                if (!row0 || !row1) continue;
                const maxC = Math.min(mapW, Math.min(row0.length, row1.length) - 1);

                for (let c = 0; c < maxC; c++) {
                    const v00 = row0[c];
                    const v01 = row0[c + 1];
                    const v10 = row1[c];
                    const v11 = row1[c + 1];

                    if (v00 === undefined || v01 === undefined || v10 === undefined || v11 === undefined) continue;

                    // Fast check for uniform cell (Zero allocations / comparisons)
                    if (v00 === v01 && v00 === v10 && v00 === v11) continue;

                    // Zero-allocation uniqueness extract (up to 4 unique values)
                    let uCount = 1;
                    const u0 = v00;
                    let u1 = -1, u2 = -1, u3 = -1;
                    if (v01 !== u0) { u1 = v01; uCount++; }
                    if (v10 !== u0 && v10 !== u1) { if (uCount === 1) u1 = v10; else u2 = v10; uCount++; }
                    if (v11 !== u0 && v11 !== u1 && v11 !== u2) { if (uCount === 1) u1 = v11; else if (uCount === 2) u2 = v11; else u3 = v11; uCount++; }

                    if (uCount <= 1) continue;
                    const uniqueVals = [u0, u1, u2, u3];

                    for (let i = 0; i < uCount; i++) {
                        for (let j = i + 1; j < uCount; j++) {
                            const valA = uniqueVals[i];
                            const valB = uniqueVals[j];
                            const matA = vertexToMatMap.get(valA) || getMaterialByVertexValue(valA);
                            const matB = vertexToMatMap.get(valB) || getMaterialByVertexValue(valB);
                            if (matA && matB && matA.id !== matB.id) {
                                frequencies[matA.id] = frequencies[matA.id] || {};
                                frequencies[matA.id][matB.id] = (frequencies[matA.id][matB.id] || 0) + 1;

                                frequencies[matB.id] = frequencies[matB.id] || {};
                                frequencies[matB.id][matA.id] = (frequencies[matB.id][matA.id] || 0) + 1;
                            }
                        }
                    }
                }
            }
        }

        return frequencies;
    }

    /**
     * Determines the dominant transition blend partner material for a given material.
     * Prioritizes the most frequent transition partner painted on the active map.
     * Falls back to registered autotile definition if no map transitions exist yet.
     * 
     * @param {Object} mat - Target material object
     * @param {Object.<string, Object.<string, number>>|null} [precalculatedFrequencies=null] - Optional cached frequency table
     * @returns {{ partner: Object|null, count: number, isFromMap: boolean }}
     */
    function getDominantTransitionPartner(mat, precalculatedFrequencies = null) {
        if (!mat) return { partner: null, count: 0, isFromMap: false };

        const frequencies = precalculatedFrequencies || calculateMapTransitionFrequencies();
        const partnerCounts = frequencies[mat.id] || {};

        let dominantPartnerId = null;
        let maxCount = 0;

        Object.entries(partnerCounts).forEach(([pId, count]) => {
            if (count > maxCount) {
                maxCount = count;
                dominantPartnerId = pId;
            }
        });

        if (dominantPartnerId && maxCount > 0) {
            const partnerMat = getMaterialById(dominantPartnerId);
            if (partnerMat) {
                return { partner: partnerMat, count: maxCount, isFromMap: true };
            }
        }

        // Fallback: Use first registered autotile transition partner
        if (mat.autotileIds && mat.autotileIds.length > 0) {
            const primaryAT = state.autotiles.find(a => a.id === mat.autotileIds[0]);
            if (primaryAT) {
                const partnerName = (primaryAT.mat1Name && primaryAT.mat1Name.toLowerCase() === mat.name.toLowerCase())
                    ? primaryAT.mat2Name
                    : primaryAT.mat1Name;
                if (partnerName) {
                    const fallbackMat = state.materials.find(m => m.name.toLowerCase() === partnerName.toLowerCase());
                    if (fallbackMat && fallbackMat.id !== mat.id) {
                        return { partner: fallbackMat, count: 0, isFromMap: false };
                    }
                }
            }
        }

        return { partner: null, count: 0, isFromMap: false };
    }

    /**
     * Procedural Composite Thumbnail Rendering Engine (Map-Adaptive Dynamic Blending).
     * Generates intelligent, tactile preview slices:
     * - Ground: Primary base tile with diagonal transition preview slice blending the
     *           dominant transitioning material on the active map!
     * - Cliff: 2-Tier vertical elevation slice (Top Cap + Shaded Face).
     * - Wall: Connected 16-tile cross/profile segment instead of solitary post dot.
     * 
     * @param {HTMLCanvasElement} canvas - Target thumbnail canvas element
     * @param {Object} mat - Material object
     * @param {number} [width=26] - Target width in CSS px
     * @param {number} [height=26] - Target height in CSS px
     * @param {Object|null} [precalculatedFrequencies=null] - Optional precalculated frequency cache
     * @returns {void}
     */
    function renderCompositeThumbnail(canvas, mat, width = 26, height = 26, precalculatedFrequencies = null) {
        if (!canvas || !mat) return;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = false;

        const { thumbTx, thumbTy, ts, primaryAT } = resolveMaterialThumbnailInfo(mat);
        if (!ts || !ts.image) return;

        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const step = state.TILE_SIZE + spacing;

        // --- 1. WALL MATERIAL COMPOSITE ---
        if (mat.isWall && primaryAT && primaryAT.mapping) {
            const m = primaryAT.mapping;
            const solidRaw = m['solid'] || m['cross'] || m['pipeH'] || m['post'] || Object.values(m)[0];
            const solidTile = Array.isArray(solidRaw) ? solidRaw[0] : solidRaw;

            if (solidTile) {
                const sx = margin + solidTile.tx * step;
                const sy = margin + solidTile.ty * step;
                ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, width, height);
                return;
            }
        }

        // --- 2. CLIFF ELEVATION 2-TIER COMPOSITE ---
        if (mat.isCliff && primaryAT && primaryAT.mapping) {
            const m = primaryAT.mapping;
            // Material 1: Elevated Top Plateau / Cliff Surface Cap
            const capRaw = m['grid_15'] || m['cliff_surface'] || m['cliff_top'] || { tx: thumbTx, ty: thumbTy };
            // Material 2: Cliff Side Wall Face / Vertical Rock (cliff_face_mid, cliff_face, cliff_face_l, etc.)
            const faceRaw = m['cliff_face_mid'] || m['cliff_face'] || m['cliff_wall'] || m['cliff_face_l'] || m['cliff_face_r'] || m['cliff_face_v1'] || m['cliff_drop_side'] || m['grid_3'] || { tx: thumbTx, ty: thumbTy };

            const capTile = Array.isArray(capRaw) ? capRaw[0] : capRaw;
            const faceTile = Array.isArray(faceRaw) ? faceRaw[0] : faceRaw;

            const halfH = Math.floor(height / 2);
            const halfTile = Math.floor(state.TILE_SIZE / 2);

            // Draw Upper Half (Material 1: Top Plateau Grass / Cap Surface)
            if (capTile) {
                const capSx = margin + capTile.tx * step;
                const capSy = margin + capTile.ty * step;
                ctx.drawImage(ts.image, capSx, capSy, state.TILE_SIZE, halfTile, 0, 0, width, halfH);
            }

            // Draw Lower Half (Material 2: Vertical Shaded Cliff Face / Side Wall)
            if (faceTile) {
                const faceSx = margin + faceTile.tx * step;
                const faceSy = margin + faceTile.ty * step;
                ctx.drawImage(ts.image, faceSx, faceSy, state.TILE_SIZE, halfTile, 0, halfH, width, height - halfH);
            }

            // 1px Subtle depth separator line
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, halfH - 1, width, 1);
            return;
        }

        // --- 3. GROUND TERRAIN BASE WITH DYNAMIC MAP-AWARE CORNER BLEND ---
        const sx = margin + thumbTx * step;
        const sy = margin + thumbTy * step;
        ctx.drawImage(ts.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, width, height);

        // Dynamically resolve the most prominent transition partner on current map
        if (!mat.isCliff && !mat.isWall) {
            const { partner: dominantPartner } = getDominantTransitionPartner(mat, precalculatedFrequencies);

            if (dominantPartner) {
                // Check if there is an explicit autotile connecting mat and dominantPartner
                const blendAT = state.autotiles.find(a => 
                    (!a.isCliff && !a.isWall) && (
                        (a.mat1Name && a.mat1Name.toLowerCase() === mat.name.toLowerCase() && a.mat2Name && a.mat2Name.toLowerCase() === dominantPartner.name.toLowerCase()) ||
                        (a.mat2Name && a.mat2Name.toLowerCase() === mat.name.toLowerCase() && a.mat1Name && a.mat1Name.toLowerCase() === dominantPartner.name.toLowerCase())
                    )
                );

                let overlayTx = dominantPartner.tx || 0;
                let overlayTy = dominantPartner.ty || 0;
                let overlayTs = state.tilesets.find(t => t.id === dominantPartner.tilesetId) || ts;

                if (blendAT && blendAT.mapping) {
                    overlayTs = state.tilesets.find(t => t.id === blendAT.tilesetId) || overlayTs;
                    const isMat1 = blendAT.mat1Name && blendAT.mat1Name.toLowerCase() === mat.name.toLowerCase();
                    const slot = isMat1 ? 'grid_15' : 'grid_0';
                    const raw = blendAT.mapping[slot] || Object.values(blendAT.mapping)[0];
                    const t = Array.isArray(raw) ? raw[0] : raw;
                    if (t) {
                        overlayTx = t.tx;
                        overlayTy = t.ty;
                    }
                }

                if (overlayTs && overlayTs.image && (overlayTx !== thumbTx || overlayTy !== thumbTy || overlayTs !== ts)) {
                    const overMargin = overlayTs.margin || 0;
                    const overSpacing = overlayTs.spacing || 0;
                    const overStep = state.TILE_SIZE + overSpacing;
                    const overSx = overMargin + overlayTx * overStep;
                    const overSy = overMargin + overlayTy * overStep;

                    if (ctx.save && ctx.beginPath && ctx.clip) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(width * 0.45, height);
                        ctx.lineTo(width, height * 0.45);
                        ctx.lineTo(width, height);
                        ctx.closePath();
                        ctx.clip();

                        ctx.drawImage(overlayTs.image, overSx, overSy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, width, height);
                        ctx.restore();

                        // Subtle diagonal divider line
                        if (ctx.stroke) {
                            ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(width * 0.45, height);
                            ctx.lineTo(width, height * 0.45);
                            ctx.stroke();
                        }
                    }
                }
            }
        }
    }

    /**
     * Attaches drag-and-drop priority stack reordering listeners to a swatch element.
     */
    function attachDragAndDropListeners(el, mat) {
        el.setAttribute('draggable', 'true');

        el.addEventListener('dragstart', (e) => {
            draggedMaterialId = mat.id;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', mat.id);
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!draggedMaterialId || draggedMaterialId === mat.id) return;

            const rect = el.getBoundingClientRect();
            const isTop = (e.clientY - rect.top) < (rect.height / 2);

            el.classList.toggle('swatch-drag-over-top', isTop);
            el.classList.toggle('swatch-drag-over-bottom', !isTop);
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('swatch-drag-over-top', 'swatch-drag-over-bottom');
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('swatch-drag-over-top', 'swatch-drag-over-bottom');
            if (draggedMaterialId && draggedMaterialId !== mat.id) {
                const rect = el.getBoundingClientRect();
                const position = (e.clientY - rect.top) < (rect.height / 2) ? 'before' : 'after';
                reorderMaterialPriority(draggedMaterialId, mat.id, position);
            }
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('dragging', 'swatch-drag-over-top', 'swatch-drag-over-bottom');
            draggedMaterialId = null;
        });
    }

    /**
     * Fluid Drag-and-Drop Visual Priority Stack Reorder Engine.
     * Reorders materials, recomputes priority integers, triggers drawMap(), and records history.
     */
    function reorderMaterialPriority(sourceMatId, targetMatId, position) {
        if (!state.materials || state.materials.length <= 1) return;

        const srcMat = state.materials.find(m => m.id === sourceMatId);
        const tgtMat = state.materials.find(m => m.id === targetMatId);
        if (!srcMat || !tgtMat || srcMat === tgtMat) return;

        // Ground Material Priority Reordering
        if (!srcMat.isCliff && !srcMat.isWall && !tgtMat.isCliff && !tgtMat.isWall) {
            const groundMats = state.materials.filter(m => !m.isCliff && !m.isWall).sort((a, b) => (b.priority || 0) - (a.priority || 0));
            const srcIdx = groundMats.findIndex(m => m.id === sourceMatId);
            if (srcIdx === -1) return;

            // Remove source
            groundMats.splice(srcIdx, 1);
            let tgtIdx = groundMats.findIndex(m => m.id === targetMatId);
            if (tgtIdx === -1) tgtIdx = groundMats.length;

            const insertIdx = position === 'before' ? tgtIdx : tgtIdx + 1;
            groundMats.splice(insertIdx, 0, srcMat);

            // Reassign monotonic priorities (Top = highest priority)
            const count = groundMats.length;
            groundMats.forEach((m, idx) => {
                m.priority = count - 1 - idx;
            });
        } else {
            // General reorder in state.materials array
            const srcIdx = state.materials.findIndex(m => m.id === sourceMatId);
            state.materials.splice(srcIdx, 1);
            let tgtIdx = state.materials.findIndex(m => m.id === targetMatId);
            if (tgtIdx === -1) tgtIdx = state.materials.length;
            const insertIdx = position === 'before' ? tgtIdx : tgtIdx + 1;
            state.materials.splice(insertIdx, 0, srcMat);
        }

        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();

        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }

        showMessage(`Priority Stack Updated: '${srcMat.name}' is now Priority ${srcMat.priority}`, "info");
    }

    /**
     * Resolves up to 5 material slots for the Active Swatch Ribbon HUD (Pinned first, then Recent).
     */
    function getRibbonSlots() {
        state.materials = state.materials || [];
        state.pinnedMaterialIds = state.pinnedMaterialIds || [];
        state.recentMaterialIds = state.recentMaterialIds || [];

        const slots = [];
        const seenIds = new Set();

        // 1. Add Pinned materials
        state.pinnedMaterialIds.forEach(id => {
            const m = state.materials.find(mat => mat.id === id);
            if (m && !seenIds.has(m.id)) {
                slots.push(m);
                seenIds.add(m.id);
            }
        });

        // 2. Add Recent materials
        state.recentMaterialIds.forEach(id => {
            if (slots.length >= 5) return;
            const m = state.materials.find(mat => mat.id === id);
            if (m && !seenIds.has(m.id)) {
                slots.push(m);
                seenIds.add(m.id);
            }
        });

        // 3. Fill remaining slots from state.materials
        for (let i = 0; i < state.materials.length && slots.length < 5; i++) {
            const m = state.materials[i];
            if (m && !seenIds.has(m.id)) {
                slots.push(m);
                seenIds.add(m.id);
            }
        }

        return slots;
    }

    /**
     * Selects the material at specified ribbon slot index (0..4).
     */
    function selectRibbonSlot(slotIndex) {
        const slots = getRibbonSlots();
        if (slotIndex >= 0 && slotIndex < slots.length && slots[slotIndex]) {
            selectMaterialSwatch(slots[slotIndex].id);
        }
    }

    /**
     * Toggles pinned status for a material swatch.
     */
    function togglePinMaterial(materialId) {
        state.pinnedMaterialIds = state.pinnedMaterialIds || [];
        const idx = state.pinnedMaterialIds.indexOf(materialId);
        const mat = getMaterialById(materialId);

        if (idx !== -1) {
            state.pinnedMaterialIds.splice(idx, 1);
            showMessage(`Unpinned '${mat ? mat.name : 'Material'}' from HUD ribbon.`, "info");
        } else {
            if (state.pinnedMaterialIds.length >= 5) {
                state.pinnedMaterialIds.shift();
            }
            state.pinnedMaterialIds.push(materialId);
            showMessage(`Pinned '${mat ? mat.name : 'Material'}' to HUD ribbon (Hotkeys 1-5)!`, "success");
        }

        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();
    }

    /**
     * Sets drawing opacity fade on the floating HUD stack to avoid canvas obstruction.
     */
    function setRibbonDrawingFade(isDrawing) {
        const stack = document.getElementById('viewport-hud-stack') || document.getElementById('active-swatch-ribbon');
        if (stack) {
            stack.classList.toggle('ribbon-fade', !!isDrawing);
        }
    }

    /**
     * Renders the Active Swatch Ribbon HUD inside the viewport.
     */
    function renderSwatchRibbonHUD() {
        const ribbon = document.getElementById('active-swatch-ribbon');
        if (!ribbon) return;

        const slots = getRibbonSlots();
        if (slots.length === 0) {
            ribbon.classList.add('hidden');
            return;
        }

        ribbon.classList.remove('hidden');
        ribbon.innerHTML = '';

        slots.forEach((mat, idx) => {
            const isActive = mat.id === state.activeMaterialId;
            const isPinned = (state.pinnedMaterialIds || []).includes(mat.id);

            const slotEl = document.createElement('div');
            let activeClass = '';
            if (isActive) {
                activeClass = mat.isWall ? 'active-wall' : (mat.isCliff ? 'active-cliff' : 'active-ground');
            }
            slotEl.className = `ribbon-slot ${activeClass}`;
            slotEl.title = `[${idx + 1}] ${mat.name} (${mat.isWall ? 'Wall' : (mat.isCliff ? 'Cliff' : 'Ground')}) - Click or press '${idx + 1}'`;

            // Hotkey Badge [1]
            const hotkeyBadge = document.createElement('span');
            hotkeyBadge.className = "ribbon-hotkey-badge";
            hotkeyBadge.textContent = `${idx + 1}`;

            // Mini Composite Thumbnail (18x18px)
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 18;
            thumbCanvas.height = 18;
            thumbCanvas.className = "w-[18px] h-[18px] rounded border border-slate-700 checkerboard bg-slate-950 shrink-0";
            renderCompositeThumbnail(thumbCanvas, mat, 18, 18);

            // Name + Color Dot
            const nameEl = document.createElement('div');
            nameEl.className = "flex items-center gap-1 min-w-0";
            nameEl.innerHTML = `
                <span class="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm" style="background-color: ${mat.color || '#22c55e'}"></span>
                <span class="text-[10px] font-bold text-slate-100 truncate max-w-[65px] leading-none">${mat.name}</span>
                ${isPinned ? '<i class="ph-fill ph-star text-[8.5px] text-yellow-400 shrink-0"></i>' : ''}
            `;

            slotEl.appendChild(hotkeyBadge);
            slotEl.appendChild(thumbCanvas);
            slotEl.appendChild(nameEl);

            slotEl.addEventListener('click', () => selectMaterialSwatch(mat.id));

            ribbon.appendChild(slotEl);
        });
    }

    /**
     * Renders a Rich Swatch Card (Density Mode: 'rich').
     * 
     * @param {Object} mat - Material swatch definition
     * @param {Object.<string, Object.<string, number>>|null} [transitionFreqs=null] - Precalculated map transition frequencies
     * @returns {HTMLDivElement}
     */
    function createRichCardElement(mat, transitionFreqs = null) {
        const isActive = mat.id === state.activeMaterialId;
        const isPinned = (state.pinnedMaterialIds || []).includes(mat.id);
        const { transitionPartners } = resolveMaterialThumbnailInfo(mat);

        const card = document.createElement('div');
        let activeClass = '';
        if (isActive) {
            activeClass = mat.isWall ? 'active-wall' : (mat.isCliff ? 'active-cliff' : 'active-ground');
        }
        card.className = `swatch-card-v2 group ${activeClass}`;

        // Drag Handle
        const dragHandle = document.createElement('i');
        dragHandle.className = "ph ph-dots-six-vertical swatch-drag-handle text-slate-500 hover:text-slate-300 text-xs shrink-0";
        dragHandle.title = "Drag to reorder hierarchy priority";

        // Procedural Composite Mini Thumbnail Canvas (26x26px)
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 26;
        thumbCanvas.height = 26;
        thumbCanvas.className = "w-[26px] h-[26px] rounded border border-slate-700 checkerboard bg-slate-950 shrink-0 shadow-inner";
        renderCompositeThumbnail(thumbCanvas, mat, 26, 26, transitionFreqs);

        // Info container (Title + Badges)
        const infoContainer = document.createElement('div');
        infoContainer.className = "flex-1 min-w-0 flex flex-col gap-0.5";

        let badgeHTML = '';
        if (mat.isWall) {
            badgeHTML = `
                <div class="flex items-center gap-1 text-[9px] text-slate-400 font-mono flex-wrap leading-none">
                    <span class="px-1 py-0.2 rounded bg-blue-950 text-blue-300 font-bold border border-blue-500/30 flex items-center gap-0.5 text-[8.5px]">
                        <i class="ph ph-wall text-[9px]"></i> 16-Tile Wall
                    </span>
                    <span class="text-blue-400/80 font-mono text-[8.5px]">[A] Tool</span>
                </div>
            `;
        } else if (mat.isCliff) {
            badgeHTML = `
                <div class="flex items-center gap-1 text-[9px] text-slate-400 font-mono flex-wrap leading-none">
                    <span class="px-1 py-0.2 rounded bg-amber-950 text-amber-300 font-bold border border-amber-500/30 flex items-center gap-0.5 text-[8.5px]">
                        <i class="ph ph-mountains text-[9px]"></i> 3D Cliff
                    </span>
                    <span class="text-amber-400/80 font-mono text-[8.5px]">Pri: ${mat.priority || 0}</span>
                </div>
            `;
        } else {
            const partnersArr = Array.from(transitionPartners);
            const partnersSnippet = partnersArr.length > 0
                ? `<span class="text-[8.5px] text-slate-400 truncate max-w-[95px]" title="Blends with: ${partnersArr.join(', ')}">↔ ${partnersArr.slice(0, 2).join(', ')}${partnersArr.length > 2 ? '…' : ''}</span>`
                : '';

            badgeHTML = `
                <div class="flex items-center gap-1 text-[9px] text-slate-400 font-mono flex-wrap leading-none">
                    <span class="px-1 py-0.2 rounded bg-teal-950 text-teal-300 font-bold border border-teal-500/30 flex items-center gap-0.5 text-[8.5px]">
                        <i class="ph ph-plant text-[9px]"></i> Pri: ${mat.priority || 0}
                    </span>
                    ${partnersSnippet}
                </div>
            `;
        }

        infoContainer.innerHTML = `
            <div class="flex items-center justify-between gap-1 leading-tight">
                <div class="flex items-center gap-1 min-w-0">
                    <span class="w-2 h-2 rounded-full shrink-0 shadow-sm" style="background-color: ${mat.color || '#22c55e'}"></span>
                    <span class="text-[11px] font-bold truncate text-slate-100">${mat.name}</span>
                    ${isPinned ? '<i class="ph-fill ph-star text-[9px] text-yellow-400 shrink-0" title="Pinned to Ribbon"></i>' : ''}
                </div>
                ${isActive ? '<span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shrink-0" title="Active Material"></span>' : ''}
            </div>
            ${badgeHTML}
        `;

        // Right Hover Quick-Action Menu Trigger Button [•••]
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.title = "Material Options (Properties, Pin, Swap, Duplicate, Delete)";
        actionBtn.className = "swatch-hover-action p-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all text-[11px] shrink-0";
        actionBtn.innerHTML = `<i class="ph ph-dots-three-vertical"></i>`;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSwatchContextMenu(e, mat);
        });

        card.appendChild(dragHandle);
        card.appendChild(thumbCanvas);
        card.appendChild(infoContainer);
        card.appendChild(actionBtn);

        attachDragAndDropListeners(card, mat);

        card.addEventListener('click', () => selectMaterialSwatch(mat.id));
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSwatchContextMenu(e, mat);
        });

        return card;
    }

    /**
     * Renders a Compact List Row (Density Mode: 'compact').
     * 
     * @param {Object} mat - Material swatch definition
     * @param {Object.<string, Object.<string, number>>|null} [transitionFreqs=null] - Precalculated map transition frequencies
     * @returns {HTMLDivElement}
     */
    function createCompactRowElement(mat, transitionFreqs = null) {
        const isActive = mat.id === state.activeMaterialId;
        const isPinned = (state.pinnedMaterialIds || []).includes(mat.id);

        const row = document.createElement('div');
        let activeClass = '';
        if (isActive) {
            activeClass = mat.isWall ? 'active-wall' : (mat.isCliff ? 'active-cliff' : 'active-ground');
        }
        row.className = `swatch-card-compact group ${activeClass}`;

        const dragHandle = document.createElement('i');
        dragHandle.className = "ph ph-dots-six-vertical swatch-drag-handle text-slate-500 hover:text-slate-300 text-[10px] shrink-0";

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 18;
        thumbCanvas.height = 18;
        thumbCanvas.className = "w-[18px] h-[18px] rounded border border-slate-700 checkerboard bg-slate-950 shrink-0";
        renderCompositeThumbnail(thumbCanvas, mat, 18, 18, transitionFreqs);

        const info = document.createElement('div');
        info.className = "flex-1 min-w-0 flex items-center justify-between gap-1 leading-none";
        info.innerHTML = `
            <div class="flex items-center gap-1 min-w-0">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${mat.color || '#22c55e'}"></span>
                <span class="text-[10px] font-bold text-slate-200 truncate">${mat.name}</span>
                ${isPinned ? '<i class="ph-fill ph-star text-[8px] text-yellow-400 shrink-0"></i>' : ''}
            </div>
            <span class="text-[8.5px] font-mono text-slate-400 shrink-0">P:${mat.priority || 0}</span>
        `;

        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = "swatch-hover-action p-0.5 rounded bg-slate-800 text-slate-300 hover:text-white text-[10px] shrink-0";
        actionBtn.innerHTML = `<i class="ph ph-dots-three-vertical"></i>`;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSwatchContextMenu(e, mat);
        });

        row.appendChild(dragHandle);
        row.appendChild(thumbCanvas);
        row.appendChild(info);
        row.appendChild(actionBtn);

        attachDragAndDropListeners(row, mat);

        row.addEventListener('click', () => selectMaterialSwatch(mat.id));
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSwatchContextMenu(e, mat);
        });

        return row;
    }

    /**
     * Renders a Visual Swatch Chip (Density Mode: 'chips').
     * 
     * @param {Object} mat - Material swatch definition
     * @param {Object.<string, Object.<string, number>>|null} [transitionFreqs=null] - Precalculated map transition frequencies
     * @returns {HTMLDivElement}
     */
    function createChipElement(mat, transitionFreqs = null) {
        const isActive = mat.id === state.activeMaterialId;
        const isPinned = (state.pinnedMaterialIds || []).includes(mat.id);

        const chip = document.createElement('div');
        let activeClass = '';
        if (isActive) {
            activeClass = mat.isWall ? 'active-wall' : (mat.isCliff ? 'active-cliff' : 'active-ground');
        }
        chip.className = `swatch-chip group ${activeClass}`;
        chip.title = `${mat.name} (Priority ${mat.priority || 0})`;

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 28;
        thumbCanvas.height = 28;
        thumbCanvas.className = "w-7 h-7 rounded border border-slate-700 checkerboard bg-slate-950 shrink-0 shadow-inner";
        renderCompositeThumbnail(thumbCanvas, mat, 28, 28, transitionFreqs);

        const label = document.createElement('div');
        label.className = "w-full flex items-center justify-center gap-0.5 text-[9px] font-bold text-slate-200 truncate";
        label.innerHTML = `
            <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${mat.color || '#22c55e'}"></span>
            <span class="truncate">${mat.name}</span>
            ${isPinned ? '<i class="ph-fill ph-star text-[7px] text-yellow-400 shrink-0"></i>' : ''}
        `;

        chip.appendChild(thumbCanvas);
        chip.appendChild(label);

        chip.addEventListener('click', () => selectMaterialSwatch(mat.id));
        chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSwatchContextMenu(e, mat);
        });

        return chip;
    }

    /**
     * Dispatches item creation based on current active density view mode.
     * 
     * @param {Object} mat - Material swatch definition
     * @param {Object.<string, Object.<string, number>>|null} [transitionFreqs=null] - Precalculated transition frequencies
     * @returns {HTMLDivElement}
     */
    function createSwatchItemElement(mat, transitionFreqs = null) {
        const mode = state.swatchDensityMode || 'rich';
        if (mode === 'compact') return createCompactRowElement(mat, transitionFreqs);
        if (mode === 'chips') return createChipElement(mat, transitionFreqs);
        return createRichCardElement(mat, transitionFreqs);
    }

    /**
     * Renders categorized accordion groups, density modes, and search results in `#terrain-swatches-grid`.
     * 
     * @OPTIMIZATION Pre-calculates map transition frequency table once per render pass to eliminate O(M*L*H*W) redundant map scans.
     * @OPTIMIZATION Batches DOM node mutations using DocumentFragment to prevent layout thrashing.
     * @returns {void}
     */
    function renderTerrainSwatchesUI() {
        const grid = document.getElementById('terrain-swatches-grid');
        if (!grid) return;
        grid.innerHTML = '';
        updateCategoryFilterButtonStyles();
        updateDensityModeButtonStyles();

        const searchInput = document.getElementById('input-swatch-search');
        const clearSearchBtn = document.getElementById('btn-clear-swatch-search');
        const searchQuery = (searchInput ? searchInput.value : (state.swatchSearchQuery || '')).trim().toLowerCase();

        if (clearSearchBtn) {
            clearSearchBtn.classList.toggle('hidden', searchQuery.length === 0);
        }

        if (!state.materials || state.materials.length === 0) {
            grid.innerHTML = `
                <div class="p-3 text-center text-slate-400 text-xs bg-slate-900/60 rounded-xl border border-slate-700/60 flex flex-col items-center gap-1.5">
                    <i class="ph ph-paint-brush-broad text-xl text-teal-400/60"></i>
                    <p class="font-medium text-slate-300">No material swatches found.</p>
                    <p class="text-[10px] text-slate-500">Create ground, cliff, or wall materials in the wizard.</p>
                    <button id="btn-swatch-open-wizard" class="mt-1 px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded text-xs font-bold transition-colors shadow-sm">
                        Create Terrain in Wizard
                    </button>
                </div>
            `;
            document.getElementById('btn-swatch-open-wizard')?.addEventListener('click', () => {
                window.TileWeaver.autotileWizard.openTerrainWizard();
            });
            return;
        }

        // Precalculate map transition frequencies once for all swatch cards
        const transitionFreqs = calculateMapTransitionFrequencies();

        // Apply Search Filter
        const matchingMaterials = state.materials.filter(mat => {
            if (!searchQuery) return true;
            const nameMatch = (mat.name || '').toLowerCase().includes(searchQuery);
            const idMatch = (mat.id || '').toLowerCase().includes(searchQuery);
            const ts = state.tilesets.find(t => t.id === mat.tilesetId);
            const tsMatch = ts && ts.name ? ts.name.toLowerCase().includes(searchQuery) : false;
            const typeMatch = (mat.isWall && 'wall fence'.includes(searchQuery)) ||
                              (mat.isCliff && 'cliff mountain 3d'.includes(searchQuery)) ||
                              (!mat.isWall && !mat.isCliff && 'ground terrain dualgrid'.includes(searchQuery));
            return nameMatch || idMatch || tsMatch || typeMatch;
        });

        // Apply Category Tab Filter ('all' | 'ground' | 'cliff' | 'wall')
        const catFilter = state.materialCategoryFilter || 'all';
        const filteredMaterials = matchingMaterials.filter(mat => {
            if (catFilter === 'ground') return !mat.isCliff && !mat.isWall;
            if (catFilter === 'cliff') return !!mat.isCliff;
            if (catFilter === 'wall') return !!mat.isWall;
            return true;
        });

        if (filteredMaterials.length === 0) {
            grid.innerHTML = `
                <div class="p-2.5 text-center text-slate-400 text-xs bg-slate-900/40 rounded-lg border border-slate-800 flex flex-col items-center gap-1">
                    <i class="ph ph-funnel text-base text-slate-500"></i>
                    <p class="font-semibold text-slate-300">No matching materials found.</p>
                    <p class="text-[10px] text-slate-500">${searchQuery ? `No results for "${searchQuery}"` : `None in '${catFilter.toUpperCase()}' category`}</p>
                    <button id="btn-swatch-reset-filter" class="mt-0.5 text-[10px] text-teal-400 hover:underline font-semibold">Reset Filters</button>
                </div>
            `;
            document.getElementById('btn-swatch-reset-filter')?.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                state.swatchSearchQuery = '';
                setMaterialCategoryFilter('all');
            });
            return;
        }

        // Group into 3 Categories
        const groundMats = filteredMaterials.filter(m => !m.isCliff && !m.isWall).sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const cliffMats = filteredMaterials.filter(m => !!m.isCliff);
        const wallMats = filteredMaterials.filter(m => !!m.isWall);

        state.swatchAccordionState = state.swatchAccordionState || { ground: true, cliff: true, wall: true };
        const mode = state.swatchDensityMode || 'rich';

        // DocumentFragment for batched DOM attachment if supported in runtime/environment
        const container = (typeof document.createDocumentFragment === 'function') 
            ? document.createDocumentFragment() 
            : grid;

        // Helper to construct categorized accordion group
        const createAccordionSection = (key, iconClass, titleText, count, items, iconColorClass) => {
            if (items.length === 0 && catFilter !== 'all' && catFilter !== key) return null;
            if (items.length === 0 && searchQuery) return null;

            const isCollapsed = !state.swatchAccordionState[key];
            const groupEl = document.createElement('div');
            groupEl.className = `swatch-accordion-group ${isCollapsed ? 'swatch-accordion-collapsed' : ''}`;

            const headerEl = document.createElement('div');
            headerEl.className = "swatch-accordion-header";
            headerEl.innerHTML = `
                <div class="flex items-center gap-1.5 min-w-0">
                    <i class="${iconClass} ${iconColorClass} text-xs"></i>
                    <span class="text-[10px] font-bold text-slate-200 uppercase tracking-wide truncate">${titleText}</span>
                    <span class="px-1.5 py-0.2 rounded-full bg-slate-950 text-slate-400 font-mono text-[8.5px] border border-slate-700">${count}</span>
                </div>
                <div class="flex items-center gap-1">
                    <i class="ph ph-caret-down text-slate-400 text-[10px] swatch-accordion-caret"></i>
                </div>
            `;

            headerEl.addEventListener('click', () => {
                state.swatchAccordionState[key] = !state.swatchAccordionState[key];
                groupEl.classList.toggle('swatch-accordion-collapsed', !state.swatchAccordionState[key]);
            });

            const bodyEl = document.createElement('div');
            bodyEl.className = (mode === 'chips') 
                ? "swatch-accordion-body p-1.5 swatch-chips-container bg-slate-950/40"
                : "swatch-accordion-body p-1.5 flex flex-col gap-1 bg-slate-950/40";

            if (items.length === 0) {
                bodyEl.innerHTML = `<div class="text-center text-slate-500 text-[9px] py-0.5 italic">No ${titleText.toLowerCase()} registered.</div>`;
            } else {
                items.forEach(mat => {
                    bodyEl.appendChild(createSwatchItemElement(mat, transitionFreqs));
                });
            }

            groupEl.appendChild(headerEl);
            groupEl.appendChild(bodyEl);
            return groupEl;
        };

        // Render Ground Group
        if (catFilter === 'all' || catFilter === 'ground') {
            const groundSection = createAccordionSection('ground', 'ph ph-plant', 'Ground Terrains', groundMats.length, groundMats, 'text-teal-400');
            if (groundSection) container.appendChild(groundSection);
        }

        // Render Cliff Group
        if (catFilter === 'all' || catFilter === 'cliff') {
            const cliffSection = createAccordionSection('cliff', 'ph ph-mountains', 'Cliffside Elevations', cliffMats.length, cliffMats, 'text-amber-400');
            if (cliffSection) container.appendChild(cliffSection);
        }

        // Render Wall Group
        if (catFilter === 'all' || catFilter === 'wall') {
            const wallSection = createAccordionSection('wall', 'ph ph-wall', 'Walls & Fences', wallMats.length, wallMats, 'text-blue-400');
            if (wallSection) container.appendChild(wallSection);
        }

        if (container !== grid) {
            grid.appendChild(container);
        }
    }

    /**
     * Opens the Swatch Context Menu Popover anchored to mouse event or button.
     */
    function openSwatchContextMenu(e, mat) {
        const menu = document.getElementById('swatch-context-menu');
        if (!menu || !mat) return;

        activeContextMenuMaterialId = mat.id;

        const nameEl = document.getElementById('swatch-ctx-name');
        const typeEl = document.getElementById('swatch-ctx-type');
        if (nameEl) nameEl.textContent = mat.name;
        if (typeEl) {
            typeEl.textContent = mat.isWall ? '16-Tile Wall' : (mat.isCliff ? '3D Cliff' : `Ground (Pri ${mat.priority || 0})`);
            typeEl.className = mat.isWall ? 'text-blue-400 font-mono text-[9px]' : (mat.isCliff ? 'text-amber-400 font-mono text-[9px]' : 'text-teal-400 font-mono text-[9px]');
        }

        // Update Pin/Unpin Label in Context Menu
        const pinLabel = document.getElementById('label-ctx-pin-ribbon');
        const isPinned = (state.pinnedMaterialIds || []).includes(mat.id);
        if (pinLabel) {
            pinLabel.textContent = isPinned ? 'Unpin from HUD Ribbon' : 'Pin to HUD Ribbon';
        }

        // Calculate Position on Screen
        menu.classList.remove('hidden');
        const menuWidth = 200;
        const menuHeight = 180;
        let posX = e.clientX || 100;
        let posY = e.clientY || 100;

        if (posX + menuWidth > window.innerWidth) posX = window.innerWidth - menuWidth - 12;
        if (posY + menuHeight > window.innerHeight) posY = window.innerHeight - menuHeight - 12;

        menu.style.left = `${posX}px`;
        menu.style.top = `${posY}px`;
    }

    /**
     * Closes the Swatch Context Menu.
     */
    function closeSwatchContextMenu() {
        const menu = document.getElementById('swatch-context-menu');
        if (menu) menu.classList.add('hidden');
        activeContextMenuMaterialId = null;
    }

    /**
     * Opens the Inline Quick Properties Drawer.
     */
    function openQuickPropertiesDrawer(materialId) {
        closeSwatchContextMenu();
        const mat = getMaterialById(materialId);
        if (!mat) return;

        activeQuickDrawerMaterialId = mat.id;
        const drawer = document.getElementById('swatch-quick-drawer');
        const nameInput = document.getElementById('quick-mat-name');
        const colorInput = document.getElementById('quick-mat-color');
        const priInput = document.getElementById('quick-mat-priority');

        if (nameInput) nameInput.value = mat.name || '';
        if (colorInput) colorInput.value = mat.color || '#22c55e';
        if (priInput) priInput.value = mat.priority || 0;

        if (drawer) drawer.classList.remove('hidden');
    }

    /**
     * Closes the Inline Quick Properties Drawer.
     */
    function closeQuickPropertiesDrawer() {
        const drawer = document.getElementById('swatch-quick-drawer');
        if (drawer) drawer.classList.add('hidden');
        activeQuickDrawerMaterialId = null;
    }

    /**
     * Saves changes made in the Quick Properties Drawer.
     */
    function saveQuickProperties() {
        if (!activeQuickDrawerMaterialId) {
            closeQuickPropertiesDrawer();
            return;
        }

        const mat = getMaterialById(activeQuickDrawerMaterialId);
        if (!mat) {
            closeQuickPropertiesDrawer();
            return;
        }

        const nameInput = document.getElementById('quick-mat-name');
        const colorInput = document.getElementById('quick-mat-color');
        const priInput = document.getElementById('quick-mat-priority');

        const newName = (nameInput ? nameInput.value : '').trim();
        const newColor = colorInput ? colorInput.value : mat.color;
        const newPri = parseInt(priInput ? priInput.value : mat.priority) || 0;

        if (newName && newName !== mat.name) {
            const oldName = mat.name;
            mat.name = newName;
            // Update autotile material names if linked
            if (state.autotiles) {
                state.autotiles.forEach(at => {
                    if (at.mat1Name && at.mat1Name.toLowerCase() === oldName.toLowerCase()) at.mat1Name = newName;
                    if (at.mat2Name && at.mat2Name.toLowerCase() === oldName.toLowerCase()) at.mat2Name = newName;
                });
            }
        }

        mat.color = newColor;
        mat.priority = newPri;

        closeQuickPropertiesDrawer();
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();

        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        showMessage(`Saved properties for '${mat.name}'!`, "success");
    }

    /**
     * Duplicates a material swatch definition.
     */
    function duplicateMaterial(materialId) {
        const mat = getMaterialById(materialId);
        if (!mat) return;

        const cloneId = 'mat_' + mat.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
        const cloneName = `${mat.name} (Copy)`;
        const nextVertexVal = state.materials.length;

        const cloneMat = {
            id: cloneId,
            name: cloneName,
            color: mat.color || '#22c55e',
            priority: (mat.priority || 0) + 1,
            vertexVal: nextVertexVal,
            tilesetId: mat.tilesetId,
            tx: mat.tx || 0,
            ty: mat.ty || 0,
            isCliff: !!mat.isCliff,
            isWall: !!mat.isWall,
            isStandalone: true,
            autotileIds: []
        };

        // Clone underlying autotile if standalone
        if (mat.autotileIds && mat.autotileIds.length > 0) {
            const originalAT = state.autotiles.find(a => a.id === mat.autotileIds[0]);
            if (originalAT) {
                const cloneAT = {
                    id: 'at_' + Date.now(),
                    name: `${cloneName} Autotile`,
                    mode: originalAT.mode,
                    tilesetId: originalAT.tilesetId,
                    mat1Name: cloneName,
                    mat2Name: originalAT.mat2Name,
                    isWall: !!originalAT.isWall,
                    isCliff: !!originalAT.isCliff,
                    mapping: JSON.parse(JSON.stringify(originalAT.mapping || {}))
                };
                state.autotiles.push(cloneAT);
                cloneMat.autotileIds.push(cloneAT.id);
            }
        }

        state.materials.push(cloneMat);
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();
        selectMaterialSwatch(cloneMat.id);

        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        showMessage(`Duplicated material: '${cloneName}'!`, "success");
    }

    let activeDeleteModalMaterialId = null;

    /**
     * Opens the Safe Terrain Material Deletion & Reassignment Modal with dependency impact analysis.
     * @param {string} materialId - ID of material to delete.
     */
    function openSafeDeleteMaterialModal(materialId) {
        const mat = getMaterialById(materialId);
        if (!mat) return;

        if (state.materials.length <= 1) {
            showMessage("Cannot delete the only remaining material.", "warning");
            return;
        }

        activeDeleteModalMaterialId = materialId;
        const modal = document.getElementById('modal-safe-delete-material');
        if (!modal) return;
        modal.classList.remove('hidden');

        // Populate Target Material Details
        const nameEl = document.getElementById('safe-delete-mat-name');
        const colorDot = document.getElementById('safe-delete-mat-color-dot');
        const badgeEl = document.getElementById('safe-delete-mat-type-badge');
        const summaryEl = document.getElementById('safe-delete-mat-impact-summary');
        const canvas = document.getElementById('safe-delete-mat-preview');

        if (nameEl) nameEl.textContent = mat.name;
        if (colorDot) colorDot.style.backgroundColor = mat.color || '#22c55e';
        if (badgeEl) {
            const isCliff = !!mat.isCliff;
            const isWall = !!mat.isWall;
            badgeEl.textContent = isWall ? 'Wall' : (isCliff ? 'Cliff' : 'Ground');
            badgeEl.className = isWall ? 'text-[9px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 font-mono border border-blue-700' :
                (isCliff ? 'text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 font-mono border border-amber-700' :
                'text-[9px] px-1.5 py-0.2 rounded bg-teal-950 text-teal-300 font-mono border border-teal-700');
        }

        // Draw preview thumbnail
        if (canvas && typeof canvas.getContext === 'function') {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const w = canvas.width || 32;
                const h = canvas.height || 32;
                ctx.clearRect(0, 0, w, h);
                renderCompositeThumbnail(canvas, mat, w, h);
            }
        }

        // Dependency Telemetry Analysis
        const matNameLower = mat.name.toLowerCase();
        const linkedAutotiles = (state.autotiles || []).filter(at => {
            const m1Match = at.mat1Name && at.mat1Name.toLowerCase() === matNameLower;
            const m2Match = at.mat2Name && at.mat2Name.toLowerCase() === matNameLower;
            return m1Match || m2Match;
        });

        let paintedVertexCount = 0;
        let affectedLayersCount = 0;
        const targetVal = mat.vertexVal;

        (state.mapLayers || []).forEach(layer => {
            if (layer && layer.terrainVertices && Array.isArray(layer.terrainVertices)) {
                let layerHasVertex = false;
                for (let r = 0; r < layer.terrainVertices.length; r++) {
                    const row = layer.terrainVertices[r];
                    if (!row || !Array.isArray(row)) continue;
                    for (let c = 0; c < row.length; c++) {
                        if (row[c] === targetVal) {
                            paintedVertexCount++;
                            layerHasVertex = true;
                        }
                    }
                }
                if (layerHasVertex) affectedLayersCount++;
            }
        });

        if (summaryEl) {
            summaryEl.innerHTML = `Linked to <strong class="text-white">${linkedAutotiles.length} autotile transition${linkedAutotiles.length === 1 ? '' : 's'}</strong> and painted on <strong class="text-white">${paintedVertexCount} map vertice${paintedVertexCount === 1 ? '' : 's'}</strong> across ${affectedLayersCount} layer${affectedLayersCount === 1 ? '' : 's'}.`;
        }

        // Populate Replacement Materials Select (All materials except the deleted one)
        const reassignSelect = document.getElementById('select-delete-replacement-material');
        if (reassignSelect) {
            reassignSelect.innerHTML = '';
            const otherMaterials = state.materials.filter(m => m.id !== materialId);
            otherMaterials.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = `${m.name} (Vertex: ${m.vertexVal}, Priority: ${m.priority})`;
                reassignSelect.appendChild(opt);
            });
            if (otherMaterials.length > 0) {
                reassignSelect.value = otherMaterials[0].id;
            }
        }

        // Reset radio buttons to reassign by default
        const radioReassign = document.getElementById('radio-delete-strategy-reassign');
        if (radioReassign) radioReassign.checked = true;
        updateSafeDeleteStrategyUI();
    }

    /**
     * Updates visual styling of strategy cards based on checked radio button.
     */
    function updateSafeDeleteStrategyUI() {
        const isReassign = document.getElementById('radio-delete-strategy-reassign')?.checked;
        const cardReassign = document.getElementById('label-delete-strategy-reassign');
        const cardClear = document.getElementById('label-delete-strategy-clear');
        const reassignContainer = document.getElementById('container-delete-reassign-select');

        if (cardReassign) {
            cardReassign.className = isReassign
                ? "flex items-start gap-3 p-3 bg-slate-950 hover:bg-slate-850 rounded-lg border border-teal-500/80 ring-1 ring-teal-500/40 cursor-pointer transition-all"
                : "flex items-start gap-3 p-3 bg-slate-950 hover:bg-slate-850 rounded-lg border border-slate-800 cursor-pointer transition-all";
        }
        if (cardClear) {
            cardClear.className = !isReassign
                ? "flex items-start gap-3 p-3 bg-slate-950 hover:bg-slate-850 rounded-lg border border-red-500/80 ring-1 ring-red-500/40 cursor-pointer transition-all"
                : "flex items-start gap-3 p-3 bg-slate-950 hover:bg-slate-850 rounded-lg border border-slate-800 cursor-pointer transition-all";
        }
        if (reassignContainer) {
            reassignContainer.style.opacity = isReassign ? '1' : '0.4';
            reassignContainer.style.pointerEvents = isReassign ? 'auto' : 'none';
        }
    }

    /** Closes Safe Material Deletion Modal */
    function closeSafeDeleteModal() {
        activeDeleteModalMaterialId = null;
        document.getElementById('modal-safe-delete-material')?.classList.add('hidden');
    }

    /**
     * Confirms and executes material deletion with vertex reassignment or clearing, and autotile pruning.
     */
    function confirmExecuteSafeDelete() {
        const materialId = activeDeleteModalMaterialId;
        if (!materialId) {
            closeSafeDeleteModal();
            return;
        }

        const mat = getMaterialById(materialId);
        if (!mat) {
            closeSafeDeleteModal();
            return;
        }

        const isReassign = document.getElementById('radio-delete-strategy-reassign')?.checked;
        const strategy = isReassign ? 'reassign' : 'clear';
        const replacementMatId = document.getElementById('select-delete-replacement-material')?.value;

        executeMaterialDeletion(materialId, strategy, replacementMatId);
        closeSafeDeleteModal();
    }

    /**
     * Executes the deletion transaction: vertex sweep, autotile pruning, material removal, and state resync.
     */
    function executeMaterialDeletion(materialId, strategy, replacementMaterialId) {
        const mat = getMaterialById(materialId);
        if (!mat) return;

        const deletedVal = mat.vertexVal;
        const matNameLower = mat.name.toLowerCase();

        let replacementMat = null;
        let replacementVal = 0;
        if (strategy === 'reassign' && replacementMaterialId) {
            replacementMat = getMaterialById(replacementMaterialId);
            if (replacementMat) {
                replacementVal = replacementMat.vertexVal;
            }
        }

        // 1. Vertex Sweep across all map layers
        let modifiedVerticesCount = 0;
        const targetNewVal = (strategy === 'reassign' && replacementMat) ? replacementVal : 0;

        (state.mapLayers || []).forEach(layer => {
            if (layer && layer.terrainVertices && Array.isArray(layer.terrainVertices)) {
                for (let r = 0; r < layer.terrainVertices.length; r++) {
                    const row = layer.terrainVertices[r];
                    if (!row || !Array.isArray(row)) continue;
                    for (let c = 0; c < row.length; c++) {
                        if (row[c] === deletedVal) {
                            row[c] = targetNewVal;
                            modifiedVerticesCount++;
                        }
                    }
                }
            }
        });

        // 2. Surgical Autotile Pruning (Only remove autotiles referencing this material; leave partner & independent transitions intact!)
        const initialAutotileCount = (state.autotiles || []).length;
        state.autotiles = (state.autotiles || []).filter(at => {
            const m1Match = at.mat1Name && at.mat1Name.toLowerCase() === matNameLower;
            const m2Match = at.mat2Name && at.mat2Name.toLowerCase() === matNameLower;
            // Prune if this autotile is dependent on deleted material
            return !(m1Match || m2Match);
        });
        const prunedAutotilesCount = initialAutotileCount - state.autotiles.length;

        // 3. Remove from state.materials
        const matIdx = state.materials.findIndex(m => m.id === materialId);
        if (matIdx !== -1) {
            state.materials.splice(matIdx, 1);
        }

        // 4. Remove from pinned & recent lists
        if (state.pinnedMaterialIds) {
            state.pinnedMaterialIds = state.pinnedMaterialIds.filter(id => id !== materialId);
        }
        if (state.recentMaterialIds) {
            state.recentMaterialIds = state.recentMaterialIds.filter(id => id !== materialId);
        }

        // 5. Update active material if it was deleted
        if (state.activeMaterialId === materialId) {
            const nextActiveMat = replacementMat || state.materials[0];
            if (nextActiveMat) {
                state.activeMaterialId = nextActiveMat.id;
                state.terrainStrokeValue = nextActiveMat.vertexVal;
                if (nextActiveMat.autotileIds && nextActiveMat.autotileIds.length > 0) {
                    state.activeAutotileId = nextActiveMat.autotileIds[0];
                }
            }
        }

        // 6. Resync and re-render
        if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.renderAutotileSelect === 'function') {
            window.TileWeaver.tilesetManager.renderAutotileSelect();
        }
        syncMaterialsFromAutotiles();
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();

        // 7. Redraw map canvas
        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }

        // 8. Push history state for full undo/redo
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        if (strategy === 'reassign' && replacementMat) {
            showMessage(`Deleted material '${mat.name}'. Reassigned ${modifiedVerticesCount} vertices to '${replacementMat.name}' and pruned ${prunedAutotilesCount} linked transitions.`, "success");
        } else {
            showMessage(`Deleted material '${mat.name}'. Cleared ${modifiedVerticesCount} vertices and pruned ${prunedAutotilesCount} linked transitions.`, "info");
        }
    }

    function deleteMaterial(materialId, strategy = 'clear', replacementMatId = null) {
        executeMaterialDeletion(materialId, strategy, replacementMatId);
    }

    /**
     * Opens the Standalone Material Creator Modal.
     */
    function openNewMaterialModal() {
        const modal = document.getElementById('modal-new-material');
        if (!modal) return;

        const nameInput = document.getElementById('new-mat-name');
        const priorityInput = document.getElementById('new-mat-priority');
        const colorInput = document.getElementById('new-mat-color');
        const coordsSpan = document.getElementById('new-mat-tile-coords');
        const canvas = document.getElementById('new-mat-preview-canvas');

        const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
        const stamp = state.selectedStamp || { col: 0, row: 0 };
        const tx = stamp.col || 0;
        const ty = stamp.row || 0;

        if (nameInput) nameInput.value = `Material ${state.materials.length + 1}`;
        if (priorityInput) priorityInput.value = state.materials.length;
        if (colorInput) {
            const colors = ['#22c55e', '#d97706', '#06b6d4', '#a855f7', '#ec4899', '#eab308', '#3b82f6', '#14b8a6'];
            colorInput.value = colors[state.materials.length % colors.length];
        }
        if (coordsSpan) coordsSpan.textContent = `Tile (${tx}, ${ty}) on ${activeTs ? activeTs.name : 'Tileset'}`;

        if (canvas && typeof canvas.getContext === 'function' && activeTs && activeTs.image) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, 32, 32);
                ctx.imageSmoothingEnabled = false;
                const margin = activeTs.margin || 0;
                const spacing = activeTs.spacing || 0;
                const step = state.TILE_SIZE + spacing;
                const sx = margin + tx * step;
                const sy = margin + ty * step;
                ctx.drawImage(activeTs.image, sx, sy, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 32, 32);
            }
        }

        modal.classList.remove('hidden');
    }

    /**
     * Closes the Standalone Material Creator Modal.
     */
    function closeNewMaterialModal() {
        document.getElementById('modal-new-material')?.classList.add('hidden');
    }

    /**
     * Confirms standalone material creation.
     */
    function confirmCreateNewMaterial() {
        const nameInput = document.getElementById('new-mat-name');
        const priorityInput = document.getElementById('new-mat-priority');
        const colorInput = document.getElementById('new-mat-color');

        const name = (nameInput ? nameInput.value : '').trim() || `Material ${state.materials.length + 1}`;
        const priority = parseInt(priorityInput ? priorityInput.value : '0') || 0;
        const color = (colorInput ? colorInput.value : '') || '#22c55e';

        const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
        const tsId = activeTs ? activeTs.id : 'ts_1';
        const stamp = state.selectedStamp || { col: 0, row: 0 };
        const tx = stamp.col || 0;
        const ty = stamp.row || 0;

        const matKey = name.toLowerCase().replace(/\s+/g, '_');
        const nextVertexVal = state.materials.length;

        const autoAT = {
            id: 'at_standalone_' + Date.now(),
            name: `${name} (Standalone)`,
            mode: 'dualgrid',
            tilesetId: tsId,
            mat1Name: name,
            mat2Name: name,
            mapping: {
                grid_0: { tx, ty },
                grid_15: { tx, ty }
            }
        };
        state.autotiles.push(autoAT);

        const newMat = {
            id: 'mat_' + matKey + '_' + Date.now(),
            name: name,
            color: color,
            priority: priority,
            vertexVal: nextVertexVal,
            tilesetId: tsId,
            tx: tx,
            ty: ty,
            isStandalone: true,
            autotileIds: [autoAT.id]
        };

        state.materials.push(newMat);
        closeNewMaterialModal();
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();
        selectMaterialSwatch(newMat.id);

        showMessage(`Created standalone terrain material '${name}'!`, "success");
    }

    /**
     * Opens the Global Material Swap / Replace Modal.
     */
    function openSwapMaterialModal(initialSourceMatId) {
        closeSwatchContextMenu();
        const modal = document.getElementById('modal-swap-material');
        if (!modal || !state.materials || state.materials.length < 2) {
            showMessage("Need at least 2 materials registered to perform a swap.", "warning");
            return;
        }

        const srcSelect = document.getElementById('swap-source-mat-select');
        const tgtSelect = document.getElementById('swap-target-mat-select');

        if (srcSelect && tgtSelect) {
            srcSelect.innerHTML = '';
            tgtSelect.innerHTML = '';

            state.materials.forEach(m => {
                const opt1 = document.createElement('option');
                opt1.value = m.id;
                opt1.textContent = `${m.name} (Priority ${m.priority || 0})`;
                srcSelect.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = m.id;
                opt2.textContent = `${m.name} (Priority ${m.priority || 0})`;
                tgtSelect.appendChild(opt2);
            });

            if (initialSourceMatId && state.materials.some(m => m.id === initialSourceMatId)) {
                srcSelect.value = initialSourceMatId;
            }

            const diffMat = state.materials.find(m => m.id !== srcSelect.value);
            if (diffMat) tgtSelect.value = diffMat.id;
        }

        modal.classList.remove('hidden');
    }

    /**
     * Closes the Global Material Swap Modal.
     */
    function closeSwapMaterialModal() {
        document.getElementById('modal-swap-material')?.classList.add('hidden');
    }

    /**
     * Confirms and performs global material replacement across layers & autotile definitions.
     */
    function confirmPerformMaterialSwap() {
        const srcSelect = document.getElementById('swap-source-mat-select');
        const tgtSelect = document.getElementById('swap-target-mat-select');
        const scopeSelect = document.getElementById('swap-scope-select');
        const updateAutotilesChk = document.getElementById('swap-update-autotiles');

        const srcId = srcSelect ? srcSelect.value : null;
        const tgtId = tgtSelect ? tgtSelect.value : null;
        const scope = scopeSelect ? scopeSelect.value : 'active_layer';
        const updateAutotiles = updateAutotilesChk ? updateAutotilesChk.checked : true;

        if (!srcId || !tgtId || srcId === tgtId) {
            showMessage("Please select two different materials to swap.", "warning");
            return;
        }

        const srcMat = state.materials.find(m => m.id === srcId);
        const tgtMat = state.materials.find(m => m.id === tgtId);
        if (!srcMat || !tgtMat) return;

        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        const srcVal = srcMat.vertexVal;
        const tgtVal = tgtMat.vertexVal;
        let replaceCount = 0;

        const layersToUpdate = scope === 'all_layers' ? state.mapLayers : [state.mapLayers[state.activeLayerIndex]];
        layersToUpdate.forEach(layer => {
            if (layer && layer.terrainVertices && Array.isArray(layer.terrainVertices)) {
                for (let r = 0; r < layer.terrainVertices.length; r++) {
                    const row = layer.terrainVertices[r];
                    if (!row || !Array.isArray(row)) continue;
                    for (let c = 0; c < row.length; c++) {
                        if (row[c] === srcVal) {
                            row[c] = tgtVal;
                            replaceCount++;
                        }
                    }
                }
            }
        });

        if (updateAutotiles && state.autotiles) {
            const srcNameLower = srcMat.name.toLowerCase();
            state.autotiles.forEach(at => {
                if (at.mat1Name && at.mat1Name.toLowerCase() === srcNameLower) {
                    at.mat1Name = tgtMat.name;
                }
                if (at.mat2Name && at.mat2Name.toLowerCase() === srcNameLower) {
                    at.mat2Name = tgtMat.name;
                }
            });
        }

        closeSwapMaterialModal();
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();

        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }

        showMessage(`Swapped '${srcMat.name}' with '${tgtMat.name}' across ${replaceCount} vertices!`, "success");
    }

    /**
     * Initializes UI event listeners for sidebar tabs, search input, density toggles, drawer, context menus, and modals.
     */
    function initTerrainSwatchesUI() {
        document.getElementById('tab-sidebar-tileset')?.addEventListener('click', () => setSidebarTab('tileset'));
        document.getElementById('tab-sidebar-terrain')?.addEventListener('click', () => setSidebarTab('swatches'));
        document.getElementById('btn-swatch-add-terrain')?.addEventListener('click', () => {
            window.TileWeaver.autotileWizard.openTerrainWizard();
        });

        // Search Input Listeners
        const searchInput = document.getElementById('input-swatch-search');
        const clearSearchBtn = document.getElementById('btn-clear-swatch-search');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.swatchSearchQuery = e.target.value;
                renderTerrainSwatchesUI();
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    state.swatchSearchQuery = '';
                    searchInput.blur();
                    renderTerrainSwatchesUI();
                }
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                state.swatchSearchQuery = '';
                renderTerrainSwatchesUI();
            });
        }

        // 3-Way Density Toggle Buttons
        document.getElementById('btn-swatch-density-rich')?.addEventListener('click', () => setSwatchDensityMode('rich'));
        document.getElementById('btn-swatch-density-compact')?.addEventListener('click', () => setSwatchDensityMode('compact'));
        document.getElementById('btn-swatch-density-chips')?.addEventListener('click', () => setSwatchDensityMode('chips'));

        // Quick Properties Drawer Listeners
        document.getElementById('btn-close-quick-drawer')?.addEventListener('click', closeQuickPropertiesDrawer);
        document.getElementById('btn-quick-save-props')?.addEventListener('click', saveQuickProperties);
        document.getElementById('btn-quick-open-advanced-props')?.addEventListener('click', () => {
            const matId = activeQuickDrawerMaterialId;
            closeQuickPropertiesDrawer();
            if (matId && window.TileWeaver.materialProperties) {
                window.TileWeaver.materialProperties.openMaterialPropertiesModal(matId);
            }
        });

        // Global Shortcut: '/' to focus material search
        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
                e.preventDefault();
                if (state.activeSidebarTab !== 'swatches') {
                    setSidebarTab('swatches');
                }
                searchInput?.focus();
                searchInput?.select();
            }
        });

        // Context Menu Item Click Listeners
        document.getElementById('btn-ctx-edit-wizard')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId && window.TileWeaver.autotileWizard) {
                window.TileWeaver.autotileWizard.openTerrainWizardForMaterial(matId);
            }
        });

        document.getElementById('btn-ctx-props')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId) {
                openQuickPropertiesDrawer(matId);
            }
        });

        document.getElementById('btn-ctx-swap')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId) openSwapMaterialModal(matId);
        });

        document.getElementById('btn-ctx-duplicate')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId) duplicateMaterial(matId);
        });

        document.getElementById('btn-ctx-pin-ribbon')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId) togglePinMaterial(matId);
        });

        document.getElementById('btn-ctx-delete')?.addEventListener('click', () => {
            const matId = activeContextMenuMaterialId;
            closeSwatchContextMenu();
            if (matId) openSafeDeleteMaterialModal(matId);
        });

        // Global dismiss on click outside context menu
        window.addEventListener('click', (e) => {
            const menu = document.getElementById('swatch-context-menu');
            if (menu && !menu.classList.contains('hidden')) {
                if (!menu.contains(e.target)) {
                    closeSwatchContextMenu();
                }
            }
        });

        // New Material Button & Modal Listeners
        document.getElementById('btn-swatch-add-material')?.addEventListener('click', openNewMaterialModal);
        document.getElementById('btn-close-new-mat')?.addEventListener('click', closeNewMaterialModal);
        document.getElementById('btn-cancel-new-mat')?.addEventListener('click', closeNewMaterialModal);
        document.getElementById('btn-confirm-new-mat')?.addEventListener('click', confirmCreateNewMaterial);

        // Global Swap Material Modal Listeners
        document.getElementById('btn-close-swap-mat')?.addEventListener('click', closeSwapMaterialModal);
        document.getElementById('btn-cancel-swap-mat')?.addEventListener('click', closeSwapMaterialModal);
        document.getElementById('btn-confirm-swap-mat')?.addEventListener('click', confirmPerformMaterialSwap);

        // Safe Material Deletion Modal Listeners
        document.getElementById('btn-close-safe-delete-mat')?.addEventListener('click', closeSafeDeleteModal);
        document.getElementById('btn-cancel-safe-delete-mat')?.addEventListener('click', closeSafeDeleteModal);
        document.getElementById('btn-confirm-safe-delete-mat')?.addEventListener('click', confirmExecuteSafeDelete);
        document.getElementById('radio-delete-strategy-reassign')?.addEventListener('change', updateSafeDeleteStrategyUI);
        document.getElementById('radio-delete-strategy-clear')?.addEventListener('change', updateSafeDeleteStrategyUI);

        // Category Filter Buttons
        document.getElementById('btn-swatch-filter-all')?.addEventListener('click', () => setMaterialCategoryFilter('all'));
        document.getElementById('btn-swatch-filter-ground')?.addEventListener('click', () => setMaterialCategoryFilter('ground'));
        document.getElementById('btn-swatch-filter-cliff')?.addEventListener('click', () => setMaterialCategoryFilter('cliff'));
        document.getElementById('btn-swatch-filter-wall')?.addEventListener('click', () => setMaterialCategoryFilter('wall'));

        syncMaterialsFromAutotiles();
        renderTerrainSwatchesUI();
        renderSwatchRibbonHUD();
    }

    /** Helper: Resolves material object by its string ID */
    function getMaterialById(id) {
        if (!state.materials) return null;
        return state.materials.find(m => m.id === id) || null;
    }

    /** Helper: Resolves material object by its vertex integer value */
    function getMaterialByVertexValue(val) {
        if (!state.materials) return null;
        return state.materials.find(m => m.vertexVal === val) || state.materials[0] || null;
    }

    // Expose terrainSwatches subsystem on window.TileWeaver namespace
    window.TileWeaver.terrainSwatches = {
        initTerrainSwatchesUI,
        syncMaterialsFromAutotiles,
        renderTerrainSwatchesUI,
        renderMaterialSwatches: renderTerrainSwatchesUI,
        renderSwatchRibbonHUD,
        selectRibbonSlot,
        togglePinMaterial,
        setRibbonDrawingFade,
        getRibbonSlots,
        renderCompositeThumbnail,
        calculateMapTransitionFrequencies,
        getDominantTransitionPartner,
        selectMaterialSwatch,
        setMaterialCategoryFilter,
        setSwatchDensityMode,
        reorderMaterialPriority,
        openQuickPropertiesDrawer,
        closeQuickPropertiesDrawer,
        saveQuickProperties,
        setSidebarTab,
        switchSidebarTab: setSidebarTab,
        getMaterialById,
        getMaterialByVertexValue,
        openNewMaterialModal,
        openSwapMaterialModal,
        confirmPerformMaterialSwap,
        duplicateMaterial,
        deleteMaterial,
        openSafeDeleteMaterialModal,
        closeSafeDeleteModal,
        executeMaterialDeletion,
        openSwatchContextMenu,
        closeSwatchContextMenu
    };
})();
