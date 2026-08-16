/**
 * @fileoverview TileWeaver - Viewport Interactions & Drawing Tools Controller
 * @subsystem Canvas Rendering & Viewport Engine / UI Input Controller
 * @frameBudget Sub-millisecond pointer transforms (<0.5ms); strict 60 FPS requestAnimationFrame loop (<16.6ms)
 * @coordinateSpace ScreenPX -> CanvasBoundingRect -> ViewportPanZoom -> WorldMapPX -> GridTileXY (col, row)
 * @stateInvariants Mutates layer.data [H][W], layer.terrainVertices [H+1][W+1], passabilityGrid, regionGrid, objects, zoomLevel, panX, panY
 * @historyTracked Atomic snapshots recorded on mousedown (stroke start) and mouseup (object drag / stroke complete)
 * @exportCompatibility Full compatibility with Native JSON v3.3 and Tiled TMJ 1.10+ bottom-left GID objects
 * -----------------------------------------------------------------------------
 * Coordinates interactive canvas pointer and keyboard navigation events:
 * 1. Center-locked Wheel Zoom (0.25x to 4.0x) & Middle-click / Spacebar pan controls.
 * 2. Tile Painting (`paint`, `autotile`, `animtile`).
 * 3. Bucket Flood Fill (`floodFill` BFS algorithm with zero-allocation integer keys).
 * 4. Line & Rectangle shape tool drawing with direct iteration.
 * 5. Tile Eraser (`erase`) with neighbor autotile recalculation.
 * 6. Eyedropper Tile Picker (`picker` / Right-click) with in-place object search.
 * 7. Collision Passability editing (cycles flag 0..3: Default, O, X, *).
 * 8. Region ID painting (1..255).
 * 9. Dual-Grid Terrain Vertex toggling (`applyTerrainVertex`, `executeTerrainFloodFill`).
 * 10. Vector Scene Object translation, 8-handle resizing, and prop placement with Shift tile-snapping.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;
    const { updateAutotileCell, getAutotileTileForCell, getDualGridTileForCell } = window.TileWeaver.autotile;
    const { drawMap, drawTileset, getGridCoordinates, getLinePoints } = window.TileWeaver.rendering;

    /**
     * Breadth-First Search (BFS) Flood Fill Algorithm.
     * Fills connected matching cells on active layer with target tile stamp.
     * 
     * OPTIMIZATION (60 FPS Canvas): Uses packed 16-bit integer keys (row << 16 | col)
     * and pre-push visited checks to eliminate all temporary JS object heap allocations.
     * 
     * @param {number} layerIndex - Target layer index in state.mapLayers
     * @param {number} startCol - Initial column coordinate (0..mapWidth-1)
     * @param {number} startRow - Initial row coordinate (0..mapHeight-1)
     * @param {Object|null} targetTile - Tile structure to match against
     * @param {Object|null} fillTile - New tile structure to stamp
     */
    function floodFill(layerIndex, startCol, startRow, targetTile, fillTile) {
        const layer = state.mapLayers[layerIndex];
        if (!layer || !layer.data || startRow < 0 || startRow >= state.mapHeight || startCol < 0 || startCol >= state.mapWidth) return;
        if (!layer.data[startRow]) return;

        const isSameTile = (t1, t2) => {
            if (!t1 && !t2) return true;
            if (!t1 || !t2) return false;
            return t1.tx === t2.tx && t1.ty === t2.ty && t1.tilesetId === t2.tilesetId;
        };

        const target = layer.data[startRow][startCol];
        if (isSameTile(target, fillTile)) return;

        const startKey = (startRow << 16) | startCol;
        const queue = [startKey];
        const visited = new Set();
        visited.add(startKey);

        while (queue.length > 0) {
            const key = queue.pop();
            const col = key & 0xFFFF;
            const row = (key >>> 16) & 0xFFFF;

            if (row >= 0 && row < state.mapHeight && col >= 0 && col < state.mapWidth && layer.data[row]) {
                layer.data[row][col] = fillTile ? { ...fillTile } : null;

                const neighbors = [
                    (row << 16) | (col + 1),
                    (row << 16) | (col - 1),
                    ((row + 1) << 16) | col,
                    ((row - 1) << 16) | col
                ];

                for (let i = 0; i < 4; i++) {
                    const nKey = neighbors[i];
                    if (!visited.has(nKey)) {
                        const nCol = nKey & 0xFFFF;
                        const nRow = (nKey >>> 16) & 0xFFFF;
                        if (nCol >= 0 && nCol < state.mapWidth && nRow >= 0 && nRow < state.mapHeight && layer.data[nRow]) {
                            if (isSameTile(layer.data[nRow][nCol], target)) {
                                visited.add(nKey);
                                queue.push(nKey);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Eyedropper Tool: Selects tile or object at (col, row), updates Tileset Inspector, jumps/scrolls to selected tile/card,
     * updates live Tile Properties panel, and activates Paint / Object tool.
     * 
     * OPTIMIZATION (60 FPS Canvas): Replaced array allocation (.slice().reverse().find()) with in-place reverse loop.
     * 
     * @param {number} col - Tile cell column coordinate (0..mapWidth-1)
     * @param {number} row - Tile cell row coordinate (0..mapHeight-1)
     */
    function pickTile(col, row) {
        if (col < 0 || col >= state.mapWidth || row < 0 || row >= state.mapHeight) return;

        const cellX = col * state.TILE_SIZE;
        const cellY = row * state.TILE_SIZE;
        const tileSize = state.TILE_SIZE;

        for (let l = state.mapLayers.length - 1; l >= 0; l--) {
            const layer = state.mapLayers[l];
            if (!layer || !layer.visible) continue;

            // Handle Object Group Layer (objectgroup)
            if (layer.type === 'objectgroup' && layer.objects && layer.objects.length > 0) {
                let clickedObj = null;
                for (let i = layer.objects.length - 1; i >= 0; i--) {
                    const o = layer.objects[i];
                    if (o.visible === false) continue;

                    const objW = o.width || tileSize;
                    const objH = o.height || tileSize;

                    // INVARIANT: GID tile objects (placed tileset/collection props) use bottom-left origin in Tiled TMJ
                    const isGidObj = o.gid && o.gid > 0;
                    const minX = o.x;
                    const maxX = o.x + objW;
                    const minY = isGidObj ? (o.y - objH) : o.y;
                    const maxY = isGidObj ? o.y : (o.y + objH);

                    // Check if clicked tile cell overlaps the object's visual bounding box
                    if (cellX < maxX && (cellX + tileSize) > minX && cellY < maxY && (cellY + tileSize) > minY) {
                        clickedObj = o;
                        break;
                    }
                }

                if (clickedObj) {
                    state.selectedObjectId = clickedObj.id;
                    state.activeLayerIndex = l;

                    if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                        window.TileWeaver.layerManager.renderLayersList();
                    }

                    // Resolve object GID / Tileset ID / Image ID to tileset palette
                    let matchedTs = null;
                    if (clickedObj.gid && clickedObj.gid > 0) {
                        const rawGidWithFlags = clickedObj.gid;
                        const gid = (rawGidWithFlags >>> 0) & 0x1FFFFFFF;
                        for (let tsIdx = state.tilesets.length - 1; tsIdx >= 0; tsIdx--) {
                            if (gid >= (state.tilesets[tsIdx].firstgid || 1)) {
                                matchedTs = state.tilesets[tsIdx];
                                state.activeTilesetIndex = tsIdx;
                                const localId = gid - (matchedTs.firstgid || 1);
                                if (matchedTs.isCollection && matchedTs.images) {
                                    const imgObj = matchedTs.images.find(img => img.tileId === localId) ||
                                                   matchedTs.images.find(img => img.id === localId) ||
                                                   matchedTs.images[localId] ||
                                                   matchedTs.images[0];
                                    if (imgObj) matchedTs.activeImageId = imgObj.id;
                                } else {
                                    const tsCols = matchedTs.columns || Math.floor((matchedTs.image ? matchedTs.image.width : 160) / tileSize);
                                    const tx = localId % (tsCols > 0 ? tsCols : 1);
                                    const ty = Math.floor(localId / (tsCols > 0 ? tsCols : 1));
                                    state.selectedStamp = { col: tx, row: ty, width: 1, height: 1 };
                                }
                                break;
                            }
                        }
                    } else if (clickedObj.tilesetId) {
                        const tsIdx = state.tilesets.findIndex(t => t.id === clickedObj.tilesetId);
                        if (tsIdx >= 0) {
                            state.activeTilesetIndex = tsIdx;
                            matchedTs = state.tilesets[tsIdx];
                            if (matchedTs.isCollection && clickedObj.imageId) {
                                matchedTs.activeImageId = clickedObj.imageId;
                            }
                        }
                    }

                    if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
                        window.TileWeaver.tilesetManager.renderTilesetSelect();
                    }

                    if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                        window.TileWeaver.tools.selectTool('objectPlace');
                    }

                    if (window.TileWeaver.tileProperties) {
                        if (window.TileWeaver.tileProperties.ensureInspectorOpen) {
                            window.TileWeaver.tileProperties.ensureInspectorOpen();
                        }
                        if (window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                            window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                        }
                    }

                    if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.scrollToSelectedTile) {
                        window.TileWeaver.tilesetManager.scrollToSelectedTile();
                    }

                    drawTileset();
                    drawMap();

                    const objLabel = clickedObj.name || (matchedTs ? matchedTs.name : 'Object');
                    showMessage(`Picked Object ID #${clickedObj.id} ('${objLabel}') from ${layer.name}`, "info");
                    return;
                }
            }

            // Safe retrieval of cell tile object from 2D layer.data array
            const tile = (layer.data && layer.data[row]) ? layer.data[row][col] : null;
            
            // Check if cell is a dual-grid terrain cell
            if (layer.terrainVertices && layer.terrainVertices[row] && layer.terrainVertices[row][col] !== undefined && (tile && tile.autotileId)) {
                const at = state.autotiles.find(a => a.id === tile.autotileId);
                if (at && at.mode === 'dualgrid') {
                    const vertexVal = layer.terrainVertices[row][col];
                    const mat = window.TileWeaver.terrainSwatches ? window.TileWeaver.terrainSwatches.getMaterialByVertexValue(vertexVal) : null;
                    if (mat) {
                        state.activeLayerIndex = l;
                        state.selectedObjectId = null;
                        if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                            window.TileWeaver.layerManager.renderLayersList();
                        }
                        window.TileWeaver.terrainSwatches.selectMaterialSwatch(mat.id);
                        window.TileWeaver.terrainSwatches.setSidebarTab('swatches');
                        if (window.TileWeaver.tileProperties) {
                            if (window.TileWeaver.tileProperties.ensureInspectorOpen) {
                                window.TileWeaver.tileProperties.ensureInspectorOpen();
                            }
                            if (window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                                window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel(tile.tx || 0, tile.ty || 0);
                            }
                        }
                        return;
                    }
                }
            }

            if (tile) {
                state.activeLayerIndex = l;
                state.selectedObjectId = null;
                if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                    window.TileWeaver.layerManager.renderLayersList();
                }

                const tsIdx = state.tilesets.findIndex(t => t.id === tile.tilesetId);
                if (tsIdx >= 0) {
                    state.activeTilesetIndex = tsIdx;
                    
                    const matchedTs = state.tilesets[tsIdx];
                    if (matchedTs && matchedTs.isCollection) {
                        if (tile.imageId) matchedTs.activeImageId = tile.imageId;
                        if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
                            window.TileWeaver.tilesetManager.renderTilesetSelect();
                        }
                        const imgObj = matchedTs.images ? matchedTs.images.find(img => img.id === tile.imageId) : null;
                        const imgName = imgObj ? imgObj.name : 'Image';
                        if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                            window.TileWeaver.tools.selectTool('objectPlace');
                        }

                        if (window.TileWeaver.tileProperties) {
                            if (window.TileWeaver.tileProperties.ensureInspectorOpen) {
                                window.TileWeaver.tileProperties.ensureInspectorOpen();
                            }
                            if (window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                                window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                            }
                        }

                        if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.scrollToSelectedTile) {
                            window.TileWeaver.tilesetManager.scrollToSelectedTile();
                        }

                        drawTileset();
                        showMessage(`Picked Collection Item '${imgName}' from ${layer.name}`, "info");
                        return;
                    } else {
                        if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
                            window.TileWeaver.tilesetManager.renderTilesetSelect();
                        }
                    }
                }

                state.selectedStamp = { col: tile.tx || 0, row: tile.ty || 0, width: 1, height: 1 };
                window.TileWeaver.tools.selectTool('paint');

                if (window.TileWeaver.tileProperties) {
                    if (window.TileWeaver.tileProperties.ensureInspectorOpen) {
                        window.TileWeaver.tileProperties.ensureInspectorOpen();
                    }
                    if (window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                        window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel(tile.tx || 0, tile.ty || 0);
                    }
                }

                if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.scrollToSelectedTile) {
                    window.TileWeaver.tilesetManager.scrollToSelectedTile();
                }

                drawTileset();
                showMessage(`Picked Tile (${tile.tx || 0}, ${tile.ty || 0}) from ${layer.name}`, "info");
                return;
            }
        }
        showMessage("Clicked empty cell.", "info");
    }

    /**
     * Applies active drawing tool action to cell at (col, row).
     * 
     * @param {number} col - Tile column coordinate
     * @param {number} row - Tile row coordinate
     */
    function applyTool(col, row) {
        if (col < 0 || col >= state.mapWidth || row < 0 || row >= state.mapHeight) return;

        const layer = state.mapLayers[state.activeLayerIndex];
        if (!layer || layer.locked || !layer.visible) return;
        if (layer.type === 'objectgroup' || !layer.data || !layer.data[row]) return;

        const ts = state.tilesets[state.activeTilesetIndex];
        if (ts && ts.isCollection && ['paint', 'bucket', 'line', 'rect'].includes(state.currentTool)) {
            if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                window.TileWeaver.tools.selectTool('objectPlace');
            }
            showMessage("Object items cannot be painted on Tile layers. Switched to 'Tile Obj' tool.", "warning");
            return;
        }

        // Eraser Tool
        if (state.currentTool === 'erase') {
            layer.data[row][col] = null;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    updateAutotileCell(state.activeLayerIndex, col + dc, row + dr);
                }
            }
        } 
        // Paint Brush / Line / Rectangle Tools
        else if (state.currentTool === 'paint' || state.currentTool === 'line' || state.currentTool === 'rect') {
            if (!ts) return;

            for (let r = 0; r < state.selectedStamp.height; r++) {
                for (let c = 0; c < state.selectedStamp.width; c++) {
                    const targetC = col + c;
                    const targetR = row + r;
                    if (targetC < state.mapWidth && targetR < state.mapHeight) {
                        layer.data[targetR][targetC] = {
                            tx: state.selectedStamp.col + c,
                            ty: state.selectedStamp.row + r,
                            tilesetId: ts.id,
                            flipH: state.stampTransform.flipH,
                            flipV: state.stampTransform.flipV,
                            rotation: state.stampTransform.rotation
                        };
                    }
                }
            }
        } 
        // Autotile Brush Tool
        else if (state.currentTool === 'autotile') {
            if (!state.activeAutotileId) {
                showMessage("No autotile selected. Use the wizard or dropdown.", "error");
                return;
            }
            const at = state.autotiles.find(a => a.id === state.activeAutotileId);
            if (!at) return;

            const isStaticOverride = state.isShiftPressed;

            layer.data[row][col] = {
                tx: 0,
                ty: 0,
                tilesetId: at.tilesetId,
                autotileId: at.id,
                isStaticAutotile: isStaticOverride
            };

            if (isStaticOverride) {
                const sub = getAutotileTileForCell(state.activeLayerIndex, col, row, at.id);
                if (sub) {
                    layer.data[row][col].tx = sub.tx;
                    layer.data[row][col].ty = sub.ty;
                }
            }

            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    updateAutotileCell(state.activeLayerIndex, col + dc, row + dr);
                }
            }
        } 
        // Animated Tile Brush Tool
        else if (state.currentTool === 'animtile') {
            if (!state.activeAnimTileId) {
                showMessage("No Animated Tile selected. Select tiles and click 'Anim'.", "error");
                return;
            }
            const anim = state.animatedTiles.find(a => a.id === state.activeAnimTileId);
            if (!anim) return;

            layer.data[row][col] = {
                tx: anim.frames[0].tx,
                ty: anim.frames[0].ty,
                tilesetId: anim.tilesetId,
                animTileId: anim.id
            };
        } 
        // Collision Passability Tool
        else if (state.currentTool === 'passability') {
            let current = state.passabilityGrid[row][col];
            current = (current + 1) % 4;
            state.passabilityGrid[row][col] = current;
        } 
        // Region ID Tool
        else if (state.currentTool === 'region') {
            state.regionGrid[row][col] = state.currentRegionId;
        }
    }

    /**
     * Sets Dual-Grid vertex state(s) across all 4 corner vertices of cell(s) within terrainBrushRadius.
     * 
     * @param {number} centerCol - Tile cell column coordinate (0..mapWidth-1)
     * @param {number} centerRow - Tile cell row coordinate (0..mapHeight-1)
     * @param {number|null} [forceValue=null] - Optional fixed target value, or null to use state.terrainStrokeValue
     */
    function applyTerrainVertex(centerCol, centerRow, forceValue = null) {
        let targetLayerIndex = state.activeLayerIndex;
        let layer = state.mapLayers[targetLayerIndex];
        if (!layer || !layer.terrainVertices) return;
        if (centerRow < 0 || centerRow >= state.mapHeight || centerCol < 0 || centerCol >= state.mapWidth) return;

        const R = Math.max(0, (state.terrainBrushRadius || 1) - 1);
        const targetVal = (forceValue !== null) 
            ? forceValue 
            : ((state.terrainStrokeValue !== undefined && state.terrainStrokeValue !== null) ? state.terrainStrokeValue : 0);

        const at = state.autotiles.find(a => a.id === state.activeAutotileId);
        const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
        const tsId = at ? at.tilesetId : (activeTs ? activeTs.id : '');
        const autoId = at ? at.id : 'at_dirt_dualgrid';

        // Set all 4 corner vertices for every cell in brush radius R
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                if (dx * dx + dy * dy <= R * R) {
                    const c = centerCol + dx;
                    const r = centerRow + dy;
                    if (c >= 0 && c < state.mapWidth && r >= 0 && r < state.mapHeight) {
                        for (let vy = r; vy <= r + 1; vy++) {
                            for (let vx = c; vx <= c + 1; vx++) {
                                if (vy >= 0 && vy <= state.mapHeight && vx >= 0 && vx <= state.mapWidth) {
                                    layer.terrainVertices[vy][vx] = targetVal;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Re-evaluate autotile cell data for all cells in expanded cell neighborhood (including 8-dir reactive wall face + base footing rows below)
        const minC = Math.max(0, centerCol - R - 3);
        const maxC = Math.min(state.mapWidth - 1, centerCol + R + 3);
        const minR = Math.max(0, centerRow - R - 1);
        const maxR = Math.min(state.mapHeight - 1, centerRow + R + 6);

        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                layer.data[r][c] = {
                    tx: 0,
                    ty: 0,
                    tilesetId: tsId,
                    autotileId: autoId
                };
                const sub = getDualGridTileForCell(targetLayerIndex, c, r, autoId);
                if (sub) {
                    layer.data[r][c].tx = sub.tx;
                    layer.data[r][c].ty = sub.ty;
                    if (sub.tilesetId) layer.data[r][c].tilesetId = sub.tilesetId;
                }
            }
        }
    }

    /**
     * Executes Queue BFS terrain flood fill on 2D vertex array layer.terrainVertices.
     * Replaces contiguous region of matching startVal with targetVal in O(N) linear time.
     * 
     * OPTIMIZATION (60 FPS Canvas): Eliminated O(N^2) Array.prototype.shift() overhead using
     * a pointer-indexed queue (head++) and packed 16-bit vertex keys ((vy << 16) | vx).
     * 
     * @param {number} startVx - Starting vertex column (0..mapWidth)
     * @param {number} startVy - Starting vertex row (0..mapHeight)
     * @param {number} targetVal - Material swatch vertex value to fill
     */
    function executeTerrainFloodFill(startVx, startVy, targetVal) {
        const layer = state.mapLayers[state.activeLayerIndex];
        if (!layer || !layer.terrainVertices) return;
        if (startVy < 0 || startVy > state.mapHeight || startVx < 0 || startVx > state.mapWidth) return;

        const verts = layer.terrainVertices;
        if (!verts[startVy] || verts[startVy][startVx] === undefined) return;
        const startVal = verts[startVy][startVx];
        if (startVal === targetVal) return;

        const startKey = (startVy << 16) | startVx;
        const queue = [startKey];
        const visited = new Set();
        visited.add(startKey);

        const at = state.autotiles.find(a => a.id === state.activeAutotileId);
        const tsId = at ? at.tilesetId : (state.tilesets[0] ? state.tilesets[0].id : '');
        const autoId = at ? at.id : 'at_dirt_dualgrid';

        let head = 0;
        while (head < queue.length) {
            const key = queue[head++];
            const vx = key & 0xFFFF;
            const vy = (key >>> 16) & 0xFFFF;

            if (vy >= 0 && vy <= state.mapHeight && vx >= 0 && vx <= state.mapWidth && verts[vy]) {
                verts[vy][vx] = targetVal;

                // Update surrounding 4 cells with boundary checks
                for (let dr = -1; dr <= 0; dr++) {
                    for (let dc = -1; dc <= 0; dc++) {
                        const c = vx + dc;
                        const r = vy + dr;
                        if (c >= 0 && c < state.mapWidth && r >= 0 && r < state.mapHeight && layer.data && layer.data[r]) {
                            layer.data[r][c] = { tx: 0, ty: 0, tilesetId: tsId, autotileId: autoId };
                            const sub = getDualGridTileForCell(state.activeLayerIndex, c, r, autoId);
                            if (sub) {
                                layer.data[r][c].tx = sub.tx;
                                layer.data[r][c].ty = sub.ty;
                                if (sub.tilesetId) layer.data[r][c].tilesetId = sub.tilesetId;
                            }
                        }
                    }
                }

                // Check 4 adjacent orthogonal neighbors (Right, Left, Down, Up)
                const neighbors = [
                    (vy << 16) | (vx + 1),
                    (vy << 16) | (vx - 1),
                    ((vy + 1) << 16) | vx,
                    ((vy - 1) << 16) | vx
                ];
                for (let i = 0; i < 4; i++) {
                    const nKey = neighbors[i];
                    if (!visited.has(nKey)) {
                        const nx = nKey & 0xFFFF;
                        const ny = (nKey >>> 16) & 0xFFFF;
                        if (ny >= 0 && ny <= state.mapHeight && nx >= 0 && nx <= state.mapWidth && verts[ny]) {
                            if (verts[ny][nx] === startVal) {
                                visited.add(nKey);
                                queue.push(nKey);
                            }
                        }
                    }
                }
            }
        }
    }

    /** Updates visibility of Viewport Contextual HUD panels based on active tool */
    function updateContextualHUD(toolName) {
        const hud = document.getElementById('contextual-viewport-hud');
        const stampPanel = document.getElementById('hud-stamp-panel');
        const terrainPanel = document.getElementById('hud-terrain-panel');
        const passabilityPanel = document.getElementById('hud-passability-panel');

        if (!hud) return;

        // Hide all sub-panels first
        if (stampPanel) stampPanel.classList.add('hidden');
        if (terrainPanel) terrainPanel.classList.add('hidden');
        if (passabilityPanel) passabilityPanel.classList.add('hidden');

        if (['paint', 'autotile', 'animtile'].includes(toolName)) {
            if (stampPanel) stampPanel.classList.remove('hidden');
            hud.classList.remove('opacity-0', 'pointer-events-none');
        } else if (['terrain', 'terrainBucket'].includes(toolName)) {
            if (terrainPanel) terrainPanel.classList.remove('hidden');
            hud.classList.remove('opacity-0', 'pointer-events-none');
        } else if (toolName === 'passability') {
            if (passabilityPanel) passabilityPanel.classList.remove('hidden');
            hud.classList.remove('opacity-0', 'pointer-events-none');
        } else {
            if (stampPanel) stampPanel.classList.remove('hidden');
            hud.classList.remove('opacity-0');
        }
    }

    /**
     * Synchronizes zoom percentage label and canvas-wrapper CSS transform.
     */
    function updateZoomUI() {
        const zoomLabel = document.getElementById('zoom-label');
        if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoomLevel * 100)}%`;

        const wrapper = document.getElementById('canvas-wrapper');
        if (wrapper) {
            wrapper.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
        }
    }

    /**
     * Updates viewport zoom level while keeping the center of the viewport window
     * locked onto the current map coordinates being viewed.
     * 
     * INVARIANT: zoomLevel is clamped strictly within [0.25, 4.0].
     * 
     * @param {number} newZoom - Desired target zoom level (clamped between 0.25 and 4.0).
     */
    function setZoomLevel(newZoom) {
        const oldZoom = state.zoomLevel || 1.0;
        const clampedZoom = Math.min(4.0, Math.max(0.25, Math.round(newZoom * 100) / 100));
        if (clampedZoom === oldZoom) return;

        const zoomRatio = clampedZoom / oldZoom;
        state.panX = Math.round(state.panX * zoomRatio * 100) / 100;
        state.panY = Math.round(state.panY * zoomRatio * 100) / 100;
        state.zoomLevel = clampedZoom;

        updateZoomUI();
        drawMap();
    }

    /**
     * Resets viewport zoom to 1.0 (100%) and centers pan at (0, 0).
     */
    function resetZoom() {
        state.zoomLevel = 1.0;
        state.panX = 0;
        state.panY = 0;
        updateZoomUI();
        drawMap();
    }

    /**
     * Initializes viewport canvas mouse, wheel, object manipulation, and sidebar resize listeners.
     */
    function initViewportUI() {
        const mapContainer = document.getElementById('map-container');
        const mapCanvas = document.getElementById('map-canvas');
        if (!mapCanvas || !mapContainer) return;

        // Viewport Wheel Zoom (0.25x to 4.0x) focusing on current viewport window center
        mapContainer.addEventListener('wheel', (e) => {
            // Ignore wheel events that originated inside the bottom tileset dock or contextual HUD panels
            if (e.target && e.target.closest && (e.target.closest('#dock-tileset-panel') || e.target.closest('#contextual-viewport-hud'))) {
                return;
            }
            e.preventDefault();
            const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
            setZoomLevel(state.zoomLevel + zoomDelta);
        }, { passive: false });

        // Helper: Hit-test 8 resize handles of currently selected object
        function findResizeHandleAt(obj, pixelX, pixelY) {
            if (!obj) return null;
            const boundsX = (obj.gid && obj.gid > 0) ? obj.x : obj.x;
            const boundsY = (obj.gid && obj.gid > 0) ? (obj.y - (obj.height || state.TILE_SIZE)) : obj.y;
            const boundsW = obj.width || state.TILE_SIZE;
            const boundsH = obj.height || state.TILE_SIZE;
            const hSize = 8;

            const handles = [
                { id: 'tl', x: boundsX, y: boundsY, cursor: 'nwse-resize' },
                { id: 'tr', x: boundsX + boundsW, y: boundsY, cursor: 'nesw-resize' },
                { id: 'bl', x: boundsX, y: boundsY + boundsH, cursor: 'nesw-resize' },
                { id: 'br', x: boundsX + boundsW, y: boundsY + boundsH, cursor: 'nwse-resize' },
                { id: 't',  x: boundsX + boundsW / 2, y: boundsY, cursor: 'ns-resize' },
                { id: 'b',  x: boundsX + boundsW / 2, y: boundsY + boundsH, cursor: 'ns-resize' },
                { id: 'l',  x: boundsX, y: boundsY + boundsH / 2, cursor: 'ew-resize' },
                { id: 'r',  x: boundsX + boundsW, y: boundsY + boundsH / 2, cursor: 'ew-resize' }
            ];

            for (let i = 0; i < handles.length; i++) {
                const h = handles[i];
                if (Math.abs(pixelX - h.x) <= hSize && Math.abs(pixelY - h.y) <= hSize) {
                    return h;
                }
            }
            return null;
        }

        // Helper: Hit-test objects on active or all object layers
        function findObjectAtPixel(pixelX, pixelY) {
            const layersToSearch = [];
            const activeLayer = state.mapLayers[state.activeLayerIndex];
            if (activeLayer && activeLayer.type === 'objectgroup') layersToSearch.push(activeLayer);
            state.mapLayers.forEach(l => {
                if (l.type === 'objectgroup' && l !== activeLayer && l.visible) layersToSearch.push(l);
            });

            for (let li = 0; li < layersToSearch.length; li++) {
                const layer = layersToSearch[li];
                if (!layer.objects) continue;
                for (let i = layer.objects.length - 1; i >= 0; i--) {
                    const o = layer.objects[i];
                    if (o.visible === false) continue;
                    const objW = o.width || state.TILE_SIZE;
                    const objH = o.height || state.TILE_SIZE;
                    const isGid = o.gid && o.gid > 0;
                    const minX = o.x;
                    const maxX = o.x + objW;
                    const minY = isGid ? (o.y - objH) : o.y;
                    const maxY = isGid ? o.y : (o.y + objH);

                    if (pixelX >= minX && pixelX <= maxX && pixelY >= minY && pixelY <= maxY) {
                        return { obj: o, layer };
                    }
                }
            }
            return null;
        }

        // Pan Mode start handler (Spacebar or Middle-Click)
        function startPanning(e) {
            if (state.isSpacePressed || e.button === 1) {
                e.preventDefault();
                state.isPanning = true;
                state.panStartX = e.clientX - state.panX;
                state.panStartY = e.clientY - state.panY;
                mapContainer.classList.add('cursor-grabbing');
                return true;
            }
            return false;
        }

        // Helper: Performs discrete step calculation for vector object dragging / resizing
        function applyObjectDragStep(e) {
            if (!state.objectDragState) return;
            const coords = (window.TileWeaver.rendering.getCanvasPixelCoordinates)
                ? window.TileWeaver.rendering.getCanvasPixelCoordinates(mapCanvas, e)
                : getGridCoordinates(mapCanvas, e);
            const pixelX = coords.x || (coords.col * state.TILE_SIZE);
            const pixelY = coords.y || (coords.row * state.TILE_SIZE);
            const ds = state.objectDragState;
            const dx = pixelX - ds.startX;
            const dy = pixelY - ds.startY;
            const isSnap = state.isShiftPressed;

            if (ds.mode === 'translate') {
                let newX = ds.origX + dx;
                let newY = ds.origY + dy;
                if (isSnap) {
                    newX = Math.round(newX / state.TILE_SIZE) * state.TILE_SIZE;
                    newY = Math.round(newY / state.TILE_SIZE) * state.TILE_SIZE;
                } else {
                    newX = Math.round(newX);
                    newY = Math.round(newY);
                }
                ds.obj.x = newX;
                ds.obj.y = newY;
            } else if (ds.mode === 'resize') {
                const handle = ds.handle;
                let newX = ds.origX;
                let newY = ds.origY;
                let newW = ds.origW;
                let newH = ds.origH;

                if (handle.includes('r')) newW = Math.max(8, ds.origW + dx);
                if (handle.includes('l')) {
                    const potentialW = ds.origW - dx;
                    if (potentialW >= 8) {
                        newX = ds.origX + dx;
                        newW = potentialW;
                    }
                }
                if (handle.includes('b')) newH = Math.max(8, ds.origH + dy);
                if (handle.includes('t')) {
                    const potentialH = ds.origH - dy;
                    if (potentialH >= 8) {
                        newY = ds.origY + dy;
                        newH = potentialH;
                    }
                }

                if (isSnap) {
                    newX = Math.round(newX / state.TILE_SIZE) * state.TILE_SIZE;
                    newY = Math.round(newY / state.TILE_SIZE) * state.TILE_SIZE;
                    newW = Math.max(state.TILE_SIZE, Math.round(newW / state.TILE_SIZE) * state.TILE_SIZE);
                    newH = Math.max(state.TILE_SIZE, Math.round(newH / state.TILE_SIZE) * state.TILE_SIZE);
                } else {
                    newX = Math.round(newX);
                    newY = Math.round(newY);
                    newW = Math.round(newW);
                    newH = Math.round(newH);
                }

                ds.obj.x = newX;
                ds.obj.y = newY;
                ds.obj.width = newW;
                ds.obj.height = newH;
            }
        }

        // Allow panning to start from map container background
        mapContainer.addEventListener('mousedown', (e) => {
            if (e.target && e.target.closest && (e.target.closest('#dock-tileset-panel') || e.target.closest('#contextual-viewport-hud'))) {
                return;
            }
            if (startPanning(e)) return;
        });

        // Suppress native middle-click autoscroll / auxiliary click defaults
        mapContainer.addEventListener('auxclick', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        // Viewport Mouse Down
        mapCanvas.addEventListener('mousedown', (e) => {
            // Pan Mode (Spacebar or Middle-Click)
            if (startPanning(e)) return;

            // Right-Click Tile Picker
            if (e.button === 2) {
                const { col, row } = getGridCoordinates(mapCanvas, e);
                pickTile(col, row);
                return;
            }

            const activeLayer = state.mapLayers[state.activeLayerIndex];
            const coords = (window.TileWeaver.rendering.getCanvasPixelCoordinates)
                ? window.TileWeaver.rendering.getCanvasPixelCoordinates(mapCanvas, e)
                : getGridCoordinates(mapCanvas, e);

            const pixelX = coords.x || (coords.col * state.TILE_SIZE);
            const pixelY = coords.y || (coords.row * state.TILE_SIZE);
            const { col, row } = coords;

            // Handle Object Layer & Object Tool Interactions
            if ((activeLayer && activeLayer.type === 'objectgroup') || state.currentTool.startsWith('object') || state.currentTool.startsWith('shape')) {
                // 1. Check if clicking on an 8-handle of currently selected object
                if (state.selectedObjectId) {
                    const selRef = window.TileWeaver.objectInspector ? window.TileWeaver.objectInspector.getSelectedObjectRef() : null;
                    if (selRef && selRef.obj) {
                        const hitHandle = findResizeHandleAt(selRef.obj, pixelX, pixelY);
                        if (hitHandle) {
                            state.objectDragState = {
                                mode: 'resize',
                                handle: hitHandle.id,
                                obj: selRef.obj,
                                startX: pixelX,
                                startY: pixelY,
                                origX: selRef.obj.x,
                                origY: selRef.obj.y,
                                origW: selRef.obj.width || state.TILE_SIZE,
                                origH: selRef.obj.height || state.TILE_SIZE
                            };
                            return;
                        }
                    }
                }

                // 2. Check if clicking on an object body
                const hitObjRef = findObjectAtPixel(pixelX, pixelY);
                if (hitObjRef) {
                    state.selectedObjectId = hitObjRef.obj.id;
                    const hitLayerIdx = state.mapLayers.findIndex(l => l === hitObjRef.layer);
                    if (hitLayerIdx >= 0) state.activeLayerIndex = hitLayerIdx;

                    if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                        window.TileWeaver.layerManager.renderLayersList();
                    }

                    if (window.TileWeaver.tileProperties) {
                        if (window.TileWeaver.tileProperties.ensureInspectorOpen) {
                            window.TileWeaver.tileProperties.ensureInspectorOpen();
                        }
                        if (window.TileWeaver.tileProperties.renderTilePropertiesForm) {
                            window.TileWeaver.tileProperties.renderTilePropertiesForm();
                        }
                    }

                    state.objectDragState = {
                        mode: 'translate',
                        obj: hitObjRef.obj,
                        startX: pixelX,
                        startY: pixelY,
                        origX: hitObjRef.obj.x,
                        origY: hitObjRef.obj.y
                    };

                    drawMap();
                    return;
                }

                // 3. Clicked empty space on Object Layer / Object Tool
                if (state.currentTool === 'objectPlace') {
                    const ts = state.tilesets[state.activeTilesetIndex];
                    if (ts) {
                        let gidVal = undefined;
                        let tileW = state.TILE_SIZE;
                        let tileH = state.TILE_SIZE;
                        let objName = `${ts.name} Object`;
                        let objType = '';
                        let alignment = ts.objectalignment || undefined;
                        let inheritedCustom = {};
                        let imgObj = null;

                        const metaKeys = new Set(['imageId', 'name', 'anchor', '__imageData', 'filename', 'imagePath']);

                        if (ts.isCollection && ts.images && ts.images.length > 0) {
                            imgObj = ts.images.find(img => img.id === ts.activeImageId) || ts.images[0];
                            if (imgObj) {
                                tileW = imgObj.width || state.TILE_SIZE;
                                tileH = imgObj.height || state.TILE_SIZE;
                                gidVal = (ts.firstgid || 1) + (imgObj.tileId !== undefined ? imgObj.tileId : 0);
                                objName = imgObj.name || `${ts.name} Object`;
                                alignment = imgObj.anchor || ts.objectalignment || undefined;

                                const sourceProps = imgObj.tileProperties || (ts.tileProperties ? ts.tileProperties[imgObj.id] : null) || {};
                                if (sourceProps.custom && typeof sourceProps.custom === 'object') {
                                    Object.entries(sourceProps.custom).forEach(([k, v]) => {
                                        if (!metaKeys.has(k)) inheritedCustom[k] = v;
                                    });
                                }
                                Object.entries(sourceProps).forEach(([k, v]) => {
                                    if (k !== 'custom' && !metaKeys.has(k) && typeof v !== 'object') {
                                        inheritedCustom[k] = v;
                                    }
                                });
                                objType = sourceProps.type || sourceProps.class || (sourceProps.terrainType && sourceProps.terrainType !== 'Meadow' && sourceProps.terrainType !== 'Props' ? sourceProps.terrainType : '');
                            }
                        } else {
                            gidVal = (ts.firstgid || 1) + (state.selectedStamp.row * (ts.columns || 1) + state.selectedStamp.col);
                            const col = state.selectedStamp.col;
                            const row = state.selectedStamp.row;
                            const rawKey = `${col}_${row}`;
                            const tileKey = `tile_${col}_${row}`;
                            const sourceProps = (ts.tileProperties ? (ts.tileProperties[rawKey] || ts.tileProperties[tileKey]) : null) || {};

                            if (sourceProps.custom && typeof sourceProps.custom === 'object') {
                                Object.assign(inheritedCustom, sourceProps.custom);
                            }
                            objName = sourceProps.name || `${ts.name} Tile`;
                            objType = sourceProps.terrainType || '';
                        }

                        if (gidVal) {
                            pushHistoryState();
                            const newObj = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
                                name: objName,
                                type: objType,
                                x: pixelX,
                                y: pixelY,
                                width: tileW,
                                height: tileH,
                                gid: gidVal,
                                alignment: alignment,
                                tilesetId: ts.id,
                                imageId: (ts.isCollection && imgObj) ? imgObj.id : undefined,
                                custom: inheritedCustom
                            });
                            return;
                        }
                    }
                } else if (state.currentTool === 'shapeRect' || state.currentTool === 'shapeEllipse' || state.currentTool === 'shapeText') {
                    pushHistoryState();
                    const newObj = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
                        name: state.currentTool === 'shapeText' ? 'Text Label' : 'New Shape',
                        x: pixelX,
                        y: pixelY,
                        width: state.TILE_SIZE,
                        height: state.TILE_SIZE,
                        ellipse: state.currentTool === 'shapeEllipse' ? true : undefined,
                        text: state.currentTool === 'shapeText' ? { text: 'Text Label', fontfamily: 'sans-serif', pixelsize: 16, color: '#ffffff' } : undefined
                    });

                    if (newObj) {
                        state.objectDragState = {
                            mode: 'resize',
                            handle: 'br',
                            obj: newObj,
                            startX: pixelX,
                            startY: pixelY,
                            origX: pixelX,
                            origY: pixelY,
                            origW: state.TILE_SIZE,
                            origH: state.TILE_SIZE
                        };
                    }
                    return;
                } else if (state.currentTool === 'shapePoint') {
                    pushHistoryState();
                    window.TileWeaver.objectInspector.createObjectOnActiveLayer({
                        name: 'WayPoint',
                        x: pixelX,
                        y: pixelY,
                        width: 16,
                        height: 16,
                        point: true
                    });
                    return;
                }

                // Clicked empty space in object select mode: deselect
                state.selectedObjectId = null;
                if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.renderTilePropertiesForm) {
                    window.TileWeaver.tileProperties.renderTilePropertiesForm();
                }
                drawMap();
                return;
            }

            state.isDrawing = true;
            if (window.TileWeaver.terrainSwatches && typeof window.TileWeaver.terrainSwatches.setRibbonDrawingFade === 'function') {
                window.TileWeaver.terrainSwatches.setRibbonDrawingFade(true);
            }
            pushHistoryState();

            if (state.currentTool === 'picker') {
                pickTile(col, row);
                state.isDrawing = false;
                return;
            }

            if (state.currentTool === 'bucket') {
                const ts = state.tilesets[state.activeTilesetIndex];
                const fillTile = (state.currentTool === 'erase' || !ts) ? null : {
                    tx: state.selectedStamp.col,
                    ty: state.selectedStamp.row,
                    tilesetId: ts.id,
                    flipH: state.stampTransform.flipH,
                    flipV: state.stampTransform.flipV,
                    rotation: state.stampTransform.rotation
                };
                floodFill(state.activeLayerIndex, col, row, state.mapLayers[state.activeLayerIndex].data[row][col], fillTile);
                drawMap();
                return;
            }

            if (state.currentTool === 'line' || state.currentTool === 'rect') {
                state.shapeStartCol = col;
                state.shapeStartRow = row;
                return;
            }

            if (state.currentTool === 'terrainBucket') {
                const layer = state.mapLayers[state.activeLayerIndex];
                if (layer && layer.terrainVertices && row >= 0 && row < state.mapHeight && col >= 0 && col < state.mapWidth) {
                    const activeVal = (state.terrainStrokeValue !== undefined && state.terrainStrokeValue !== null) ? state.terrainStrokeValue : 0;
                    const sampleVx = Math.min(state.mapWidth, Math.max(0, col));
                    const sampleVy = Math.min(state.mapHeight, Math.max(0, row));
                    const targetVal = activeVal;
                    executeTerrainFloodFill(sampleVx, sampleVy, targetVal);
                    window.TileWeaver.history.pushHistoryState();
                    drawMap();
                }
                return;
            }

            if (state.currentTool === 'terrain') {
                const layer = state.mapLayers[state.activeLayerIndex];
                if (layer && layer.terrainVertices && row >= 0 && row < state.mapHeight && col >= 0 && col < state.mapWidth) {
                    const activeVal = (state.terrainStrokeValue !== undefined && state.terrainStrokeValue !== null) ? state.terrainStrokeValue : 0;
                    const strokeVal = activeVal;
                    state.currentTerrainPaintValue = strokeVal;
                    applyTerrainVertex(col, row, strokeVal);
                    state.lastTerrainCol = col;
                    state.lastTerrainRow = row;
                }
                drawMap();
            } else {
                applyTool(col, row);
                drawMap();
            }
        });

        // Viewport Mouse Move (Unified RAF-Gated Dispatcher)
        let isPanMovePending = false;
        let isMouseMovePending = false;
        let lastMoveEvent = null;

        window.addEventListener('mousemove', (e) => {
            if (state.isPanning) {
                state.panX = e.clientX - state.panStartX;
                state.panY = e.clientY - state.panStartY;
                if (!isPanMovePending) {
                    isPanMovePending = true;
                    requestAnimationFrame(() => {
                        isPanMovePending = false;
                        const wrapper = document.getElementById('canvas-wrapper');
                        if (wrapper) {
                            wrapper.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
                        }
                    });
                }
                return;
            }

            lastMoveEvent = e;
            if (isMouseMovePending) return;
            isMouseMovePending = true;

            requestAnimationFrame(() => {
                isMouseMovePending = false;
                const evt = lastMoveEvent || e;
                if (!evt) return;

                // Handle Active Object Dragging & Resizing inside RAF loop
                if (state.objectDragState) {
                    applyObjectDragStep(evt);
                    if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.renderTilePropertiesForm) {
                        window.TileWeaver.tileProperties.renderTilePropertiesForm();
                    }
                    drawMap();
                    return;
                }

                const coords = (window.TileWeaver.rendering.getCanvasPixelCoordinates)
                    ? window.TileWeaver.rendering.getCanvasPixelCoordinates(mapCanvas, evt)
                    : getGridCoordinates(mapCanvas, evt);

                const pixelX = coords.x || (coords.col * state.TILE_SIZE);
                const pixelY = coords.y || (coords.row * state.TILE_SIZE);
                const { col, row } = coords;

                const activeLayer = state.mapLayers[state.activeLayerIndex];
                const isObjectContext = (activeLayer && activeLayer.type === 'objectgroup') || state.currentTool.startsWith('object') || state.currentTool.startsWith('shape');

                const pixelChanged = (pixelX !== state.hoverPixelX || pixelY !== state.hoverPixelY);
                const cellChanged = (col !== state.hoverCol || row !== state.hoverRow);

                state.hoverPixelX = pixelX;
                state.hoverPixelY = pixelY;

                // Check resize handle hovering for cursor feedback
                if (state.selectedObjectId) {
                    const selRef = window.TileWeaver.objectInspector ? window.TileWeaver.objectInspector.getSelectedObjectRef() : null;
                    if (selRef && selRef.obj) {
                        const hHit = findResizeHandleAt(selRef.obj, pixelX, pixelY);
                        state.hoveredResizeHandle = hHit ? hHit.id : null;
                        mapCanvas.style.cursor = hHit ? hHit.cursor : '';
                    }
                }

                if (state.isDrawing && state.currentTool === 'terrain') {
                    if (cellChanged) {
                        state.lastTerrainCol = col;
                        state.lastTerrainRow = row;
                        const dragVal = (state.currentTerrainPaintValue !== undefined && state.currentTerrainPaintValue !== null)
                            ? state.currentTerrainPaintValue
                            : ((state.terrainStrokeValue !== undefined && state.terrainStrokeValue !== null) ? state.terrainStrokeValue : 0);
                        applyTerrainVertex(col, row, dragVal);
                        drawMap();
                    }
                }

                if (cellChanged || (isObjectContext && pixelChanged)) {
                    state.hoverCol = col;
                    state.hoverRow = row;

                    if (state.isDrawing && state.currentTool !== 'line' && state.currentTool !== 'rect' && state.currentTool !== 'bucket' && state.currentTool !== 'terrain') {
                        applyTool(col, row);
                    }
                    drawMap();
                }
            });
        });

        // Viewport Mouse Up
        window.addEventListener('mouseup', (e) => {
            if (state.isPanning) {
                state.isPanning = false;
                mapContainer.classList.remove('cursor-grabbing');
                drawMap();
            }

            if (state.objectDragState) {
                // FLUSH INVARIANT: Apply final pointer coordinate delta immediately before clearing drag state
                applyObjectDragStep(e);
                state.objectDragState = null;
                pushHistoryState();
                if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.renderTilePropertiesForm) {
                    window.TileWeaver.tileProperties.renderTilePropertiesForm();
                }
                drawMap();
            }

            if (state.isDrawing) {
                if (state.currentTool === 'line') {
                    const { col, row } = getGridCoordinates(mapCanvas, e);
                    const points = getLinePoints(state.shapeStartCol, state.shapeStartRow, col, row);
                    for (let i = 0; i < points.length; i++) {
                        applyTool(points[i].col, points[i].row);
                    }
                } else if (state.currentTool === 'rect') {
                    const { col, row } = getGridCoordinates(mapCanvas, e);
                    const minC = Math.min(state.shapeStartCol, col);
                    const maxC = Math.max(state.shapeStartCol, col);
                    const minR = Math.min(state.shapeStartRow, row);
                    const maxR = Math.max(state.shapeStartRow, row);
                    for (let r = minR; r <= maxR; r++) {
                        for (let c = minC; c <= maxC; c++) {
                            applyTool(c, r);
                        }
                    }
                }
                state.isDrawing = false;
                if (window.TileWeaver.terrainSwatches) {
                    if (typeof window.TileWeaver.terrainSwatches.setRibbonDrawingFade === 'function') {
                        window.TileWeaver.terrainSwatches.setRibbonDrawingFade(false);
                    }
                    if (typeof window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI === 'function') {
                        window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
                    }
                    if (typeof window.TileWeaver.terrainSwatches.renderSwatchRibbonHUD === 'function') {
                        window.TileWeaver.terrainSwatches.renderSwatchRibbonHUD();
                    }
                }
                drawMap();
            }
        });

        // Sidebar Resizer Drag & Drop Listener (RAF Throttled)
        const resizer = document.getElementById('sidebar-resizer');
        const sidebar = document.getElementById('sidebar-container');
        const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

        if (resizer && sidebar) {
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            let isResizePending = false;
            let lastClientX = 0;

            resizer.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startWidth = sidebar.getBoundingClientRect().width;
                resizer.classList.add('is-resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                lastClientX = e.clientX;
                if (!isResizePending) {
                    isResizePending = true;
                    requestAnimationFrame(() => {
                        isResizePending = false;
                        if (!isResizing) return;
                        const newWidth = Math.min(540, Math.max(320, startWidth + (lastClientX - startX)));
                        sidebar.style.width = `${newWidth}px`;
                        drawMap();
                    });
                }
            });

            window.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    isResizePending = false;
                    resizer.classList.remove('is-resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });
        }

        // Sidebar Collapse Toggle
        if (btnToggleSidebar && sidebar) {
            btnToggleSidebar.addEventListener('click', () => {
                sidebar.classList.toggle('sidebar-collapsed');
                drawMap();
            });
        }

        mapCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    // Expose viewport controller on window.TileWeaver namespace
    window.TileWeaver.viewport = {
        floodFill,
        pickTile,
        applyTool,
        applyTerrainVertex,
        executeTerrainFloodFill,
        updateContextualHUD,
        setZoomLevel,
        resetZoom,
        updateZoomUI,
        initViewportUI
    };
})();
