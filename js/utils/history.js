/**
 * TileWeaver - Undo / Redo History Stack Manager
 * ----------------------------------------------
 * Manages snapshot state history for all map edits. Takes deep snapshots of map
 * layers, passability grids, region grids, and dimensions to allow full multi-level
 * undo and redo operations via keyboard shortcuts (Ctrl+Z / Ctrl+Y) or toolbar buttons.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};
    window.TileWeaver = window.TileWeaver; // Backward-compatibility alias

    const { MAX_HISTORY } = (window.TileWeaver.constants || window.TileWeaver.constants);
    const { state } = (window.TileWeaver.stateModule || window.TileWeaver.stateModule);
    const { showMessage } = (window.TileWeaver.toast || window.TileWeaver.toast);

    /** Stack of past state JSON snapshots for Undo */
    let historyStack = [];
    /** Stack of future state JSON snapshots for Redo */
    let redoStack = [];
    /** Callback function to invoke after state is restored to update canvas views */
    let onRestoreCallback = null;

    /**
     * Registers a callback function to be called after undo/redo state restoration.
     * @param {Function} callback - Function that re-draws canvases and updates layer UI.
     */
    function setHistoryRestoreCallback(callback) {
        onRestoreCallback = callback;
    }

    /**
     * Captures a deep JSON snapshot of current map state and pushes it onto `historyStack`.
     * Clears the `redoStack` whenever a new edit action occurs.
     */
    /** Helper: Serializes state into a compact snapshot object */
    function captureStateSnapshot() {
        return {
            mapWidth: state.mapWidth,
            mapHeight: state.mapHeight,
            TILE_SIZE: state.TILE_SIZE,
            nextobjectid: state.nextobjectid || 1,
            layers: state.mapLayers.map(l => {
                const compactData = [];
                if (l.data) {
                    for (let r = 0; r < state.mapHeight; r++) {
                        if (!l.data[r]) continue;
                        for (let c = 0; c < state.mapWidth; c++) {
                            const cell = l.data[r][c];
                            if (cell) {
                                compactData.push({ r, c, cell: { ...cell } });
                            }
                        }
                    }
                }
                const compactVertices = [];
                if (l.terrainVertices) {
                    for (let r = 0; r <= state.mapHeight; r++) {
                        if (!l.terrainVertices[r]) continue;
                        for (let c = 0; c <= state.mapWidth; c++) {
                            const v = l.terrainVertices[r][c];
                            if (v) compactVertices.push({ r, c, v });
                        }
                    }
                }
                const objects = (l.objects && Array.isArray(l.objects))
                    ? JSON.parse(JSON.stringify(l.objects))
                    : [];
                return {
                    id: l.id,
                    name: l.name,
                    type: l.type || (objects.length > 0 ? 'objectgroup' : 'tilelayer'),
                    draworder: l.draworder || 'topdown',
                    visible: l.visible !== undefined ? l.visible : true,
                    locked: l.locked !== undefined ? l.locked : false,
                    opacity: l.opacity !== undefined ? l.opacity : 1.0,
                    compactData,
                    compactVertices,
                    objects
                };
            }),
            compactPassability: (() => {
                const arr = [];
                if (state.passabilityGrid) {
                    for (let r = 0; r < state.mapHeight; r++) {
                        if (!state.passabilityGrid[r]) continue;
                        for (let c = 0; c < state.mapWidth; c++) {
                            const v = state.passabilityGrid[r][c];
                            if (v) arr.push({ r, c, v });
                        }
                    }
                }
                return arr;
            })(),
            compactRegion: (() => {
                const arr = [];
                if (state.regionGrid) {
                    for (let r = 0; r < state.mapHeight; r++) {
                        if (!state.regionGrid[r]) continue;
                        for (let c = 0; c < state.mapWidth; c++) {
                            const v = state.regionGrid[r][c];
                            if (v) arr.push({ r, c, v });
                        }
                    }
                }
                return arr;
            })()
        };
    }

    /**
     * Captures a deep JSON snapshot of current map state and pushes it onto `historyStack`.
     * Clears the `redoStack` whenever a new edit action occurs.
     */
    function pushHistoryState() {
        const snapshot = captureStateSnapshot();
        historyStack.push(JSON.stringify(snapshot));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        redoStack = [];
        updateHistoryButtons();
    }

    /**
     * Performs an Undo operation by popping the last state from `historyStack` and restoring it.
     */
    function undo() {
        if (historyStack.length === 0) return;
        
        // Save current state into redo stack before restoring past state
        const currentState = captureStateSnapshot();
        redoStack.push(JSON.stringify(currentState));

        const lastState = JSON.parse(historyStack.pop());
        restoreState(lastState);
        showMessage("Undo performed", "info");
        updateHistoryButtons();
    }

    /**
     * Performs a Redo operation by popping the next state from `redoStack` and restoring it.
     */
    function redo() {
        if (redoStack.length === 0) return;
        
        // Save current state into history stack before restoring future state
        const currentState = captureStateSnapshot();
        historyStack.push(JSON.stringify(currentState));

        const nextState = JSON.parse(redoStack.pop());
        restoreState(nextState);
        showMessage("Redo performed", "info");
        updateHistoryButtons();
    }

    /**
     * Restores map state from a parsed snapshot object and updates DOM inputs & viewports.
     * @param {Object} savedState - Parsed state snapshot object.
     */
    function restoreState(savedState) {
        state.mapWidth = savedState.mapWidth;
        state.mapHeight = savedState.mapHeight;
        state.TILE_SIZE = savedState.TILE_SIZE;
        if (savedState.nextobjectid !== undefined) {
            state.nextobjectid = savedState.nextobjectid;
        }

        // Restore layers
        if (savedState.layers) {
            state.mapLayers = savedState.layers.map(l => {
                const objects = l.objects
                    ? JSON.parse(JSON.stringify(l.objects))
                    : [];

                // Backward-compatible full data array support
                if (l.data && Array.isArray(l.data) && Array.isArray(l.data[0])) {
                    return {
                        ...l,
                        type: l.type || (objects.length > 0 ? 'objectgroup' : 'tilelayer'),
                        draworder: l.draworder || 'topdown',
                        objects
                    };
                }

                // Unpack compact data into 2D grid
                const data = [];
                for (let y = 0; y < state.mapHeight; y++) {
                    const row = [];
                    for (let x = 0; x < state.mapWidth; x++) row.push(null);
                    data.push(row);
                }
                if (l.compactData) {
                    l.compactData.forEach(item => {
                        if (item.r < state.mapHeight && item.c < state.mapWidth) {
                            data[item.r][item.c] = item.cell;
                        }
                    });
                }

                const terrainVertices = [];
                for (let y = 0; y <= state.mapHeight; y++) {
                    const vRow = [];
                    for (let x = 0; x <= state.mapWidth; x++) vRow.push(0);
                    terrainVertices.push(vRow);
                }
                if (l.compactVertices) {
                    l.compactVertices.forEach(item => {
                        if (item.r <= state.mapHeight && item.c <= state.mapWidth) {
                            terrainVertices[item.r][item.c] = item.v;
                        }
                    });
                }

                return {
                    id: l.id,
                    name: l.name,
                    type: l.type || (objects.length > 0 ? 'objectgroup' : 'tilelayer'),
                    draworder: l.draworder || 'topdown',
                    visible: l.visible !== undefined ? l.visible : true,
                    locked: l.locked !== undefined ? l.locked : false,
                    opacity: l.opacity !== undefined ? l.opacity : 1.0,
                    data,
                    terrainVertices,
                    objects
                };
            });
        }

        // Restore passability grid
        state.passabilityGrid = [];
        for (let y = 0; y < state.mapHeight; y++) {
            const pRow = [];
            for (let x = 0; x < state.mapWidth; x++) pRow.push(0);
            state.passabilityGrid.push(pRow);
        }
        if (savedState.compactPassability) {
            savedState.compactPassability.forEach(item => {
                if (item.r < state.mapHeight && item.c < state.mapWidth) {
                    state.passabilityGrid[item.r][item.c] = item.v;
                }
            });
        } else if (savedState.passabilityGrid) {
            state.passabilityGrid = savedState.passabilityGrid;
        }

        // Restore region grid
        state.regionGrid = [];
        for (let y = 0; y < state.mapHeight; y++) {
            const rRow = [];
            for (let x = 0; x < state.mapWidth; x++) rRow.push(0);
            state.regionGrid.push(rRow);
        }
        if (savedState.compactRegion) {
            savedState.compactRegion.forEach(item => {
                if (item.r < state.mapHeight && item.c < state.mapWidth) {
                    state.regionGrid[item.r][item.c] = item.v;
                }
            });
        } else if (savedState.regionGrid) {
            state.regionGrid = savedState.regionGrid;
        }
        
        if (state.activeLayerIndex >= state.mapLayers.length) {
            state.activeLayerIndex = state.mapLayers.length - 1;
        }
        
        // Validate selectedObjectId to prevent dangling selection reference
        if (state.selectedObjectId) {
            let foundSelectedObj = false;
            for (const layer of state.mapLayers) {
                if (layer.objects && layer.objects.some(o => o.id === state.selectedObjectId)) {
                    foundSelectedObj = true;
                    break;
                }
            }
            if (!foundSelectedObj) {
                state.selectedObjectId = null;
                const tp = (window.TileWeaver.tileProperties || window.TileWeaver.tileProperties);
                if (tp && tp.renderTilePropertiesForm) {
                    tp.renderTilePropertiesForm();
                }
            }
        }

        // Update header dimension input fields
        const wInput = document.getElementById('map-width-input');
        const hInput = document.getElementById('map-height-input');
        const sInput = document.getElementById('tile-size-input');
        if (wInput) wInput.value = state.mapWidth;
        if (hInput) hInput.value = state.mapHeight;
        if (sInput) sInput.value = state.TILE_SIZE;

        // Trigger registered post-restoration callback (re-draw canvas viewports)
        if (onRestoreCallback) onRestoreCallback();
    }

    /**
     * Enables or disables Undo/Redo toolbar buttons based on stack lengths.
     */
    function updateHistoryButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) btnUndo.disabled = historyStack.length === 0;
        if (btnRedo) btnRedo.disabled = redoStack.length === 0;
    }

    // Expose history manager on window.TileWeaver namespace
    window.TileWeaver.history = {
        setHistoryRestoreCallback,
        pushHistoryState,
        undo,
        redo,
        restoreState,
        updateHistoryButtons
    };
    window.TileWeaver.history = window.TileWeaver.history;
})();
