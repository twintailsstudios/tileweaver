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
 * 2. Visual controls: Visibility (Eye), Lock (Key), Rename (Pencil), Duplicate (Copy), Reorder (Up/Down & Drag-and-Drop), Delete (Trash).
 * 3. HTML5 drag-and-drop layer stack reordering with real-time drop highlighting and active selection preservation.
 * 4. Opacity slider with 60 FPS requestAnimationFrame throttled preview and coalesced history snapshots.
 * 5. Inline double-click & button-triggered layer renaming with input sanitization and Escape cancellation.
 * 6. Deep-cloned layer duplication preserving 2D tile data, terrain vertices, and entity isolation.
 * 7. Mathematical active layer index correction on layer deletion and reordering.
 * 8. Tool mode auto-switching and preservation across layer selections.
 * 9. Global overlay view toggles (Grid, Passability, Region IDs).
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state, createNewLayerObject } = window.TileWeaver.stateModule;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawMap } = window.TileWeaver.rendering;

    // RAF throttle handle for fluid 60 FPS opacity slider dragging
    let opacityRafId = null;

    // Tracking for HTML5 drag-and-drop layer reordering
    let draggedLayerIndex = null;

    /**
     * Reorders a layer from one stack index to another, keeping active selection intact
     * and pushing an atomic history snapshot.
     * 
     * @param {number} fromIndex - Source layer index in `state.mapLayers`.
     * @param {number} toIndex - Destination layer index in `state.mapLayers`.
     * @returns {boolean} True if the layer was successfully moved.
     */
    function reorderLayer(fromIndex, toIndex) {
        if (!Array.isArray(state.mapLayers) || state.mapLayers.length <= 1) return false;
        if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') return false;
        if (fromIndex < 0 || fromIndex >= state.mapLayers.length || toIndex < 0 || toIndex >= state.mapLayers.length) return false;
        if (fromIndex === toIndex) return false;

        const activeLayer = state.mapLayers[state.activeLayerIndex];
        const [moved] = state.mapLayers.splice(fromIndex, 1);
        state.mapLayers.splice(toIndex, 0, moved);

        // Keep activeLayerIndex pointing to the same active layer
        if (activeLayer) {
            const newActiveIndex = state.mapLayers.indexOf(activeLayer);
            if (newActiveIndex >= 0) {
                state.activeLayerIndex = newActiveIndex;
            }
        }

        pushHistoryState();
        renderLayerUI();
        drawMap();
        return true;
    }

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
     * Programmatically renames a layer at a given index with length clamping and history tracking.
     * 
     * @param {number} layerIndex - Target layer index in `state.mapLayers`.
     * @param {string} newName - Desired new layer name string.
     * @returns {boolean} True if the rename succeeded and state was committed.
     */
    function renameLayer(layerIndex, newName) {
        if (!Array.isArray(state.mapLayers) || layerIndex < 0 || layerIndex >= state.mapLayers.length) return false;
        const layer = state.mapLayers[layerIndex];
        if (!layer) return false;

        const trimmed = (typeof newName === 'string' ? newName.trim() : '');
        if (!trimmed) return false;

        const sanitized = trimmed.substring(0, 60);
        if (sanitized !== layer.name) {
            layer.name = sanitized;
            pushHistoryState();
            renderLayerUI();
            return true;
        }
        return false;
    }

    /**
     * Initiates inline renaming UI within a given layer DOM element or by layer index.
     * 
     * @param {number} layerIndex - Target layer index in `state.mapLayers`.
     * @param {HTMLElement} [itemElement] - Optional existing DOM item element.
     */
    function startRename(layerIndex, itemElement) {
        if (!Array.isArray(state.mapLayers) || layerIndex < 0 || layerIndex >= state.mapLayers.length) return;
        const layer = state.mapLayers[layerIndex];
        if (!layer) return;

        let item = itemElement;
        if (!item) {
            const listEl = document.getElementById('layers-list');
            if (listEl) {
                const items = listEl.querySelectorAll ? listEl.querySelectorAll('.layer-item') : [];
                const domIndex = state.mapLayers.length - 1 - layerIndex;
                item = items[domIndex];
            }
        }
        if (!item) return;

        const nameLabel = item.querySelector('.layer-name-label');
        if (!nameLabel) return;

        const currentName = layer.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.maxLength = 60;
        input.className = 'w-full bg-slate-950 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-slate-100 font-bold focus:outline-none focus:ring-1 focus:ring-blue-400';

        // Shield input from parent selection clicks and editor hotkeys
        ['click', 'dblclick', 'mousedown', 'mouseup', 'keydown', 'keyup'].forEach(eventType => {
            input.addEventListener(eventType, (e) => e.stopPropagation());
        });

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

        const cancelRename = () => {
            if (committed) return;
            committed = true;
            renderLayerUI();
        };

        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                commitRename();
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                cancelRename();
            }
        });
        input.addEventListener('blur', commitRename);

        nameLabel.replaceWith(input);
        input.focus();
        input.select();
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
            item.setAttribute('draggable', 'true');
            item.setAttribute('data-layer-index', String(i));

            const isObjectGroup = (layer.type === 'objectgroup');
            const badgeClass = isObjectGroup ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-blue-500/20 text-blue-300 border-blue-500/40';
            const badgeText = isObjectGroup ? 'Obj' : 'Tile';
            const objCountText = isObjectGroup ? ` (${layer.objects ? layer.objects.length : 0})` : '';

            item.innerHTML = `
                <div class="flex items-center justify-between gap-2 min-w-0">
                    <div class="flex items-center gap-1 min-w-0 flex-1">
                        <div class="layer-drag-handle p-0.5 text-slate-500 hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0" title="Drag to reorder layer">
                            <i class="ph ph-dots-six-vertical text-sm"></i>
                        </div>
                        <button class="btn-vis p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors shrink-0" title="Toggle Visibility">
                            <i class="ph ${layer.visible ? 'ph-eye text-blue-400 text-sm' : 'ph-eye-slash text-slate-600 text-sm'}"></i>
                        </button>
                        <button class="btn-lock p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-200 transition-colors shrink-0" title="Toggle Lock">
                            <i class="ph ${layer.locked ? 'ph-lock-key text-amber-400 text-sm' : 'ph-lock-key-open text-slate-600 text-sm'}"></i>
                        </button>
                        <span class="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded border shrink-0 ${badgeClass}">${badgeText}</span>
                        <span class="layer-name-label font-bold truncate text-slate-100 text-xs hover:underline cursor-text flex-1 min-w-0" title="Double click or click pencil to rename: ${layer.name}">${layer.name}${objCountText}</span>
                    </div>

                    <div class="flex items-center gap-0.5 shrink-0">
                        <button class="btn-rename p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-blue-300 transition-colors" title="Rename Layer">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
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

            // HTML5 Drag and Drop Event Listeners
            item.addEventListener('dragstart', (e) => {
                // Guard: Suppress dragging when clicking buttons, inputs, or sliders
                if (e.target.closest && (e.target.closest('button') || e.target.closest('input'))) {
                    e.preventDefault();
                    return;
                }

                draggedLayerIndex = i;
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                }

                // Add visual styling during drag
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => {
                        if (item.classList) {
                            item.classList.add('opacity-40', 'border-dashed', 'border-blue-400');
                        }
                    });
                }
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
                if (draggedLayerIndex !== null && draggedLayerIndex !== i) {
                    if (item.classList) {
                        item.classList.add('border-blue-400', 'bg-blue-950/40');
                    }
                }
            });

            item.addEventListener('dragleave', () => {
                if (item.classList) {
                    item.classList.remove('border-blue-400', 'bg-blue-950/40');
                }
            });

            item.addEventListener('dragend', () => {
                draggedLayerIndex = null;
                const allItems = listEl.querySelectorAll ? listEl.querySelectorAll('.layer-item') : [];
                allItems.forEach(el => {
                    if (el.classList) {
                        el.classList.remove('opacity-40', 'border-dashed', 'border-blue-400', 'bg-blue-950/40');
                    }
                });
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (item.classList) {
                    item.classList.remove('border-blue-400', 'bg-blue-950/40');
                }

                let fromIdx = draggedLayerIndex;
                if (fromIdx === null && e.dataTransfer && typeof e.dataTransfer.getData === 'function') {
                    const data = e.dataTransfer.getData('text/plain');
                    if (data !== '') fromIdx = parseInt(data, 10);
                }

                if (typeof fromIdx === 'number' && !isNaN(fromIdx) && fromIdx !== i) {
                    reorderLayer(fromIdx, i);
                }
                draggedLayerIndex = null;
            });

            // Layer item selection handler (in-place class toggle to preserve DOM node for double-click)
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                
                const wasActive = (state.activeLayerIndex === i);
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

                if (!wasActive) {
                    const allItems = listEl.querySelectorAll ? listEl.querySelectorAll('.layer-item') : [];
                    allItems.forEach(el => {
                        if (el.classList) {
                            el.classList.remove('active', 'border-blue-500/80', 'border-l-4', 'border-l-blue-500', 'bg-slate-850');
                            el.classList.add('border-slate-700/70');
                        }
                    });
                    if (item.classList) {
                        item.classList.add('active', 'border-blue-500/80', 'border-l-4', 'border-l-blue-500', 'bg-slate-850');
                        item.classList.remove('border-slate-700/70');
                    }
                }
                drawMap();
            });

            // Inline Double-Click Layer Renaming
            const nameLabel = item.querySelector('.layer-name-label');
            if (nameLabel) {
                nameLabel.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    startRename(i, item);
                });
            }

            // Dedicated Rename Button Action
            const btnRename = item.querySelector('.btn-rename');
            if (btnRename) {
                btnRename.addEventListener('click', (e) => {
                    e.stopPropagation();
                    startRename(i, item);
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
        cloneLayerObject,
        renameLayer,
        startRename,
        reorderLayer
    };
})();
