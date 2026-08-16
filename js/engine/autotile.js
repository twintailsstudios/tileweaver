/**
 * @fileoverview autotile.js - TileWeaver Autotiling & Dual-Grid Bitmask Engine
 * @subsystem Autotiling, Dual-Grid & Bitmask Math Engine
 * @frameBudget <0.25ms (Budgeted execution cost within 16.6ms 60 FPS window)
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY (col, row)
 * @stateInvariants Single-source-of-truth reactive state mutations on state.mapLayers[l].data
 * @historyTracked Snapshots coalesced on pointerup via history.pushHistoryState()
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+
 * -------------------------------------------------------------------------------------
 * Computes neighboring tile relationships and maps cells to appropriate autotile
 * sub-tiles based on 5 engine modes:
 * 
 * Mode 1: `9slice` (3x3 outer boundary corner/edge matching).
 * Mode 2: `dualgrid` (4-corner vertex bitmasks 0..15 matching terrain boundaries).
 * Mode 3: `16tile` (4-neighbor cardinal bitmask 0..15 for 1-tile wide paths & crossroads).
 * Mode 4: `25tile` (Extended 9-slice + 45° diagonal ramps & inner corners).
 * Mode 5: `47tile` (Full RPG Maker A2 format with concave corner cutouts).
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { MODE_SLOTS } = window.TileWeaver.constants;
    const { state } = window.TileWeaver.stateModule;

    /**
     * Immutable 16-Tile Cardinal Bitmask Key Table.
     * Maps 4-bit cardinal neighbor bitmask (Bit 0: North, Bit 1: East, Bit 2: South, Bit 3: West) to slot names.
     * OPTIMIZATION (60 FPS Hot Path): Hoisted to module scope and frozen to eliminate 16 string object allocations per wall cell.
     */
    const BITMASK_16_KEYS = Object.freeze([
        'post',     // 0: 0000 (isolated post / pillar)
        'capS',     // 1: 0001 (connected North -> Bottom cap on South side)
        'capW',     // 2: 0010 (connected East -> Left cap on West side)
        'cornerBL', // 3: 0011 (connected North + East: └)
        'capN',     // 4: 0100 (connected South -> Top cap on North side)
        'pipeV',    // 5: 0101 (connected North + South: ┃)
        'cornerTL', // 6: 0110 (connected South + East: ┌)
        'tWest',    // 7: 0111 (connected North + South + East: ├)
        'capE',     // 8: 1000 (connected West -> Right cap on East side)
        'cornerBR', // 9: 1001 (connected North + West: ┘)
        'pipeH',    // 10: 1010 (connected East + West: ━)
        'tSouth',   // 11: 1011 (connected North + East + West: ┴)
        'cornerTR', // 12: 1100 (connected South + West: ┐)
        'tEast',    // 13: 1101 (connected North + South + West: ┤)
        'tNorth',   // 14: 1110 (connected South + East + West: ┬)
        'cross'     // 15: 1111 (connected North + South + East + West: ┼)
    ]);

    /**
     * Evaluates neighboring cells around (col, row) and resolves the appropriate autotile slot.
     * 
     * @param {number} layerIndex - Target layer index.
     * @param {number} col - Cell column coordinate.
     * @param {number} row - Cell row coordinate.
     * @param {string} autotileId - ID of autotile definition to evaluate.
     * @returns {Object|null} Object containing `{ tx, ty }` tile coordinates on tileset.
     */
    function getAutotileTileForCell(layerIndex, col, row, autotileId) {
        const at = state.autotiles.find(a => a.id === autotileId);
        if (!at) return null;
        const m = at.mapping;
        const mode = at.mode || '9slice';
        const isWall = mode === '16tile' || mode === 'wall_9x3' || mode === 'wall' || at.isWall;

        /** Helper: Checks if cell at (c, r) shares the same autotile ID */
        function sameAT(c, r) {
            if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) {
                return isWall ? false : true; // Out-of-bounds cells do NOT connect to isolated walls
            }
            const cell = state.mapLayers[layerIndex].data[r][c];
            return cell && cell.autotileId === autotileId;
        }

        // Cardinal Neighbor Matches (North, South, West, East)
        const n = sameAT(col, row - 1);
        const s = sameAT(col, row + 1);
        const w = sameAT(col - 1, row);
        const e = sameAT(col + 1, row);

        // --- Mode: Cliffside Vertical Wall Projection (cliff_vstretch) ---
        if (mode === 'cliff_vstretch' || at.isCliff) {
            return getCliffAutotileTileForCell(layerIndex, col, row, autotileId);
        }

        // --- Mode: 16-Tile Cardinal Wall, Corridor & Path Resolution (Cardinal Bitmask 0..15) ---
        if (isWall) {
            const bitmask = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
            const slotKey = BITMASK_16_KEYS[bitmask];
            let res = m[slotKey];
            if (!res) {
                if (slotKey === 'post') res = m['iso'];
                else if (slotKey === 'pipeV') res = m['vertPipe'];
                else if (slotKey === 'cross') res = m['horizPipe'] || m['solid'];
            }
            return (Array.isArray(res) && res.length > 0) ? res[0] : (res || m['post'] || m['iso'] || m['pipeH'] || m['solid']);
        }

        // --- Mode: 25-Tile Diagonal Slopes & Ramp Resolution ---
        if (mode === '25tile') {
            const nw = sameAT(col - 1, row - 1);
            const ne = sameAT(col + 1, row - 1);
            const sw = sameAT(col - 1, row + 1);
            const se = sameAT(col + 1, row + 1);

            // Check 45° Diagonal Slopes
            if (e && s && !se && !n && !w) return m['slopeSE'] || m['topLeft'];
            if (w && s && !sw && !n && !e) return m['slopeSW'] || m['topRight'];
            if (e && n && !ne && !s && !w) return m['slopeNE'] || m['bottomLeft'];
            if (w && n && !nw && !s && !e) return m['slopeNW'] || m['bottomRight'];

            // 9-Slice Boundary Matching
            if (n && s && w && e) return m['center'];
            if (!n && s && w && e) return m['top'];
            if (n && !s && w && e) return m['bottom'];
            if (n && s && !w && e) return m['left'];
            if (n && s && w && !e) return m['right'];
            if (!n && s && !w && e) return m['topLeft'];
            if (!n && s && w && !e) return m['topRight'];
            if (n && !s && !w && e) return m['bottomLeft'];
            if (n && !s && w && !e) return m['bottomRight'];
            return m['center'];
        }

        // --- Mode: 47-Tile Full RPG Maker Inner-Corner Cutouts ---
        if (mode === '47tile') {
            const nw = sameAT(col - 1, row - 1);
            const ne = sameAT(col + 1, row - 1);
            const sw = sameAT(col - 1, row + 1);
            const se = sameAT(col + 1, row + 1);

            // Check Inner Concave Corner Cutouts
            if (n && e && !ne) return m['innerTR'] || m['center'];
            if (n && w && !nw) return m['innerTL'] || m['center'];
            if (s && e && !se) return m['innerBR'] || m['center'];
            if (s && w && !sw) return m['innerBL'] || m['center'];

            if (n && s && w && e) return m['center'];
            if (!n && s && w && e) return m['top'];
            if (n && !s && w && e) return m['bottom'];
            if (n && s && !w && e) return m['left'];
            if (n && s && w && !e) return m['right'];
            if (!n && s && !w && e) return m['topLeft'];
            if (!n && s && w && !e) return m['topRight'];
            if (n && !s && !w && e) return m['bottomLeft'];
            if (n && !s && w && !e) return m['bottomRight'];
            return m['center'];
        }

        // --- Default Mode: 9-Slice Outer Block ---
        if (n && s && w && e) return m.center;
        if (!n && s && w && e) return m.top;
        if (n && !s && w && e) return m.bottom;
        if (n && s && !w && e) return m.left;
        if (n && s && w && !e) return m.right;
        if (!n && s && !w && e) return m.topLeft;
        if (!n && s && w && !e) return m.topRight;
        if (n && !s && !w && e) return m.bottomLeft;
        if (n && !s && w && !e) return m.bottomRight;
        return m.center;
    }

    /**
     * Resolves Dual-Grid 4-corner vertex state for cell at (col, row).
     * Calculates 4-bit binary mask based on top-left, top-right, bottom-left, and bottom-right vertex states.
     * Supports multi-material integer vertex values (0, 1, 2, ...).
     * 
     * @param {number|Object} layerIndex - Target layer index or layer object.
     * @param {number} col - Cell column coordinate.
     * @param {number} row - Cell row coordinate.
     * @param {string} autotileId - Target autotile ID.
     * @returns {Object|null} Mapped `{ tx, ty }` tile coordinates or composite descriptor.
     */
    function getDualGridTileForCell(layerIndex, col, row, autotileId) {
        let at = state.autotiles.find(a => a.id === autotileId);
        const layer = (typeof layerIndex === 'object' && layerIndex !== null) ? layerIndex : state.mapLayers[layerIndex];
        if (!layer || !layer.terrainVertices) {
            if (!at) return null;
            const m = at.mapping;
            return m['grid_0'] || Object.values(m)[0];
        }
        const verts = layer.terrainVertices;

        // Fetch 4 vertex values surrounding cell (col, row)
        const vTL = (row < verts.length && col < verts[row].length) ? verts[row][col] : 0;
        const vTR = (row < verts.length && col + 1 < verts[row].length) ? verts[row][col + 1] : 0;
        const vBL = (row + 1 < verts.length && col < verts[row + 1].length) ? verts[row + 1][col] : 0;
        const vBR = (row + 1 < verts.length && col + 1 < verts[row + 1].length) ? verts[row + 1][col + 1] : 0;

        const quad = [vTL, vTR, vBL, vBR];
        const uniqueVals = Array.from(new Set(quad));

        // --- Cliff Autotile Set Evaluation (Cliff Top Surface & Auto Wall Spawning) ---
        function isCliffMaterial(mat) {
            if (!mat) return false;
            if (mat.isCliff) return true;
            const nameLower = mat.name ? mat.name.toLowerCase() : '';
            return state.autotiles.some(a => (a.isCliff || a.mode === 'cliff_vstretch') && a.mat1Name && a.mat1Name.toLowerCase() === nameLower);
        }

        // OPTIMIZATION (60 FPS Hot Path): Zero-allocation direct index loop replacing state.autotiles.filter
        for (let i = 0; i < state.autotiles.length; i++) {
            const cliffAT = state.autotiles[i];
            if (!cliffAT.isCliff && cliffAT.mode !== 'cliff_vstretch') continue;
            const mat1Name = cliffAT.mat1Name ? cliffAT.mat1Name.toLowerCase() : '';
            const mat1Obj = (state.materials || []).find(m => m.name.toLowerCase() === mat1Name);
            if (!mat1Obj || !isCliffMaterial(mat1Obj)) continue;

            const cliffVal = mat1Obj.vertexVal;

            const cellHasCliffVerts = (c, r) => {
                if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) return false;
                const v0 = verts[r] ? verts[r][c] : 0;
                const v1 = verts[r] ? verts[r][c + 1] : 0;
                const v2 = verts[r + 1] ? verts[r + 1][c] : 0;
                const v3 = verts[r + 1] ? verts[r + 1][c + 1] : 0;
                return (v0 === cliffVal || v1 === cliffVal || v2 === cliffVal || v3 === cliffVal);
            };

            const isWallFaceAtCell = (c, r) => {
                if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) return false;
                const v0 = verts[r] ? verts[r][c] : 0;
                const v1 = verts[r] ? verts[r][c + 1] : 0;
                const v2 = verts[r + 1] ? verts[r + 1][c] : 0;
                const v3 = verts[r + 1] ? verts[r + 1][c + 1] : 0;
                const bm = (v0 === cliffVal ? 1 : 0) | (v1 === cliffVal ? 2 : 0) | (v2 === cliffVal ? 4 : 0) | (v3 === cliffVal ? 8 : 0);
                if (bm > 0) return false;
                if (r - 1 >= 0) {
                    const vTL_a = verts[r - 1][c];
                    const vTR_a = verts[r - 1][c + 1];
                    const maskA = (vTL_a === cliffVal ? 1 : 0) | (vTR_a === cliffVal ? 2 : 0);
                    return maskA > 0;
                }
                return false;
            };

            const isBaseFootingAtCell = (c, r) => {
                if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) return false;
                const v0 = verts[r] ? verts[r][c] : 0;
                const v1 = verts[r] ? verts[r][c + 1] : 0;
                const v2 = verts[r + 1] ? verts[r + 1][c] : 0;
                const v3 = verts[r + 1] ? verts[r + 1][c + 1] : 0;
                const bm = (v0 === cliffVal ? 1 : 0) | (v1 === cliffVal ? 2 : 0) | (v2 === cliffVal ? 4 : 0) | (v3 === cliffVal ? 8 : 0);
                if (bm > 0) return false;
                if (r - 2 >= 0) {
                    const vTL_a2 = verts[r - 2][c];
                    const vTR_a2 = verts[r - 2][c + 1];
                    const maskA2 = (vTL_a2 === cliffVal ? 1 : 0) | (vTR_a2 === cliffVal ? 2 : 0);
                    return maskA2 > 0;
                }
                return false;
            };

            const cellHasRightWallFace = (c, r) => {
                return cellHasCliffVerts(c + 1, r - 1) && !cellHasCliffVerts(c + 1, r);
            };

            const cellHasLeftWallFace = (c, r) => {
                return cellHasCliffVerts(c - 1, r - 1) && !cellHasCliffVerts(c - 1, r);
            };

            const hasLeftCliffWallFace = (c, r) => {
                const ulWall = cellHasCliffVerts(c - 1, r - 1) && !cellHasCliffVerts(c - 1, r);
                const lWall = cellHasCliffVerts(c - 1, r) && !cellHasCliffVerts(c - 1, r + 1);
                const llWall = cellHasCliffVerts(c - 1, r + 1) && !cellHasCliffVerts(c - 1, r + 2);
                return ulWall || lWall || llWall;
            };

            const hasRightCliffWallFace = (c, r) => {
                const urWall = cellHasCliffVerts(c + 1, r - 1) && !cellHasCliffVerts(c + 1, r);
                const rWall = cellHasCliffVerts(c + 1, r) && !cellHasCliffVerts(c + 1, r + 1);
                const lrWall = cellHasCliffVerts(c + 1, r + 1) && !cellHasCliffVerts(c + 1, r + 2);
                return urWall || rWall || lrWall;
            };

            const hasWallAbove = (c, r) => {
                if (r - 1 < 0) return false;
                return cellHasCliffVerts(c, r - 1) || isWallFaceAtCell(c, r - 1) || isBaseFootingAtCell(c, r - 1);
            };

            const hasWallTopRight = (c, r) => {
                const trCol = c + 1;
                const trRow = r - 1;
                if (trRow < 0 || trCol >= state.mapWidth) return false;
                const vTL_tr = verts[trRow] ? verts[trRow][trCol] === cliffVal : false;
                const vTR_tr = verts[trRow] ? verts[trRow][trCol + 1] === cliffVal : false;
                return (vTL_tr || vTR_tr) || isWallFaceAtCell(trCol, trRow) || isBaseFootingAtCell(trCol, trRow) || isWallFaceAtCell(trCol, r);
            };

            const hasWallTopLeft = (c, r) => {
                const tlCol = c - 1;
                const tlRow = r - 1;
                if (tlRow < 0 || tlCol < 0) return false;
                const vTL_tl = verts[tlRow] ? verts[tlRow][tlCol] === cliffVal : false;
                const vTR_tl = verts[tlRow] ? verts[tlRow][tlCol + 1] === cliffVal : false;
                return (vTL_tl || vTR_tl) || isWallFaceAtCell(tlCol, tlRow) || isBaseFootingAtCell(tlCol, tlRow) || isWallFaceAtCell(tlCol, r);
            };

            // 1. Check if cell (col, row) itself contains cliff top vertices
            const hasCliffVert = (vTL === cliffVal || vTR === cliffVal || vBL === cliffVal || vBR === cliffVal);
            if (hasCliffVert) {
                const bitmask = (vTL === cliffVal ? 1 : 0) | (vTR === cliffVal ? 2 : 0) | (vBL === cliffVal ? 4 : 0) | (vBR === cliffVal ? 8 : 0);
                if (bitmask > 0) {
                    const m = cliffAT.mapping;
                    let slotKey = `grid_${bitmask}`;

                    // Check for Row 5 Alternative Wall-Top Edge Tiles (swapped when Cliff Wall exists directly above)
                    const wallAbove = hasWallAbove(col, row);

                    if (bitmask === 8) {
                        // Outer TL Corner: (0,0) -> (5,0) Alt Outer TL Corner if wall above
                        if (wallAbove) slotKey = 'cliff_top_alt_tl';
                    } else if (bitmask === 12) {
                        // Top Straight Edge: (0,1) -> (5,1) Alt Top Edge if wall above
                        if (wallAbove) slotKey = 'cliff_top_alt_top';
                    } else if (bitmask === 4) {
                        // Outer TR Corner: (0,2) -> (5,2) Alt Outer TR Corner if wall above
                        if (wallAbove) slotKey = 'cliff_top_alt_tr';
                    } else if (bitmask === 13) {
                        // Inner TR Cutout (cutout at Top-Right): (1,3) -> (5,3) Alt Inner TR Cutout if cliff wall at top-right
                        if (hasWallTopRight(col, row)) slotKey = 'cliff_top_alt_inner_br';
                    } else if (bitmask === 14) {
                        // Inner TL Cutout (cutout at Top-Left): (1,4) -> (5,4) Alt Inner TL Cutout if cliff wall at top-left
                        if (hasWallTopLeft(col, row)) slotKey = 'cliff_top_alt_inner_bl';
                    } else if (bitmask === 3) {
                        // Specialized exposed side drop profile check for Lip Rim overhangs & Outer corners
                        const leftCellHasCliff = cellHasCliffVerts(col - 1, row);
                        const rightCellHasCliff = cellHasCliffVerts(col + 1, row);
                        const rightWallFace = cellHasRightWallFace(col, row);
                        const leftWallFace = cellHasLeftWallFace(col, row);

                        if ((!leftCellHasCliff && rightCellHasCliff) || leftWallFace) {
                            slotKey = 'cliff_drop_side'; // Tile (1,5) - Left Wall Side Drop Profile
                        } else if ((!rightCellHasCliff && leftCellHasCliff) || rightWallFace) {
                            slotKey = 'cliff_top_cap';  // Tile (2,5) - Right Wall Side Drop Profile
                        } else {
                            slotKey = 'grid_3';         // Tile (2,1) - Standard Plateau Lip Rim Edge
                        }
                    } else if (bitmask === 1) {
                        // Outer BR corner: (2,2) -> (5,6) Alt Outer BR Corner if wall above AND wall to the right
                        const wallRight = cellHasCliffVerts(col + 1, row) || isWallFaceAtCell(col + 1, row) || isBaseFootingAtCell(col + 1, row);
                        if (cellHasRightWallFace(col, row) || hasRightCliffWallFace(col, row)) {
                            slotKey = 'cliff_top_cap';  // Tile (2,5) - Right Wall Side Drop Profile
                        } else if (wallAbove && wallRight) {
                            slotKey = 'cliff_top_alt_br'; // Tile (5,6) - Alt Outer BR Corner
                        } else {
                            slotKey = 'grid_1';         // Tile (2,2) - Normal Outer BR Corner (grass to the right)
                        }
                    } else if (bitmask === 2) {
                        // Outer BL corner: (2,0) -> (5,5) Alt Outer BL Corner if wall above AND wall to the left
                        const wallLeft = cellHasCliffVerts(col - 1, row) || isWallFaceAtCell(col - 1, row) || isBaseFootingAtCell(col - 1, row);
                        if (cellHasLeftWallFace(col, row) || hasLeftCliffWallFace(col, row)) {
                            slotKey = 'cliff_drop_side'; // Tile (1,5) - Left Wall Side Drop Profile
                        } else if (wallAbove && wallLeft) {
                            slotKey = 'cliff_top_alt_bl'; // Tile (5,5) - Alt Outer BL Corner
                        } else {
                            slotKey = 'grid_2';         // Tile (2,0) - Normal Outer BL Corner (grass to the left)
                        }
                    } else if (bitmask === 10) {
                        // Left edge of cliff top (grid_10 / Tile 1,0):
                        const leftIsWallFace = isWallFaceAtCell(col - 1, row);
                        const leftIsBaseFooting = isBaseFootingAtCell(col - 1, row);

                        if (leftIsWallFace) {
                            slotKey = 'cliff_side_l';    // Tile (3,5) - Upper Left Cliff Wall Join
                        } else if (leftIsBaseFooting || (row - 1 >= 0 && cellHasCliffVerts(col - 1, row - 1))) {
                            slotKey = 'cliff_side_l2';   // Tile (4,5) - Lower Left Cliff Wall Join (Tile 3,5 directly above)
                        }
                    } else if (bitmask === 5) {
                        // Right edge of cliff top (grid_5 / Tile 1,2):
                        const rightIsWallFace = isWallFaceAtCell(col + 1, row);
                        const rightIsBaseFooting = isBaseFootingAtCell(col + 1, row);

                        if (rightIsWallFace) {
                            slotKey = 'cliff_side_r';    // Tile (3,6) - Upper Right Cliff Wall Join
                        } else if (rightIsBaseFooting || (row - 1 >= 0 && cellHasCliffVerts(col + 1, row - 1))) {
                            slotKey = 'cliff_side_r2';   // Tile (4,6) - Lower Right Cliff Wall Join (Tile 3,6 directly above)
                        }
                    }

                    const rawEntry = m[slotKey] || m[`grid_${bitmask}`] || m['grid_15'] || Object.values(m)[0];
                    const entry = resolveSlotEntry(rawEntry, col, row);
                    if (entry) {
                        return {
                            tx: entry.tx,
                            ty: entry.ty,
                            tilesetId: cliffAT.tilesetId,
                            autotileId: cliffAT.id
                        };
                    }
                }
            } else {
                // 2. Cell (col, row) has no cliff top vertices (bitmask === 0). Check if 1 row directly below a cliff top bottom edge!
                if (row - 1 >= 0) {
                    const vTL_a = verts[row - 1][col];
                    const vTR_a = verts[row - 1][col + 1];
                    const vBL_a = verts[row][col];
                    const vBR_a = verts[row][col + 1];
                    const maskAbove = (vTL_a === cliffVal ? 1 : 0) | (vTR_a === cliffVal ? 2 : 0) | (vBL_a === cliffVal ? 4 : 0) | (vBR_a === cliffVal ? 8 : 0);

                    if (maskAbove === 3 || maskAbove === 2 || maskAbove === 1 || maskAbove === 10 || maskAbove === 5 || maskAbove === 14 || maskAbove === 13) {
                        const m = cliffAT.mapping;
                        let slotKey = 'cliff_face_mid';

                        if (maskAbove === 3) {
                            const leftCellHasCliffAbove = cellHasCliffVerts(col - 1, row - 1);
                            const rightCellHasCliffAbove = cellHasCliffVerts(col + 1, row - 1);
                            const rightWallFaceAbove = cellHasRightWallFace(col, row - 1);
                            const leftWallFaceAbove = cellHasLeftWallFace(col, row - 1);

                            if ((!leftCellHasCliffAbove && rightCellHasCliffAbove) || leftWallFaceAbove) {
                                slotKey = leftWallFaceAbove ? 'cliff_face_v1' : 'cliff_face_l'; // Tile (3,3) or Outer Left (3,0)
                            } else if ((!rightCellHasCliffAbove && leftCellHasCliffAbove) || rightWallFaceAbove) {
                                slotKey = rightWallFaceAbove ? 'cliff_face_v2' : 'cliff_face_r'; // Tile (3,4) or Outer Right (3,2)
                            } else {
                                slotKey = 'cliff_face_mid'; // Tile (3,1) - Spawns 1 row below Tile (2,1)
                            }
                        } else if (maskAbove === 2) {
                            if (cellHasLeftWallFace(col, row - 1) || hasLeftCliffWallFace(col, row - 1)) {
                                slotKey = 'cliff_face_v1'; // Tile (3,3) - Spawns 1 row below Tile (1,5)
                            } else {
                                slotKey = 'cliff_face_l';  // Tile (3,0) - Spawns 1 row below Outer BL Tile (2,0)
                            }
                        } else if (maskAbove === 1) {
                            if (cellHasRightWallFace(col, row - 1) || hasRightCliffWallFace(col, row - 1)) {
                                slotKey = 'cliff_face_v2'; // Tile (3,4) - Spawns 1 row below Tile (2,5)
                            } else {
                                slotKey = 'cliff_face_r';  // Tile (3,2) - Spawns 1 row below Outer BR Tile (2,2)
                            }
                        } else if (maskAbove === 10) {
                            if (hasLeftCliffWallFace(col, row - 1)) {
                                slotKey = 'cliff_face_v2'; // Tile (3,4) - Spawns 1 row directly below Tile (3,5)
                            }
                        } else if (maskAbove === 5) {
                            if (hasRightCliffWallFace(col, row - 1)) {
                                slotKey = 'cliff_face_v1'; // Tile (3,3) - Spawns 1 row directly below Tile (4,5)
                            }
                        }

                        const rawEntry = m[slotKey] || m['cliff_face_mid'] || Object.values(m)[0];
                        const entry = resolveSlotEntry(rawEntry, col, row);
                        if (entry) {
                            return {
                                tx: entry.tx,
                                ty: entry.ty,
                                tilesetId: cliffAT.tilesetId,
                                autotileId: cliffAT.id
                            };
                        }
                    }
                }

                // 3. Check if 2 rows directly below a cliff top bottom edge!
                if (row - 2 >= 0) {
                    const vTL_a2 = verts[row - 2][col];
                    const vTR_a2 = verts[row - 2][col + 1];
                    const vBL_a2 = verts[row - 1][col];
                    const vBR_a2 = verts[row - 1][col + 1];
                    const mask2Above = (vTL_a2 === cliffVal ? 1 : 0) | (vTR_a2 === cliffVal ? 2 : 0) | (vBL_a2 === cliffVal ? 4 : 0) | (vBR_a2 === cliffVal ? 8 : 0);

                    if (mask2Above === 3 || mask2Above === 2 || mask2Above === 1 || mask2Above === 10 || mask2Above === 5 || mask2Above === 14 || mask2Above === 13) {
                        const m = cliffAT.mapping;
                        let slotKey = 'cliff_base_shadow';

                        // Evaluate corresponding Tier 2 wall face key at (col, row - 1)
                        let wallFaceKey = 'cliff_face_mid';
                        if (mask2Above === 3) {
                            const leftCellHasCliff2Above = cellHasCliffVerts(col - 1, row - 2);
                            const rightCellHasCliff2Above = cellHasCliffVerts(col + 1, row - 2);
                            const rightWallFace2Above = cellHasRightWallFace(col, row - 2);
                            const leftWallFace2Above = cellHasLeftWallFace(col, row - 2);

                            if ((!leftCellHasCliff2Above && rightCellHasCliff2Above) || leftWallFace2Above) {
                                wallFaceKey = leftWallFace2Above ? 'cliff_face_v1' : 'cliff_face_l';
                            } else if ((!rightCellHasCliff2Above && leftCellHasCliff2Above) || rightWallFace2Above) {
                                wallFaceKey = rightWallFace2Above ? 'cliff_face_v2' : 'cliff_face_r';
                            } else {
                                wallFaceKey = 'cliff_face_mid';
                            }
                        } else if (mask2Above === 2) {
                            if (cellHasLeftWallFace(col, row - 2) || hasLeftCliffWallFace(col, row - 2)) {
                                wallFaceKey = 'cliff_face_v1';
                            } else {
                                wallFaceKey = 'cliff_face_l';
                            }
                        } else if (mask2Above === 1) {
                            if (cellHasRightWallFace(col, row - 2) || hasRightCliffWallFace(col, row - 2)) {
                                wallFaceKey = 'cliff_face_v2';
                            } else {
                                wallFaceKey = 'cliff_face_r';
                            }
                        } else if (mask2Above === 10) {
                            if (hasLeftCliffWallFace(col, row - 2)) {
                                wallFaceKey = 'cliff_face_v2';
                            }
                        } else if (mask2Above === 5) {
                            if (hasRightCliffWallFace(col, row - 2)) {
                                wallFaceKey = 'cliff_face_v1';
                            }
                        }

                        // Map Tier 2 Wall Face to Tier 3 Base Footing 1-to-1
                        if (wallFaceKey === 'cliff_face_l') slotKey = 'cliff_base_bl';
                        else if (wallFaceKey === 'cliff_face_r') slotKey = 'cliff_base_br';
                        else if (wallFaceKey === 'cliff_face_v1') slotKey = 'cliff_blend_l';
                        else if (wallFaceKey === 'cliff_face_v2') slotKey = 'cliff_blend_r';
                        else slotKey = 'cliff_base_shadow';

                        const rawEntry = m[slotKey] || m['cliff_base_shadow'] || Object.values(m)[0];
                        const entry = resolveSlotEntry(rawEntry, col, row);
                        if (entry) {
                            return {
                                tx: entry.tx,
                                ty: entry.ty,
                                tilesetId: cliffAT.tilesetId,
                                autotileId: cliffAT.id
                            };
                        }
                    }
                }
            }
        }

        // Case 1: Pure single-material tile (all 4 vertices are equal)
        if (uniqueVals.length === 1) {
            const val = uniqueVals[0];
            const mat = window.TileWeaver.terrainSwatches
                ? window.TileWeaver.terrainSwatches.getMaterialByVertexValue(val)
                : null;
            if (mat) {
                let slotEntry = null;
                if (mat.autotileIds && mat.autotileIds.length > 0) {
                    const matAT = state.autotiles.find(a => mat.autotileIds.includes(a.id) && !a.isCliff && a.mode !== 'cliff_vstretch')
                        || state.autotiles.find(a => a.id === mat.autotileIds[0]);
                    if (matAT && matAT.mapping) {
                        const isMat1 = matAT.mat1Name && matAT.mat1Name.toLowerCase() === mat.name.toLowerCase();
                        const slotKey = isMat1 ? (matAT.isCliff ? 'grid_15' : 'grid_0') : 'grid_15';
                        const rawEntry = matAT.mapping[slotKey];
                        if (rawEntry) {
                            slotEntry = resolveSlotEntry(rawEntry, col, row);
                        }
                    }
                }
                const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
                const tsId = mat.tilesetId || (at ? at.tilesetId : (activeTs ? activeTs.id : ''));
                return {
                    tx: slotEntry ? slotEntry.tx : (mat.tx || 0),
                    ty: slotEntry ? slotEntry.ty : (mat.ty || 0),
                    tilesetId: tsId
                };
            }
        }

        // Case 2: Multi-material cell (2 or more distinct vertex values in quad)
        if (uniqueVals.length >= 2) {
            // Map vertex values to material definitions
            const valMaterialMap = new Map();
            uniqueVals.forEach(v => {
                const mat = window.TileWeaver.terrainSwatches
                    ? window.TileWeaver.terrainSwatches.getMaterialByVertexValue(v)
                    : null;
                if (mat) valMaterialMap.set(v, mat);
            });

            // Collect materials present and sort by priority ascending (0 = lowest base, higher = overlay)
            const materialsPresent = uniqueVals
                .map(v => valMaterialMap.get(v))
                .filter(Boolean)
                .sort((a, b) => (a.priority || 0) - (b.priority || 0));

            // Sub-case 2A: Exactly 2 Materials Present - Check Direct Pairwise Autotile
            if (uniqueVals.length === 2 && materialsPresent.length === 2) {
                const val1 = uniqueVals[0];
                const val2 = uniqueVals[1];
                const mat1 = valMaterialMap.get(val1);
                const mat2 = valMaterialMap.get(val2);

                if (mat1 && mat2) {
                    const pairwiseAT = findPairwiseAutotile(mat1, mat2);
                    if (pairwiseAT) {
                        const name1 = mat1.name.toLowerCase();
                        let overlayVal = val2;
                        if (pairwiseAT.mat2Name) {
                            const targetOverlayName = pairwiseAT.mat2Name.toLowerCase();
                            overlayVal = (name1 === targetOverlayName) ? val1 : val2;
                        } else if (pairwiseAT.mat1Name) {
                            const targetBaseName = pairwiseAT.mat1Name.toLowerCase();
                            overlayVal = (name1 === targetBaseName) ? val2 : val1;
                        }

                        const bitmask = (vTL === overlayVal ? 1 : 0) | (vTR === overlayVal ? 2 : 0) | (vBL === overlayVal ? 4 : 0) | (vBR === overlayVal ? 8 : 0);
                        const m = pairwiseAT.mapping;
                        const rawEntry = m[`grid_${bitmask}`] || m['grid_0'] || Object.values(m)[0];
                        const entry = resolveSlotEntry(rawEntry, col, row);
                        if (entry) {
                            return {
                                tx: entry.tx,
                                ty: entry.ty,
                                tilesetId: pairwiseAT.tilesetId,
                                autotileId: pairwiseAT.id
                            };
                        }
                    }
                }
            }

            // Sub-case 2B: 3 or 4 Materials Present (Multi-Material Junction)
            // Canvas rendering will use drawDualGridCellSubQuadrants to render seamless 4-corner slices.
            // Provide dominant material base coordinates as fallback.
            if (uniqueVals.length >= 3) {
                const domMat = materialsPresent[materialsPresent.length - 1] || materialsPresent[0];
                const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
                const tsId = domMat.tilesetId || (activeTs ? activeTs.id : '');
                return {
                    tx: domMat.tx || 0,
                    ty: domMat.ty || 0,
                    tilesetId: tsId,
                    isDualGridComposite: true
                };
            }

                // Priority 2: Layered Alpha Overlay Composite System (Option B - 46-Tile System)
                // Base tile is lowest-priority material in this cell
                const baseMat = materialsPresent[0];
                const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
                const baseTsId = baseMat.tilesetId || (at ? at.tilesetId : (activeTs ? activeTs.id : ''));
                
                let resultTile = {
                    tx: baseMat.tx || 0,
                    ty: baseMat.ty || 0,
                    tilesetId: baseTsId,
                    overlays: []
                };

                // Evaluate higher-priority overlay materials in ascending priority order
                for (let i = 1; i < materialsPresent.length; i++) {
                    const overMat = materialsPresent[i];
                    const overName = overMat.name.toLowerCase();

                    // Find overlay autotile definition for overMat
                    let overlayAT = state.autotiles.find(a => 
                        (a.mode === 'overlay_dualgrid' || a.isOverlayMode) &&
                        ((a.mat1Name && a.mat1Name.toLowerCase() === overName) || 
                         (a.mat2Name && a.mat2Name.toLowerCase() === overName) || 
                         a.overlayMaterialId === overMat.id)
                    );

                    // Fallback to any autotile tied to overMat
                    if (!overlayAT && overMat.autotileIds && overMat.autotileIds.length > 0) {
                        overlayAT = state.autotiles.find(a => a.id === overMat.autotileIds[0]);
                    }

                    if (overlayAT) {
                        const overVal = overMat.vertexVal;
                        const bitmask = (vTL === overVal ? 1 : 0) | (vTR === overVal ? 2 : 0) | (vBL === overVal ? 4 : 0) | (vBR === overVal ? 8 : 0);
                        const m = overlayAT.mapping;
                        const rawEntry = m[`grid_${bitmask}`] || m['grid_15'] || m['grid_0'] || Object.values(m)[0];
                        const entry = resolveSlotEntry(rawEntry, col, row);

                        if (entry) {
                            if (bitmask === 15) {
                                // 100% Solid Overlay replaces base tile completely
                                resultTile = {
                                    tx: entry.tx,
                                    ty: entry.ty,
                                    tilesetId: overlayAT.tilesetId,
                                    autotileId: overlayAT.id,
                                    overlays: []
                                };
                            } else if (bitmask > 0) {
                                // Transparent overlay shape stacked over base
                                resultTile.overlays.push({
                                    tx: entry.tx,
                                    ty: entry.ty,
                                    tilesetId: overlayAT.tilesetId,
                                    autotileId: overlayAT.id
                                });
                            }
                        } else if (typeof overMat.tx === 'number' && typeof overMat.ty === 'number') {
                            // Standalone material fallback when no overlay autotile mapping exists
                            const overVal = overMat.vertexVal;
                            const bitmask = (vTL === overVal ? 1 : 0) | (vTR === overVal ? 2 : 0) | (vBL === overVal ? 4 : 0) | (vBR === overVal ? 8 : 0);
                            if (bitmask === 15) {
                                resultTile = {
                                    tx: overMat.tx,
                                    ty: overMat.ty,
                                    tilesetId: overMat.tilesetId || baseTsId,
                                    overlays: []
                                };
                            } else if (bitmask > 0) {
                                resultTile.overlays.push({
                                    tx: overMat.tx,
                                    ty: overMat.ty,
                                    tilesetId: overMat.tilesetId || baseTsId
                                });
                            }
                        }
                    }
                }

                return resultTile;
        }

        return null;
    }

    /** 
     * Helper: Selects tile variation from slot entry using Smart-Anchor probability thresholds
     * and deterministic spatial hash (with optional organic clumping).
     */
    function resolveSlotEntry(rawEntry, col, row, distributionMode = 'uniform') {
        if (!rawEntry) return null;
        if (Array.isArray(rawEntry) && rawEntry.length > 0) {
            if (rawEntry.length === 1) return rawEntry[0];

            // 1. Generate Deterministic PRNG Seed
            let seed;
            if (distributionMode === 'organic') {
                // Coherent quantized spatial block hash with micro-jitter (preserves strict uniform distribution across [0, 1))
                seed = (Math.abs(Math.sin(Math.floor(col * 0.25) * 12.9898 + Math.floor(row * 0.25) * 78.233 + (col % 4) * 0.17 + (row % 4) * 0.23) * 43758.5453)) % 1.0;
            } else {
                // High-frequency uniform spatial hash
                seed = Math.abs(Math.sin(col * 12.9898 + row * 78.233) * 43758.5453) % 1.0;
            }

            // 2. Check if entries use Smart-Anchor rate model or legacy weights
            const hasRates = rawEntry.some(v => typeof v.rate === 'number');
            if (hasRates) {
                // Smart-Anchor Model: Index 0 is Base Anchor
                let decoratorSum = 0;
                for (let i = 1; i < rawEntry.length; i++) {
                    decoratorSum += Math.max(0, parseFloat(rawEntry[i].rate) || 0);
                }
                const baseRate = Math.max(0, 100 - decoratorSum);
                const baseThreshold = baseRate / 100.0;

                if (seed < baseThreshold) {
                    return rawEntry[0];
                }

                let cumulative = baseThreshold;
                for (let i = 1; i < rawEntry.length; i++) {
                    const r = Math.max(0, parseFloat(rawEntry[i].rate) || 0);
                    cumulative += (r / 100.0);
                    if (seed <= cumulative) {
                        return rawEntry[i];
                    }
                }
                return rawEntry[0];
            } else {
                // Legacy Weight fallback
                const totalWeight = rawEntry.reduce((sum, v) => sum + (v.weight || 100), 0);
                let accum = 0;
                for (let i = 0; i < rawEntry.length; i++) {
                    accum += (rawEntry[i].weight || 100) / (totalWeight || 1);
                    if (seed <= accum) {
                        return rawEntry[i];
                    }
                }
                return rawEntry[0];
            }
        }
        return rawEntry;
    }

    /**
     * Re-evaluates autotile mapping for cell at (col, row) and updates `{ tx, ty }`.
     * @param {number} layerIndex - Target layer index.
     * @param {number} col - Cell column.
     * @param {number} row - Cell row.
     */
    function updateAutotileCell(layerIndex, col, row) {
        if (col < 0 || col >= state.mapWidth || row < 0 || row >= state.mapHeight) return;
        const layer = state.mapLayers[layerIndex];
        const cell = layer.data[row][col];
        if (cell && cell.autotileId && !cell.isStaticAutotile) {
            const at = state.autotiles.find(a => a.id === cell.autotileId);
            const sub = (at && at.mode === 'dualgrid')
                ? getDualGridTileForCell(layerIndex, col, row, cell.autotileId)
                : getAutotileTileForCell(layerIndex, col, row, cell.autotileId);

            if (sub) {
                cell.tx = sub.tx;
                cell.ty = sub.ty;
            }
        }
    }

    /**
     * Composites a single autotile cell using 4 independent sub-quadrants (TL, TR, BL, BR).
     * Enables seamless corner transitions without visual seam artifacts.
     * 
     * @returns {boolean} Returns true if compositing was handled.
     */
    function drawAutotileCellSubQuadrants(ctx, layerIndex, col, row, cell, ts) {
        const half = state.TILE_SIZE / 2;
        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;
        const at = state.autotiles.find(a => a.id === cell.autotileId);
        if (!at || at.mode === 'dualgrid' || at.mode === 'overlay_dualgrid' || at.mode === 'cliff_vstretch' || at.isCliff || at.mode === '16tile' || at.mode === 'wall_9x3' || at.mode === 'wall' || at.isWall) return false;
        const m = at.mapping;

        function sameAT(c, r) {
            if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) return true;
            const targetCell = state.mapLayers[layerIndex].data[r][c];
            return targetCell && targetCell.autotileId === cell.autotileId;
        }

        const n = sameAT(col, row - 1);
        const s = sameAT(col, row + 1);
        const w = sameAT(col - 1, row);
        const e = sameAT(col + 1, row);
        const nw = sameAT(col - 1, row - 1);
        const ne = sameAT(col + 1, row - 1);
        const sw = sameAT(col - 1, row + 1);
        const se = sameAT(col + 1, row + 1);

        const defaultTile = m.center || m.solid || Object.values(m)[0];
        if (!defaultTile) return false;

        // Top-Left Quadrant
        let quadTL = defaultTile;
        if (!n && !w) quadTL = m.topLeft || quadTL;
        else if (!n && w) quadTL = m.top || quadTL;
        else if (n && !w) quadTL = m.left || quadTL;
        else if (n && w && !nw) quadTL = m.innerTL || m.center || quadTL;
        else quadTL = m.center || quadTL;

        // Top-Right Quadrant
        let quadTR = defaultTile;
        if (!n && !e) quadTR = m.topRight || quadTR;
        else if (!n && e) quadTR = m.top || quadTR;
        else if (n && !e) quadTR = m.right || quadTR;
        else if (n && e && !ne) quadTR = m.innerTR || m.center || quadTR;
        else quadTR = m.center || quadTR;

        // Bottom-Left Quadrant
        let quadBL = defaultTile;
        if (!s && !w) quadBL = m.bottomLeft || quadBL;
        else if (!s && w) quadBL = m.bottom || quadBL;
        else if (s && !w) quadBL = m.left || quadBL;
        else if (s && w && !sw) quadBL = m.innerBL || m.center || quadBL;
        else quadBL = m.center || quadBL;

        // Bottom-Right Quadrant
        let quadBR = defaultTile;
        if (!s && !e) quadBR = m.bottomRight || quadBR;
        else if (!s && e) quadBR = m.bottom || quadBR;
        else if (s && !e) quadBR = m.right || quadBR;
        else if (s && e && !se) quadBR = m.innerBR || m.center || quadBR;
        else quadBR = m.center || quadBR;

        /** Render sub-quadrant onto main canvas */
        const drawSubQuad = (q, isRight, isBottom) => {
            if (!q) return;
            const srcX = margin + q.tx * (state.TILE_SIZE + spacing) + (isRight ? half : 0);
            const srcY = margin + q.ty * (state.TILE_SIZE + spacing) + (isBottom ? half : 0);
            const destX = col * state.TILE_SIZE + (isRight ? half : 0);
            const destY = row * state.TILE_SIZE + (isBottom ? half : 0);

            ctx.drawImage(ts.image, srcX, srcY, half, half, destX, destY, half, half);
        };

        drawSubQuad(quadTL, false, false);
        drawSubQuad(quadTR, true, false);
        drawSubQuad(quadBL, false, true);
        drawSubQuad(quadBR, true, true);

        return true;
    }

    /**
     * Evaluates 3-tier vertical cliffside autotiling (Top Rim, Middle Face, Bottom Base Footing, Side Drops).
     * Standardized 6x3 Dual-Grid Ground Top + 6x2 Cliff Wall Side Extension format.
     */
    function getCliffAutotileTileForCell(layerIndex, col, row, autotileId) {
        const at = state.autotiles.find(a => a.id === autotileId);
        if (!at) return null;
        const m = at.mapping || {};

        function sameAT(c, r) {
            if (c < 0 || c >= state.mapWidth || r < 0 || r >= state.mapHeight) return false;
            const layer = state.mapLayers[layerIndex];
            const cell = layer && layer.data && layer.data[r] ? layer.data[r][c] : null;
            return !!(cell && cell.autotileId === autotileId);
        }

        const n = sameAT(col, row - 1);
        const s = sameAT(col, row + 1);
        const w = sameAT(col - 1, row);
        const e = sameAT(col + 1, row);

        let entry = null;

        // 1. Top Row of Vertical Wall Face (No North cliff neighbor, but has South cliff neighbor)
        if (!n && s) {
            if (!w && !e) entry = resolveSlotEntry(m['cliff_face_mid'] || m['cliff_drop_side'], col, row);
            else if (!w && e) entry = resolveSlotEntry(m['cliff_face_l'] || m['cliff_face_mid'], col, row);
            else if (w && !e) entry = resolveSlotEntry(m['cliff_face_r'] || m['cliff_face_mid'], col, row);
            else entry = resolveSlotEntry(m['cliff_face_mid'] || m['grid_0'] || Object.values(m)[0], col, row);
        }

        // 2. Bottom Base Footing (Has North cliff neighbor, no South cliff neighbor)
        else if (n && !s) {
            if (!w && !e) entry = resolveSlotEntry(m['cliff_base_shadow'] || m['cliff_base_bl'] || m['cliff_base_br'], col, row);
            else if (!w && e) entry = resolveSlotEntry(m['cliff_base_bl'] || m['cliff_base_shadow'], col, row);
            else if (w && !e) entry = resolveSlotEntry(m['cliff_base_br'] || m['cliff_base_shadow'], col, row);
            else entry = resolveSlotEntry(m['cliff_base_shadow'] || m['cliff_base_bl'], col, row);
        }

        // 3. Middle Vertical Wall Face (Has both North and South cliff neighbors)
        else if (n && s) {
            if (!w && !e) entry = resolveSlotEntry(m['cliff_face_mid'] || m['cliff_drop_side'], col, row);
            else if (!w && e) entry = resolveSlotEntry(m['cliff_face_l'] || m['cliff_face_mid'], col, row);
            else if (w && !e) entry = resolveSlotEntry(m['cliff_face_r'] || m['cliff_face_mid'], col, row);
            else entry = resolveSlotEntry(m['cliff_face_mid'] || m['grid_0'] || Object.values(m)[0], col, row);
        }

        if (!entry) {
            entry = resolveSlotEntry(m['cliff_face_mid'] || m['grid_12'] || m['grid_0'] || Object.values(m)[0], col, row);
        }

        if (entry) {
            return {
                tx: entry.tx,
                ty: entry.ty,
                tilesetId: at.tilesetId,
                autotileId: at.id
            };
        }

        return null;
    }

    /**
     * Finds the registered pairwise autotile definition connecting matA and matB.
     * @param {Object} matA - First material swatch.
     * @param {Object} matB - Second material swatch.
     * @returns {Object|null} Registered autotile object or null.
     */
    function findPairwiseAutotile(matA, matB) {
        if (!matA || !matB || matA.id === matB.id) return null;
        const nameA = matA.name.toLowerCase();
        const nameB = matB.name.toLowerCase();

        const matchesPair = (a) => a && (
            (a.mode === 'dualgrid' && !a.isOverlayMode && (
                (a.mat1Name && a.mat1Name.toLowerCase() === nameA && a.mat2Name && a.mat2Name.toLowerCase() === nameB) ||
                (a.mat1Name && a.mat1Name.toLowerCase() === nameB && a.mat2Name && a.mat2Name.toLowerCase() === nameA)
            )) ||
            ((a.isCliff || a.mode === 'cliff_vstretch') && (
                (a.mat1Name && a.mat1Name.toLowerCase() === nameB && ((a.mat3Name && a.mat3Name.toLowerCase() === nameA) || (a.mat2Name && a.mat2Name.toLowerCase() === nameA))) ||
                (a.mat1Name && a.mat1Name.toLowerCase() === nameA && ((a.mat3Name && a.mat3Name.toLowerCase() === nameB) || (a.mat2Name && a.mat2Name.toLowerCase() === nameB)))
            ))
        );

        let found = state.autotiles.find(a => a.id === state.activeAutotileId && matchesPair(a));
        if (!found) {
            for (let i = state.autotiles.length - 1; i >= 0; i--) {
                if (matchesPair(state.autotiles[i])) {
                    found = state.autotiles[i];
                    break;
                }
            }
        }
        return found || null;
    }

    /**
     * Resolves the source tile coordinates and tileset for a single 16x16 quadrant (0=TL, 1=TR, 2=BL, 3=BR).
     * Evaluates local corner vertex interactions and pairwise autotiles.
     */
    function resolveDualGridQuadrantTile(col, row, vTL, vTR, vBL, vBR, quadIndex) {
        const swatches = window.TileWeaver.terrainSwatches;
        if (!swatches) return null;

        const quadAnchorVal = (quadIndex === 0) ? vTL : (quadIndex === 1 ? vTR : (quadIndex === 2 ? vBL : vBR));
        const anchorMat = swatches.getMaterialByVertexValue(quadAnchorVal);
        if (!anchorMat) return null;

        // Identify neighbor vertices for this specific quadrant
        let vHoriz, vVert, vDiag;
        if (quadIndex === 0) { // TL (0, 0)
            vHoriz = vTR; vVert = vBL; vDiag = vBR;
        } else if (quadIndex === 1) { // TR (1, 0)
            vHoriz = vTL; vVert = vBR; vDiag = vBL;
        } else if (quadIndex === 2) { // BL (0, 1)
            vHoriz = vBR; vVert = vTL; vDiag = vTR;
        } else { // BR (1, 1)
            vHoriz = vBL; vVert = vTR; vDiag = vTL;
        }

        let partnerVal = null;
        let isHorizTransition = false;
        let isVertTransition = false;

        // Case 1: All 3 neighbors equal anchor -> pure uniform material
        if (vHoriz === quadAnchorVal && vVert === quadAnchorVal && vDiag === quadAnchorVal) {
            partnerVal = null;
        }
        // Case 2: One neighbor direction is same as anchor, the other differs
        else if (vHoriz === quadAnchorVal && vVert !== quadAnchorVal) {
            partnerVal = vVert;
            isVertTransition = true;
        }
        else if (vVert === quadAnchorVal && vHoriz !== quadAnchorVal) {
            partnerVal = vHoriz;
            isHorizTransition = true;
        }
        // Case 3: Both horizontal and vertical neighbors differ from anchor
        else if (vHoriz !== quadAnchorVal && vVert !== quadAnchorVal) {
            if (vHoriz === vVert) {
                partnerVal = vHoriz;
            } else {
                // Two distinct neighbor materials!
                // If the opposite vertical half is uniform (e.g. both top vertices are Water or both bottom are Grass),
                // the active transition across THIS half is horizontal (e.g. Sand meeting Dirt)!
                if (vVert === vDiag) {
                    partnerVal = vHoriz;
                    isHorizTransition = true;
                } else if (vHoriz === vDiag) {
                    partnerVal = vVert;
                    isVertTransition = true;
                } else {
                    const matHoriz = swatches.getMaterialByVertexValue(vHoriz);
                    const matVert = swatches.getMaterialByVertexValue(vVert);
                    const pairHoriz = findPairwiseAutotile(anchorMat, matHoriz);
                    const pairVert = findPairwiseAutotile(anchorMat, matVert);
                    if (pairHoriz && !pairVert) {
                        partnerVal = vHoriz;
                        isHorizTransition = true;
                    } else if (pairVert && !pairHoriz) {
                        partnerVal = vVert;
                        isVertTransition = true;
                    } else {
                        const prioHoriz = matHoriz ? (matHoriz.priority || 0) : 0;
                        const prioVert = matVert ? (matVert.priority || 0) : 0;
                        if (prioHoriz >= prioVert) {
                            partnerVal = vHoriz;
                            isHorizTransition = true;
                        } else {
                            partnerVal = vVert;
                            isVertTransition = true;
                        }
                    }
                }
            }
        }
        // Case 4: Only diagonal neighbor differs
        else if (vDiag !== quadAnchorVal) {
            partnerVal = vDiag;
        }

        const activeTs = state.tilesets[state.activeTilesetIndex] || state.tilesets[0];

        if (partnerVal === null) {
            // Uniform quadrant: use anchor material's solid base tile
            const tsId = anchorMat.tilesetId || (activeTs ? activeTs.id : '');
            return { tx: anchorMat.tx || 0, ty: anchorMat.ty || 0, tilesetId: tsId };
        }

        const partnerMat = swatches.getMaterialByVertexValue(partnerVal);
        if (!partnerMat) {
            return { tx: anchorMat.tx || 0, ty: anchorMat.ty || 0, tilesetId: anchorMat.tilesetId || (activeTs ? activeTs.id : '') };
        }

        // Find pairwise autotile between anchorMat and partnerMat
        const pairAT = findPairwiseAutotile(anchorMat, partnerMat);
        if (pairAT && pairAT.mapping) {
            let overlayVal = partnerVal;
            let baseVal = quadAnchorVal;
            const nameAnchor = anchorMat.name.toLowerCase();
            if (pairAT.mat2Name) {
                const targetOverlayName = pairAT.mat2Name.toLowerCase();
                overlayVal = (nameAnchor === targetOverlayName) ? quadAnchorVal : partnerVal;
                baseVal = (nameAnchor === targetOverlayName) ? partnerVal : quadAnchorVal;
            } else if (pairAT.mat1Name) {
                const targetBaseName = pairAT.mat1Name.toLowerCase();
                overlayVal = (nameAnchor === targetBaseName) ? partnerVal : quadAnchorVal;
                baseVal = (nameAnchor === targetBaseName) ? quadAnchorVal : partnerVal;
            }

            let bitmask = 0;

            if (isHorizTransition) {
                // Active transition is horizontal across columns (Left Column vs Right Column)
                // Use the active row's vertex pair to project across columns consistently
                const col0Val = (quadIndex === 0 || quadIndex === 1) ? vTL : vBL;
                const col1Val = (quadIndex === 0 || quadIndex === 1) ? vTR : vBR;

                const isCol0Overlay = (col0Val === overlayVal);
                const isCol1Overlay = (col1Val === overlayVal);

                bitmask = (isCol0Overlay ? 1 : 0) |
                          (isCol1Overlay ? 2 : 0) |
                          (isCol0Overlay ? 4 : 0) |
                          (isCol1Overlay ? 8 : 0);
            } else if (isVertTransition) {
                // Active transition is vertical across rows (Top Row vs Bottom Row)
                // Use the active column's vertex pair to project across rows consistently
                const row0Val = (quadIndex === 0 || quadIndex === 2) ? vTL : vTR;
                const row1Val = (quadIndex === 0 || quadIndex === 2) ? vBL : vBR;

                const isRow0Overlay = (row0Val === overlayVal);
                const isRow1Overlay = (row1Val === overlayVal);

                bitmask = (isRow0Overlay ? 1 : 0) |
                          (isRow0Overlay ? 2 : 0) |
                          (isRow1Overlay ? 4 : 0) |
                          (isRow1Overlay ? 8 : 0);
            } else {
                // General 4-corner bitmask evaluation
                bitmask = (vTL === overlayVal ? 1 : 0) |
                          (vTR === overlayVal ? 2 : 0) |
                          (vBL === overlayVal ? 4 : 0) |
                          (vBR === overlayVal ? 8 : 0);
            }

            const m = pairAT.mapping;
            const rawEntry = m[`grid_${bitmask}`] || m['grid_0'] || Object.values(m)[0];
            const entry = resolveSlotEntry(rawEntry, col, row);
            if (entry) {
                return {
                    tx: entry.tx,
                    ty: entry.ty,
                    tilesetId: pairAT.tilesetId || (state.tilesets[state.activeTilesetIndex]?.id || '')
                };
            }
        }

        // Fallback: Solid anchor tile
        return {
            tx: anchorMat.tx || 0,
            ty: anchorMat.ty || 0,
            tilesetId: anchorMat.tilesetId || (activeTs ? activeTs.id : '')
        };
    }

    /**
     * Composites a Dual-Grid cell using 4 independent 16x16 sub-quadrants (TL, TR, BL, BR).
     * Automatically resolves 3-way and 4-way multi-material junctions without seam artifacts.
     * 
     * @param {CanvasRenderingContext2D} ctx - Target 2D rendering context.
     * @param {number} layerIndex - Target layer index.
     * @param {number} col - Cell column coordinate.
     * @param {number} row - Cell row coordinate.
     * @param {Object} cell - Layer cell object.
     * @returns {boolean} Returns true if compositing was handled.
     */
    function drawDualGridCellSubQuadrants(ctx, layerIndex, col, row, cell) {
        if (!cell) return false;
        const layer = state.mapLayers[layerIndex];
        if (!layer || !layer.terrainVertices) return false;

        const vertices = layer.terrainVertices;
        if (row < 0 || row >= vertices.length - 1 || col < 0 || col >= vertices[0].length - 1) {
            return false;
        }

        const vTL = vertices[row][col];
        const vTR = vertices[row][col + 1];
        const vBL = vertices[row + 1][col];
        const vBR = vertices[row + 1][col + 1];

        // Single pure material: skip sub-quadrant slicing (fast path draws 32x32 directly)
        if (vTL === vTR && vTR === vBL && vBL === vBR) {
            return false;
        }

        const uniqueVals = Array.from(new Set([vTL, vTR, vBL, vBR]));
        
        // For 2 materials: if a direct pairwise autotile exists, the single 32x32 draw path is faster and accurate
        if (uniqueVals.length === 2) {
            const swatches = window.TileWeaver.terrainSwatches;
            const mat1 = swatches ? swatches.getMaterialByVertexValue(uniqueVals[0]) : null;
            const mat2 = swatches ? swatches.getMaterialByVertexValue(uniqueVals[1]) : null;
            if (mat1 && mat2) {
                const directAT = findPairwiseAutotile(mat1, mat2);
                if (directAT) {
                    // Direct pairwise autotile exists -> single 32x32 draw path handles it!
                    return false;
                }
            }
        }

        // Multi-Material Junction (3 or 4 materials, or 2 materials without direct 32x32 pair)
        const half = state.TILE_SIZE / 2; // 16px

        const q0 = resolveDualGridQuadrantTile(col, row, vTL, vTR, vBL, vBR, 0); // TL
        const q1 = resolveDualGridQuadrantTile(col, row, vTL, vTR, vBL, vBR, 1); // TR
        const q2 = resolveDualGridQuadrantTile(col, row, vTL, vTR, vBL, vBR, 2); // BL
        const q3 = resolveDualGridQuadrantTile(col, row, vTL, vTR, vBL, vBR, 3); // BR

        const drawQuad = (q, offsetX, offsetY) => {
            if (!q) return;
            const ts = state.tilesets.find(t => t.id === q.tilesetId) || state.tilesets[state.activeTilesetIndex] || state.tilesets[0];
            if (!ts || !ts.image) return;

            const margin = ts.margin || 0;
            const spacing = ts.spacing || 0;
            const srcX = margin + q.tx * (state.TILE_SIZE + spacing) + offsetX;
            const srcY = margin + q.ty * (state.TILE_SIZE + spacing) + offsetY;
            const destX = col * state.TILE_SIZE + offsetX;
            const destY = row * state.TILE_SIZE + offsetY;

            ctx.drawImage(ts.image, srcX, srcY, half, half, destX, destY, half, half);
        };

        drawQuad(q0, 0, 0);       // Top-Left (TL)
        drawQuad(q1, half, 0);    // Top-Right (TR)
        drawQuad(q2, 0, half);    // Bottom-Left (BL)
        drawQuad(q3, half, half); // Bottom-Right (BR)

        return true;
    }

    /**
     * Returns active layer index for painting cliffsides onto the current active layer.
     */
    function ensureDedicatedCliffLayer() {
        return state.activeLayerIndex;
    }

    // Expose autotile engine on window.TileWeaver namespace
    window.TileWeaver.autotile = {
        getAutotileTileForCell,
        getDualGridTileForCell,
        getCliffAutotileTileForCell,
        ensureDedicatedCliffLayer,
        updateAutotileCell,
        drawAutotileCellSubQuadrants,
        drawDualGridCellSubQuadrants,
        resolveDualGridQuadrantTile,
        findPairwiseAutotile,
        resolveSlotEntry
    };
})();
