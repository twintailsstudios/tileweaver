/**
 * @fileoverview Drawing Tools & Global Keyboard Input Dispatcher for TileWeaver.
 * @subsystem Drawing Tools & Input Dispatcher / UI Control Manager
 * @frameBudget <0.05ms per discrete tool transition; zero frame budget impact on 60 FPS loop
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY (Operative Mode Dispatch)
 * @stateInvariants Mutates state.currentTool, state.terrainBrushRadius, state.isSpacePressed, state.isPanning, state.isShiftPressed
 * @historyTracked Routes global Ctrl+Z / Ctrl+Y to history.undo() / history.redo()
 * @exportCompatibility Full compatibility with standard tile layers and object group vector modes
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { drawMap, drawTileset } = window.TileWeaver.rendering;
    const { undo, redo } = window.TileWeaver.history;

    /**
     * Immutable static tool button configuration dictionary.
     * Maps tool identifiers to DOM element IDs, badge display labels, and category groups.
     * @constant {Object.<string, {id: string, name: string, group: string}>}
     */
    const TOOL_BUTTON_MAP = Object.freeze({
        'paint': { id: 'tool-paint', name: 'Brush [P]', group: 'draw' },
        'autotile': { id: 'tool-autotile', name: 'Autotile [A]', group: 'draw' },
        'animtile': { id: 'tool-animtile', name: 'Anim [N]', group: 'draw' },
        'erase': { id: 'tool-erase', name: 'Eraser [E]', group: 'draw' },
        'picker': { id: 'tool-picker', name: 'Picker [I]', group: 'draw' },
        'bucket': { id: 'tool-bucket', name: 'Bucket Fill [B]', group: 'shape' },
        'line': { id: 'tool-line', name: 'Line [L]', group: 'shape' },
        'rect': { id: 'tool-rect', name: 'Rectangle [R]', group: 'shape' },
        'terrain': { id: 'tool-terrain', name: 'Terrain Brush [T]', group: 'world' },
        'terrainBucket': { id: 'tool-terrain-bucket', name: 'Terrain Fill', group: 'world' },
        'passability': { id: 'tool-passability', name: 'Passability (O/X)', group: 'world' },
        'region': { id: 'tool-region', name: 'Region IDs', group: 'world' },
        'objectSelect': { id: 'tool-object-select', name: 'Object Select [O]', group: 'object' },
        'objectPlace': { id: 'tool-object-place', name: 'Place Object', group: 'object' },
        'shapeRect': { id: 'tool-shape-rect', name: 'Rect Shape', group: 'object' },
        'shapeEllipse': { id: 'tool-shape-ellipse', name: 'Ellipse Shape', group: 'object' },
        'shapePoint': { id: 'tool-shape-point', name: 'Point Marker', group: 'object' },
        'shapePolyline': { id: 'tool-shape-polyline', name: 'Polyline', group: 'object' },
        'shapePolygon': { id: 'tool-shape-polygon', name: 'Polygon', group: 'object' },
        'shapeText': { id: 'tool-shape-text', name: 'Text Object', group: 'object' }
    });

    /** Set of tools that use toggle button styling (.btn-toggle-active) */
    const WORLD_TOGGLE_TOOLS = new Set(['terrain', 'terrainBucket', 'passability', 'region']);

    /** Tool category tab identifier list */
    const CATEGORY_TABS = ['draw', 'shape', 'object', 'world'];

    /**
     * Checks if any modal dialog overlay is currently visible in the DOM.
     * @returns {boolean} True if a modal dialog is open.
     */
    function isModalOpen() {
        return !!document.querySelector('.modal-overlay:not(.hidden), .fixed.inset-0:not(.hidden):not(#map-container)');
    }

    /**
     * Activates a drawing tool and updates active button CSS highlights, badge, and HUD context.
     * @param {string} toolName - Name of tool to select.
     */
    function selectTool(toolName) {
        state.currentTool = toolName;

        // Clear active highlights from all tool buttons
        document.querySelectorAll('.btn-tool-active').forEach(b => b.classList.remove('btn-tool-active'));
        document.querySelectorAll('.btn-toggle-active').forEach(b => b.classList.remove('btn-toggle-active'));

        const config = TOOL_BUTTON_MAP[toolName];
        if (config) {
            const btn = document.getElementById(config.id);
            if (btn) {
                if (WORLD_TOGGLE_TOOLS.has(toolName)) {
                    btn.classList.add('btn-toggle-active');
                } else {
                    btn.classList.add('btn-tool-active');
                }
            }

            // Update Active Tool Badge text
            const badge = document.getElementById('active-tool-badge');
            if (badge) badge.textContent = config.name;

            // Automatically switch tool category tab if needed (switchToolTab updates tab states)
            if (config.group) {
                switchToolTab(config.group);
            } else {
                updateToolTabStates();
            }
        } else {
            updateToolTabStates();
        }

        // Update Viewport Contextual HUD
        if (window.TileWeaver.viewport && typeof window.TileWeaver.viewport.updateContextualHUD === 'function') {
            window.TileWeaver.viewport.updateContextualHUD(toolName);
        }

        // Automatic Handoff: Switch sidebar tab to Terrain Swatches when Terrain tool selected
        if (toolName === 'terrain') {
            if (window.TileWeaver.terrainSwatches) {
                const ts = window.TileWeaver.terrainSwatches;
                if (typeof ts.setSidebarTab === 'function') {
                    ts.setSidebarTab('swatches');
                } else if (typeof ts.switchSidebarTab === 'function') {
                    ts.switchSidebarTab('swatches');
                }
            }
        }

        drawTileset();
        drawMap();
    }

    /**
     * Evaluates current active layer type & active tileset type,
     * updating enabled/disabled and opacity styles for 'Draw' vs 'Object' category tabs.
     */
    function updateToolTabStates() {
        const activeLayer = state.mapLayers[state.activeLayerIndex];
        const activeTs = state.tilesets[state.activeTilesetIndex];
        const isObjectContext = (activeLayer && activeLayer.type === 'objectgroup') || (activeTs && activeTs.isCollection);

        const drawTab = document.getElementById('tool-tab-draw');
        const objectTab = document.getElementById('tool-tab-object');

        if (isObjectContext) {
            // Object Context: Disable "Draw" tab, Enable "Object" tab
            if (drawTab) {
                drawTab.classList.add('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
                drawTab.setAttribute('disabled', 'true');
            }
            if (objectTab) {
                objectTab.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
                objectTab.removeAttribute('disabled');
            }
        } else {
            // Tile Context: Disable "Object" tab, Enable "Draw" tab
            if (objectTab) {
                objectTab.classList.add('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
                objectTab.setAttribute('disabled', 'true');
            }
            if (drawTab) {
                drawTab.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
                drawTab.removeAttribute('disabled');
            }
        }
    }

    /**
     * Switches active drawing tools category tab ('draw', 'shape', 'object', 'world').
     * @param {string} tabName - Category tab identifier to activate.
     */
    function switchToolTab(tabName) {
        updateToolTabStates();
        const tabBtn = document.getElementById(`tool-tab-${tabName}`);
        if (tabBtn && tabBtn.hasAttribute('disabled')) return;

        CATEGORY_TABS.forEach(t => {
            const btn = document.getElementById(`tool-tab-${t}`);
            const group = document.getElementById(`tool-group-${t}`);
            if (btn && group) {
                const isDisabled = btn.hasAttribute('disabled');
                if (t === tabName) {
                    btn.className = `flex-1 py-1.5 px-1 text-center text-slate-200 bg-slate-800 border-b-2 border-blue-500 font-bold transition-colors ${isDisabled ? 'opacity-40 pointer-events-none cursor-not-allowed' : ''}`;
                    group.classList.remove('hidden');
                } else {
                    btn.className = `flex-1 py-1.5 px-1 text-center text-slate-400 hover:text-slate-200 transition-colors ${isDisabled ? 'opacity-40 pointer-events-none cursor-not-allowed' : ''}`;
                    group.classList.add('hidden');
                }
            }
        });
    }

    /**
     * Sets active terrain brush radius (1, 2, or 3) and updates radius button UI.
     * @param {number|string} radius - Desired radius index (1 for 1x1, 2 for 3x3, 3 for 5x5).
     */
    function setTerrainBrushRadius(radius) {
        const validRadius = Math.max(1, Math.min(3, parseInt(radius, 10) || 1));
        state.terrainBrushRadius = validRadius;

        [1, 2, 3].forEach(r => {
            const btn = document.getElementById(`btn-radius-${r}`);
            if (btn) {
                if (r === validRadius) {
                    btn.className = "px-2 py-0.5 rounded bg-teal-600 text-white font-bold text-[11px] transition-colors shadow";
                } else {
                    btn.className = "px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors";
                }
            }
        });

        if (window.TileWeaver.toast && typeof window.TileWeaver.toast.showMessage === 'function') {
            window.TileWeaver.toast.showMessage(`Terrain brush radius set to ${validRadius === 1 ? '1x1' : validRadius === 2 ? '3x3' : '5x5'}!`, "info");
        }
    }

    /**
     * Registers click listeners on tool buttons and global keyboard shortcut listeners.
     */
    function initToolsUI() {
        // Register click listeners for all mapped tools
        Object.keys(TOOL_BUTTON_MAP).forEach(tool => {
            const config = TOOL_BUTTON_MAP[tool];
            const btn = document.getElementById(config.id);
            if (btn) {
                btn.addEventListener('click', () => selectTool(tool));
            }
        });

        // Category Tab click listeners
        CATEGORY_TABS.forEach(tab => {
            document.getElementById(`tool-tab-${tab}`)?.addEventListener('click', () => switchToolTab(tab));
        });

        // Terrain Brush Radius listeners
        [1, 2, 3].forEach(r => {
            document.getElementById(`btn-radius-${r}`)?.addEventListener('click', () => setTerrainBrushRadius(r));
        });

        // Global Keyboard Hotkey Event Listener
        window.addEventListener('keydown', (e) => {
            // Guard: Ignore hotkeys while user is typing in text inputs or editable elements
            const activeTag = document.activeElement?.tagName;
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(activeTag) || document.activeElement?.isContentEditable) {
                return;
            }

            // Guard: Suppress editor tool shortcuts if any modal dialog overlay is currently visible
            if (isModalOpen()) {
                return;
            }

            // Undo / Redo Hotkeys
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
                return;
            }

            // Viewport Zoom Hotkeys (Ctrl/Cmd + Plus, Minus, 0)
            if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === 'Add')) {
                e.preventDefault();
                if (window.TileWeaver.viewport && window.TileWeaver.viewport.setZoomLevel) {
                    window.TileWeaver.viewport.setZoomLevel(state.zoomLevel + 0.25);
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_' || e.key === 'Subtract')) {
                e.preventDefault();
                if (window.TileWeaver.viewport && window.TileWeaver.viewport.setZoomLevel) {
                    window.TileWeaver.viewport.setZoomLevel(state.zoomLevel - 0.25);
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
                e.preventDefault();
                if (window.TileWeaver.viewport && window.TileWeaver.viewport.resetZoom) {
                    window.TileWeaver.viewport.resetZoom();
                }
                return;
            }

            // Numeric Swatch HUD Ribbon Hotkeys 1-5
            if (['1', '2', '3', '4', '5'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (window.TileWeaver.terrainSwatches && typeof window.TileWeaver.terrainSwatches.selectRibbonSlot === 'function') {
                    e.preventDefault();
                    window.TileWeaver.terrainSwatches.selectRibbonSlot(parseInt(e.key, 10) - 1);
                    return;
                }
            }

            // Tool Shortcuts
            switch (e.key.toLowerCase()) {
                case 'p': selectTool('paint'); break;
                case 'a': selectTool('autotile'); break;
                case 'n': selectTool('animtile'); break;
                case 'b': selectTool('bucket'); break;
                case 'l': selectTool('line'); break;
                case 'r': selectTool('rect'); break;
                case 'e': selectTool('erase'); break;
                case 'i': selectTool('picker'); break;
                case 't': selectTool('terrain'); break;
                case 'o': selectTool('objectSelect'); break;
            }

            // Delete / Backspace key to remove selected object
            if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedObjectId) {
                if (window.TileWeaver.objectInspector && window.TileWeaver.objectInspector.deleteSelectedObject) {
                    window.TileWeaver.objectInspector.deleteSelectedObject();
                }
            }

            // Spacebar Pan Mode Keydown (Guarded against OS auto-repeat)
            if (e.code === 'Space') {
                if (e.repeat) return;
                state.isSpacePressed = true;
                document.getElementById('map-container')?.classList.add('cursor-grab');
            }
            if (e.shiftKey) state.isShiftPressed = true;
            if (e.ctrlKey || e.metaKey || e.key === 'Control' || e.key === 'Meta') {
                state.isCtrlPressed = true;
                if (state.isDrawing && state.strokeAnchorCol === -1 && state.hoverCol >= 0) {
                    state.strokeAnchorCol = state.hoverCol;
                    state.strokeAnchorRow = state.hoverRow;
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                state.isSpacePressed = false;
                state.isPanning = false;
                const container = document.getElementById('map-container');
                if (container) {
                    container.classList.remove('cursor-grab', 'cursor-grabbing');
                }
            }
            if (!e.shiftKey) state.isShiftPressed = false;
            if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
                state.isCtrlPressed = false;
                if (state.isDrawing) {
                    state.strokeAxisLock = null;
                    if (state.hoverCol >= 0) {
                        state.strokeAnchorCol = state.hoverCol;
                        state.strokeAnchorRow = state.hoverRow;
                    }
                }
            }
        });

        updateToolTabStates();
    }

    // Expose tools manager on window.TileWeaver namespace
    window.TileWeaver.tools = {
        selectTool,
        switchToolTab,
        updateToolTabStates,
        setTerrainBrushRadius,
        TOOL_BUTTON_MAP,
        initToolsUI
    };
})();
