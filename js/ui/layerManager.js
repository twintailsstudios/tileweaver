/**
 * @fileoverview layerManager.js - TileWeaver Layer Hierarchy Stack UI Manager
 * @subsystem Layer Hierarchy & Matrix Management
 * @frameBudget 0.05ms UI event dispatch / 16.6ms 60 FPS RAF throttled repaints
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY
 * @stateInvariants state.mapLayers.length >= 1, 0 <= state.activeLayerIndex < state.mapLayers.length
 * @historyTracked Snapshots recorded via history.pushHistoryState()
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+
 * -----------------------------------------------------------------------------
 * Manages the multi-layer hierarchy stack on the left sidebar:
 * 1. Dynamic layer stack rendering with reverse-order rendering (top canvas layer rendered topmost).
 * 2. Visual controls: Visibility (Eye), Lock (Key), Duplicate (Copy), Reorder (Up/Down), Delete (Trash).
 * 3. Opacity slider with 60 FPS requestAnimationFrame throttled preview and coalesced history snapshots.
 * 4. Inline double-click layer renaming with input sanitization and Escape cancellation.
 * 5. Deep-cloned layer duplication preserving 2D tile data, terrain vertices, and entity isolation.
 * 6. Mathematical active layer index correction on layer deletion.
 * 7. Tool mode auto-switching and preservation across layer selections.
 * 8. Global overlay view toggles (Grid, Passability, Region IDs).
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state, createNewLayerObject } = window.TileWeaver.stateModule;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawMap } = window.TileWeaver.rendering;

    // RAF throttle handle for fluid 60 FPS opacity slider dragging
    let opacityRafId = null;

    /**
     * Deep-clones a layer data object to guarantee complete memory isolation.
     * Prevents mutations in a duplicated layer from corrupting original layer matrices.
     * 
     * @param {Object} sourceLayer - The source layer object to duplicate.
     * @returns {Object} Deeply cloned layer object with unique ID and data arrays.
     */
    function cloneLayerObject(sourceLayer) {
        if (!sourceLayer) return null;
        
        // Generate new unique layer ID
        const newLayerId = 'layer_' + (state.layerIdCounter++);
        const cloned = {
            id: newLayerId,
            name: `${sourceLayer.name || 'Layer'} (Copy)`,
            type: sourceLayer.type || 'tilelayer',
            visible: sourceLayer.visible !== false,
            locked: Boolean(sourceLayer.locked),
            opacity: typeof sourceLayer.opacity === 'number' ? Math.max(0, Math.min(1, sourceLayer.opacity)) : 1.0,
            draworder: sourceLayer.draworder || 'topdown',
            data: [],
            terrainVertices: [],
            objects: []
        };

        if (cloned.type === 'tilelayer') {
            // Deep copy 2D cell grid (row x col -> null or tile object)
            if (Array.isArray(sourceLayer.data)) {
                cloned.data = sourceLayer.data.map(row => 
                    Array.isArray(row) ? row.map(cell => (cell ? { ...cell } : null)) : []
                );
            }
            // Deep copy 2D terrain vertices grid ((height+1) x (width+1) -> 0 or 1)
            if (Array.isArray(sourceLayer.terrainVertices)) {
                cloned.terrainVertices = sourceLayer.terrainVertices.map(row => 
                    Array.isArray(row) ? [...row] : []
                );
            }
        } else if (cloned.type === 'objectgroup') {
            // Deep copy entity objects array with new unique object IDs
            if (Array.isArray(sourceLayer.objects)) {
                cloned.objects = sourceLayer.objects.map(obj => ({
                    ...obj,
                    id: 'obj_' + (state.layerIdCounter++)
                }));
            }
        }

        return cloned;
    }

    /**
     * Synchronizes global overlay checkbox states in the DOM with reactive state properties.
     */
    function syncOverlayCheckboxes() {
        const toggleGrid = document.getElementById('toggle-grid');
        if (toggleGrid) toggleGrid.checked = Boolean(state.showGrid);

        const togglePass = document.getElementById('toggle-passability');
        if (togglePass) togglePass.checked = Boolean(state.showPassability);

        const toggleReg = document.getElementById('toggle-regions');
        if (toggleReg) toggleReg.checked = Boolean(state.showRegions);
    }

    /**
     * Re-renders the layer hierarchy list in the sidebar DOM.
     * Iterates through `state.mapLayers` in reverse order (topmost visual layer rendered first).
     */
    function renderLayerUI() {
        const listEl = document.getElementById('layers-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!Array.isArray(state.mapLayers) || state.mapLayers.length === 0) {
            return;
        }

        // Defensive active layer index clamping
        if (typeof state.activeLayerIndex !== 'number' || state.activeLayerIndex < 0) {
            state.activeLayerIndex = 0;
        } else if (state.activeLayerIndex >= state.mapLayers.length) {
            state.activeLayerIndex = state.mapLayers.length - 1;
        }

        // Synchronize overlay checkbox states with state store
        syncOverlayCheckboxes();

        for (let i = state.mapLayers.length - 1; i >= 0; i--) {
            const layer = state.mapLayers[i];
            const isSelected = (i === state.activeLayerIndex);

            const item = document.createElement('div');
            item.className = `layer-item flex flex-col p-2.5 rounded-lg bg-slate-900/90 border text-xs gap-2 cursor-pointer transition-all shadow-sm ${isSelected ? 'active border-blue-500/80 border-l-4 border-l-blue-500 bg-slate-850' : 'border-slate-700/70 hover:border-slate-600 hover:bg-slate-850'}`;
            
            const isObjectGroup = (layer.type === 'objectgroup');
            const badgeClass = isObjectGroup ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-blue-500/20 text-blue-300 border-blue-500/40';
            const badgeText = isObjectGroup ? 'Obj' : 'Tile';
            const objCountText = isObjectGroup ? ` (${layer.objects ? layer.objects.length : 0})` : '';

            item.innerHTML = `
                <div class="flex items-center justify-between gap-2 min-w-0">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <button class="btn-vis p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors" title="Toggle Visibility">
                            <i class="ph ${layer.visible ? 'ph-eye text-blue-400 text-sm' : 'ph-eye-slash text-slate-600 text-sm'}"></i>
                        </button>
                        <button class="btn-lock p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors" title="Toggle Lock">
                            <i class="ph ${layer.locked ? 'ph-lock-key text-amber-400 text-sm' : 'ph-lock-key-open text-slate-600 text-sm'}"></i>
                        </button>
                        <span class="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded border ${badgeClass}">${badgeText}</span>
                        <span class="layer-name-label font-bold truncate text-slate-100 text-xs hover:underline cursor-text" title="Double click to rename: ${layer.name}">${layer.name}${objCountText}</span>
                    </div>

                    <div class="flex items-center gap-0.5">
                        <button class="btn-dup p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-blue-300 transition-colors" title="Duplicate Layer">
                            <i class="ph ph-copy"></i>
                        </button>
                        <button class="btn-up p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors" title="Move Up" ${i === state.mapLayers.length - 1 ? 'disabled' : ''}>
                            <i class="ph ph-caret-up"></i>
                        </button>
                        <button class="btn-down p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors" title="Move Down" ${i === 0 ? 'disabled' : ''}>
                            <i class="ph ph-caret-down"></i>
                        </button>
                        <button class="btn-del p-1 hover:bg-red-900/60 text-slate-400 hover:text-red-300 rounded transition-colors" title="Delete Layer" ${state.mapLayers.length <= 1 ? 'disabled' : ''}>
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>

                <div class="flex items-center gap-2 text-[10px] text-slate-400 px-0.5">
                    <span class="font-medium text-slate-400">Opacity:</span>
                    <input type="range" class="layer-opacity-slider flex-1 h-2 bg-slate-950 rounded-full accent-blue-500 cursor-pointer" min="0" max="100" value="${Math.round((layer.opacity !== undefined ? layer.opacity : 1.0) * 100)}">
                    <span class="opacity-val w-8 text-right font-mono text-slate-300 font-bold">${Math.round((layer.opacity !== undefined ? layer.opacity : 1.0) * 100)}%</span>
                </div>
            `;

            // Layer item selection handler
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                
                state.activeLayerIndex = i;
                const activeTs = state.tilesets ? state.tilesets[state.activeTilesetIndex] : null;

                if (layer.type === 'objectgroup') {
                    if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                        window.TileWeaver.tools.selectTool('objectPlace');
                    }
                } else if (layer.type === 'tilelayer') {
                    if (activeTs && activeTs.isCollection) {
                        const normalTsIdx = state.tilesets.findIndex(t => !t.isCollection);
                        if (normalTsIdx >= 0) state.activeTilesetIndex = normalTsIdx;
                        if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
                            window.TileWeaver.tilesetManager.renderTilesetSelect();
                        }
                    }
                    // If user was in object placement mode, switch back to paint.
                    // Otherwise, preserve active drawing tools (erase, bucketFill, autotile, terrain, line, rect).
                    if (state.currentTool === 'objectPlace') {
                        if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                            window.TileWeaver.tools.selectTool('paint');
                        }
                    }
                }

                if (window.TileWeaver.tools && window.TileWeaver.tools.updateToolTabStates) {
                    window.TileWeaver.tools.updateToolTabStates();
                }

                renderLayerUI();
                drawMap();
            });

            // Inline Double-Click Layer Renaming
            const nameLabel = item.querySelector('.layer-name-label');
            if (nameLabel) {
                nameLabel.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const currentName = layer.name;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentName;
                    input.className = 'w-full bg-slate-950 border border-blue-500 rounded px-1 text-xs text-slate-100 font-bold focus:outline-none';
                    
                    let committed = false;
                    const commitRename = () => {
                        if (committed) return;
                        committed = true;
                        const newName = input.value.trim();
                        if (newName && newName !== currentName) {
                            layer.name = newName.substring(0, 60);
                            pushHistoryState();
                        }
                        renderLayerUI();
                    };

                    input.addEventListener('keydown', (evt) => {
                        if (evt.key === 'Enter') {
                            commitRename();
                        } else if (evt.key === 'Escape') {
                            committed = true;
                            renderLayerUI();
                        }
                    });
                    input.addEventListener('blur', commitRename);

                    nameLabel.replaceWith(input);
                    input.focus();
                    input.select();
                });
            }

            // Opacity slider with 60 FPS requestAnimationFrame throttling
            const slider = item.querySelector('.layer-opacity-slider');
            const valLabel = item.querySelector('.opacity-val');

            if (slider && valLabel) {
                slider.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value, 10);
                    layer.opacity = Math.max(0, Math.min(100, isNaN(val) ? 100 : val)) / 100;
                    valLabel.textContent = `${Math.round(layer.opacity * 100)}%`;

                    // OPTIMIZATION (60 FPS Canvas): Throttle continuous slider repaints via RAF
                    if (!opacityRafId) {
                        opacityRafId = requestAnimationFrame(() => {
                            opacityRafId = null;
                            drawMap();
                        });
                    }
                });

                slider.addEventListener('change', () => {
                    if (opacityRafId) {
                        cancelAnimationFrame(opacityRafId);
                        opacityRafId = null;
                    }
                    drawMap();
                    pushHistoryState();
                });
            }

            // Visibility toggle
            const btnVis = item.querySelector('.btn-vis');
            if (btnVis) {
                btnVis.addEventListener('click', (e) => {
                    e.stopPropagation();
                    layer.visible = !layer.visible;
                    renderLayerUI();
                    drawMap();
                });
            }

            // Lock toggle
            const btnLock = item.querySelector('.btn-lock');
            if (btnLock) {
                btnLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    layer.locked = !layer.locked;
                    renderLayerUI();
                });
            }

            // Duplicate layer
            const btnDup = item.querySelector('.btn-dup');
            if (btnDup) {
                btnDup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cloned = cloneLayerObject(layer);
                    state.mapLayers.splice(i + 1, 0, cloned);
                    state.activeLayerIndex = i + 1;
                    pushHistoryState();
                    renderLayerUI();
                    drawMap();
                });
            }

            // Move layer UP in rendering stack
            const btnUp = item.querySelector('.btn-up');
            if (btnUp) {
                btnUp.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i < state.mapLayers.length - 1) {
                        const temp = state.mapLayers[i];
                        state.mapLayers[i] = state.mapLayers[i + 1];
                        state.mapLayers[i + 1] = temp;
                        state.activeLayerIndex = i + 1;
                        pushHistoryState();
                        renderLayerUI();
                        drawMap();
                    }
                });
            }

            // Move layer DOWN in rendering stack
            const btnDown = item.querySelector('.btn-down');
            if (btnDown) {
                btnDown.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (i > 0) {
                        const temp = state.mapLayers[i];
                        state.mapLayers[i] = state.mapLayers[i - 1];
                        state.mapLayers[i - 1] = temp;
                        state.activeLayerIndex = i - 1;
                        pushHistoryState();
                        renderLayerUI();
                        drawMap();
                    }
                });
            }

            // Delete layer with strict active index mathematical recalculation
            const btnDel = item.querySelector('.btn-del');
            if (btnDel) {
                btnDel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (state.mapLayers.length <= 1) return;

                    // Remove targeted layer
                    state.mapLayers.splice(i, 1);

                    // INVARIANT: Mathematical active index correction on deletion
                    if (state.activeLayerIndex === i) {
                        state.activeLayerIndex = Math.max(0, i - 1);
                    } else if (state.activeLayerIndex > i) {
                        state.activeLayerIndex--;
                    }

                    // Bounds clamping
                    state.activeLayerIndex = Math.max(0, Math.min(state.mapLayers.length - 1, state.activeLayerIndex));

                    // Synchronize tool state for newly active layer
                    const newActiveLayer = state.mapLayers[state.activeLayerIndex];
                    if (newActiveLayer) {
                        if (newActiveLayer.type === 'objectgroup' && window.TileWeaver.tools?.selectTool) {
                            window.TileWeaver.tools.selectTool('objectPlace');
                        } else if (newActiveLayer.type === 'tilelayer' && state.currentTool === 'objectPlace' && window.TileWeaver.tools?.selectTool) {
                            window.TileWeaver.tools.selectTool('paint');
                        }
                    }

                    pushHistoryState();
                    renderLayerUI();
                    drawMap();
                });
            }

            listEl.appendChild(item);
        }
    }

    /**
     * Registers layer creation button listeners & global overlay view checkbox handlers.
     */
    function initLayerUI() {
        document.getElementById('btn-add-layer')?.addEventListener('click', () => {
            const newName = `Layer ${state.mapLayers.length + 1}`;
            state.mapLayers.push(createNewLayerObject(newName, 'tilelayer'));
            state.activeLayerIndex = state.mapLayers.length - 1;
            pushHistoryState();
            renderLayerUI();
            drawMap();
        });

        document.getElementById('btn-add-object-layer')?.addEventListener('click', () => {
            const newName = `Objects ${state.mapLayers.length + 1}`;
            state.mapLayers.push(createNewLayerObject(newName, 'objectgroup'));
            state.activeLayerIndex = state.mapLayers.length - 1;
            pushHistoryState();
            renderLayerUI();
            drawMap();
        });

        document.getElementById('toggle-grid')?.addEventListener('change', (e) => {
            state.showGrid = Boolean(e.target.checked);
            drawMap();
        });

        document.getElementById('toggle-passability')?.addEventListener('change', (e) => {
            state.showPassability = Boolean(e.target.checked);
            drawMap();
        });

        document.getElementById('toggle-regions')?.addEventListener('change', (e) => {
            state.showRegions = Boolean(e.target.checked);
            drawMap();
        });
    }

    // Expose layer manager on window.TileWeaver namespace with 100% alias coverage
    window.TileWeaver.layerManager = {
        renderLayerUI,
        renderLayerList: renderLayerUI,
        renderLayersList: renderLayerUI,
        initLayerUI,
        cloneLayerObject
    };
})();
