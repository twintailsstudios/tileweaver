/**
 * @fileoverview TileWeaver - Export & Import System (Tiled JSON & Assets Folder Specification)
 * @subsystem Export, Import & Serialization Engine
 * @frameBudget 0.0ms (Asynchronous / Non-blocking to 60 FPS requestAnimationFrame loop)
 * @coordinateSpace 2D Tile Grid Matrix (x, y) <-> 1D Tiled GID Array (y * mapWidth + x)
 * @stateInvariants Single-source-of-truth state mutations; dimensions clamped to (0 <= x < mapWidth, 0 <= y < mapHeight); passabilityGrid & regionGrid array dimensions strictly preserved
 * @historyTracked Push history snapshot via history.pushHistoryState() before map ingestion
 * @exportCompatibility Tiled TMJ 1.10+, Native JSON v3.3, 32-bit GID transformation bitflags (0x80000000 H-flip, 0x40000000 V-flip, 0x20000000 diagonal flip)
 * ---------------------------------------------------------------------------------
 * Manages map file downloads, Tiled JSON format conversions, and assets folder image matching:
 * 1. Tiled JSON Map (.json / .tmj): Standard Tiled map format with embedded tilesets,
 *    embedded terrain sets (wangsets), custom gameplay properties, autotile definitions,
 *    animated tiles, passability grid, region IDs, dual-grid terrain vertices, and
 *    bitmask flip/rotation GID flags (0x80000000 H-flip, 0x40000000 V-flip, 0x20000000 diagonal flip).
 * 2. Native JSON v3.3: Complete project state backup format.
 * 3. PNG Image Render: Renders multi-layer map composite onto a downloadable PNG canvas.
 * 4. Tiled Map Importer: Parses uploaded map files, matches embedded tileset images against
 *    the root `assets/` folder, restores all tileset/terrain settings, and recreates the exact map.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawTileTransformed } = window.TileWeaver.rendering;

    // OPTIMIZATION: Reusable scratch canvas pool for base64 dataUrl extraction without GC DOM element churn
    let _sharedScratchCanvas = null;

    /**
     * Retrieves or resizes the shared offscreen scratch canvas.
     * @param {number} width - Desired canvas width
     * @param {number} height - Desired canvas height
     * @returns {HTMLCanvasElement|null} Reusable canvas instance
     */
    function getScratchCanvas(width, height) {
        if (!_sharedScratchCanvas && typeof document !== 'undefined') {
            _sharedScratchCanvas = document.createElement('canvas');
        }
        if (_sharedScratchCanvas) {
            _sharedScratchCanvas.width = Math.max(1, width || 32);
            _sharedScratchCanvas.height = Math.max(1, height || 32);
            const ctx = _sharedScratchCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, _sharedScratchCanvas.width, _sharedScratchCanvas.height);
        }
        return _sharedScratchCanvas;
    }

    /**
     * Converts an HTMLImageElement to base64 data URL using the shared scratch canvas pool.
     * @param {HTMLImageElement} img - Source image element
     * @param {string} [mimeType='image/png'] - Image MIME format
     * @returns {string} Base64 data URL string
     */
    function imageToDataUrl(img, mimeType = 'image/png') {
        if (!img || img.width <= 0) return '';
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        try {
            const c = getScratchCanvas(w, h) || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
            if (!c) return (img.src && !img.src.startsWith('blob:')) ? img.src : '';
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                return c.toDataURL(mimeType);
            }
        } catch (e) {}
        return (img.src && !img.src.startsWith('blob:')) ? img.src : '';
    }

    /**
     * Helper: Triggers browser file download prompt for generated content string.
     * @param {string} content - Raw text/json payload
     * @param {string} fileName - Destination filename
     * @param {string} contentType - MIME type header
     */
    function downloadFile(content, fileName, contentType) {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        // INVARIANT: Explicitly release memory reference immediately after click dispatch
        URL.revokeObjectURL(a.href);
    }

    /**
     * Helper: Promise wrapper to load HTMLImageElement asynchronously.
     * @param {string} src - Image source URI or data URL
     * @returns {Promise<HTMLImageElement>} Resolved loaded image
     */
    function loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http') && typeof src === 'string' && !src.startsWith('data:')) {
                img.crossOrigin = "anonymous";
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = src;
        });
    }

    /**
     * Helper: Generates a lightweight placeholder HTMLImageElement for missing or virtual assets.
     * @param {number} [w=32] - Placeholder width
     * @param {number} [h=32] - Placeholder height
     * @param {string} [label=''] - Optional debug label
     * @returns {HTMLImageElement} Virtual placeholder image
     */
    function createPlaceholderImage(w = 32, h = 32, label = '') {
        const c = document.createElement('canvas');
        c.width = Math.max(16, w || 32);
        c.height = Math.max(16, h || 32);
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(51, 65, 85, 0.4)';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, c.width, c.height);
        const img = new Image();
        img.src = c.toDataURL('image/png');
        return img;
    }

    /**
     * Exports full TileWeaver Native JSON v3.3 format.
     */
    function exportNativeJSON() {
        const exportData = {
            version: 3.3,
            tileSize: state.TILE_SIZE,
            mapWidth: state.mapWidth,
            mapHeight: state.mapHeight,
            tilesets: (state.tilesets || []).map(t => ({
                id: t.id,
                name: t.name,
                isCollection: !!t.isCollection,
                activeImageId: t.activeImageId || null,
                filename: t.filename || `${t.name}.png`,
                assetId: t.assetId || null,
                margin: t.margin || 0,
                spacing: t.spacing || 0,
                tilewidth: t.tilewidth || state.TILE_SIZE,
                tileheight: t.tileheight || state.TILE_SIZE,
                columns: t.columns || (t.image ? Math.floor((t.image.width - (t.margin || 0)) / ((t.tilewidth || state.TILE_SIZE) + (t.spacing || 0))) : 0),
                tilecount: t.tilecount || 0,
                firstgid: t.firstgid || 1,
                tileProperties: t.tileProperties || {},
                objectalignment: t.objectalignment,
                fillmode: t.fillmode,
                tilerendersize: t.tilerendersize,
                grid: t.grid,
                images: t.isCollection && t.images ? t.images.map(img => {
                    let imgDataUrl = img.dataUrl || '';
                    if (!imgDataUrl && img.image && img.image.width > 0) {
                        imgDataUrl = imageToDataUrl(img.image, 'image/png');
                    }
                    return {
                        id: img.id,
                        tileId: img.tileId,
                        assetId: img.assetId || null,
                        name: img.name,
                        filename: img.filename,
                        width: img.width,
                        height: img.height,
                        colsSpan: img.colsSpan,
                        rowsSpan: img.rowsSpan,
                        anchor: img.anchor,
                        anchorOffsetX: img.anchorOffsetX,
                        anchorOffsetY: img.anchorOffsetY,
                        tileProperties: img.tileProperties || {},
                        dataUrl: imgDataUrl
                    };
                }) : []
            })),
            assets: (state.assets || []).map(a => {
                let dataUrl = a.dataUrl || '';
                if (!dataUrl && a.image && a.image.width > 0) {
                    dataUrl = imageToDataUrl(a.image, a.mimeType || 'image/png');
                }
                return {
                    id: a.id,
                    name: a.name,
                    filename: a.filename,
                    relativePath: a.relativePath || `assets/${a.filename}`,
                    width: a.width,
                    height: a.height,
                    sizeBytes: a.sizeBytes || 0,
                    mimeType: a.mimeType || 'image/png',
                    tags: a.tags || [],
                    assignedTilesetIds: a.assignedTilesetIds || [],
                    createdAt: a.createdAt || new Date().toISOString(),
                    updatedAt: a.updatedAt || new Date().toISOString(),
                    dataUrl: dataUrl
                };
            }),
            autotiles: state.autotiles,
            animatedTiles: state.animatedTiles,
            materials: state.materials,
            layers: state.mapLayers,
            passabilityGrid: state.passabilityGrid,
            regionGrid: state.regionGrid
        };
        (window.TileWeaver.exportImport.downloadFile || downloadFile)(JSON.stringify(exportData, null, 2), "map_export.json", "application/json");
        showMessage("Exported TileWeaverject File (map_export.json)", "success");
    }

    /**
     * Exports Universal Game Engine JSON map format (.json / .tmj).
     * Embeds all tilesets, collection tilesets, terrain sets (wangsets), autotile definitions, tile gameplay properties,
     * animated tiles, passability grid, region IDs, and dual-grid terrain vertices.
     * Calculates bitwise transformation masks for flipped/rotated tiles:
     * - Horizontal Flip: 0x80000000
     * - Vertical Flip:   0x40000000
     * - Diagonal Flip:   0x20000000 (used for 90° / 270° rotation)
     * @param {string} [filename="map_game_engine.json"] - Output TMJ filename
     */
    function exportTiledTMJ(filename = "map_game_engine.json") {
        let currentGid = 1;
        const tilesetMeta = (state.tilesets || []).map(ts => {
            const firstgid = ts.firstgid !== undefined ? ts.firstgid : currentGid;

            if (ts.isCollection) {
                const imageCount = ts.images ? ts.images.length : 0;
                const tilecount = ts.tilecount !== undefined ? ts.tilecount : imageCount;
                currentGid = firstgid + Math.max(1, tilecount);

                let maxW = ts.tilewidth || state.TILE_SIZE;
                let maxH = ts.tileheight || state.TILE_SIZE;
                if (ts.images && ts.images.length > 0) {
                    ts.images.forEach(img => {
                        if (img.width && img.width > maxW) maxW = img.width;
                        if (img.height && img.height > maxH) maxH = img.height;
                    });
                }

                const tilesArr = ts.images ? ts.images.map((img, idx) => {
                    const propList = [
                        { name: "imageId", type: "string", value: img.id },
                        { name: "name", type: "string", value: img.name },
                        { name: "anchor", type: "string", value: img.anchor || "bottom-center" },
                        { name: "__imageData", type: "string", value: img.dataUrl || (img.image ? img.image.src : '') }
                    ];

                    const sourceProps = img.tileProperties || (ts.tileProperties ? ts.tileProperties[img.id] : null) || {};
                    const metaKeys = new Set(['imageId', 'name', 'anchor', '__imageData', 'filename', 'imagePath']);

                    if (sourceProps.custom && typeof sourceProps.custom === 'object') {
                        Object.entries(sourceProps.custom).forEach(([k, v]) => {
                            if (!metaKeys.has(k) && !propList.some(p => p.name === k)) {
                                propList.push({
                                    name: k,
                                    type: typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'boolean' ? 'bool' : 'string',
                                    value: v
                                });
                            }
                        });
                    }
                    Object.entries(sourceProps).forEach(([k, v]) => {
                        if (k !== 'custom' && !metaKeys.has(k) && typeof v !== 'object' && !propList.some(p => p.name === k)) {
                            propList.push({
                                name: k,
                                type: typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'boolean' ? 'bool' : 'string',
                                value: v
                            });
                        }
                    });

                    return {
                        id: img.tileId !== undefined ? img.tileId : idx,
                        image: img.imagePath || (img.filename ? (img.filename.startsWith('assets/') || img.filename.includes('/') || img.filename.includes(':') ? img.filename : `assets/${img.filename}`) : `assets/${img.name}.png`),
                        imagewidth: img.width,
                        imageheight: img.height,
                        properties: propList
                    };
                }) : [];

                const collEntry = {
                    firstgid,
                    name: ts.name,
                    tilewidth: maxW,
                    tileheight: maxH,
                    margin: ts.margin || 0,
                    spacing: ts.spacing || 0,
                    columns: ts.columns !== undefined ? ts.columns : 0, // 0 signifies Collection of Images in Tiled 1.10 spec
                    tilecount: tilecount,
                    properties: [
                        { name: "tilesetId", type: "string", value: ts.id },
                        { name: "isCollection", type: "bool", value: true }
                    ],
                    tiles: tilesArr
                };

                if (ts.objectalignment) collEntry.objectalignment = ts.objectalignment;
                if (ts.fillmode) collEntry.fillmode = ts.fillmode;
                if (ts.tilerendersize) collEntry.tilerendersize = ts.tilerendersize;
                if (ts.grid) collEntry.grid = ts.grid;

                return collEntry;
            }

            const margin = ts.margin || 0;
            const spacing = ts.spacing || 0;
            const tw = ts.tilewidth || state.TILE_SIZE;
            const th = ts.tileheight || state.TILE_SIZE;

            const cols = ts.columns !== undefined ? ts.columns : (ts.image ? Math.floor((ts.image.width - margin) / (tw + spacing)) : 1);
            const rows = ts.image ? Math.floor((ts.image.height - margin) / (th + spacing)) : 1;
            const tilecount = ts.tilecount !== undefined ? ts.tilecount : (cols * rows);
            currentGid = firstgid + tilecount;

            // Generate asset relative image path referencing original path or assets/ folder
            let imagePath = '';
            if (ts.imagePath) {
                imagePath = ts.imagePath;
            } else {
                const cleanFilename = ts.filename || (ts.name.toLowerCase().replace(/\s+/g, '_') + '.png');
                imagePath = (cleanFilename.startsWith('assets/') || cleanFilename.includes('/') || cleanFilename.includes(':')) ? cleanFilename : `assets/${cleanFilename}`;
            }

            // Optional base64 image data fallback
            let imageData = '';
            if (ts.image && ts.image.width > 0) {
                imageData = imageToDataUrl(ts.image, 'image/png');
            }

            // Build individual tile entries for animations and tile properties
            const tilesArr = [];
            
            // 1. Export Animated Tiles belonging to this tileset
            const animsForTs = (state.animatedTiles || []).filter(a => a.tilesetId === ts.id);
            animsForTs.forEach(anim => {
                if (anim.frames && anim.frames.length > 0) {
                    const localId = anim.frames[0].ty * cols + anim.frames[0].tx;
                    const animFrames = anim.frames.map(f => ({
                        duration: anim.frameDurationMs || 250,
                        tileid: f.ty * cols + f.tx
                    }));
                    tilesArr.push({
                        id: localId,
                        animation: animFrames,
                        properties: [
                            { name: "animId", type: "string", value: anim.id },
                            { name: "animName", type: "string", value: anim.name }
                        ]
                    });
                }
            });

            // 2. Export Tile Gameplay Properties (from Tile Properties Inspector)
            if (ts.tileProperties) {
                Object.entries(ts.tileProperties).forEach(([key, props]) => {
                    const [txStr, tyStr] = key.split('_');
                    const tx = parseInt(txStr);
                    const ty = parseInt(tyStr);
                    const localId = ty * cols + tx;
                    let existing = tilesArr.find(t => t.id === localId);
                    if (!existing) {
                        existing = { id: localId, properties: [] };
                        tilesArr.push(existing);
                    }
                    existing.properties = existing.properties || [];
                    Object.entries(props).forEach(([pName, pVal]) => {
                        if (!existing.properties.some(p => p.name === pName)) {
                            existing.properties.push({
                                name: pName,
                                type: typeof pVal === 'number' ? 'int' : typeof pVal === 'boolean' ? 'bool' : 'string',
                                value: pVal
                            });
                        }
                    });
                });
            }

            // 3. Export preserved tile definitions (probability, custom tile metadata)
            if (ts.tiles && Array.isArray(ts.tiles)) {
                ts.tiles.forEach(t => {
                    let existing = tilesArr.find(x => x.id === t.id);
                    if (!existing) {
                        tilesArr.push(t);
                    } else {
                        if (t.probability !== undefined && existing.probability === undefined) {
                            existing.probability = t.probability;
                        }
                    }
                });
            }

            // 4. Export Tiled WangSets (Terrain Sets) representing autotiles & dual-grid materials
            const wangsets = [];
            const autotilesForTs = (state.autotiles || []).filter(a => a.tilesetId === ts.id);
            autotilesForTs.forEach(at => {
                const wangcolors = [];
                if (at.mat1Name) wangcolors.push({ name: at.mat1Name, color: "#22c55e", tile: 0 });
                if (at.mat2Name) wangcolors.push({ name: at.mat2Name, color: "#d97706", tile: 0 });
                wangsets.push({
                    name: at.name,
                    type: at.mode === 'dualgrid' ? 'corner' : 'mixed',
                    tile: 0,
                    wangcolors: wangcolors,
                    properties: [
                        { name: "autotileId", type: "string", value: at.id },
                        { name: "mode", type: "string", value: at.mode || "9slice" },
                        { name: "isCliff", type: "bool", value: !!at.isCliff },
                        { name: "mat1Name", type: "string", value: at.mat1Name || "" },
                        { name: "mat2Name", type: "string", value: at.mat2Name || "" },
                        { name: "mapping", type: "string", value: JSON.stringify(at.mapping || {}) }
                    ]
                });
            });

            const cleanFilename = ts.filename || imagePath;
            const tsEntry = {
                firstgid,
                name: ts.name,
                image: imagePath,
                imagewidth: ts.imagewidth || (ts.image ? ts.image.width : cols * tw),
                imageheight: ts.imageheight || (ts.image ? ts.image.height : rows * th),
                tilewidth: tw,
                tileheight: th,
                margin,
                spacing,
                columns: cols,
                tilecount,
                properties: [
                    { name: "tilesetId", type: "string", value: ts.id },
                    { name: "filename", type: "string", value: cleanFilename },
                    { name: "__imageData", type: "string", value: imageData }
                ],
                tiles: tilesArr,
                wangsets: wangsets
            };

            if (ts.objectalignment) tsEntry.objectalignment = ts.objectalignment;
            if (ts.fillmode) tsEntry.fillmode = ts.fillmode;
            if (ts.tilerendersize) tsEntry.tilerendersize = ts.tilerendersize;
            if (ts.grid) tsEntry.grid = ts.grid;

            return tsEntry;
        });

        // OPTIMIZATION: Pre-calculate fast O(1) tileset metadata lookup Map to eliminate inner-loop .find() calls
        const metaLookup = new Map();
        (state.tilesets || []).forEach(tsInState => {
            const tsMeta = tilesetMeta.find(t => t.name === tsInState.name) || tilesetMeta[0];
            const firstgid = tsMeta ? tsMeta.firstgid : 1;
            let imageIndexMap = null;
            if (tsInState.isCollection && Array.isArray(tsInState.images)) {
                imageIndexMap = new Map();
                tsInState.images.forEach((img, idx) => {
                    imageIndexMap.set(img.id, idx + 1);
                });
            }
            metaLookup.set(tsInState.id, {
                firstgid,
                columns: tsMeta ? (tsMeta.columns || 1) : 1,
                isCollection: !!tsInState.isCollection,
                imageIndexMap
            });
        });
        const defaultMeta = metaLookup.get((state.tilesets && state.tilesets[0]?.id)) || { firstgid: 1, columns: 1, isCollection: false, imageIndexMap: null };

        // Format Map Layers into Tiled structures (tilelayer vs objectgroup)
        const tmjLayers = (state.mapLayers || []).map((l, idx) => {
            if (l.type === 'objectgroup') {
                const layerProps = [];
                if (l.locked) layerProps.push({ name: "locked", type: "bool", value: true });

                const layerObj = {
                    id: l.id && typeof l.id === 'number' ? l.id : (idx + 1),
                    name: l.name,
                    type: "objectgroup",
                    visible: l.visible !== undefined ? l.visible : true,
                    opacity: l.opacity !== undefined ? l.opacity : 1.0,
                    x: l.x !== undefined ? l.x : 0,
                    y: l.y !== undefined ? l.y : 0,
                    draworder: l.draworder || "topdown",
                    objects: (l.objects || []).map(obj => {
                        let propList = [];
                        if (obj.custom && typeof obj.custom === 'object' && Object.keys(obj.custom).length > 0) {
                            propList = Object.entries(obj.custom).map(([name, value]) => ({
                                name,
                                type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
                                value
                            }));
                        } else if (Array.isArray(obj.properties)) {
                            propList = JSON.parse(JSON.stringify(obj.properties));
                        }
                        return {
                            id: obj.id,
                            name: obj.name || '',
                            type: obj.type || obj.class || '',
                            x: obj.x,
                            y: obj.y,
                            width: obj.width,
                            height: obj.height,
                            rotation: obj.rotation || 0,
                            gid: obj.gid || undefined,
                            alignment: obj.alignment || undefined,
                            ellipse: obj.ellipse || undefined,
                            point: obj.point || undefined,
                            polygon: obj.polygon || undefined,
                            polyline: obj.polyline || undefined,
                            text: obj.text || undefined,
                            visible: obj.visible !== undefined ? obj.visible : true,
                            opacity: obj.opacity !== undefined ? obj.opacity : 1.0,
                            properties: propList
                        };
                    })
                };
                if (layerProps.length > 0) {
                    layerObj.properties = layerProps;
                }
                return layerObj;
            }

            const flatData = [];
            for (let y = 0; y < state.mapHeight; y++) {
                const row = l.data ? l.data[y] : null;
                for (let x = 0; x < state.mapWidth; x++) {
                    const tile = row ? row[x] : null;
                    if (tile) {
                        const meta = metaLookup.get(tile.tilesetId) || defaultMeta;
                        const firstgid = meta.firstgid;
                        let localGid = 1;

                        if (meta.isCollection && meta.imageIndexMap) {
                            localGid = meta.imageIndexMap.get(tile.imageId) || 1;
                        } else {
                            localGid = (tile.ty || 0) * meta.columns + (tile.tx || 0) + 1;
                        }

                        const rawGid = (firstgid - 1) + localGid;

                        let flags = 0;
                        let h = tile.flipH;
                        let v = tile.flipV;
                        let r = tile.rotation || 0;

                        // Calculate Tiled bitwise flags for rotation & flipping
                        if (r === 90) {
                            const temp = h; h = !v; v = temp;
                            flags |= 0x20000000;
                        } else if (r === 180) {
                            h = !h; v = !v;
                        } else if (r === 270) {
                            const temp = h; h = v; v = !temp;
                            flags |= 0x20000000;
                        }

                        if (h) flags |= 0x80000000;
                        if (v) flags |= 0x40000000;

                        // INVARIANT: Strict >>> 0 unsigned 32-bit bitmask conversion
                        flatData.push((rawGid | flags) >>> 0);
                    } else {
                        flatData.push(0);
                    }
                }
            }

            const layerProps = [];
            if (l.locked) layerProps.push({ name: "locked", type: "bool", value: true });
            if (l.terrainVertices && Array.isArray(l.terrainVertices) && l.terrainVertices.some(row => Array.isArray(row) && row.some(v => v !== 0))) {
                layerProps.push({ name: "terrainVertices", type: "string", value: JSON.stringify(l.terrainVertices) });
            }

            const layerObj = {
                id: l.id && typeof l.id === 'number' ? l.id : (idx + 1),
                name: l.name,
                type: "tilelayer",
                visible: l.visible !== undefined ? l.visible : true,
                opacity: l.opacity !== undefined ? l.opacity : 1.0,
                width: state.mapWidth,
                height: state.mapHeight,
                data: flatData
            };
            if (layerProps.length > 0) {
                layerObj.properties = layerProps;
            }
            return layerObj;
        });

        const customProps = [];
        if (state.passabilityGrid && Array.isArray(state.passabilityGrid) && state.passabilityGrid.some(row => Array.isArray(row) && row.some(cell => cell !== 0))) {
            customProps.push({ name: "passabilityGrid", type: "string", value: JSON.stringify(state.passabilityGrid) });
        }
        if (state.regionGrid && Array.isArray(state.regionGrid) && state.regionGrid.some(row => Array.isArray(row) && row.some(cell => cell !== 0))) {
            customProps.push({ name: "regionGrid", type: "string", value: JSON.stringify(state.regionGrid) });
        }
        if (state.autotiles && state.autotiles.length > 0) {
            customProps.push({ name: "autotiles", type: "string", value: JSON.stringify(state.autotiles) });
        }
        if (state.animatedTiles && state.animatedTiles.length > 0) {
            customProps.push({ name: "animatedTiles", type: "string", value: JSON.stringify(state.animatedTiles) });
        }
        if (state.materials && state.materials.length > 0) {
            customProps.push({ name: "materials", type: "string", value: JSON.stringify(state.materials) });
        }

        const tmjData = {
            compressionlevel: state.compressionlevel !== undefined ? state.compressionlevel : -1,
            height: state.mapHeight,
            width: state.mapWidth,
            tilewidth: state.TILE_SIZE,
            tileheight: state.TILE_SIZE,
            infinite: !!state.infinite,
            nextlayerid: state.nextlayerid || (state.mapLayers.length + 1),
            nextobjectid: state.nextobjectid || 1,
            orientation: state.orientation || "orthogonal",
            renderorder: state.renderorder || "right-down",
            tiledversion: state.tiledversion || "1.10.0",
            type: "map",
            version: state.mapVersion || "1.10"
        };
        if (customProps.length > 0) {
            tmjData.properties = customProps;
        }
        tmjData.tilesets = tilesetMeta;
        tmjData.layers = tmjLayers;

        (window.TileWeaver.exportImport.downloadFile || downloadFile)(JSON.stringify(tmjData, null, 2), filename, "application/json");
        showMessage(`Exported Game Engine Map (${filename})`, "success");
    }

    /**
     * Renders all visible layers onto an offscreen canvas and downloads a high-res PNG image.
     */
    function exportPNG() {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = state.mapWidth * state.TILE_SIZE;
        exportCanvas.height = state.mapHeight * state.TILE_SIZE;
        const ctx = exportCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        // OPTIMIZATION: Cache tileset lookup map upfront to eliminate O(N) searches inside cell loop
        const tilesetMap = new Map((state.tilesets || []).map(t => [t.id, t]));
        const defaultTileset = (state.tilesets && state.tilesets[0]) || null;

        (state.mapLayers || []).forEach((l, lIdx) => {
            if (!l || !l.visible || !l.data) return;
            ctx.globalAlpha = l.opacity !== undefined ? l.opacity : 1.0;

            // OPTIMIZATION: Hoist dual-grid function presence check outside nested cell loop
            const hasDualGrid = !!(l.terrainVertices && window.TileWeaver.autotile && typeof window.TileWeaver.autotile.drawDualGridCellSubQuadrants === 'function');

            for (let y = 0; y < state.mapHeight; y++) {
                const row = l.data[y];
                if (!row) continue;
                for (let x = 0; x < state.mapWidth; x++) {
                    const tile = row[x];
                    if (tile) {
                        if (hasDualGrid) {
                            const dualGridHandled = window.TileWeaver.autotile.drawDualGridCellSubQuadrants(ctx, lIdx, x, y, tile);
                            if (dualGridHandled) continue;
                        }

                        const ts = tilesetMap.get(tile.tilesetId) || defaultTileset;
                        if (ts && ts.image) {
                            const margin = ts.margin || 0;
                            const spacing = ts.spacing || 0;
                            const srcX = margin + tile.tx * (state.TILE_SIZE + spacing);
                            const srcY = margin + tile.ty * (state.TILE_SIZE + spacing);

                            drawTileTransformed(
                                ctx,
                                ts.image,
                                srcX, srcY, state.TILE_SIZE, state.TILE_SIZE,
                                x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE,
                                tile.flipH, tile.flipV, tile.rotation
                            );
                        }
                    }
                }
            }
        });

        const a = document.createElement('a');
        a.download = 'map_render.png';
        a.href = exportCanvas.toDataURL('image/png');
        a.click();
        showMessage("Exported PNG Render", "success");
    }

    /**
     * Creates a high-DPI procedural placeholder canvas for missing/unuploaded tileset assets.
     * @param {string} name - Tileset name
     * @param {string} filename - Target asset filename
     * @param {number} [width=160] - Canvas width
     * @param {number} [height=160] - Canvas height
     * @returns {HTMLCanvasElement} Procedural placeholder canvas
     */
    function createMissingAssetPlaceholder(name, filename, width = 160, height = 160) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(width || 160, 160);
        canvas.height = Math.max(height || 160, 160);
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        // Dark background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Subtle diagonal pattern / checkerboard
        ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
        const tileSize = 32;
        for (let y = 0; y < canvas.height; y += tileSize) {
            for (let x = 0; x < canvas.width; x += tileSize) {
                if ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0) {
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }

        // Red dashed border
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 2;
        if (ctx.strokeRect) ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

        // Centered Warning Badge
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const boxW = Math.min(canvas.width - 20, 240);
        const boxH = 52;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        if (ctx.fillRect) ctx.fillRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1;
        if (ctx.strokeRect) ctx.strokeRect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH);

        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (ctx.fillText) ctx.fillText(`⚠️ Missing: ${filename}`, centerX, centerY - 10);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px sans-serif';
        if (ctx.fillText) ctx.fillText(`Upload '${filename}' to display`, centerX, centerY + 10);

        return canvas;
    }

    /**
     * Analyzes map JSON structure without mutating state.
     * Extracts map metadata and list of required texture filenames.
     * @param {Object} data - Parsed map JSON
     * @returns {Object} Map inspection report
     */
    function analyzeMapJSON(data) {
        const w = data.width || data.mapWidth || 30;
        const h = data.height || data.mapHeight || 20;
        const ts = data.tilewidth || data.tileSize || 32;
        const layersCount = (data.layers || []).length;
        const autotilesCount = Array.isArray(data.autotiles) ? data.autotiles.length : 0;
        
        const requiredAssets = [];
        const seen = new Set();
        
        if (data.tilesets && Array.isArray(data.tilesets)) {
            data.tilesets.forEach((rawTs, idx) => {
                const tsProps = {};
                if (rawTs.properties && Array.isArray(rawTs.properties)) {
                    rawTs.properties.forEach(p => { tsProps[p.name] = p.value; });
                }
                const isCollection = tsProps.isCollection || rawTs.columns === 0 || (rawTs.tiles && rawTs.tiles.some(t => t.image)) || (rawTs.isCollection && Array.isArray(rawTs.images));
                const tsName = rawTs.name || `Tileset ${idx + 1}`;
                
                if (isCollection) {
                    const entries = (rawTs.tiles && Array.isArray(rawTs.tiles)) ? rawTs.tiles : (rawTs.images && Array.isArray(rawTs.images) ? rawTs.images : []);
                    entries.forEach((tileEntry, tIdx) => {
                        const tProps = {};
                        if (tileEntry.properties && Array.isArray(tileEntry.properties)) {
                            tileEntry.properties.forEach(p => { tProps[p.name] = p.value; });
                        }
                        const imgPath = tileEntry.filename || tileEntry.image || tProps.filename || `${tsName}_${tIdx + 1}.png`;
                        const filename = imgPath.split('/').pop().split('\\').pop();
                        if (!seen.has(filename.toLowerCase())) {
                            seen.add(filename.toLowerCase());
                            requiredAssets.push({
                                name: tileEntry.name || tProps.name || filename.replace(/\.[^/.]+$/, ""),
                                filename: filename,
                                isCollection: true,
                                width: tileEntry.width || tileEntry.imagewidth || 32,
                                height: tileEntry.height || tileEntry.imageheight || 32
                            });
                        }
                    });
                } else {
                    const imgPath = rawTs.filename || rawTs.image || tsProps.filename || `${tsName.toLowerCase().replace(/\s+/g, '_')}.png`;
                    const filename = imgPath.split('/').pop().split('\\').pop();
                    if (!seen.has(filename.toLowerCase())) {
                        seen.add(filename.toLowerCase());
                        requiredAssets.push({
                            name: tsName,
                            filename: filename,
                            isCollection: false,
                            width: rawTs.imagewidth || 160,
                            height: rawTs.imageheight || 160
                        });
                    }
                }
            });
        }
        
        return {
            mapWidth: w,
            mapHeight: h,
            tileSize: ts,
            layersCount,
            autotilesCount,
            requiredAssets
        };
    }

    /**
     * Parses an uploaded project JSON map file (supporting Native JSON v3.3 & Tiled JSON format),
     * matches tilesets against the Project Digital Asset Vault & any uploaded asset files,
     * creates placeholder tilesets for missing textures, applies all embedded settings,
     * and recreates the exact map state.
     * @param {File|Blob|string|Object} fileOrContent - Map data file or object
     * @param {Array<File|Blob>} [assetFiles=[]] - External texture files
     * @param {Function} [onSuccess] - Callback upon completion
     */
    async function importMapJSON(fileOrContent, assetFiles = [], onSuccess) {
        if (!fileOrContent) return;

        if (typeof assetFiles === 'function') {
            onSuccess = assetFiles;
            assetFiles = [];
        }

        let data = null;
        if (typeof fileOrContent === 'string') {
            try {
                data = JSON.parse(fileOrContent);
            } catch (e) {
                data = null;
            }
        } else if (fileOrContent && typeof fileOrContent === 'object') {
            if (fileOrContent.width || fileOrContent.mapWidth || fileOrContent.layers || fileOrContent.tilesets) {
                data = fileOrContent;
            } else if (typeof FileReader !== 'undefined') {
                try {
                    const text = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const res = (e && e.target && e.target.result !== undefined) ? e.target.result : (reader.result || e);
                            resolve(res);
                        };
                        reader.onerror = reject;
                        reader.readAsText(fileOrContent);
                    });
                    data = typeof text === 'string' ? JSON.parse(text) : text;
                } catch (e) {
                    if (fileOrContent._content) {
                        data = typeof fileOrContent._content === 'string' ? JSON.parse(fileOrContent._content) : fileOrContent._content;
                    }
                }
            } else if (fileOrContent._content) {
                data = typeof fileOrContent._content === 'string' ? JSON.parse(fileOrContent._content) : fileOrContent._content;
            }
        }

        try {
            if (!data || (!data.width && !data.mapWidth)) throw new Error("Invalid map structure");

            pushHistoryState();

            // 0. Pre-load and restore Digital Asset Vault BEFORE matching tilesets
            let restoredAssets = [];
            if (data.assets && Array.isArray(data.assets) && data.assets.length > 0) {
                for (let aIdx = 0; aIdx < data.assets.length; aIdx++) {
                    const rawAsset = data.assets[aIdx];
                    let assetImg = null;
                    if (rawAsset.dataUrl) {
                        try {
                            assetImg = await loadImageAsync(rawAsset.dataUrl);
                        } catch (e) {}
                    }
                    if (!assetImg || assetImg.width === 0) {
                        const assetPath = rawAsset.relativePath || `assets/${rawAsset.filename}`;
                        try {
                            assetImg = await loadImageAsync(assetPath);
                        } catch (e) {}
                    }
                    if (!assetImg || assetImg.width === 0) {
                        assetImg = createPlaceholderImage(rawAsset.width || 32, rawAsset.height || 32, rawAsset.name);
                    }

                    const assetRec = {
                        id: rawAsset.id || `asset_${aIdx + 1}`,
                        name: rawAsset.name,
                        filename: rawAsset.filename,
                        relativePath: rawAsset.relativePath || `assets/${rawAsset.filename}`,
                        width: rawAsset.width || (assetImg ? assetImg.width : 32),
                        height: rawAsset.height || (assetImg ? assetImg.height : 32),
                        sizeBytes: rawAsset.sizeBytes || 0,
                        mimeType: rawAsset.mimeType || 'image/png',
                        tags: rawAsset.tags || [],
                        assignedTilesetIds: rawAsset.assignedTilesetIds || [],
                        createdAt: rawAsset.createdAt || new Date().toISOString(),
                        updatedAt: rawAsset.updatedAt || new Date().toISOString(),
                        dataUrl: rawAsset.dataUrl || '',
                        image: assetImg
                    };
                    restoredAssets.push(assetRec);
                }
            }

            // Also load any external asset files provided during the Import dialog
            if (assetFiles && Array.isArray(assetFiles) && assetFiles.length > 0) {
                for (const aFile of assetFiles) {
                    if (aFile instanceof File || aFile instanceof Blob) {
                        try {
                            const dataUrl = await new Promise((res, rej) => {
                                const fr = new FileReader();
                                fr.onload = () => res(fr.result);
                                fr.onerror = rej;
                                fr.readAsDataURL(aFile);
                            });
                            const img = await loadImageAsync(dataUrl);
                            const rec = window.TileWeaver.stateModule.createNewAssetRecord(
                                aFile.name.replace(/\.[^/.]+$/, ""),
                                aFile.name,
                                img,
                                dataUrl,
                                aFile.size,
                                aFile.type,
                                ['imported'],
                                []
                            );
                            const existingIdx = restoredAssets.findIndex(a => (a.filename || '').toLowerCase() === (rec.filename || '').toLowerCase());
                            if (existingIdx >= 0) {
                                restoredAssets[existingIdx] = rec;
                            } else {
                                restoredAssets.push(rec);
                            }
                        } catch (e) {
                            console.warn("Failed to pre-load imported asset file:", aFile, e);
                        }
                    } else if (aFile && aFile.image) {
                        const existingIdx = restoredAssets.findIndex(a => a.id === aFile.id || ((a.filename || '').toLowerCase() === (aFile.filename || '').toLowerCase()));
                        if (existingIdx >= 0) {
                            restoredAssets[existingIdx] = aFile;
                        } else {
                            restoredAssets.push(aFile);
                        }
                    }
                }
            }

            if (restoredAssets.length > 0) {
                state.assets = restoredAssets;
                state.activeAssetId = state.assets[0].id;
            }

            // OPTIMIZATION: Build fast indexed asset lookup maps to accelerate tileset texture reconnection
            const assetById = new Map();
            const assetByFilenameLower = new Map();
            const assetByNameLower = new Map();
            const assetByBaseLower = new Map();

            (state.assets || []).forEach(a => {
                if (a.id) assetById.set(a.id, a);
                if (a.filename) {
                    const fLower = a.filename.split('/').pop().split('\\').pop().toLowerCase();
                    assetByFilenameLower.set(fLower, a);
                    assetByBaseLower.set(fLower.replace(/\.[^/.]+$/, ""), a);
                }
                if (a.name) {
                    const nLower = a.name.toLowerCase();
                    assetByNameLower.set(nLower, a);
                    assetByBaseLower.set(nLower, a);
                }
            });

            // 1. Restore Basic Map Config & Metadata
            state.mapWidth = data.width || data.mapWidth;
            state.mapHeight = data.height || data.mapHeight;
            state.TILE_SIZE = data.tilewidth || data.tileSize || 32;
            state.tiledversion = data.tiledversion || '1.10.0';
            state.mapVersion = data.version || '1.10';
            state.orientation = data.orientation || 'orthogonal';
            state.renderorder = data.renderorder || 'right-down';
            state.compressionlevel = data.compressionlevel !== undefined ? data.compressionlevel : -1;
            state.infinite = !!data.infinite;
            state.nextlayerid = data.nextlayerid || 1;
            state.nextobjectid = data.nextobjectid || 1;

            // 2. Parse Custom Map Properties (passabilityGrid, regionGrid, autotiles, animatedTiles, materials)
            const mapProps = {};
            if (data.properties && Array.isArray(data.properties)) {
                data.properties.forEach(p => { mapProps[p.name] = p.value; });
            }

            if (mapProps.passabilityGrid) {
                state.passabilityGrid = typeof mapProps.passabilityGrid === 'string' ? JSON.parse(mapProps.passabilityGrid) : mapProps.passabilityGrid;
            } else if (data.passabilityGrid) {
                state.passabilityGrid = data.passabilityGrid;
            }

            if (mapProps.regionGrid) {
                state.regionGrid = typeof mapProps.regionGrid === 'string' ? JSON.parse(mapProps.regionGrid) : mapProps.regionGrid;
            } else if (data.regionGrid) {
                state.regionGrid = data.regionGrid;
            }

            // Ensure passabilityGrid and regionGrid match state.mapHeight x state.mapWidth
            if (!state.passabilityGrid || !Array.isArray(state.passabilityGrid) || state.passabilityGrid.length !== state.mapHeight) {
                state.passabilityGrid = [];
                for (let y = 0; y < state.mapHeight; y++) {
                    const pRow = [];
                    for (let x = 0; x < state.mapWidth; x++) pRow.push(0);
                    state.passabilityGrid.push(pRow);
                }
            }
            if (!state.regionGrid || !Array.isArray(state.regionGrid) || state.regionGrid.length !== state.mapHeight) {
                state.regionGrid = [];
                for (let y = 0; y < state.mapHeight; y++) {
                    const rRow = [];
                    for (let x = 0; x < state.mapWidth; x++) rRow.push(0);
                    state.regionGrid.push(rRow);
                }
            }

            if (mapProps.autotiles) {
                state.autotiles = typeof mapProps.autotiles === 'string' ? JSON.parse(mapProps.autotiles) : mapProps.autotiles;
            } else if (data.autotiles) {
                state.autotiles = data.autotiles;
            }
            if (window.TileWeaver.stateModule && typeof window.TileWeaver.stateModule.sanitizeAutotileIds === 'function') {
                window.TileWeaver.stateModule.sanitizeAutotileIds();
            }

            if (mapProps.animatedTiles) {
                state.animatedTiles = typeof mapProps.animatedTiles === 'string' ? JSON.parse(mapProps.animatedTiles) : mapProps.animatedTiles;
            } else if (data.animatedTiles) {
                state.animatedTiles = data.animatedTiles;
            }

            if (mapProps.materials) {
                state.materials = typeof mapProps.materials === 'string' ? JSON.parse(mapProps.materials) : mapProps.materials;
            } else if (data.materials) {
                state.materials = data.materials;
            }

            // 3. Restore Embedded Tilesets & Match Assets Image Files
            let loadedTilesets = [];
            let matchedAssetsCount = 0;

            if (data.tilesets && Array.isArray(data.tilesets)) {
                for (let i = 0; i < data.tilesets.length; i++) {
                    const rawTs = data.tilesets[i];
                    const tsProps = {};
                    if (rawTs.properties && Array.isArray(rawTs.properties)) {
                        rawTs.properties.forEach(p => { tsProps[p.name] = p.value; });
                    }

                    const tilesetId = tsProps.tilesetId || rawTs.id || `ts_${i + 1}`;
                    const tsName = rawTs.name || `Tileset ${i + 1}`;
                    
                    // Check if tileset is a Collection of Images tileset
                    const isCollection = tsProps.isCollection || rawTs.columns === 0 || (rawTs.tiles && rawTs.tiles.some(t => t.image)) || (rawTs.isCollection && Array.isArray(rawTs.images));

                    const rawFilename = rawTs.filename || rawTs.image || tsProps.filename || `${tsName.toLowerCase().replace(/\s+/g, '_')}.png`;
                    const filename = rawFilename ? rawFilename.split('/').pop().split('\\').pop() : `${tsName.toLowerCase().replace(/\s+/g, '_')}.png`;
                    const imgPath = rawTs.imagePath || rawTs.image || tsProps.filename || (filename.startsWith('assets/') ? filename : `assets/${filename}`);

                    let loadedImage = null;
                    let matchedAssetId = null;
                    let isMissing = false;

                    // Only match top-level sheet image for standard grid tilesets
                    if (!isCollection) {
                        const filenameLower = filename.toLowerCase();
                        const tsNameLower = tsName.toLowerCase();
                        const baseLower = filenameLower.replace(/\.[^/.]+$/, "");

                        const matchedAsset = (rawTs.assetId && assetById.get(rawTs.assetId)) ||
                            (state.assets || []).find(a => a.assignedTilesetIds && a.assignedTilesetIds.includes(tilesetId)) ||
                            assetByFilenameLower.get(filenameLower) ||
                            assetByNameLower.get(tsNameLower) ||
                            assetByBaseLower.get(baseLower);

                        if (matchedAsset && matchedAsset.image) {
                            loadedImage = matchedAsset.image;
                            matchedAssetId = matchedAsset.id;
                            isMissing = false;
                            matchedAssetsCount++;
                            if (!matchedAsset.assignedTilesetIds) matchedAsset.assignedTilesetIds = [];
                            if (!matchedAsset.assignedTilesetIds.includes(tilesetId)) matchedAsset.assignedTilesetIds.push(tilesetId);
                        } else if (rawTs.dataUrl) {
                            try {
                                loadedImage = await loadImageAsync(rawTs.dataUrl);
                                isMissing = false;
                                matchedAssetsCount++;
                            } catch (e) {
                                loadedImage = createMissingAssetPlaceholder(tsName, filename, rawTs.imagewidth || 160, rawTs.imageheight || 160);
                                isMissing = true;
                            }
                        } else {
                            // Asset is not in project assets - generate missing placeholder image
                            loadedImage = createMissingAssetPlaceholder(tsName, filename, rawTs.imagewidth || 160, rawTs.imageheight || 160);
                            matchedAssetId = null;
                            isMissing = true;
                        }
                    }

                    // Extract custom tile properties
                    const tileProperties = Object.assign({}, rawTs.tileProperties || {});
                    if (rawTs.tiles && Array.isArray(rawTs.tiles)) {
                        const cols = rawTs.columns || (loadedImage ? Math.floor(loadedImage.width / state.TILE_SIZE) : 5);
                        rawTs.tiles.forEach(t => {
                            if (t.properties && Array.isArray(t.properties)) {
                                const tx = t.id % cols;
                                const ty = Math.floor(t.id / cols);
                                const propObj = {};
                                t.properties.forEach(p => { propObj[p.name] = p.value; });
                                tileProperties[`${tx}_${ty}`] = propObj;
                            }
                        });
                    }

                    // Extract WangSets (Terrain Sets) if embedded in tileset
                    if (rawTs.wangsets && Array.isArray(rawTs.wangsets)) {
                        rawTs.wangsets.forEach(w => {
                            const wProps = {};
                            if (w.properties && Array.isArray(w.properties)) {
                                w.properties.forEach(p => { wProps[p.name] = p.value; });
                            }
                            if (wProps.autotileId && wProps.mapping) {
                                const exists = (state.autotiles || []).find(a => a.id === wProps.autotileId);
                                if (!exists) {
                                    state.autotiles.push({
                                        id: wProps.autotileId,
                                        name: w.name,
                                        mode: wProps.mode || '9slice',
                                        tilesetId: tilesetId,
                                        isCliff: !!wProps.isCliff,
                                        mat1Name: wProps.mat1Name || (w.wangcolors && w.wangcolors[0] ? w.wangcolors[0].name : 'Base Material'),
                                        mat2Name: wProps.mat2Name || (w.wangcolors && w.wangcolors[1] ? w.wangcolors[1].name : 'Overlay Material'),
                                        mapping: typeof wProps.mapping === 'string' ? JSON.parse(wProps.mapping) : wProps.mapping
                                    });
                                }
                            }
                        });
                    }

                    if (isCollection) {
                        const collTs = window.TileWeaver.stateModule.createNewCollectionTileset(tsName);
                        collTs.id = tilesetId;
                        collTs.firstgid = rawTs.firstgid !== undefined ? rawTs.firstgid : 1;
                        if (rawTs.tilewidth) collTs.tilewidth = rawTs.tilewidth;
                        if (rawTs.tileheight) collTs.tileheight = rawTs.tileheight;
                        if (rawTs.columns !== undefined) collTs.columns = rawTs.columns;
                        if (rawTs.tilecount !== undefined) collTs.tilecount = rawTs.tilecount;
                        collTs.imagePath = imgPath;

                        const rawImages = (rawTs.images && Array.isArray(rawTs.images)) ? rawTs.images : (rawTs.tiles && Array.isArray(rawTs.tiles) ? rawTs.tiles : []);

                        for (let tIdx = 0; tIdx < rawImages.length; tIdx++) {
                            const tileEntry = rawImages[tIdx];
                            const tileEntryProps = {};
                            if (tileEntry.properties && Array.isArray(tileEntry.properties)) {
                                tileEntry.properties.forEach(p => { tileEntryProps[p.name] = p.value; });
                            }

                            const rawImgPath = tileEntry.filename || tileEntry.image || tileEntryProps.filename || `${tsName}_${tIdx}.png`;
                            const filename = rawImgPath.split('/').pop().split('\\').pop();
                            const filenameLower = filename.toLowerCase();
                            const entryName = tileEntry.name || tileEntryProps.name || filename.replace(/\.[^/.]+$/, "");
                            const nameLower = entryName.toLowerCase();
                            const baseLower = filenameLower.replace(/\.[^/.]+$/, "");

                            let loadedCollImage = null;
                            let collAssetId = null;
                            let collMissing = false;

                            const matchedAsset = (tileEntry.assetId && assetById.get(tileEntry.assetId)) ||
                                (tileEntryProps.imageId && assetById.get(tileEntryProps.imageId)) ||
                                (state.assets || []).find(a => a.assignedTilesetIds && a.assignedTilesetIds.includes(tilesetId) && (a.name === entryName || a.filename === filename)) ||
                                assetByFilenameLower.get(filenameLower) ||
                                assetByNameLower.get(nameLower) ||
                                assetByBaseLower.get(baseLower);

                            if (matchedAsset && matchedAsset.image) {
                                loadedCollImage = matchedAsset.image;
                                collAssetId = matchedAsset.id;
                                collMissing = false;
                                matchedAssetsCount++;
                                if (!matchedAsset.assignedTilesetIds) matchedAsset.assignedTilesetIds = [];
                                if (!matchedAsset.assignedTilesetIds.includes(tilesetId)) matchedAsset.assignedTilesetIds.push(tilesetId);
                            } else if (tileEntry.dataUrl) {
                                try {
                                    loadedCollImage = await loadImageAsync(tileEntry.dataUrl);
                                    collMissing = false;
                                    matchedAssetsCount++;
                                } catch (e) {
                                    loadedCollImage = createMissingAssetPlaceholder(entryName, filename, tileEntry.width || tileEntry.imagewidth || state.TILE_SIZE, tileEntry.height || tileEntry.imageheight || state.TILE_SIZE);
                                    collMissing = true;
                                }
                            } else {
                                loadedCollImage = createMissingAssetPlaceholder(entryName, filename, tileEntry.width || tileEntry.imagewidth || state.TILE_SIZE, tileEntry.height || tileEntry.imageheight || state.TILE_SIZE);
                                collAssetId = null;
                                collMissing = true;
                            }

                            const anchor = tileEntry.anchor || tileEntryProps.anchor || 'bottom-center';
                            const imgObj = window.TileWeaver.stateModule.addCollectionImage(
                                collTs, entryName, filename, loadedCollImage, matchedAsset ? matchedAsset.dataUrl : (tileEntry.dataUrl || ''), anchor
                            );
                            if (imgObj) {
                                imgObj.tileId = typeof tileEntry.tileId === 'number' ? tileEntry.tileId : (typeof tileEntry.id === 'number' ? tileEntry.id : tIdx);
                                imgObj.assetId = collAssetId;
                                imgObj.isMissing = collMissing;
                                if (tileEntry.id || tileEntryProps.imageId) {
                                    imgObj.id = tileEntry.id || tileEntryProps.imageId;
                                }
                                if (tileEntry.anchorOffsetX !== undefined) imgObj.anchorOffsetX = tileEntry.anchorOffsetX;
                                if (tileEntry.anchorOffsetY !== undefined) imgObj.anchorOffsetY = tileEntry.anchorOffsetY;
                                imgObj.imagePath = rawImgPath;

                                const propsSource = tileEntry.tileProperties || tileEntryProps;
                                if (propsSource && Object.keys(propsSource).length > 0) {
                                    imgObj.tileProperties = JSON.parse(JSON.stringify(propsSource));
                                }
                            }
                        }
                        collTs.isMissing = collTs.images.length > 0 && collTs.images.every(img => img.isMissing);
                        if (rawTs.objectalignment) collTs.objectalignment = rawTs.objectalignment;
                        if (rawTs.fillmode) collTs.fillmode = rawTs.fillmode;
                        if (rawTs.tilerendersize) collTs.tilerendersize = rawTs.tilerendersize;
                        if (rawTs.grid) collTs.grid = rawTs.grid;
                        loadedTilesets.push(collTs);
                    } else {
                        const gridTs = {
                            id: tilesetId,
                            name: tsName,
                            filename: filename,
                            assetId: matchedAssetId,
                            isMissing: isMissing,
                            imagePath: imgPath,
                            firstgid: rawTs.firstgid !== undefined ? rawTs.firstgid : 1,
                            tilewidth: rawTs.tilewidth || rawTs.tileSize || state.TILE_SIZE,
                            tileheight: rawTs.tileheight || rawTs.tileSize || state.TILE_SIZE,
                            imagewidth: rawTs.imagewidth || (loadedImage ? loadedImage.width : 160),
                            imageheight: rawTs.imageheight || (loadedImage ? loadedImage.height : 160),
                            columns: rawTs.columns !== undefined ? rawTs.columns : (loadedImage ? Math.max(1, Math.floor((loadedImage.width - (rawTs.margin || 0)) / ((rawTs.tilewidth || state.TILE_SIZE) + (rawTs.spacing || 0)))) : 5),
                            tilecount: rawTs.tilecount !== undefined ? rawTs.tilecount : (loadedImage ? (Math.max(1, Math.floor((loadedImage.width - (rawTs.margin || 0)) / ((rawTs.tilewidth || state.TILE_SIZE) + (rawTs.spacing || 0)))) * Math.max(1, Math.floor((loadedImage.height - (rawTs.margin || 0)) / ((rawTs.tileheight || state.TILE_SIZE) + (rawTs.spacing || 0))))) : 0),
                            tiles: rawTs.tiles || [],
                            image: loadedImage,
                            margin: rawTs.margin || 0,
                            spacing: rawTs.spacing || 0,
                            tileProperties
                        };
                        if (rawTs.objectalignment) gridTs.objectalignment = rawTs.objectalignment;
                        if (rawTs.fillmode) gridTs.fillmode = rawTs.fillmode;
                        if (rawTs.tilerendersize) gridTs.tilerendersize = rawTs.tilerendersize;
                        if (rawTs.grid) gridTs.grid = rawTs.grid;
                        loadedTilesets.push(gridTs);
                    }
                }
            }

            if (loadedTilesets.length > 0) {
                state.tilesets = loadedTilesets;
                state.activeTilesetIndex = 0;
            }

            // Repair / validate foreign or mismatched tileset IDs in imported autotiles & materials
            if (state.tilesets.length > 0) {
                const defaultGridTs = state.tilesets.find(t => !t.isCollection) || state.tilesets[0];
                if (state.autotiles && Array.isArray(state.autotiles)) {
                    state.autotiles.forEach(at => {
                        if (!state.tilesets.some(t => t.id === at.tilesetId)) {
                            at.tilesetId = defaultGridTs.id;
                        }
                    });
                }
                if (state.materials && Array.isArray(state.materials)) {
                    state.materials.forEach(m => {
                        if (!state.tilesets.some(t => t.id === m.tilesetId)) {
                            m.tilesetId = defaultGridTs.id;
                        }
                    });
                }
            }

            if (window.TileWeaver.stateModule && typeof window.TileWeaver.stateModule.recomputeTilesetGids === 'function') {
                window.TileWeaver.stateModule.recomputeTilesetGids();
            }

            // 4. Restore Layers & Decode Bitwise GIDs
            if (data.layers && Array.isArray(data.layers)) {
                // OPTIMIZATION: Pre-calculate sorted tileset ranges & collection image maps before decoding layers
                const sortedTilesets = [...state.tilesets].sort((a, b) => (b.firstgid || 1) - (a.firstgid || 1));
                const collectionImageMaps = new Map();
                state.tilesets.forEach(ts => {
                    if (ts.isCollection && Array.isArray(ts.images)) {
                        const imgMap = new Map();
                        ts.images.forEach((img, idx) => {
                            if (img.tileId !== undefined) imgMap.set(`tileId_${img.tileId}`, img);
                            if (img.id !== undefined) imgMap.set(`id_${img.id}`, img);
                            imgMap.set(`idx_${idx}`, img);
                        });
                        collectionImageMaps.set(ts.id, imgMap);
                    }
                });

                state.mapLayers = data.layers.map((l, lIdx) => {
                    const layerProps = {};
                    if (l.properties && Array.isArray(l.properties)) {
                        l.properties.forEach(p => { layerProps[p.name] = p.value; });
                    }

                    // Preserve authentic Object Groups (objectgroup)
                    if (l.type === 'objectgroup') {
                        const layerObj = window.TileWeaver.stateModule.createNewLayerObject(l.name, 'objectgroup');
                        layerObj.id = l.id || 'layer_' + (lIdx + 1);
                        layerObj.visible = l.visible !== undefined ? l.visible : true;
                        layerObj.opacity = l.opacity !== undefined ? l.opacity : 1.0;
                        layerObj.x = l.x !== undefined ? l.x : 0;
                        layerObj.y = l.y !== undefined ? l.y : 0;
                        layerObj.locked = !!layerProps.locked;
                        layerObj.draworder = l.draworder || 'topdown';
                        layerObj.objects = (l.objects || []).map(obj => {
                            const customProps = {};
                            if (obj.custom && typeof obj.custom === 'object') {
                                Object.assign(customProps, obj.custom);
                            }
                            if (Array.isArray(obj.properties)) {
                                obj.properties.forEach(p => {
                                    if (p && p.name && customProps[p.name] === undefined) {
                                        customProps[p.name] = p.value;
                                    }
                                });
                            }

                            let tilesetId = obj.tilesetId || undefined;
                            let imageId = obj.imageId || undefined;
                            if (obj.gid && !tilesetId) {
                                const rawGid = (obj.gid >>> 0) & 0x1FFFFFFF;
                                const matchedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(rawGid) : null;
                                if (matchedTs) {
                                    tilesetId = matchedTs.id;
                                    if (matchedTs.isCollection && matchedTs.images) {
                                        const localId = rawGid - (matchedTs.firstgid || 1);
                                        const imgObj = matchedTs.images.find(img => img.tileId === localId) ||
                                                       matchedTs.images.find(img => img.id === localId) ||
                                                       matchedTs.images[localId] ||
                                                       matchedTs.images[0];
                                        if (imgObj) imageId = imgObj.id;
                                    }
                                }
                            }

                            return {
                                id: obj.id,
                                name: obj.name || '',
                                type: obj.type || obj.class || '',
                                x: obj.x || 0,
                                y: obj.y || 0,
                                width: obj.width || 0,
                                height: obj.height || 0,
                                rotation: obj.rotation || 0,
                                gid: obj.gid || null,
                                alignment: obj.alignment || undefined,
                                tilesetId: tilesetId,
                                imageId: imageId,
                                ellipse: obj.ellipse || undefined,
                                point: obj.point || undefined,
                                polygon: obj.polygon || undefined,
                                polyline: obj.polyline || undefined,
                                text: obj.text || undefined,
                                visible: obj.visible !== undefined ? obj.visible : true,
                                opacity: obj.opacity !== undefined ? obj.opacity : 1.0,
                                custom: customProps,
                                properties: obj.properties ? JSON.parse(JSON.stringify(obj.properties)) : []
                            };
                        });
                        return layerObj;
                    }

                    let terrainVerts = [];
                    if (layerProps.terrainVertices) {
                        terrainVerts = typeof layerProps.terrainVertices === 'string' ? JSON.parse(layerProps.terrainVertices) : layerProps.terrainVertices;
                    } else if (l.terrainVertices) {
                        terrainVerts = l.terrainVertices;
                    } else {
                        for (let y = 0; y <= state.mapHeight; y++) {
                            const vRow = [];
                            for (let x = 0; x <= state.mapWidth; x++) vRow.push(0);
                            terrainVerts.push(vRow);
                        }
                    }

                    let dataGrid = [];
                    if (Array.isArray(l.data) && l.data.length > 0 && Array.isArray(l.data[0])) {
                        dataGrid = l.data; // Native 2D grid array
                    } else if (Array.isArray(l.data)) {
                        // 1D GID Array with bitwise flip flags
                        dataGrid = [];
                        for (let y = 0; y < state.mapHeight; y++) {
                            const row = [];
                            for (let x = 0; x < state.mapWidth; x++) {
                                const idx = y * state.mapWidth + x;
                                const rawGidWithFlags = l.data[idx] || 0;
                                if (rawGidWithFlags === 0) {
                                    row.push(null);
                                } else {
                                    const unsignedGid = rawGidWithFlags >>> 0;
                                    const h = (unsignedGid & 0x80000000) !== 0;
                                    const v = (unsignedGid & 0x40000000) !== 0;
                                    const d = (unsignedGid & 0x20000000) !== 0;
                                    const gid = unsignedGid & 0x1FFFFFFF;

                                    // OPTIMIZATION: Rapidly locate matching tileset from sorted firstgid list
                                    let matchedTs = state.tilesets[0];
                                    for (let tsIdx = 0; tsIdx < sortedTilesets.length; tsIdx++) {
                                        if (gid >= (sortedTilesets[tsIdx].firstgid || 1)) {
                                            matchedTs = sortedTilesets[tsIdx];
                                            break;
                                        }
                                    }

                                    // Decode Tiled flip/rotation flags
                                    let rotation = 0;
                                    let flipH = false;
                                    let flipV = false;

                                    if (!d) {
                                        if (!h && !v)      { rotation = 0;   flipH = false; flipV = false; }
                                        else if (h && v)   { rotation = 180; flipH = false; flipV = false; }
                                        else if (h && !v)  { rotation = 0;   flipH = true;  flipV = false; }
                                        else if (!h && v)  { rotation = 0;   flipH = false; flipV = true;  }
                                    } else {
                                        if (h && !v)       { rotation = 90;  flipH = false; flipV = false; }
                                        else if (!h && v)  { rotation = 270; flipH = false; flipV = false; }
                                        else if (!h && !v) { rotation = 90;  flipH = false; flipV = true;  }
                                        else if (h && v)   { rotation = 90;  flipH = true;  flipV = false; }
                                    }

                                    if (matchedTs && matchedTs.isCollection && matchedTs.images) {
                                        const localId = gid - (matchedTs.firstgid || 1);
                                        const imgMap = collectionImageMaps.get(matchedTs.id);
                                        const imgObj = (imgMap ? (imgMap.get(`tileId_${localId}`) || imgMap.get(`id_${localId}`) || imgMap.get(`idx_${localId}`)) : null) ||
                                                       matchedTs.images[localId] ||
                                                       matchedTs.images[0];
                                        row.push({
                                            tilesetId: matchedTs.id,
                                            imageId: imgObj ? imgObj.id : null,
                                            flipH, flipV, rotation
                                        });
                                    } else {
                                        const tw = matchedTs.tilewidth || state.TILE_SIZE;
                                        const tsCols = matchedTs.columns || (matchedTs.imagewidth ? Math.floor(matchedTs.imagewidth / tw) : (matchedTs.image ? Math.floor(matchedTs.image.width / tw) : 1));
                                        const localId = gid - (matchedTs.firstgid !== undefined ? matchedTs.firstgid : 1);
                                        const tx = localId % tsCols;
                                        const ty = Math.floor(localId / tsCols);

                                        row.push({
                                            tilesetId: matchedTs.id,
                                            tx, ty,
                                            flipH, flipV, rotation
                                        });
                                    }
                                }
                            }
                            dataGrid.push(row);
                        }
                    } else {
                        // Safe fallback for objectgroup or non-data layers: create full 2D array initialized to null
                        dataGrid = [];
                        for (let y = 0; y < state.mapHeight; y++) {
                            const row = [];
                            for (let x = 0; x < state.mapWidth; x++) row.push(null);
                            dataGrid.push(row);
                        }
                    }

                    return {
                        id: l.id ? 'layer_' + l.id : 'layer_' + (lIdx + 1),
                        name: l.name,
                        type: 'tilelayer',
                        visible: l.visible !== undefined ? l.visible : true,
                        locked: !!layerProps.locked,
                        opacity: l.opacity !== undefined ? l.opacity : 1.0,
                        data: dataGrid,
                        terrainVertices: terrainVerts
                    };
                });
            }

            if (window.TileWeaver.terrainSwatches && typeof window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles === 'function') {
                window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
            }

            if (state.autotiles && state.autotiles.length > 0) state.activeAutotileId = state.autotiles[0].id;
            if (state.animatedTiles && state.animatedTiles.length > 0) state.activeAnimTileId = state.animatedTiles[0].id;

            if (window.TileWeaver.stateModule && typeof window.TileWeaver.stateModule.syncAssetsFromExistingTilesets === 'function') {
                window.TileWeaver.stateModule.syncAssetsFromExistingTilesets();
            }

            if (window.TileWeaver.assetManager && typeof window.TileWeaver.assetManager.updateAssetCountBadge === 'function') {
                window.TileWeaver.assetManager.updateAssetCountBadge();
                if (state.isAssetManagerOpen) {
                    if (typeof window.TileWeaver.assetManager.renderAssetGallery === 'function') {
                        window.TileWeaver.assetManager.renderAssetGallery();
                    }
                    if (typeof window.TileWeaver.assetManager.renderAssetInspector === 'function') {
                        window.TileWeaver.assetManager.renderAssetInspector(state.activeAssetId);
                    }
                }
            }

            // 5. Completely Synchronize Viewport Canvases, Layer Hierarchy, Swatches, and Dropdowns
            synchronizeAppAfterMapImport();

            if (onSuccess) onSuccess();
            showMessage(`Imported map with ${matchedAssetsCount} matched asset images from assets/`, "success");
        } catch (err) {
            console.error("Map import error:", err);
            showMessage("Failed to import map file.", "error");
        }
    }

    /**
     * Completely synchronizes application state, header input controls, canvas sizes,
     * layer stack cards, tileset selectors, terrain swatch cards, and dual-canvas viewports
     * after a map is imported.
     */
    function synchronizeAppAfterMapImport() {
        // 1. Synchronize Top Header Map Dimensions & Tile Size Inputs
        const inputW = document.getElementById('map-width-input');
        const inputH = document.getElementById('map-height-input');
        const inputSize = document.getElementById('tile-size-input');
        if (inputW) inputW.value = state.mapWidth;
        if (inputH) inputH.value = state.mapHeight;
        if (inputSize) inputSize.value = state.TILE_SIZE;

        // 2. Synchronize Active Tileset & Inspector Metric Inputs
        state.activeTilesetIndex = 0;
        const activeTs = state.tilesets ? state.tilesets[0] : null;
        if (activeTs) {
            ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = activeTs.margin || 0;
            });
            ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = activeTs.spacing || 0;
            });
        }
        state.selectedStamp = { col: 0, row: 0, width: 1, height: 1 };

        // 3. Resize All Canvases to Match state.mapWidth and state.mapHeight
        if (window.TileWeaver.rendering && typeof window.TileWeaver.rendering.resizeCanvases === 'function') {
            window.TileWeaver.rendering.resizeCanvases();
        }

        // 4. Synchronize Layer Stack Hierarchy UI
        if (window.TileWeaver.layerManager && typeof window.TileWeaver.layerManager.renderLayerUI === 'function') {
            window.TileWeaver.layerManager.renderLayerUI();
        }

        // 5. Synchronize Tileset, Autotile & Animation Selector Dropdowns
        if (window.TileWeaver.tilesetManager) {
            if (typeof window.TileWeaver.tilesetManager.renderTilesetSelect === 'function') {
                window.TileWeaver.tilesetManager.renderTilesetSelect();
            }
            if (typeof window.TileWeaver.tilesetManager.renderAutotileSelect === 'function') {
                window.TileWeaver.tilesetManager.renderAutotileSelect();
            }
            if (typeof window.TileWeaver.tilesetManager.renderAnimSelect === 'function') {
                window.TileWeaver.tilesetManager.renderAnimSelect();
            }
            if (typeof window.TileWeaver.tilesetManager.updateTransformUI === 'function') {
                window.TileWeaver.tilesetManager.updateTransformUI();
            }
        }

        // 6. Synchronize Material Terrain Swatches from Autotiles
        if (window.TileWeaver.terrainSwatches) {
            if (typeof window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles === 'function') {
                window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
            }
            if (typeof window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI === 'function') {
                window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
            }
        }

        // 7. Synchronize Asset Vault & Update Badge Count
        if (window.TileWeaver.stateModule && typeof window.TileWeaver.stateModule.syncAssetsFromExistingTilesets === 'function') {
            window.TileWeaver.stateModule.syncAssetsFromExistingTilesets();
        }
        if (window.TileWeaver.assetManager && typeof window.TileWeaver.assetManager.updateAssetCountBadge === 'function') {
            window.TileWeaver.assetManager.updateAssetCountBadge();
            if (state.isAssetManagerOpen && typeof window.TileWeaver.assetManager.renderAssetGallery === 'function') {
                window.TileWeaver.assetManager.renderAssetGallery();
                if (typeof window.TileWeaver.assetManager.renderAssetInspector === 'function') {
                    window.TileWeaver.assetManager.renderAssetInspector(state.activeAssetId);
                }
            }
        }

        // 8. Re-draw Tileset Canvas and Map Canvas
        if (window.TileWeaver.rendering) {
            if (typeof window.TileWeaver.rendering.drawTileset === 'function') {
                window.TileWeaver.rendering.drawTileset();
            }
            if (typeof window.TileWeaver.rendering.drawMap === 'function') {
                window.TileWeaver.rendering.drawMap();
            }
        }

        // 9. Reset Viewport Zoom & Pan to Frame Imported Map
        if (window.TileWeaver.viewport && typeof window.TileWeaver.viewport.resetZoom === 'function') {
            window.TileWeaver.viewport.resetZoom();
        }

        // 10. Update History Undo / Redo Toolbar Button States
        if (window.TileWeaver.history && typeof window.TileWeaver.history.updateHistoryButtons === 'function') {
            window.TileWeaver.history.updateHistoryButtons();
        }

        // 11. Update Tile Properties Inspector if open
        if (window.TileWeaver.tileProperties && typeof window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel === 'function') {
            window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
        }
    }

    /**
     * Packs all images of a Collection Tileset into a single composite Spritesheet Atlas PNG
     * and downloads the packed PNG atlas file.
     * @param {number} [tsIdx] - Index of collection tileset in state.tilesets (defaults to activeTilesetIndex).
     */
    function exportPackedAtlas(tsIdx = state.activeTilesetIndex) {
        const ts = state.tilesets ? state.tilesets[tsIdx] : null;
        if (!ts || !ts.isCollection || !ts.images || ts.images.length === 0) {
            showMessage("Select a non-empty Collection Tileset to export a packed atlas.", "error");
            return;
        }

        // Shelf packing algorithm for multi-sized collection images
        let totalWidth = 0;
        let totalHeight = 0;
        let maxRowHeight = 0;
        let currentX = 0;
        let currentY = 0;
        const maxAtlasWidth = 512;

        const positions = [];
        ts.images.forEach(imgObj => {
            const w = imgObj.width || state.TILE_SIZE;
            const h = imgObj.height || state.TILE_SIZE;

            if (currentX + w > maxAtlasWidth && currentX > 0) {
                currentX = 0;
                currentY += maxRowHeight;
                maxRowHeight = 0;
            }

            positions.push({ imgObj, x: currentX, y: currentY, w, h });
            currentX += w;
            maxRowHeight = Math.max(maxRowHeight, h);
            totalWidth = Math.max(totalWidth, currentX);
            totalHeight = Math.max(totalHeight, currentY + maxRowHeight);
        });

        const atlasCanvas = document.createElement('canvas');
        atlasCanvas.width = totalWidth;
        atlasCanvas.height = totalHeight;
        const ctx = atlasCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        positions.forEach(pos => {
            const imgEl = pos.imgObj.image;
            if (imgEl && imgEl.width > 0) {
                ctx.drawImage(imgEl, 0, 0, imgEl.naturalWidth || imgEl.width, imgEl.naturalHeight || imgEl.height, pos.x, pos.y, pos.w, pos.h);
            }
        });

        const cleanName = ts.name.toLowerCase().replace(/\s+/g, '_') + '_atlas.png';
        const a = document.createElement('a');
        a.download = cleanName;
        a.href = atlasCanvas.toDataURL('image/png');
        a.click();
        showMessage(`Exported Packed Atlas PNG (${cleanName}, ${totalWidth}x${totalHeight}px)`, "success");
    }

    // Expose export/import engine on window.TileWeaver namespace
    window.TileWeaver.exportImport = {
        downloadFile,
        exportNativeJSON,
        exportTiledTMJ,
        exportPNG,
        exportPackedAtlas,
        importMapJSON,
        analyzeMapJSON,
        createMissingAssetPlaceholder,
        synchronizeAppAfterMapImport
    };
})();
