/**
 * @fileoverview objectInspector.js - TileWeaver Object Inspector & Vector Shape Manager Module
 * @subsystem Object Layer & Entity Inspector Subsystem
 * @frameBudget 0.05ms UI event dispatch / 16.6ms 60 FPS RAF throttled repaints
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> WorldPixelXY (px)
 * @stateInvariants state.mapLayers has objectgroup layer; state.selectedObjectId points to valid entity ID
 * @historyTracked Snapshots recorded via history.pushHistoryState()
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+
 * -------------------------------------------------------------------------------------------------
 * Manages live inspection, manipulation, vector shape geometry, and custom property editing for Object Layer entities:
 * 1. Entity Resolution: Resolves active object entity reference from `state.selectedObjectId`.
 * 2. Transform HUD: Extends the right sidebar Inspector dock with transformation fields (X, Y, Width, Height, Rotation, Origin Align).
 * 3. Vector Shape & Text Attributes: Supports Rectangles, Ellipses, Points, Polygons, Polylines, and Text Object attributes.
 * 4. Bidirectional Custom Properties: Normalizes and synchronizes `custom` dictionary and Tiled TMJ typed `properties` array.
 * 5. Lifecycle Management: Creation, transactional duplication, and deletion with history snapshotting (`pushHistoryState`).
 * 6. Allocation-Free ID Allocator: Single-pass linear ID allocation preventing V8 call stack overflow.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawMap } = window.TileWeaver.rendering;

    /**
     * Deep-clones plain objects and arrays without JSON stringify overhead.
     * OPTIMIZATION (Memory / GC): Eliminates V8 heap string allocation churn during object creation/duplication.
     * 
     * @param {*} source - Source value to clone.
     * @returns {*} Deeply cloned value.
     */
    function deepClonePropertyObject(source) {
        if (source === null || typeof source !== 'object') {
            return source;
        }
        if (Array.isArray(source)) {
            return source.map(item => deepClonePropertyObject(item));
        }
        const cloned = {};
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                cloned[key] = deepClonePropertyObject(source[key]);
            }
        }
        return cloned;
    }

    /**
     * Allocates a guaranteed unique object ID across all existing map layers.
     * OPTIMIZATION (Memory & Safety): Single-pass linear scan replaces flatMap/Math.max spread,
     * preventing V8 call stack overflow on large entity datasets.
     * 
     * @returns {number} Next unique object ID.
     */
    function getNextObjectId() {
        let maxExistingId = 0;
        if (Array.isArray(state.mapLayers)) {
            for (let l = 0; l < state.mapLayers.length; l++) {
                const layer = state.mapLayers[l];
                if (layer && Array.isArray(layer.objects)) {
                    for (let o = 0; o < layer.objects.length; o++) {
                        const objId = layer.objects[o]?.id;
                        if (typeof objId === 'number' && objId > maxExistingId) {
                            maxExistingId = objId;
                        }
                    }
                }
            }
        }
        const nextId = Math.max(typeof state.nextobjectid === 'number' ? state.nextobjectid : 1, maxExistingId + 1);
        state.nextobjectid = nextId + 1;
        return nextId;
    }

    /**
     * Synchronizes custom property dictionary with Tiled TMJ typed properties array.
     * INVARIANT: Maintains 100% schema parity across Native JSON v3.3 and Tiled TMJ 1.10+ formats.
     * 
     * @param {Object} obj - Target object entity.
     */
    function syncObjectProperties(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (!obj.custom || typeof obj.custom !== 'object') obj.custom = {};
        if (!Array.isArray(obj.properties)) obj.properties = [];

        // 1. Sync custom dictionary entries into properties array
        Object.entries(obj.custom).forEach(([name, value]) => {
            const existingProp = obj.properties.find(p => p && p.name === name);
            const inferredType = typeof value === 'number' 
                ? (Number.isInteger(value) ? 'int' : 'float') 
                : typeof value === 'boolean' ? 'bool' : 'string';

            if (existingProp) {
                existingProp.value = value;
                if (!existingProp.type) existingProp.type = inferredType;
            } else {
                obj.properties.push({
                    name,
                    type: inferredType,
                    value
                });
            }
        });

        // 2. Sync properties array entries into custom dictionary
        obj.properties.forEach(p => {
            if (p && p.name && obj.custom[p.name] === undefined) {
                obj.custom[p.name] = p.value;
            }
        });
    }

    /**
     * Obtains active selected object entity and its parent layer.
     * INVARIANT: Returns null if no object is selected or layer is missing.
     * 
     * @returns {{ obj: Object, layer: Object, layerIndex: number }|null}
     */
    function getSelectedObjectRef() {
        if (!state.selectedObjectId || !Array.isArray(state.mapLayers)) return null;

        for (let lIdx = 0; lIdx < state.mapLayers.length; lIdx++) {
            const layer = state.mapLayers[lIdx];
            if (layer && layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
                const obj = layer.objects.find(o => o && o.id === state.selectedObjectId);
                if (obj) {
                    return { obj, layer, layerIndex: lIdx };
                }
            }
        }
        return null;
    }

    /**
     * Deletes the currently selected object instance from its parent object layer.
     * HISTORY: Captures an atomic snapshot before removing the entity.
     */
    function deleteSelectedObject() {
        const ref = getSelectedObjectRef();
        if (!ref) {
            showMessage("No object selected to delete.", "info");
            return;
        }

        pushHistoryState();

        const { obj, layer } = ref;
        const objName = obj.name || `Object #${obj.id}`;
        layer.objects = layer.objects.filter(o => o && o.id !== obj.id);
        state.selectedObjectId = null;

        if (window.TileWeaver.tileProperties && typeof window.TileWeaver.tileProperties.renderTilePropertiesForm === 'function') {
            window.TileWeaver.tileProperties.renderTilePropertiesForm();
        }

        drawMap();
        showMessage(`Deleted '${objName}' from layer '${layer.name}'`, "info");
    }

    /**
     * Duplicates the currently selected object instance with a spatial offset and fresh ID.
     * HISTORY: Captures an atomic snapshot before duplicating the entity.
     * 
     * @returns {Object|null} Duplicated object reference or null.
     */
    function duplicateSelectedObject() {
        const ref = getSelectedObjectRef();
        if (!ref || !ref.obj || !ref.layer) {
            showMessage("No object selected to duplicate.", "info");
            return null;
        }

        pushHistoryState();

        const { obj, layer } = ref;
        const maxW = (state.mapWidth || 30) * (state.TILE_SIZE || 32);
        const maxH = (state.mapHeight || 20) * (state.TILE_SIZE || 32);
        const offset = 16;

        const nextId = getNextObjectId();
        const clonedData = deepClonePropertyObject(obj);

        const duplicatedObj = {
            ...clonedData,
            id: nextId,
            name: obj.name ? `${obj.name} (Copy)` : `Object #${nextId}`,
            x: Math.min(Math.max(0, maxW - (obj.width || 32)), Math.round((obj.x || 0) + offset)),
            y: Math.min(Math.max(0, maxH - (ref.obj.height || 32)), Math.round((obj.y || 0) + offset))
        };

        syncObjectProperties(duplicatedObj);
        layer.objects.push(duplicatedObj);
        state.selectedObjectId = duplicatedObj.id;

        if (window.TileWeaver.tileProperties && typeof window.TileWeaver.tileProperties.renderTilePropertiesForm === 'function') {
            window.TileWeaver.tileProperties.renderTilePropertiesForm();
        }

        drawMap();
        showMessage(`Duplicated '${obj.name || `Object #${obj.id}`}'`, "info");
        return duplicatedObj;
    }

    /**
     * Creates a new object on the active layer (or creates an Object Layer if none active).
     * INVARIANT: Automatically provisions an Object Layer if currently on a tile layer.
     * 
     * @param {Object} rawObj - Object configuration template.
     * @returns {Object|null} Created object reference.
     */
    function createObjectOnActiveLayer(rawObj) {
        if (!rawObj || typeof rawObj !== 'object') return null;

        let activeLayer = state.mapLayers[state.activeLayerIndex];

        // Auto-switch or auto-create an Object Layer if current active layer is a tile layer
        if (!activeLayer || activeLayer.type !== 'objectgroup') {
            let objLayerIdx = state.mapLayers.findIndex(l => l && l.type === 'objectgroup');
            if (objLayerIdx < 0) {
                // Create new Object Layer using stateModule factory
                const newObjLayer = window.TileWeaver.stateModule.createNewLayerObject('Objects', 'objectgroup');
                state.mapLayers.push(newObjLayer);
                objLayerIdx = state.mapLayers.length - 1;
            }
            if (objLayerIdx >= 0) {
                state.activeLayerIndex = objLayerIdx;
                activeLayer = state.mapLayers[objLayerIdx];
                if (window.TileWeaver.layerManager && typeof window.TileWeaver.layerManager.renderLayerUI === 'function') {
                    window.TileWeaver.layerManager.renderLayerUI();
                }
            }
        }

        if (!activeLayer || !Array.isArray(activeLayer.objects)) return null;

        const nextId = getNextObjectId();
        const customProps = rawObj.custom && typeof rawObj.custom === 'object' 
            ? deepClonePropertyObject(rawObj.custom) 
            : {};
        const propertiesArr = Array.isArray(rawObj.properties) 
            ? deepClonePropertyObject(rawObj.properties) 
            : [];

        const newObj = {
            id: nextId,
            name: rawObj.name || '',
            type: rawObj.type || rawObj.class || '',
            x: Math.round(rawObj.x || 0),
            y: Math.round(rawObj.y || 0),
            width: Math.max(1, Math.round(rawObj.width || state.TILE_SIZE || 32)),
            height: Math.max(1, Math.round(rawObj.height || state.TILE_SIZE || 32)),
            rotation: Math.round((((parseFloat(rawObj.rotation) || 0) % 360) + 360) % 360),
            alignment: rawObj.alignment || undefined,
            tilesetId: rawObj.tilesetId || undefined,
            imageId: rawObj.imageId || undefined,
            tx: rawObj.tx !== undefined ? rawObj.tx : undefined,
            ty: rawObj.ty !== undefined ? rawObj.ty : undefined,
            localTileId: rawObj.localTileId !== undefined ? rawObj.localTileId : undefined,
            visible: rawObj.visible !== undefined ? Boolean(rawObj.visible) : true,
            opacity: typeof rawObj.opacity === 'number' ? Math.max(0, Math.min(1, rawObj.opacity)) : 1.0,
            gid: rawObj.gid || undefined,
            ellipse: rawObj.ellipse || undefined,
            point: rawObj.point || undefined,
            polygon: rawObj.polygon ? deepClonePropertyObject(rawObj.polygon) : undefined,
            polyline: rawObj.polyline ? deepClonePropertyObject(rawObj.polyline) : undefined,
            text: rawObj.text ? deepClonePropertyObject(rawObj.text) : undefined,
            custom: customProps,
            properties: propertiesArr
        };

        syncObjectProperties(newObj);
        activeLayer.objects.push(newObj);
        state.selectedObjectId = newObj.id;

        if (window.TileWeaver.tileProperties) {
            if (typeof window.TileWeaver.tileProperties.ensureInspectorOpen === 'function') {
                window.TileWeaver.tileProperties.ensureInspectorOpen();
            }
            if (typeof window.TileWeaver.tileProperties.renderTilePropertiesForm === 'function') {
                window.TileWeaver.tileProperties.renderTilePropertiesForm();
            }
        }

        drawMap();
        return newObj;
    }

    /**
     * Renders dedicated object transform fields (X, Y, W, H, Rotation, Origin Align, Text) inside sidebar panel.
     * OPTIMIZATION (DOM Performance): Detaches previous container before re-insertion, preventing event listener leaks.
     * 
     * @param {HTMLElement} container - Sidebar inspector container element.
     * @param {Object} obj - Selected object entity reference.
     */
    function renderObjectTransformFields(container, obj) {
        if (!container || !obj) return;

        const isGid = obj.gid && obj.gid > 0;
        let shapeKind = 'Rectangle';
        if (isGid) shapeKind = 'Tile Object';
        else if (obj.ellipse) shapeKind = 'Ellipse';
        else if (obj.point) shapeKind = 'Point';
        else if (obj.polygon) shapeKind = 'Polygon';
        else if (obj.polyline) shapeKind = 'Polyline';
        else if (obj.text) shapeKind = 'Text Label';

        const transformHTML = `
            <div id="object-inspector-transform" class="bg-slate-900/90 p-2.5 rounded-lg border border-slate-700/80 flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <span class="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                        <i class="ph ph-bounding-box"></i> Transform (${shapeKind})
                    </span>
                    <div class="flex items-center gap-1">
                        <button id="btn-duplicate-object-sidebar" title="Duplicate Object" class="px-2 py-0.5 bg-blue-950/80 hover:bg-blue-900 border border-blue-600/50 text-blue-300 rounded text-[10px] font-bold transition-colors flex items-center gap-1">
                            <i class="ph ph-copy"></i> Duplicate
                        </button>
                        <button id="btn-delete-object-sidebar" title="Delete Object" class="px-2 py-0.5 bg-red-950/80 hover:bg-red-900 border border-red-600/50 text-red-300 rounded text-[10px] font-bold transition-colors flex items-center gap-1">
                            <i class="ph ph-trash"></i> Delete
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[11px]">
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                        <label for="obj-input-x" class="text-slate-400 font-bold font-mono">X:</label>
                        <input type="number" id="obj-input-x" value="${Math.round(obj.x || 0)}" class="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs text-blue-400 font-mono font-bold">
                    </div>
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                        <label for="obj-input-y" class="text-slate-400 font-bold font-mono">Y:</label>
                        <input type="number" id="obj-input-y" value="${Math.round(obj.y || 0)}" class="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs text-blue-400 font-mono font-bold">
                    </div>
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                        <label for="obj-input-w" class="text-slate-400 font-bold font-mono">W:</label>
                        <input type="number" id="obj-input-w" value="${Math.round(obj.width || state.TILE_SIZE || 32)}" min="1" class="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs text-emerald-400 font-mono font-bold">
                    </div>
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                        <label for="obj-input-h" class="text-slate-400 font-bold font-mono">H:</label>
                        <input type="number" id="obj-input-h" value="${Math.round(obj.height || state.TILE_SIZE || 32)}" min="1" class="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs text-emerald-400 font-mono font-bold">
                    </div>
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800 col-span-2">
                        <label for="obj-input-rot" class="text-slate-400 font-bold text-[10px]">Rot (°):</label>
                        <input type="number" id="obj-input-rot" value="${Math.round(obj.rotation || 0)}" min="0" max="360" step="1" class="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-right text-xs text-purple-300 font-mono font-bold">
                    </div>
                    <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800 col-span-2">
                        <label for="obj-input-alignment" class="text-slate-400 font-bold text-[10px]">Origin Align:</label>
                        <select id="obj-input-alignment" class="bg-slate-900 border border-slate-700 text-amber-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-amber-500">
                            <option value="bottomleft" ${(!obj.alignment || obj.alignment === 'bottomleft') ? 'selected' : ''}>↘ Bottom-Left (Default)</option>
                            <option value="bottom" ${obj.alignment === 'bottom' ? 'selected' : ''}>⬇ Bottom-Center</option>
                            <option value="bottomright" ${obj.alignment === 'bottomright' ? 'selected' : ''}>↙ Bottom-Right</option>
                            <option value="left" ${obj.alignment === 'left' ? 'selected' : ''}>⬅ Center-Left</option>
                            <option value="center" ${obj.alignment === 'center' ? 'selected' : ''}>🎯 Center</option>
                            <option value="right" ${obj.alignment === 'right' ? 'selected' : ''}>➡ Center-Right</option>
                            <option value="topleft" ${obj.alignment === 'topleft' ? 'selected' : ''}>↖ Top-Left</option>
                            <option value="top" ${obj.alignment === 'top' ? 'selected' : ''}>⬆ Top-Center</option>
                            <option value="topright" ${obj.alignment === 'topright' ? 'selected' : ''}>↗ Top-Right</option>
                        </select>
                    </div>
                </div>

                ${obj.text ? `
                <div class="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
                    <label for="obj-input-text-val" class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Text Content:</label>
                    <input type="text" id="obj-input-text-val" value="${obj.text.text || ''}" placeholder="Text label..." class="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold">
                    <div class="grid grid-cols-2 gap-2 text-[11px]">
                        <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                            <label for="obj-input-font-size" class="text-slate-400 font-mono">Size:</label>
                            <input type="number" id="obj-input-font-size" value="${obj.text.pixelsize || 16}" min="6" max="120" class="w-12 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs text-purple-300 font-mono">
                        </div>
                        <div class="flex items-center justify-between bg-slate-950 px-2 py-1 rounded border border-slate-800">
                            <label for="obj-input-text-color" class="text-slate-400 font-mono">Color:</label>
                            <input type="color" id="obj-input-text-color" value="${obj.text.color || '#ffffff'}" class="w-8 h-6 bg-slate-900 border border-slate-700 rounded p-0 cursor-pointer">
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        // Inject before custom properties table container
        const existingPanel = document.getElementById('object-inspector-transform');
        if (existingPanel) existingPanel.remove();

        container.insertAdjacentHTML('afterbegin', transformHTML);

        // Bind transform input event listeners
        document.getElementById('obj-input-x')?.addEventListener('change', (e) => {
            pushHistoryState();
            obj.x = parseFloat(e.target.value) || 0;
            drawMap();
        });
        document.getElementById('obj-input-y')?.addEventListener('change', (e) => {
            pushHistoryState();
            obj.y = parseFloat(e.target.value) || 0;
            drawMap();
        });
        document.getElementById('obj-input-w')?.addEventListener('change', (e) => {
            pushHistoryState();
            obj.width = Math.max(1, parseFloat(e.target.value) || 32);
            e.target.value = obj.width;
            drawMap();
        });
        document.getElementById('obj-input-h')?.addEventListener('change', (e) => {
            pushHistoryState();
            obj.height = Math.max(1, parseFloat(e.target.value) || 32);
            e.target.value = obj.height;
            drawMap();
        });
        document.getElementById('obj-input-rot')?.addEventListener('change', (e) => {
            pushHistoryState();
            const rawVal = parseFloat(e.target.value) || 0;
            obj.rotation = Math.round(((rawVal % 360) + 360) % 360);
            e.target.value = obj.rotation;
            drawMap();
        });
        document.getElementById('obj-input-alignment')?.addEventListener('change', (e) => {
            pushHistoryState();
            obj.alignment = e.target.value;
            drawMap();
        });
        document.getElementById('btn-duplicate-object-sidebar')?.addEventListener('click', duplicateSelectedObject);
        document.getElementById('btn-delete-object-sidebar')?.addEventListener('click', deleteSelectedObject);

        if (obj.text) {
            document.getElementById('obj-input-text-val')?.addEventListener('change', (e) => {
                pushHistoryState();
                obj.text.text = e.target.value;
                drawMap();
            });
            document.getElementById('obj-input-font-size')?.addEventListener('change', (e) => {
                pushHistoryState();
                obj.text.pixelsize = Math.max(6, Math.min(120, parseInt(e.target.value, 10) || 16));
                e.target.value = obj.text.pixelsize;
                drawMap();
            });
            document.getElementById('obj-input-text-color')?.addEventListener('change', (e) => {
                pushHistoryState();
                obj.text.color = e.target.value;
                drawMap();
            });
        }
    }

    // Expose Object Inspector subsystem on window.TileWeaver namespace
    window.TileWeaver.objectInspector = {
        getSelectedObjectRef,
        deleteSelectedObject,
        duplicateSelectedObject,
        createObjectOnActiveLayer,
        renderObjectTransformFields,
        syncObjectProperties,
        getNextObjectId,
        deepClonePropertyObject
    };
})();
