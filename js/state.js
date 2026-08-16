/**
 * @fileoverview TileWeaver - Central Reactive Application State Store
 * @subsystem Core State & Bootstrapper Subsystem
 * @frameBudget 0.00ms (Decoupled master state container / O(1) synchronous cell lookups)
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY (px)
 * @stateInvariants Single source of truth in state; 2D layer cell grids [H][W] and Dual-Grid vertex matrices [H+1][W+1]
 * @historyTracked Central data model for snapshots in history.js; compact layer and grid serialization
 * @exportCompatibility Native JSON v3.3 specification & Tiled TMJ 1.10+ compatible (32-bit GID transformation bitflags)
 * ---------------------------------------------------------------------------------------------------------------------
 * Holds the single source of truth for map dimensions, active tools, multi-layer
 * canvas data, collision passability grids, region ID grids, tilesets, digital asset vault,
 * autotiles, materials, animated tiles, and stamp transformation parameters.
 */

(function() {
    'use strict';

    // Universal root resolver supporting Browser (window), Web Worker (self), and Node.js (global/globalThis)
    const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : (typeof globalThis !== 'undefined' ? globalThis : {}));
    root.TileWeaver = root.TileWeaver || {};
    root.TileWeaver = root.TileWeaver; // Backward-compatibility alias

    const { DEFAULT_TILE_SIZE, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT } = (root.TileWeaver.constants || root.TileWeaver.constants || {});

    /**
     * Module-scoped pre-compiled regular expression for parsing sequential autotile IDs (e.g. 'at_1', 'at_24').
     * @type {RegExp}
     */
    const AUTOTILE_ID_REGEX = /^at_(\d+)$/;

    /**
     * Master State Object
     */
    const state = {
        // --- Grid & Map Dimension Config ---
        /** Tile size in pixels (e.g. 32 = 32x32px) */
        TILE_SIZE: DEFAULT_TILE_SIZE,
        /** Map width in tiles */
        mapWidth: DEFAULT_MAP_WIDTH,
        /** Map height in tiles */
        mapHeight: DEFAULT_MAP_HEIGHT,

        // --- Viewport Zoom & Pan State ---
        /** Current viewport scale factor (0.25x to 4.0x) */
        zoomLevel: 1.0,
        /** Viewport horizontal pan offset in pixels */
        panX: 0,
        /** Viewport vertical pan offset in pixels */
        panY: 0,
        /** Track whether Spacebar key is currently held down for panning */
        isSpacePressed: false,
        /** Track whether Shift key is held down (used for autotile static overrides) */
        isShiftPressed: false,
        /** Active pan dragging flag */
        isPanning: false,
        /** Initial mouse X position when pan drag begins */
        panStartX: 0,
        /** Initial mouse Y position when pan drag begins */
        panStartY: 0,

        // --- Multi-Layer System State ---
        /** Array of layer objects containing tile grid data, object arrays & metadata */
        mapLayers: [],
        /** Index of currently selected active layer in `mapLayers` */
        activeLayerIndex: 0,
        /** Auto-incrementing counter for layer IDs */
        layerIdCounter: 1,

        // --- Active Object Selection & Object Layer State ---
        /** ID of currently selected object on an Object Layer (null if none) */
        selectedObjectId: null,
        /** Hovered object ID under cursor on Object Layer (null if none) */
        hoveredObjectId: null,
        /** Active resize handle under cursor: 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r' (null if none) */
        hoveredResizeHandle: null,
        /** Transient tracking object for active object translation or handle resizing */
        objectDragState: null,
        /** Active array of {x, y} vertices being drawn for polyline/polygon tool */
        objectDrawingVertices: [],
        /** Active sub-tool mode for object placement ('select', 'placeTile', 'rect', 'ellipse', 'point', 'polyline', 'polygon', 'text') */
        objectToolMode: 'select',
        /** Exact pixel X coordinate under cursor for pixel-smooth object ghost previews */
        hoverPixelX: 0,
        /** Exact pixel Y coordinate under cursor for pixel-smooth object ghost previews */
        hoverPixelY: 0,

        // --- Map Level Metadata Preservation ---
        tiledversion: '1.10.0',
        mapVersion: '1.10',
        orientation: 'orthogonal',
        renderorder: 'right-down',
        nextlayerid: 1,
        nextobjectid: 1,

        // --- Collision Passability & Region Overlay Grids ---
        /** 2D grid storing collision flags: 0 = Default, 1 = Passable (O), 2 = Solid (X), 3 = Overhang (*) */
        passabilityGrid: [], 
        /** 2D grid storing integer region IDs (1..255) for spawning/events */
        regionGrid: [],      
        /** Currently selected Region ID to paint */
        currentRegionId: 1,  

        // --- Active Tools State ---
        /** Active drawing tool: 'paint', 'autotile', 'animtile', 'bucket', 'line', 'rect', 'erase', 'picker', 'passability', 'region', 'terrain', 'cliff' */
        currentTool: 'paint', 
        /** True while user is holding mouse button to paint/erase on canvas */
        isDrawing: false,
        
        // --- Multi-Tileset Manager State ---
        /** Array of loaded tileset objects: { id, name, image, margin, spacing, tileProperties } */
        tilesets: [],
        /** Index of active tileset in `tilesets` array */
        activeTilesetIndex: 0,
        /** Auto-incrementing counter for uploaded tileset IDs */
        tilesetIdCounter: 1,
        /** Zoom scale multiplier for tileset palette viewer (0.5x to 4.0x, Default 1.0 = 100%) */
        tilesetZoom: 1.0,
        /** Active tileset manager display mode ('dock', 'popout') */
        tilesetViewMode: 'dock',
        /** True if floating popout window is open */
        isTilesetPopoutOpen: false,
        /** True if bottom widescreen dock panel is open */
        isTilesetDockOpen: true,
        /** True if bottom widescreen dock panel is currently collapsed into a slim 32px bar */
        isTilesetDockCollapsed: false,
        /** True if right live tile properties inspector panel is currently collapsed */
        isRightInspectorCollapsed: false,
        /** Hovered tile coordinate on tileset viewer: { col, row } */
        tilesetHoverCoord: { col: -1, row: -1 },

        // --- Project Digital Asset Vault & Asset Manager State ---
        /** Array of all raw image asset records: { id, name, filename, relativePath, width, height, sizeBytes, mimeType, dataUrl, image, createdAt, updatedAt, tags, assignedTilesetIds } */
        assets: [],
        /** ID of currently selected asset in the Asset Manager inspector */
        activeAssetId: null,
        /** Active filter category in Asset Manager ('all', 'in-use', 'unassigned', 'spritesheet', 'collection') */
        assetFilter: 'all',
        /** Text search query in Asset Manager */
        assetSearchQuery: '',
        /** Visibility flag for Asset Manager modal */
        isAssetManagerOpen: false,
        /** Auto-incrementing counter for asset IDs */
        assetIdCounter: 1,

        // --- Autotiles & Animated Tiles System State ---
        /** Array of mapped autotile definitions: { id, name, mode, tilesetId, mapping, isCliff } */
        autotiles: [],
        /** Array of animated tile definitions: { id, name, tilesetId, frames, frameDurationMs } */
        animatedTiles: [],
        /** Global unique material definitions for terrain swatches */
        materials: [],
        /** Currently selected material swatch ID */
        activeMaterialId: null,
        /** Active sidebar view tab ('tileset' or 'swatches') */
        activeSidebarTab: 'tileset',
        /** ID of currently selected autotile */
        activeAutotileId: null,
        /** ID of currently selected animated tile */
        activeAnimTileId: null,
        /** Auto-incrementing counter for autotile IDs */
        autotileCounter: 1,
        /** Auto-incrementing counter for anim tile IDs */
        animCounter: 1,
        /** Filter mode for terrain material swatches ('all', 'ground', 'cliff', 'wall') */
        terrainFilterMode: 'all',
        materialCategoryFilter: 'all',
        /** Active creation mode in Terrain Wizard ('ground', 'cliff', 'wall') */
        terrainWizardMode: 'ground',

        // --- Dedicated Cliffside Brush State ---
        /** Active cliff brush vertical height in tiles (Default: 2 tiles) */
        cliffBrushHeight: 2,
        /** Cliff layer targeting mode ('auto' dedicated layer stack vs 'custom' split layer assignment) */
        cliffTargetLayerMode: 'auto',
        /** Custom layer assignment routing object */
        cliffLayerConfig: { lipLayerId: null, faceLayerId: null, baseLayerId: null },

        // --- Stamp Selection & Transformation State ---
        /** Active tile stamp bounds selected on tileset palette viewer */
        selectedStamp: { col: 0, row: 0, width: 1, height: 1 },
        /** Active tile stamp transformations */
        stampTransform: { flipH: false, flipV: false, rotation: 0 },
        /** True while user is dragging a rectangular selection box on tileset canvas */
        isSelectingTileset: false,
        /** Initial tile coordinate when drag selecting on tileset canvas */
        tilesetDragStart: { col: 0, row: 0 },

        // --- Shape Tool Preview State ---
        /** Starting column for Line or Rect drawing tools */
        shapeStartCol: -1,
        /** Starting row for Line or Rect drawing tools */
        shapeStartRow: -1,
        /** Active terrain brush radius in vertices (1 = single vertex 1x1, 2 = 3x3, 3 = 5x5) */
        terrainBrushRadius: 1,
        /** Active terrain drag painting stroke value (0 = Base material, 1+ = Overlay materials) */
        terrainStrokeValue: 0,
        /** Last terrain vertex X coordinate painted during drag */
        lastTerrainVx: -1,
        /** Last terrain vertex Y coordinate painted during drag */
        lastTerrainVy: -1,

        // --- Viewport Hover Position ---
        /** Hovered tile column under cursor (-1 if outside) */
        hoverCol: -1,
        /** Hovered tile row under cursor (-1 if outside) */
        hoverRow: -1,

        // --- Visual Viewport Toggles ---
        /** Toggle visibility of tile grid lines */
        showGrid: true,
        /** Toggle visibility of Passability (O/X/*) text overlay */
        showPassability: true,
        /** Toggle visibility of Region ID overlay colors */
        showRegions: true,

        // --- Autotile Wizard Modal State ---
        /** Selected autotile mode in wizard modal ('9slice', 'dualgrid', '16tile', '25tile', '47tile') */
        wizardMode: '9slice',
        /** Key of currently active slot being mapped in wizard */
        wizardActiveSlotKey: 'topLeft',
        /** Map of slot keys to { tx, ty } tileset tile coordinates */
        wizardMapping: {},
        /** Track whether interactive 6x3 preset placement box mode is active */
        terrainPresetPlacementActive: false,
        /** Hovered column for 6x3 preset placement preview (-1 if inactive) */
        terrainPresetHoverCol: -1,
        /** Hovered row for 6x3 preset placement preview (-1 if inactive) */
        terrainPresetHoverRow: -1
    };

    /**
     * Factory function: Creates a new layer data object initialized with empty 2D grids or object arrays.
     * @param {string} [name] - Display name for the layer.
     * @param {string} [type='tilelayer'] - Layer type ('tilelayer' or 'objectgroup').
     * @returns {Object} Layer object containing `data` array or `objects` array.
     */
    function createNewLayerObject(name, type = 'tilelayer') {
        const layer = {
            id: 'layer_' + (state.layerIdCounter++),
            name: name || (type === 'objectgroup' ? `Objects ${state.layerIdCounter}` : `Layer ${state.layerIdCounter}`),
            type: type,
            visible: true,
            locked: false,
            opacity: 1.0,
            data: [],
            terrainVertices: [],
            objects: [],
            draworder: 'topdown'
        };

        if (type === 'tilelayer') {
            // OPTIMIZATION: Zero-allocation packed array instantiation for 2D cell grid (H x W -> null)
            for (let y = 0; y < state.mapHeight; y++) {
                layer.data.push(new Array(state.mapWidth).fill(null));
            }

            // OPTIMIZATION: Zero-allocation packed array instantiation for 2D Dual-Grid vertex grid ((H+1) x (W+1) -> 0)
            for (let y = 0; y <= state.mapHeight; y++) {
                layer.terrainVertices.push(new Array(state.mapWidth + 1).fill(0));
            }
        }
        return layer;
    }

    /**
     * Resets and initializes default map layers ("Base Layer" and "Details Layer")
     * alongside passability and region grids with zero-churn packed arrays.
     */
    function initMapData() {
        state.mapLayers = [];
        state.mapLayers.push(createNewLayerObject("Base Layer (Ground)"));
        state.mapLayers.push(createNewLayerObject("Details Layer (Decor)"));
        state.activeLayerIndex = 0;

        state.passabilityGrid = [];
        state.regionGrid = [];
        // OPTIMIZATION: Zero-allocation packed array fills for collision passability and region grids
        for (let y = 0; y < state.mapHeight; y++) {
            state.passabilityGrid.push(new Array(state.mapWidth).fill(0));
            state.regionGrid.push(new Array(state.mapWidth).fill(0));
        }
    }

    /**
     * Normalizes a slot mapping entry into an array of tile variations [{ tx, ty, rate, weight, locked, isBase }, ...].
     * Supports both single tile { tx, ty } and multi-tile variation arrays.
     */
    function getSlotVariations(mapping, slotKey) {
        if (!mapping || !mapping[slotKey]) return [];
        const entry = mapping[slotKey];
        let vars = [];
        if (Array.isArray(entry)) {
            vars = entry.filter(v => v && typeof v.tx === 'number' && typeof v.ty === 'number')
                        .map((v, idx) => ({
                            tx: v.tx,
                            ty: v.ty,
                            rate: typeof v.rate === 'number' ? v.rate : (v.weight !== undefined ? v.weight : (idx === 0 ? 100 : 20)),
                            weight: typeof v.weight === 'number' ? v.weight : (v.rate || 100),
                            locked: !!v.locked,
                            isBase: idx === 0
                        }));
        } else if (typeof entry.tx === 'number' && typeof entry.ty === 'number') {
            vars = [{
                tx: entry.tx,
                ty: entry.ty,
                rate: typeof entry.rate === 'number' ? entry.rate : (entry.weight || 100),
                weight: typeof entry.weight === 'number' ? entry.weight : 100,
                locked: false,
                isBase: true
            }];
        }

        if (vars.length > 0) {
            calculateVariationRates(vars);
        }
        return vars;
    }

    /**
     * Calculates and synchronizes Smart-Anchor Base rates and decorator thresholds.
     * The first element (index 0) is the Base Anchor and automatically absorbs:
     * BaseRate = max(0, 100 - sum(decoratorRates)).
     * 
     * @param {Array<Object>} variations - Array of variation objects.
     * @returns {number} The calculated Base Anchor percentage rate.
     */
    function calculateVariationRates(variations) {
        if (!variations || variations.length === 0) return 100;
        if (variations.length === 1) {
            variations[0].isBase = true;
            variations[0].rate = 100;
            variations[0].weight = 100;
            return 100;
        }

        variations[0].isBase = true;
        let decoratorSum = 0;
        for (let i = 1; i < variations.length; i++) {
            variations[i].isBase = false;
            const r = Math.max(0, Math.min(100, parseFloat(variations[i].rate) || 0));
            variations[i].rate = r;
            variations[i].weight = r; // Keep weight in sync
            decoratorSum += r;
        }

        // OPTIMIZATION: Pure numeric 4-decimal precision rounding eliminating string allocation and parseFloat churn
        const baseRate = Math.max(0, Math.min(100, Math.round((100 - decoratorSum) * 10000) / 10000));
        variations[0].rate = baseRate;
        variations[0].weight = baseRate;
        return baseRate;
    }

    /**
     * Factory function: Creates a new collection tileset object.
     * @param {string} [name] - Name for the collection tileset.
     * @returns {Object} Collection tileset object.
     */
    function createNewCollectionTileset(name) {
        const id = 'ts_coll_' + (state.tilesetIdCounter++);
        return {
            id: id,
            name: name || `Collection ${state.tilesetIdCounter}`,
            isCollection: true,
            images: [],
            activeImageId: null,
            tileProperties: {}
        };
    }

    /**
     * Adds an image entry to a collection tileset object.
     * @param {Object} tileset - Collection tileset object.
     * @param {string} name - Display name for the image asset.
     * @param {string} filename - Filename of source image asset.
     * @param {HTMLImageElement} imgElement - Loaded HTMLImageElement.
     * @param {string} [dataUrl] - Optional base64 data URL.
     * @param {string} [anchor='bottom-center'] - Anchor alignment ('bottom-center', 'bottom-left', 'center', 'top-left').
     * @param {number} [tileId] - Optional explicit local tile ID.
     * @returns {Object} The added collection image object.
     */
    function addCollectionImage(tileset, name, filename, imgElement, dataUrl, anchor = 'bottom-center', tileId = undefined) {
        if (!tileset || !tileset.isCollection) return null;

        const imgId = 'img_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
        const w = imgElement ? (imgElement.naturalWidth || imgElement.width || state.TILE_SIZE) : state.TILE_SIZE;
        const h = imgElement ? (imgElement.naturalHeight || imgElement.height || state.TILE_SIZE) : state.TILE_SIZE;

        const nextTileId = (typeof tileId === 'number') 
            ? tileId 
            : ((tileset.images && tileset.images.length > 0) 
                ? (Math.max(...tileset.images.map(i => typeof i.tileId === 'number' ? i.tileId : -1)) + 1) 
                : 0);

        const imgObj = {
            id: imgId,
            tileId: nextTileId,
            name: name || filename || `Image ${tileset.images.length + 1}`,
            filename: filename || `${name}.png`,
            width: w,
            height: h,
            colsSpan: Math.max(1, Math.ceil(w / state.TILE_SIZE)),
            rowsSpan: Math.max(1, Math.ceil(h / state.TILE_SIZE)),
            anchor: anchor, // 'bottom-center' | 'bottom-left' | 'center' | 'top-left'
            anchorOffsetX: 0,
            anchorOffsetY: 0,
            image: imgElement,
            dataUrl: dataUrl || '',
            tileProperties: {}
        };

        tileset.images.push(imgObj);
        if (!tileset.activeImageId) {
            tileset.activeImageId = imgId;
        }

        recomputeTilesetGids();
        return imgObj;
    }

    /**
     * Updates an existing image entry within a collection tileset (e.g. uploading a new version).
     * @param {Object} tileset - Collection tileset object.
     * @param {string} imageId - ID of image to update.
     * @param {HTMLImageElement} newImgElement - New loaded HTMLImageElement.
     * @param {string} [dataUrl] - New base64 data URL.
     * @param {string} [filename] - Optional new filename.
     * @returns {Object|null} The updated collection image object, or null if not found.
     */
    function updateCollectionImage(tileset, imageId, newImgElement, dataUrl, filename) {
        if (!tileset || !tileset.isCollection || !tileset.images) return null;
        const imgObj = tileset.images.find(img => img.id === imageId);
        if (!imgObj) return null;

        const w = newImgElement ? (newImgElement.naturalWidth || newImgElement.width || imgObj.width) : imgObj.width;
        const h = newImgElement ? (newImgElement.naturalHeight || newImgElement.height || imgObj.height) : imgObj.height;

        imgObj.image = newImgElement;
        if (dataUrl) imgObj.dataUrl = dataUrl;
        if (filename) {
            imgObj.filename = filename;
            if (!imgObj.name || imgObj.name.startsWith('Image ')) {
                imgObj.name = filename.replace(/\.[^/.]+$/, "");
            }
        }
        imgObj.width = w;
        imgObj.height = h;
        imgObj.colsSpan = Math.max(1, Math.ceil(w / state.TILE_SIZE));
        imgObj.rowsSpan = Math.max(1, Math.ceil(h / state.TILE_SIZE));

        return imgObj;
    }

    /**
     * Removes an image entry from a collection tileset object.
     * @param {Object} tileset - Collection tileset object.
     * @param {string} imageId - ID of image to remove.
     */
    function removeCollectionImage(tileset, imageId) {
        if (!tileset || !tileset.isCollection || !tileset.images) return;
        const idx = tileset.images.findIndex(img => img.id === imageId);
        if (idx >= 0) {
            tileset.images.splice(idx, 1);
            if (tileset.activeImageId === imageId) {
                tileset.activeImageId = tileset.images.length > 0 ? tileset.images[0].id : null;
            }
            recomputeTilesetGids();
        }
    }

    /**
     * Dynamically recomputes `firstgid` for all tilesets in `state.tilesets`
     * to ensure contiguous, non-overlapping GID allocations across standard spritesheets and image collections.
     */
    function recomputeTilesetGids() {
        if (!state.tilesets || state.tilesets.length === 0) return;
        let currentGid = 1;
        state.tilesets.forEach(ts => {
            ts.firstgid = currentGid;
            if (ts.isCollection) {
                const maxTileId = (ts.images && ts.images.length > 0)
                    ? Math.max(...ts.images.map(i => typeof i.tileId === 'number' ? i.tileId : 0))
                    : 0;
                const count = (ts.images && ts.images.length > 0)
                    ? Math.max(ts.images.length, maxTileId + 1)
                    : 1;
                currentGid += count;
            } else if (ts.image && ts.image.width > 0) {
                const tw = ts.tilewidth || state.TILE_SIZE;
                const th = ts.tileheight || state.TILE_SIZE;
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const cols = ts.columns !== undefined ? ts.columns : Math.max(1, Math.floor((ts.image.width - margin) / (tw + spacing)));
                const rows = Math.max(1, Math.floor((ts.image.height - margin) / (th + spacing)));
                const count = ts.tilecount !== undefined ? ts.tilecount : (cols * rows);
                currentGid += count;
            } else {
                currentGid += (ts.tilecount || 1);
            }
        });
    }

    /**
     * Resolves a raw GID integer (stripping bitwise flip flags) to its corresponding parent tileset object.
     * @param {number} rawGid - Raw GID integer from layer cell or object.
     * @returns {Object|null} Matching tileset object, or null if none found.
     */
    function getTilesetForGid(rawGid) {
        if (!rawGid || !state.tilesets || state.tilesets.length === 0) return null;
        const gid = (rawGid >>> 0) & 0x1FFFFFFF;
        let matchedTs = state.tilesets[0];
        for (let tsIdx = state.tilesets.length - 1; tsIdx >= 0; tsIdx--) {
            const ts = state.tilesets[tsIdx];
            const fg = ts.firstgid !== undefined ? ts.firstgid : 1;
            if (gid >= fg) {
                matchedTs = ts;
                break;
            }
        }
        return matchedTs;
    }

    /**
     * Factory function: Creates a new AssetRecord object.
     * @param {string} name - Display name of the asset.
     * @param {string} filename - Original filename.
     * @param {HTMLImageElement} imgElement - Loaded HTMLImageElement.
     * @param {string} [dataUrl] - Optional base64 data URL.
     * @param {number} [sizeBytes=0] - Optional file size in bytes.
     * @param {string} [mimeType='image/png'] - MIME type.
     * @param {Array<string>} [tags=[]] - User tags.
     * @param {Array<string>} [assignedTilesetIds=[]] - Linked tileset IDs.
     * @returns {Object} Newly created AssetRecord.
     */
    function createNewAssetRecord(name, filename, imgElement, dataUrl = '', sizeBytes = 0, mimeType = 'image/png', tags = [], assignedTilesetIds = []) {
        const id = 'asset_' + (state.assetIdCounter++) + '_' + Math.random().toString(36).substring(2, 7);
        const cleanName = name || (filename ? filename.replace(/\.[^/.]+$/, "") : `Asset ${state.assetIdCounter}`);
        const cleanFilename = filename || `${cleanName}.png`;
        const w = imgElement ? (imgElement.naturalWidth || imgElement.width || 32) : 32;
        const h = imgElement ? (imgElement.naturalHeight || imgElement.height || 32) : 32;
        const relPath = (cleanFilename.startsWith('assets/') || cleanFilename.includes('/') || cleanFilename.includes(':'))
            ? cleanFilename
            : `assets/${cleanFilename}`;

        return {
            id: id,
            name: cleanName,
            filename: cleanFilename,
            relativePath: relPath,
            width: w,
            height: h,
            sizeBytes: sizeBytes || Math.round(w * h * 4 * 0.4), // Estimation fallback if not provided
            mimeType: mimeType || 'image/png',
            dataUrl: dataUrl || (imgElement && imgElement.src && imgElement.src.startsWith('data:') ? imgElement.src : ''),
            image: imgElement || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: Array.isArray(tags) ? [...tags] : [],
            assignedTilesetIds: Array.isArray(assignedTilesetIds) ? [...assignedTilesetIds] : []
        };
    }

    /**
     * Adds an AssetRecord to the master state assets vault.
     * @param {Object} assetRecord - AssetRecord to add.
     * @returns {Object} Added asset record.
     */
    function addAssetToState(assetRecord) {
        if (!assetRecord) return null;
        if (!state.assets) state.assets = [];
        
        const existingIdx = state.assets.findIndex(a => a.id === assetRecord.id);
        if (existingIdx >= 0) {
            state.assets[existingIdx] = assetRecord;
        } else {
            state.assets.push(assetRecord);
        }

        if (!state.activeAssetId) {
            state.activeAssetId = assetRecord.id;
        }

        // Automatic Reconnection: Check if any existing placeholder tilesets or collection images are waiting for this asset
        if (state.tilesets && state.tilesets.length > 0) {
            let reconnectedCount = 0;
            const rawAssetFilename = assetRecord.filename || '';
            const assetFilename = rawAssetFilename.split('/').pop().split('\\').pop().toLowerCase();
            const assetName = (assetRecord.name || '').toLowerCase();
            const assetBase = assetFilename.replace(/\.[^/.]+$/, "");

            state.tilesets.forEach(ts => {
                if (!ts.isCollection) {
                    const rawTsFilename = ts.filename || `${ts.name}.png`;
                    const tsFilename = rawTsFilename.split('/').pop().split('\\').pop().toLowerCase();
                    const tsName = (ts.name || '').toLowerCase();
                    const tsBase = tsFilename.replace(/\.[^/.]+$/, "");

                    const matches = (tsFilename === assetFilename) || 
                                    (tsName === assetName) || 
                                    (tsBase === assetBase) ||
                                    (ts.assetId === assetRecord.id) ||
                                    (assetRecord.assignedTilesetIds && assetRecord.assignedTilesetIds.includes(ts.id));

                    if (matches && (ts.isMissing || !ts.assetId || ts.image !== assetRecord.image)) {
                        ts.image = assetRecord.image;
                        ts.assetId = assetRecord.id;
                        ts.isMissing = false;
                        ts.filename = assetRecord.filename || ts.filename;

                        const newW = assetRecord.width || (assetRecord.image ? assetRecord.image.width : 160);
                        const newH = assetRecord.height || (assetRecord.image ? assetRecord.image.height : 160);
                        ts.columns = Math.max(1, Math.floor((newW - (ts.margin || 0)) / ((ts.tilewidth || state.TILE_SIZE) + (ts.spacing || 0))));
                        ts.tilecount = ts.columns * Math.max(1, Math.floor((newH - (ts.margin || 0)) / ((ts.tileheight || state.TILE_SIZE) + (ts.spacing || 0))));

                        if (!assetRecord.assignedTilesetIds) assetRecord.assignedTilesetIds = [];
                        if (!assetRecord.assignedTilesetIds.includes(ts.id)) assetRecord.assignedTilesetIds.push(ts.id);
                        reconnectedCount++;
                    }
                } else if (ts.isCollection && ts.images) {
                    ts.images.forEach(imgObj => {
                        const rawImgFilename = imgObj.filename || `${imgObj.name}.png`;
                        const imgFilename = rawImgFilename.split('/').pop().split('\\').pop().toLowerCase();
                        const imgName = (imgObj.name || '').toLowerCase();
                        const imgBase = imgFilename.replace(/\.[^/.]+$/, "");

                        const matches = (imgFilename === assetFilename) || 
                                        (imgName === assetName) || 
                                        (imgBase === assetBase) ||
                                        (imgObj.assetId && imgObj.assetId === assetRecord.id);

                        if (matches && (imgObj.isMissing || !imgObj.assetId || imgObj.image !== assetRecord.image)) {
                            imgObj.image = assetRecord.image;
                            imgObj.dataUrl = assetRecord.dataUrl;
                            imgObj.assetId = assetRecord.id;
                            imgObj.isMissing = false;
                            imgObj.filename = assetRecord.filename || imgObj.filename;
                            imgObj.width = assetRecord.width || (assetRecord.image ? assetRecord.image.width : state.TILE_SIZE);
                            imgObj.height = assetRecord.height || (assetRecord.image ? assetRecord.image.height : state.TILE_SIZE);
                            imgObj.colsSpan = Math.max(1, Math.ceil(imgObj.width / state.TILE_SIZE));
                            imgObj.rowsSpan = Math.max(1, Math.ceil(imgObj.height / state.TILE_SIZE));

                            if (!assetRecord.assignedTilesetIds) assetRecord.assignedTilesetIds = [];
                            if (!assetRecord.assignedTilesetIds.includes(ts.id)) assetRecord.assignedTilesetIds.push(ts.id);
                            reconnectedCount++;
                        }
                    });
                }
            });

            if (reconnectedCount > 0) {
                const tw = window.TileWeaver || window.TileWeaver;
                if (tw && tw.stateModule && tw.stateModule.recomputeTilesetGids) {
                    tw.stateModule.recomputeTilesetGids();
                }
                if (tw && tw.rendering) {
                    if (tw.rendering.drawTileset) tw.rendering.drawTileset();
                    if (tw.rendering.drawMap) tw.rendering.drawMap();
                }
                if (tw && tw.tilesetManager && tw.tilesetManager.renderTilesetSelect) {
                    tw.tilesetManager.renderTilesetSelect();
                }
                if (tw && tw.toast && tw.toast.showMessage) {
                    tw.toast.showMessage(`Connected texture '${assetRecord.filename}' to map tilesets!`, "success");
                }
            }
        }

        return assetRecord;
    }

    /**
     * Removes an asset record from state.
     * @param {string} assetId - ID of asset to remove.
     * @returns {boolean} True if removed.
     */
    function removeAssetFromState(assetId) {
        if (!state.assets) return false;
        const idx = state.assets.findIndex(a => a.id === assetId);
        if (idx >= 0) {
            state.assets.splice(idx, 1);
            if (state.activeAssetId === assetId) {
                state.activeAssetId = state.assets.length > 0 ? state.assets[0].id : null;
            }
            return true;
        }
        return false;
    }

    /**
     * Updates an existing asset record with new image data (e.g. during hot-swapping).
     * @param {string} assetId - ID of asset to update.
     * @param {HTMLImageElement} newImgElement - New loaded HTMLImageElement.
     * @param {string} [newDataUrl] - New base64 data URL.
     * @param {string} [newFilename] - Optional new filename.
     * @returns {Object|null} Updated asset record or null.
     */
    function updateAssetInState(assetId, newImgElement, newDataUrl, newFilename) {
        if (!state.assets) return null;
        const asset = state.assets.find(a => a.id === assetId);
        if (!asset) return null;

        if (newImgElement) {
            asset.image = newImgElement;
            asset.width = newImgElement.naturalWidth || newImgElement.width || asset.width;
            asset.height = newImgElement.naturalHeight || newImgElement.height || asset.height;
        }
        if (newDataUrl) {
            asset.dataUrl = newDataUrl;
        }
        if (newFilename) {
            asset.filename = newFilename;
            asset.name = newFilename.replace(/\.[^/.]+$/, "");
            asset.relativePath = (newFilename.startsWith('assets/') || newFilename.includes('/') || newFilename.includes(':'))
                ? newFilename
                : `assets/${newFilename}`;
        }
        asset.updatedAt = new Date().toISOString();
        return asset;
    }

    /**
     * Retrieves an asset record by its ID.
     * @param {string} assetId - Asset identifier.
     * @returns {Object|null}
     */
    function getAssetById(assetId) {
        if (!state.assets || !assetId) return null;
        return state.assets.find(a => a.id === assetId) || null;
    }

    /**
     * Computes the real-time dependency graph and usage statistics for an asset.
     * @param {string} assetId - Asset identifier.
     * @returns {Object} Usage report { tilesets, autotiles, layers, placedTilesCount, isUsed }
     */
    function getAssetUsage(assetId) {
        const result = {
            tilesets: [],
            autotiles: [],
            layers: [],
            placedTilesCount: 0,
            isUsed: false
        };

        if (!assetId || !state.assets) return result;
        const asset = state.assets.find(a => a.id === assetId);
        if (!asset) return result;

        // 1. Find all referencing Tilesets (Standard spritesheets & Collection images)
        if (state.tilesets) {
            state.tilesets.forEach(ts => {
                let isLinked = false;
                if (ts.assetId === assetId || (ts.filename && ts.filename === asset.filename) || (asset.assignedTilesetIds && asset.assignedTilesetIds.includes(ts.id))) {
                    isLinked = true;
                }
                if (ts.isCollection && ts.images) {
                    const matchedImg = ts.images.find(img => img.assetId === assetId || img.id === assetId || img.filename === asset.filename);
                    if (matchedImg) {
                        isLinked = true;
                    }
                }
                if (isLinked && !result.tilesets.some(t => t.id === ts.id)) {
                    result.tilesets.push({
                        id: ts.id,
                        name: ts.name,
                        isCollection: !!ts.isCollection
                    });
                }
            });
        }

        // 2. Find all Autotiles referencing linked tilesets
        const linkedTilesetIds = new Set(result.tilesets.map(t => t.id));
        if (state.autotiles) {
            state.autotiles.forEach(at => {
                if (linkedTilesetIds.has(at.tilesetId)) {
                    result.autotiles.push({
                        id: at.id,
                        name: at.name,
                        mode: at.mode || '9slice'
                    });
                }
            });
        }

        // 3. Count placed tiles & objects across all map layers referencing this asset
        if (state.mapLayers) {
            state.mapLayers.forEach(layer => {
                let countInLayer = 0;
                if (layer.type === 'tilelayer' && layer.data) {
                    for (let y = 0; y < state.mapHeight; y++) {
                        for (let x = 0; x < state.mapWidth; x++) {
                            const tile = layer.data[y] ? layer.data[y][x] : null;
                            if (tile && linkedTilesetIds.has(tile.tilesetId)) {
                                countInLayer++;
                            }
                        }
                    }
                } else if (layer.type === 'objectgroup' && layer.objects) {
                    layer.objects.forEach(obj => {
                        if (obj.assetId === assetId || (obj.imageId && obj.imageId === assetId) || (obj.tilesetId && linkedTilesetIds.has(obj.tilesetId))) {
                            countInLayer++;
                        }
                    });
                }

                if (countInLayer > 0) {
                    result.layers.push({
                        id: layer.id,
                        name: layer.name,
                        type: layer.type,
                        placedCount: countInLayer
                    });
                    result.placedTilesCount += countInLayer;
                }
            });
        }

        result.isUsed = result.tilesets.length > 0 || result.layers.length > 0 || result.placedTilesCount > 0;
        return result;
    }

    /**
     * Synchronizes existing tilesets and collection images into state.assets.
     * Ensures all initial, procedural, and imported tilesets have corresponding AssetRecord entries.
     */
    function syncAssetsFromExistingTilesets() {
        if (!state.assets) state.assets = [];

        if (state.tilesets && state.tilesets.length > 0) {
            state.tilesets.forEach(ts => {
                if (ts.isMissing) return; // Never index missing/placeholder tilesets into Vault

                if (ts.isCollection && ts.images && ts.images.length > 0) {
                    ts.images.forEach(imgObj => {
                        if (imgObj.isMissing || !imgObj.image) return;

                        let existing = state.assets.find(a => 
                            a.id === imgObj.assetId || 
                            a.id === imgObj.id || 
                            (a.filename && a.filename.toLowerCase() === (imgObj.filename || '').toLowerCase()) ||
                            (a.name === imgObj.name && a.width === imgObj.width && a.height === imgObj.height)
                        );
                        if (!existing) {
                            const rec = createNewAssetRecord(
                                imgObj.name,
                                imgObj.filename,
                                imgObj.image,
                                imgObj.dataUrl || '',
                                0,
                                'image/png',
                                ['prop', 'collection'],
                                [ts.id]
                            );
                            rec.id = imgObj.assetId || ('asset_' + imgObj.id);
                            imgObj.assetId = rec.id;
                            addAssetToState(rec);
                        } else {
                            imgObj.assetId = existing.id;
                            if (!existing.assignedTilesetIds.includes(ts.id)) {
                                existing.assignedTilesetIds.push(ts.id);
                            }
                            if (!existing.image && imgObj.image) existing.image = imgObj.image;
                            if (!existing.dataUrl && imgObj.dataUrl) existing.dataUrl = imgObj.dataUrl;
                        }
                    });
                } else if (!ts.isCollection && ts.image) {
                    let existing = state.assets.find(a => 
                        a.id === ts.assetId || 
                        (a.filename && a.filename.toLowerCase() === (ts.filename || '').toLowerCase()) ||
                        (a.name === ts.name && a.width === ts.image.width && a.height === ts.image.height)
                    );
                    if (!existing) {
                        const rec = createNewAssetRecord(
                            ts.name,
                            ts.filename || `${ts.name}.png`,
                            ts.image,
                            ts.image.src && ts.image.src.startsWith('data:') ? ts.image.src : '',
                            0,
                            'image/png',
                            ['tileset', 'spritesheet'],
                            [ts.id]
                        );
                        ts.assetId = rec.id;
                        addAssetToState(rec);
                    } else {
                        ts.assetId = existing.id;
                        if (!existing.assignedTilesetIds.includes(ts.id)) {
                            existing.assignedTilesetIds.push(ts.id);
                        }
                        if (!existing.image && ts.image) existing.image = ts.image;
                    }
                }
            });
        }

        if (!state.activeAssetId && state.assets.length > 0) {
            state.activeAssetId = state.assets[0].id;
        }
    }

    /**
     * Generates a guaranteed globally unique autotile ID (e.g. 'at_1', 'at_2', 'at_8', ...).
     * Inspects all existing state.autotiles to ensure no duplicate ID collisions.
     * @returns {string} Unique autotile ID.
     */
    function generateUniqueAutotileId() {
        let maxId = 0;
        if (state.autotiles && Array.isArray(state.autotiles)) {
            state.autotiles.forEach(at => {
                if (at && typeof at.id === 'string') {
                    // OPTIMIZATION: Utilizing module-scoped pre-compiled regex
                    const match = at.id.match(AUTOTILE_ID_REGEX);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num > maxId) maxId = num;
                    }
                }
            });
        }
        const nextNum = Math.max(state.autotileCounter || 1, maxId + 1);
        state.autotileCounter = nextNum + 1;
        return 'at_' + nextNum;
    }

    /**
     * Scans state.autotiles and deduplicates any conflicting autotile IDs.
     */
    function sanitizeAutotileIds() {
        if (!state.autotiles || !Array.isArray(state.autotiles)) return;
        const seen = new Set();
        let maxId = 0;

        // First pass: find max ID
        state.autotiles.forEach(at => {
            if (at && typeof at.id === 'string') {
                // OPTIMIZATION: Utilizing module-scoped pre-compiled regex
                const match = at.id.match(AUTOTILE_ID_REGEX);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxId) maxId = num;
                }
            }
        });

        // Second pass: fix duplicates
        state.autotiles.forEach(at => {
            if (!at) return;
            if (!at.id || seen.has(at.id)) {
                maxId++;
                const oldId = at.id;
                const newId = 'at_' + maxId;
                at.id = newId;
                // Update references in state.materials
                if (state.materials && Array.isArray(state.materials)) {
                    state.materials.forEach(mat => {
                        if (mat.autotileIds && Array.isArray(mat.autotileIds)) {
                            const idx = mat.autotileIds.indexOf(oldId);
                            if (idx !== -1) mat.autotileIds[idx] = newId;
                        }
                    });
                }
            }
            seen.add(at.id);
        });

        state.autotileCounter = Math.max(state.autotileCounter || 1, maxId + 1);
    }

    // Expose state and initializers on universal root namespace
    root.TileWeaver.stateModule = {
        state,
        createNewLayerObject,
        initMapData,
        getSlotVariations,
        calculateVariationRates,
        createNewCollectionTileset,
        addCollectionImage,
        updateCollectionImage,
        removeCollectionImage,
        recomputeTilesetGids,
        getTilesetForGid,
        createNewAssetRecord,
        addAssetToState,
        removeAssetFromState,
        updateAssetInState,
        getAssetById,
        getAssetUsage,
        syncAssetsFromExistingTilesets,
        generateUniqueAutotileId,
        sanitizeAutotileIds
    };
    root.TileWeaver.state = state;
    root.TileWeaver.stateModule = root.TileWeaver.stateModule;
    root.TileWeaver.state = root.TileWeaver.state;
})();
