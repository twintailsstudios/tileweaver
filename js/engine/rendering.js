/**
 * @fileoverview TileWeaver - Main Canvas Rendering Engine
 * @subsystem Canvas Rendering & Viewport Engine
 * @frameBudget Budgeted < 16.6ms for 60 FPS requestAnimationFrame loop and pointer hover previews
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY (col, row)
 * @stateInvariants Pure state reader; draws multi-layer stack from window.TileWeaver.state
 * @historyTracked Read-only engine; zero history stack mutations
 * @exportCompatibility Render output matches Native JSON v3.3 & Tiled TMJ 1.10+ formats
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { drawAutotileCellSubQuadrants, drawDualGridCellSubQuadrants } = window.TileWeaver.autotile || {};

    let mapCanvas, mapCtx, tilesetCanvas, tilesetCtx;

    /**
     * Obtains 2D context references for main map canvas and tileset viewer canvas.
     */
    function initRenderingElements() {
        mapCanvas = document.getElementById('map-canvas');
        if (mapCanvas) mapCtx = mapCanvas.getContext('2d', { alpha: true });

        tilesetCanvas = document.getElementById('tileset-canvas');
        if (tilesetCanvas) tilesetCtx = tilesetCanvas.getContext('2d', { alpha: true });
    }

    /**
     * Resizes map canvas dimensions to match current `mapWidth * TILE_SIZE` and `mapHeight * TILE_SIZE`.
     * Sets `imageSmoothingEnabled = false` for sharp pixel art.
     */
    function resizeCanvases() {
        if (!mapCanvas || !mapCtx) initRenderingElements();
        if (mapCanvas) {
            mapCanvas.width = state.mapWidth * state.TILE_SIZE;
            mapCanvas.height = state.mapHeight * state.TILE_SIZE;
            mapCtx.imageSmoothingEnabled = false;
        }
        if (tilesetCtx) {
            tilesetCtx.imageSmoothingEnabled = false;
        }
    }

    /**
     * Draws a single tile with optional 2D canvas transformations (Flip H, Flip V, Rotation).
     * @param {CanvasRenderingContext2D} ctx - Target 2D rendering context
     * @param {CanvasImageSource} img - Source sprite image or canvas element
     * @param {number} sourceX - Source rectangle X offset in pixels
     * @param {number} sourceY - Source rectangle Y offset in pixels
     * @param {number} sourceW - Source rectangle width in pixels
     * @param {number} sourceH - Source rectangle height in pixels
     * @param {number} destX - Destination canvas X offset in pixels
     * @param {number} destY - Destination canvas Y offset in pixels
     * @param {number} destW - Destination tile width in pixels
     * @param {number} destH - Destination tile height in pixels
     * @param {boolean} [flipH=false] - Horizontal axis flip flag
     * @param {boolean} [flipV=false] - Vertical axis flip flag
     * @param {number} [rotation=0] - Clockwise rotation in degrees (0, 90, 180, 270)
     */
    function drawTileTransformed(ctx, img, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH, flipH, flipV, rotation) {
        // FAST PATH: Bypass affine matrix state save/restore for untransformed tiles (zero GPU context churn)
        if (!flipH && !flipV && !rotation) {
            ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH);
            return;
        }

        ctx.save();
        const centerX = destX + destW / 2;
        const centerY = destY + destH / 2;
        ctx.translate(centerX, centerY);
        if (rotation) ctx.rotate((rotation * Math.PI) / 180);
        if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, -destW / 2, -destH / 2, destW, destH);
        ctx.restore();
    }

    /**
     * Helper to render a tileset on any target canvas context with zoom scaling,
     * crisp pixel alignment, grid overlay, hover highlight, and stamp selection.
     */
    function renderTilesetOnCanvas(canvas, ts, zoom = 1.0) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        if (!ts || !ts.image) {
            canvas.width = 240;
            canvas.height = 200;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#64748b';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No tileset loaded', 120, 90);
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#475569';
            ctx.fillText('Upload a PNG tileset to start', 120, 110);
            return;
        }

        const img = ts.image;
        const scaledW = Math.max(1, Math.round(img.width * zoom));
        const scaledH = Math.max(1, Math.round(img.height * zoom));

        canvas.width = scaledW;
        canvas.height = scaledH;
        ctx.imageSmoothingEnabled = false;

        ctx.clearRect(0, 0, scaledW, scaledH);
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, scaledW, scaledH);

        const margin = (ts.margin || 0) * zoom;
        const spacing = (ts.spacing || 0) * zoom;
        const tileSizeScaled = state.TILE_SIZE * zoom;
        const step = tileSizeScaled + spacing;

        // Draw faint tileset grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let x = margin; x <= scaledW; x += step) {
            const px = Math.round(x) + 0.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, scaledH); ctx.stroke();
        }
        for (let y = margin; y <= scaledH; y += step) {
            const py = Math.round(y) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(scaledW, py); ctx.stroke();
        }

        // Highlight hover tile
        if (state.tilesetHoverCoord && state.tilesetHoverCoord.col >= 0 && state.tilesetHoverCoord.row >= 0) {
            const hx = margin + state.tilesetHoverCoord.col * step;
            const hy = margin + state.tilesetHoverCoord.row * step;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = Math.max(1.5, Math.round(1.5 * zoom));
            ctx.strokeRect(hx, hy, tileSizeScaled, tileSizeScaled);
            ctx.fillStyle = 'rgba(96, 165, 250, 0.2)';
            ctx.fillRect(hx, hy, tileSizeScaled, tileSizeScaled);
        }

        // Highlight active stamp selection box
        if (state.currentTool !== 'erase' && state.currentTool !== 'passability' && state.currentTool !== 'region') {
            const sx = margin + state.selectedStamp.col * step;
            const sy = margin + state.selectedStamp.row * step;
            const sw = state.selectedStamp.width * state.TILE_SIZE * zoom + (state.selectedStamp.width - 1) * spacing;
            const sh = state.selectedStamp.height * state.TILE_SIZE * zoom + (state.selectedStamp.height - 1) * spacing;

            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = Math.max(2, Math.round(2 * zoom));
            ctx.strokeRect(sx, sy, sw, sh);
            
            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fillRect(sx, sy, sw, sh);
        }
    }

    /**
     * Draws the active tileset image across active palette viewer canvases (sidebar, popout, dock).
     */
    function drawTileset() {
        const ts = (state.tilesets && state.tilesets[state.activeTilesetIndex]) || (state.tilesets && state.tilesets[0]) || null;
        const zoom = state.tilesetZoom || 1.0;

        const sidebarCanvas = document.getElementById('tileset-canvas');
        if (sidebarCanvas) renderTilesetOnCanvas(sidebarCanvas, ts, zoom);

        const popoutCanvas = document.getElementById('popout-tileset-canvas');
        if (popoutCanvas) renderTilesetOnCanvas(popoutCanvas, ts, zoom);

        const dockCanvas = document.getElementById('dock-tileset-canvas');
        if (dockCanvas) renderTilesetOnCanvas(dockCanvas, ts, zoom);
    }

    /**
     * Master render function: Redraws map layers, grid lines, collision passability symbols,
     * region heatmaps, and active tool previews onto `mapCanvas`.
     */
    function drawMap() {
        if (!mapCanvas || !mapCtx) initRenderingElements();
        if (!mapCanvas || !mapCtx) return;

        mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
        const now = performance.now();

        // Calculate visible tile bounds for Viewport Frustum Culling using DOM rect alignment
        const mapContainer = document.getElementById('map-container');
        let minCol = 0, maxCol = Math.max(0, (state.mapWidth || 1) - 1);
        let minRow = 0, maxRow = Math.max(0, (state.mapHeight || 1) - 1);

        if (mapContainer && mapCanvas) {
            const containerRect = mapContainer.getBoundingClientRect();
            const canvasRect = mapCanvas.getBoundingClientRect();

            if (canvasRect.width > 0 && canvasRect.height > 0 && containerRect.width > 0 && containerRect.height > 0) {
                const visibleLeft = Math.max(0, containerRect.left - canvasRect.left);
                const visibleTop = Math.max(0, containerRect.top - canvasRect.top);
                const visibleRight = Math.min(canvasRect.width, containerRect.right - canvasRect.left);
                const visibleBottom = Math.min(canvasRect.height, containerRect.bottom - canvasRect.top);

                const scaleX = ((state.mapWidth || 1) * state.TILE_SIZE) / canvasRect.width;
                const scaleY = ((state.mapHeight || 1) * state.TILE_SIZE) / canvasRect.height;

                if (isFinite(scaleX) && isFinite(scaleY) && scaleX > 0 && scaleY > 0) {
                    minCol = Math.max(0, Math.min(state.mapWidth - 1, Math.floor((visibleLeft * scaleX) / state.TILE_SIZE) - 4));
                    maxCol = Math.max(0, Math.min(state.mapWidth - 1, Math.ceil((visibleRight * scaleX) / state.TILE_SIZE) + 4));
                    minRow = Math.max(0, Math.min(state.mapHeight - 1, Math.floor((visibleTop * scaleY) / state.TILE_SIZE) - 4));
                    maxRow = Math.max(0, Math.min(state.mapHeight - 1, Math.ceil((visibleBottom * scaleY) / state.TILE_SIZE) + 4));
                }
            }
        }

        // OPTIMIZATION (60 FPS Canvas): Pre-index O(1) Map lookups for tilesets and animated tiles to eliminate hot-loop Array.find overhead
        const tilesetMap = new Map();
        if (Array.isArray(state.tilesets)) {
            for (let i = 0; i < state.tilesets.length; i++) {
                const t = state.tilesets[i];
                if (t && t.id) tilesetMap.set(t.id, t);
            }
        }
        const defaultTileset = (state.tilesets && state.tilesets[state.activeTilesetIndex]) || (state.tilesets && state.tilesets[0]) || null;

        const animTileMap = new Map();
        if (Array.isArray(state.animatedTiles)) {
            for (let i = 0; i < state.animatedTiles.length; i++) {
                const a = state.animatedTiles[i];
                if (a && a.id) animTileMap.set(a.id, a);
            }
        }

        // 1. Render Tile & Object Layers Stack
        for (let l = 0; l < state.mapLayers.length; l++) {
            const layer = state.mapLayers[l];
            if (!layer.visible) continue;

            // Inactive layers render with subtle transparency
            const layerOpacity = layer.opacity * (l === state.activeLayerIndex ? 1.0 : 0.65);
            mapCtx.globalAlpha = layerOpacity;

            // Render Object Group Layer (objectgroup)
            if (layer.type === 'objectgroup' && layer.objects) {
                layer.objects.forEach(obj => {
                    if (obj.visible === false) return;

                    if (obj.gid && obj.gid > 0) {
                        const rawGidWithFlags = obj.gid;
                        const unsignedGid = rawGidWithFlags >>> 0;
                        const h = (unsignedGid & 0x80000000) !== 0;
                        const v = (unsignedGid & 0x40000000) !== 0;
                        const d = (unsignedGid & 0x20000000) !== 0;
                        const gid = unsignedGid & 0x1FFFFFFF;

                        // 1. Direct tilesetId lookup if available, otherwise getTilesetForGid fallback
                        let matchedTs = (obj.tilesetId && tilesetMap.has(obj.tilesetId)) 
                            ? tilesetMap.get(obj.tilesetId) 
                            : null;
                        if (!matchedTs) {
                            matchedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(obj.gid) : defaultTileset;
                        }

                        let rotation = obj.rotation || 0;
                        let flipH = h;
                        let flipV = v;

                        if (d) {
                            if (h && !v)       { rotation = 90;  flipH = false; flipV = false; }
                            else if (!h && v)  { rotation = 270; flipH = false; flipV = false; }
                            else if (!h && !v) { rotation = 90;  flipH = false; flipV = true;  }
                            else if (h && v)   { rotation = 90;  flipH = true;  flipV = false; }
                        }

                        if (matchedTs) {
                            if (matchedTs.isMissing) {
                                // Missing tileset: skip drawing on map canvas
                                return;
                            }
                            const localId = gid - (matchedTs.firstgid || 1);
                            let imgEl = null;
                            let sourceX = 0, sourceY = 0, sourceW = state.TILE_SIZE, sourceH = state.TILE_SIZE;

                            if (matchedTs.isCollection && matchedTs.images) {
                                const imgObj = (obj.imageId ? matchedTs.images.find(img => img.id === obj.imageId) : null) ||
                                               matchedTs.images.find(img => img.tileId === localId) ||
                                               matchedTs.images.find(img => img.id === localId) ||
                                               matchedTs.images[localId] ||
                                               matchedTs.images[0];
                                if (imgObj && imgObj.isMissing) {
                                    return;
                                }
                                if (imgObj && imgObj.image) {
                                    imgEl = imgObj.image;
                                    sourceW = imgEl.naturalWidth || imgEl.width;
                                    sourceH = imgEl.naturalHeight || imgEl.height;
                                }
                            } else if (matchedTs.image) {
                                imgEl = matchedTs.image;
                                const tsCols = matchedTs.columns || Math.floor((imgEl.width - (matchedTs.margin || 0)) / (state.TILE_SIZE + (matchedTs.spacing || 0))) || 1;
                                const margin = matchedTs.margin || 0;
                                const spacing = matchedTs.spacing || 0;
                                const tx = localId % tsCols;
                                const ty = Math.floor(localId / tsCols);
                                sourceX = margin + tx * (state.TILE_SIZE + spacing);
                                sourceY = margin + ty * (state.TILE_SIZE + spacing);
                            }

                            if (imgEl && imgEl.width > 0) {
                                const objW = obj.width || sourceW || state.TILE_SIZE;
                                const objH = obj.height || sourceH || state.TILE_SIZE;

                                // Calculate origin based on object alignment or tileset objectalignment
                                const align = (obj.alignment || matchedTs.objectalignment || 'bottomleft').toLowerCase();
                                let drawX = obj.x;
                                let drawY = obj.y - objH; // Tiled default for GID tile objects is bottom-left

                                if (align === 'bottom' || align === 'bottomcenter') {
                                    drawX = obj.x - objW / 2;
                                    drawY = obj.y - objH;
                                } else if (align === 'bottomright') {
                                    drawX = obj.x - objW;
                                    drawY = obj.y - objH;
                                } else if (align === 'left' || align === 'centerleft') {
                                    drawX = obj.x;
                                    drawY = obj.y - objH / 2;
                                } else if (align === 'center') {
                                    drawX = obj.x - objW / 2;
                                    drawY = obj.y - objH / 2;
                                } else if (align === 'right' || align === 'centerright') {
                                    drawX = obj.x - objW;
                                    drawY = obj.y - objH / 2;
                                } else if (align === 'topleft') {
                                    drawX = obj.x;
                                    drawY = obj.y;
                                } else if (align === 'top' || align === 'topcenter') {
                                    drawX = obj.x - objW / 2;
                                    drawY = obj.y;
                                } else if (align === 'topright') {
                                    drawX = obj.x - objW;
                                    drawY = obj.y;
                                }

                                drawTileTransformed(
                                    mapCtx, imgEl, sourceX, sourceY, sourceW, sourceH,
                                    drawX, drawY, objW, objH,
                                    flipH, flipV, rotation
                                );

                                if (state.selectedObjectId === obj.id) {
                                    mapCtx.strokeStyle = '#3b82f6';
                                    mapCtx.lineWidth = 2;
                                    mapCtx.strokeRect(drawX, drawY, objW, objH);
                                    mapCtx.fillStyle = 'rgba(59, 130, 246, 0.2)';
                                    mapCtx.fillRect(drawX, drawY, objW, objH);
                                }
                            }
                        }
                    } else {
                        // Render non-GID vector shapes & text objects
                        const objW = obj.width || state.TILE_SIZE;
                        const objH = obj.height || state.TILE_SIZE;

                        mapCtx.save();
                        mapCtx.lineWidth = 1.5;
                        mapCtx.strokeStyle = '#38bdf8';
                        mapCtx.fillStyle = 'rgba(56, 189, 248, 0.18)';

                        if (obj.ellipse) {
                            mapCtx.beginPath();
                            const radiusX = Math.max(1, objW / 2);
                            const radiusY = Math.max(1, objH / 2);
                            mapCtx.ellipse(obj.x + radiusX, obj.y + radiusY, radiusX, radiusY, 0, 0, Math.PI * 2);
                            mapCtx.fill();
                            mapCtx.stroke();
                        } else if (obj.point) {
                            const px = obj.x;
                            const py = obj.y;
                            mapCtx.fillStyle = '#ef4444';
                            mapCtx.strokeStyle = '#ffffff';
                            mapCtx.lineWidth = 1;
                            mapCtx.beginPath();
                            mapCtx.arc(px, py, 6, 0, Math.PI * 2);
                            mapCtx.fill();
                            mapCtx.stroke();

                            mapCtx.fillStyle = '#ffffff';
                            mapCtx.font = 'bold 10px sans-serif';
                            mapCtx.fillText(obj.name || `Point #${obj.id}`, px + 8, py + 3);
                        } else if (obj.polygon && Array.isArray(obj.polygon) && obj.polygon.length > 0) {
                            mapCtx.beginPath();
                            obj.polygon.forEach((pt, pIdx) => {
                                const vx = obj.x + (pt.x || 0);
                                const vy = obj.y + (pt.y || 0);
                                if (pIdx === 0) mapCtx.moveTo(vx, vy);
                                else mapCtx.lineTo(vx, vy);
                            });
                            mapCtx.closePath();
                            mapCtx.fill();
                            mapCtx.stroke();
                        } else if (obj.polyline && Array.isArray(obj.polyline) && obj.polyline.length > 0) {
                            mapCtx.beginPath();
                            obj.polyline.forEach((pt, pIdx) => {
                                const vx = obj.x + (pt.x || 0);
                                const vy = obj.y + (pt.y || 0);
                                if (pIdx === 0) mapCtx.moveTo(vx, vy);
                                else mapCtx.lineTo(vx, vy);
                            });
                            mapCtx.stroke();
                        } else if (obj.text) {
                            const fontPx = obj.text.pixelsize || 16;
                            const fontFamily = obj.text.fontfamily || 'sans-serif';
                            mapCtx.font = `${obj.text.bold ? 'bold ' : ''}${obj.text.italic ? 'italic ' : ''}${fontPx}px ${fontFamily}`;
                            mapCtx.fillStyle = obj.text.color || '#ffffff';
                            mapCtx.textBaseline = 'top';
                            mapCtx.fillText(obj.text.text || obj.name || 'Text', obj.x, obj.y);
                        } else {
                            // Standard Rectangle Shape
                            mapCtx.fillRect(obj.x, obj.y, objW, objH);
                            mapCtx.strokeRect(obj.x, obj.y, objW, objH);
                        }

                        mapCtx.restore();
                    }

                    // Render 8-handle Selection Overlay for active object
                    if (state.selectedObjectId === obj.id) {
                        const boundsW = obj.width || state.TILE_SIZE;
                        const boundsH = obj.height || state.TILE_SIZE;
                        let boundsX = obj.x;
                        let boundsY = obj.y;

                        if (obj.gid && obj.gid > 0) {
                            const matchedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(obj.gid) : null;
                            const align = (obj.alignment || (matchedTs ? matchedTs.objectalignment : null) || 'bottomleft').toLowerCase();
                            if (align === 'bottom' || align === 'bottomcenter') { boundsX = obj.x - boundsW / 2; boundsY = obj.y - boundsH; }
                            else if (align === 'bottomright') { boundsX = obj.x - boundsW; boundsY = obj.y - boundsH; }
                            else if (align === 'left' || align === 'centerleft') { boundsX = obj.x; boundsY = obj.y - boundsH / 2; }
                            else if (align === 'center') { boundsX = obj.x - boundsW / 2; boundsY = obj.y - boundsH / 2; }
                            else if (align === 'right' || align === 'centerright') { boundsX = obj.x - boundsW; boundsY = obj.y - boundsH / 2; }
                            else if (align === 'topleft') { boundsX = obj.x; boundsY = obj.y; }
                            else if (align === 'top' || align === 'topcenter') { boundsX = obj.x - boundsW / 2; boundsY = obj.y; }
                            else if (align === 'topright') { boundsX = obj.x - boundsW; boundsY = obj.y; }
                            else { boundsX = obj.x; boundsY = obj.y - boundsH; }
                        }

                        mapCtx.save();
                        mapCtx.strokeStyle = '#3b82f6';
                        mapCtx.lineWidth = 2;
                        mapCtx.strokeRect(boundsX, boundsY, boundsW, boundsH);
                        mapCtx.fillStyle = 'rgba(59, 130, 246, 0.15)';
                        mapCtx.fillRect(boundsX, boundsY, boundsW, boundsH);

                        // Draw 8 Handles (TL, TR, BL, BR, Top, Bottom, Left, Right)
                        const hSize = 6;
                        const handles = [
                            { id: 'tl', x: boundsX, y: boundsY },
                            { id: 'tr', x: boundsX + boundsW, y: boundsY },
                            { id: 'bl', x: boundsX, y: boundsY + boundsH },
                            { id: 'br', x: boundsX + boundsW, y: boundsY + boundsH },
                            { id: 't',  x: boundsX + boundsW / 2, y: boundsY },
                            { id: 'b',  x: boundsX + boundsW / 2, y: boundsY + boundsH },
                            { id: 'l',  x: boundsX, y: boundsY + boundsH / 2 },
                            { id: 'r',  x: boundsX + boundsW, y: boundsY + boundsH / 2 }
                        ];

                        handles.forEach(h => {
                            const isHovered = state.hoveredResizeHandle === h.id;
                            mapCtx.fillStyle = isHovered ? '#60a5fa' : '#ffffff';
                            mapCtx.strokeStyle = '#1d4ed8';
                            mapCtx.lineWidth = 1.5;
                            mapCtx.fillRect(h.x - hSize / 2, h.y - hSize / 2, hSize, hSize);
                            mapCtx.strokeRect(h.x - hSize / 2, h.y - hSize / 2, hSize, hSize);
                        });

                        mapCtx.restore();
                    }
                });
                continue;
            }

            if (!layer.data) continue;

            for (let y = minRow; y <= maxRow; y++) {
                if (!layer.data[y]) continue;
                for (let x = minCol; x <= maxCol; x++) {
                    const tile = layer.data[y][x];
                    if (tile) {
                        // Check Animated Water / Sparkle Tile
                        if (tile.animTileId) {
                            const anim = animTileMap.get(tile.animTileId);
                            if (anim && anim.frames && anim.frames.length > 0) {
                                const dur = anim.frameDurationMs || 250;
                                const frameIdx = Math.floor(now / dur) % anim.frames.length;
                                const activeFrame = anim.frames[frameIdx];
                                const ts = (anim.tilesetId ? tilesetMap.get(anim.tilesetId) : null) || defaultTileset;

                                if (ts && ts.image) {
                                    const margin = ts.margin || 0;
                                    const spacing = ts.spacing || 0;
                                    const srcX = margin + activeFrame.tx * (state.TILE_SIZE + spacing);
                                    const srcY = margin + activeFrame.ty * (state.TILE_SIZE + spacing);

                                    drawTileTransformed(
                                        mapCtx, ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE,
                                        x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE,
                                        tile.flipH, tile.flipV, tile.rotation
                                    );
                                    continue;
                                }
                            }
                        }

                        // Collection Tileset Rendering
                        const ts = (tile.tilesetId ? tilesetMap.get(tile.tilesetId) : null) || defaultTileset;
                        if (!ts || ts.isMissing) {
                            continue;
                        }

                        if (ts && ts.isCollection && ts.images) {
                            const imgObj = ts.images.find(img => img.id === tile.imageId);
                            if (imgObj && (imgObj.isMissing || !imgObj.image)) {
                                continue;
                            }
                            if (imgObj && (imgObj.image || imgObj.dataUrl)) {
                                const imgEl = imgObj.image;
                                if (imgEl && imgEl.width > 0) {
                                    const destW = imgObj.width || state.TILE_SIZE;
                                    const destH = imgObj.height || state.TILE_SIZE;
                                    const cellX = x * state.TILE_SIZE;
                                    const cellY = y * state.TILE_SIZE;

                                    let drawX = cellX;
                                    let drawY = cellY;
                                    const anchor = imgObj.anchor || 'bottom-center';

                                    if (anchor === 'bottom-center') {
                                        drawX = cellX + (state.TILE_SIZE - destW) / 2 + (imgObj.anchorOffsetX || 0);
                                        drawY = cellY + state.TILE_SIZE - destH + (imgObj.anchorOffsetY || 0);
                                    } else if (anchor === 'bottom-left') {
                                        drawX = cellX + (imgObj.anchorOffsetX || 0);
                                        drawY = cellY + state.TILE_SIZE - destH + (imgObj.anchorOffsetY || 0);
                                    } else if (anchor === 'center') {
                                        drawX = cellX + (state.TILE_SIZE - destW) / 2 + (imgObj.anchorOffsetX || 0);
                                        drawY = cellY + (state.TILE_SIZE - destH) / 2 + (imgObj.anchorOffsetY || 0);
                                    } else if (anchor === 'top-center') {
                                        drawX = cellX + (state.TILE_SIZE - destW) / 2 + (imgObj.anchorOffsetX || 0);
                                        drawY = cellY + (imgObj.anchorOffsetY || 0);
                                    } else {
                                        drawX = cellX + (imgObj.anchorOffsetX || 0);
                                        drawY = cellY + (imgObj.anchorOffsetY || 0);
                                    }

                                    drawTileTransformed(
                                        mapCtx, imgEl, 0, 0, imgEl.naturalWidth || imgEl.width, imgEl.naturalHeight || imgEl.height,
                                        drawX, drawY, destW, destH,
                                        tile.flipH, tile.flipV, tile.rotation
                                    );
                                    continue;
                                }
                            }
                        }

                        // Standard Static or Autotile Rendering
                        if (ts && ts.image) {
                            if (layer.terrainVertices) {
                                const dualGridComposited = (window.TileWeaver.autotile && window.TileWeaver.autotile.drawDualGridCellSubQuadrants)
                                    ? window.TileWeaver.autotile.drawDualGridCellSubQuadrants(mapCtx, l, x, y, tile)
                                    : false;
                                if (dualGridComposited) continue;
                            } else if (tile.autotileId && !tile.isStaticAutotile) {
                                const handled = drawAutotileCellSubQuadrants(mapCtx, l, x, y, tile, ts);
                                if (handled) continue;
                            }

                            const margin = ts.margin || 0;
                            const spacing = ts.spacing || 0;
                            const srcX = margin + tile.tx * (state.TILE_SIZE + spacing);
                            const srcY = margin + tile.ty * (state.TILE_SIZE + spacing);

                            drawTileTransformed(
                                mapCtx, ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE,
                                x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE,
                                tile.flipH, tile.flipV, tile.rotation
                            );

                            // Draw Layered Alpha Overlays if present (Option B 46-Tile Overlay System)
                            if (tile.overlays && Array.isArray(tile.overlays) && tile.overlays.length > 0) {
                                tile.overlays.forEach(ov => {
                                    const ovTs = (ov.tilesetId ? tilesetMap.get(ov.tilesetId) : null) || ts;
                                    if (ovTs && ovTs.image) {
                                        const ovMargin = ovTs.margin || 0;
                                        const ovSpacing = ovTs.spacing || 0;
                                        const ovSrcX = ovMargin + ov.tx * (state.TILE_SIZE + ovSpacing);
                                        const ovSrcY = ovMargin + ov.ty * (state.TILE_SIZE + ovSpacing);
                                        drawTileTransformed(
                                            mapCtx, ovTs.image, ovSrcX, ovSrcY, state.TILE_SIZE, state.TILE_SIZE,
                                            x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE,
                                            tile.flipH, tile.flipV, tile.rotation
                                        );
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }

        mapCtx.globalAlpha = 1.0;

        // 2. Render Map Grid Overlay
        if (state.showGrid) {
            mapCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            mapCtx.lineWidth = 1;
            for (let x = 0; x <= mapCanvas.width; x += state.TILE_SIZE) {
                mapCtx.beginPath(); mapCtx.moveTo(x, 0); mapCtx.lineTo(x, mapCanvas.height); mapCtx.stroke();
            }
            for (let y = 0; y <= mapCanvas.height; y += state.TILE_SIZE) {
                mapCtx.beginPath(); mapCtx.moveTo(0, y); mapCtx.lineTo(mapCanvas.width, y); mapCtx.stroke();
            }
        }

        // 3. Render Collision Passability Overlay (O / X / *)
        if (state.showPassability && state.passabilityGrid) {
            mapCtx.font = 'bold 14px monospace';
            mapCtx.textAlign = 'center';
            mapCtx.textBaseline = 'middle';

            for (let y = minRow; y <= maxRow; y++) {
                if (!state.passabilityGrid[y]) continue;
                for (let x = minCol; x <= maxCol; x++) {
                    const flag = state.passabilityGrid[y][x];
                    const cx = x * state.TILE_SIZE + state.TILE_SIZE / 2;
                    const cy = y * state.TILE_SIZE + state.TILE_SIZE / 2;

                    if (flag === 1) { // 🟢 Passable
                        mapCtx.fillStyle = 'rgba(34, 197, 94, 0.2)';
                        mapCtx.fillRect(x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                        mapCtx.fillStyle = '#22c55e';
                        mapCtx.fillText('O', cx, cy);
                    } else if (flag === 2) { // 🔴 Solid Impassable
                        mapCtx.fillStyle = 'rgba(239, 68, 68, 0.2)';
                        mapCtx.fillRect(x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                        mapCtx.fillStyle = '#ef4444';
                        mapCtx.fillText('X', cx, cy);
                    } else if (flag === 3) { // ⭐ Overhang Ceiling
                        mapCtx.fillStyle = 'rgba(168, 85, 247, 0.2)';
                        mapCtx.fillRect(x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                        mapCtx.fillStyle = '#a855f7';
                        mapCtx.fillText('*', cx, cy);
                    }
                }
            }
        }

        // 4. Render Region ID Heatmap Overlay
        if (state.showRegions && state.regionGrid) {
            // OPTIMIZATION (60 FPS Canvas): Batch font & text alignment state outside iteration loop
            mapCtx.font = '10px monospace';
            mapCtx.textAlign = 'right';
            mapCtx.textBaseline = 'bottom';

            for (let y = minRow; y <= maxRow; y++) {
                if (!state.regionGrid[y]) continue;
                for (let x = minCol; x <= maxCol; x++) {
                    const rId = state.regionGrid[y][x];
                    if (rId > 0) {
                        mapCtx.fillStyle = `hsla(${(rId * 45) % 360}, 80%, 50%, 0.3)`;
                        mapCtx.fillRect(x * state.TILE_SIZE, y * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                        mapCtx.fillStyle = '#ffffff';
                        mapCtx.fillText(rId, (x + 1) * state.TILE_SIZE - 2, (y + 1) * state.TILE_SIZE - 2);
                    }
                }
            }
        }

        // 5. Render Mouse Hover Cursor & Active Shape Previews
        if (state.hoverCol >= 0 && state.hoverCol < state.mapWidth && state.hoverRow >= 0 && state.hoverRow < state.mapHeight) {
            if (state.isDrawing && (state.currentTool === 'line' || state.currentTool === 'rect')) {
                mapCtx.strokeStyle = '#60a5fa';
                mapCtx.lineWidth = 2;

                if (state.currentTool === 'line') {
                    const points = getLinePoints(state.shapeStartCol, state.shapeStartRow, state.hoverCol, state.hoverRow);
                    points.forEach(p => {
                        mapCtx.strokeRect(p.col * state.TILE_SIZE, p.row * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                    });
                } else if (state.currentTool === 'rect') {
                    const minC = Math.min(state.shapeStartCol, state.hoverCol);
                    const maxC = Math.max(state.shapeStartCol, state.hoverCol);
                    const minR = Math.min(state.shapeStartRow, state.hoverRow);
                    const maxR = Math.max(state.shapeStartRow, state.hoverRow);
                    const w = (maxC - minC + 1) * state.TILE_SIZE;
                    const h = (maxR - minR + 1) * state.TILE_SIZE;
                    mapCtx.strokeRect(minC * state.TILE_SIZE, minR * state.TILE_SIZE, w, h);
                }
            } else {
                mapCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                mapCtx.lineWidth = 1.5;

                if (state.currentTool === 'erase') {
                    mapCtx.fillStyle = 'rgba(239, 68, 68, 0.4)';
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.currentTool === 'passability') {
                    mapCtx.strokeRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.currentTool === 'region') {
                    mapCtx.fillStyle = `hsla(${(state.currentRegionId * 45) % 360}, 80%, 50%, 0.5)`;
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.currentTool === 'cliff') {
                    const h = state.cliffBrushHeight || 2;
                    mapCtx.fillStyle = 'rgba(245, 158, 11, 0.35)';
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE * (h + 1));
                    mapCtx.strokeStyle = '#f59e0b';
                    mapCtx.lineWidth = 2.5;
                    mapCtx.strokeRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE * (h + 1));
                } else if (state.currentTool === 'terrain') {
                    mapCtx.fillStyle = 'rgba(20, 184, 166, 0.4)';
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                    mapCtx.strokeStyle = '#14b8a6';
                    mapCtx.lineWidth = 2;
                    mapCtx.strokeRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.currentTool === 'autotile') {
                    mapCtx.fillStyle = 'rgba(16, 185, 129, 0.4)';
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.currentTool === 'animtile') {
                    mapCtx.fillStyle = 'rgba(168, 85, 247, 0.4)';
                    mapCtx.fillRect(state.hoverCol * state.TILE_SIZE, state.hoverRow * state.TILE_SIZE, state.TILE_SIZE, state.TILE_SIZE);
                } else if (state.tilesets[state.activeTilesetIndex]) {
                    const ts = state.tilesets[state.activeTilesetIndex];
                    const activeLayer = state.mapLayers[state.activeLayerIndex];
                    const isObjectContext = (activeLayer && activeLayer.type === 'objectgroup') || state.currentTool === 'objectPlace' || ts.isCollection;

                    if (ts.isCollection && ts.images && ts.images.length > 0) {
                        const imgObj = ts.images.find(img => img.id === ts.activeImageId) || ts.images[0];
                        if (imgObj && (imgObj.image || imgObj.dataUrl)) {
                            const imgEl = imgObj.image;
                            if (imgEl && imgEl.width > 0) {
                                mapCtx.globalAlpha = 0.55;
                                const destW = imgObj.width || state.TILE_SIZE;
                                const destH = imgObj.height || state.TILE_SIZE;
                                const cellX = (isObjectContext && state.hoverPixelX !== undefined) ? state.hoverPixelX : (state.hoverCol * state.TILE_SIZE);
                                const cellY = (isObjectContext && state.hoverPixelY !== undefined) ? state.hoverPixelY : (state.hoverRow * state.TILE_SIZE);

                                const align = (ts.objectalignment || (imgObj ? imgObj.anchor : null) || 'bottomleft').toLowerCase();
                                let drawX = cellX;
                                let drawY = cellY;

                                if (align === 'bottom' || align === 'bottomcenter' || align === 'bottom-center') {
                                    drawX = cellX - destW / 2;
                                    drawY = cellY - destH;
                                } else if (align === 'bottomright' || align === 'bottom-right') {
                                    drawX = cellX - destW;
                                    drawY = cellY - destH;
                                } else if (align === 'left' || align === 'centerleft' || align === 'middle-left') {
                                    drawX = cellX;
                                    drawY = cellY - destH / 2;
                                } else if (align === 'center' || align === 'middle') {
                                    drawX = cellX - destW / 2;
                                    drawY = cellY - destH / 2;
                                } else if (align === 'right' || align === 'centerright' || align === 'middle-right') {
                                    drawX = cellX - destW;
                                    drawY = cellY - destH / 2;
                                } else if (align === 'topleft' || align === 'top-left') {
                                    drawX = cellX;
                                    drawY = cellY;
                                } else if (align === 'top' || align === 'topcenter' || align === 'top-center') {
                                    drawX = cellX - destW / 2;
                                    drawY = cellY;
                                } else if (align === 'topright' || align === 'top-right') {
                                    drawX = cellX - destW;
                                    drawY = cellY;
                                } else {
                                    // Default bottom-left
                                    drawX = cellX;
                                    drawY = cellY - destH;
                                }

                                drawX += (imgObj.anchorOffsetX || 0);
                                drawY += (imgObj.anchorOffsetY || 0);

                                drawTileTransformed(
                                    mapCtx, imgEl, 0, 0, imgEl.naturalWidth || imgEl.width, imgEl.naturalHeight || imgEl.height,
                                    drawX, drawY, destW, destH,
                                    state.stampTransform.flipH, state.stampTransform.flipV, state.stampTransform.rotation
                                );
                                mapCtx.globalAlpha = 1.0;

                                // Draw visual bounding box & origin crosshair for object placement
                                mapCtx.strokeStyle = '#6366f1';
                                mapCtx.lineWidth = 1.5;
                                mapCtx.strokeRect(drawX, drawY, destW, destH);

                                // Origin Anchor Dot
                                mapCtx.fillStyle = '#ef4444';
                                mapCtx.strokeStyle = '#ffffff';
                                mapCtx.lineWidth = 1;
                                mapCtx.beginPath();
                                mapCtx.arc(cellX, cellY, 4, 0, Math.PI * 2);
                                mapCtx.fill();
                                mapCtx.stroke();
                            }
                        }
                    } else if (ts.image) {
                        mapCtx.globalAlpha = 0.5;
                        const margin = ts.margin || 0;
                        const spacing = ts.spacing || 0;
                        const stampW = state.selectedStamp.width || 1;
                        const stampH = state.selectedStamp.height || 1;
                        const destW = stampW * state.TILE_SIZE;
                        const destH = stampH * state.TILE_SIZE;
                        const cellX = (isObjectContext && state.hoverPixelX !== undefined) ? state.hoverPixelX : (state.hoverCol * state.TILE_SIZE);
                        const cellY = (isObjectContext && state.hoverPixelY !== undefined) ? state.hoverPixelY : (state.hoverRow * state.TILE_SIZE);

                        let baseDrawX = cellX;
                        let baseDrawY = cellY;

                        if (isObjectContext) {
                            const align = (ts.objectalignment || 'bottomleft').toLowerCase();
                            if (align === 'bottom' || align === 'bottomcenter') {
                                baseDrawX = cellX - destW / 2;
                                baseDrawY = cellY - destH;
                            } else if (align === 'bottomright') {
                                baseDrawX = cellX - destW;
                                baseDrawY = cellY - destH;
                            } else if (align === 'left' || align === 'centerleft') {
                                baseDrawX = cellX;
                                baseDrawY = cellY - destH / 2;
                            } else if (align === 'center') {
                                baseDrawX = cellX - destW / 2;
                                baseDrawY = cellY - destH / 2;
                            } else if (align === 'right' || align === 'centerright') {
                                baseDrawX = cellX - destW;
                                baseDrawY = cellY - destH / 2;
                            } else if (align === 'topleft') {
                                baseDrawX = cellX;
                                baseDrawY = cellY;
                            } else if (align === 'top' || align === 'topcenter') {
                                baseDrawX = cellX - destW / 2;
                                baseDrawY = cellY;
                            } else if (align === 'topright') {
                                baseDrawX = cellX - destW;
                                baseDrawY = cellY;
                            } else {
                                baseDrawX = cellX;
                                baseDrawY = cellY - destH;
                            }
                        }

                        for (let r = 0; r < stampH; r++) {
                            for (let c = 0; c < stampW; c++) {
                                const srcX = margin + (state.selectedStamp.col + c) * (state.TILE_SIZE + spacing);
                                const srcY = margin + (state.selectedStamp.row + r) * (state.TILE_SIZE + spacing);
                                const tileDrawX = baseDrawX + c * state.TILE_SIZE;
                                const tileDrawY = baseDrawY + r * state.TILE_SIZE;

                                drawTileTransformed(
                                    mapCtx,
                                    ts.image,
                                    srcX, srcY, state.TILE_SIZE, state.TILE_SIZE,
                                    tileDrawX, tileDrawY, state.TILE_SIZE, state.TILE_SIZE,
                                    state.stampTransform.flipH, state.stampTransform.flipV, state.stampTransform.rotation
                                );
                            }
                        }
                        mapCtx.globalAlpha = 1.0;

                        if (isObjectContext) {
                            mapCtx.strokeStyle = '#6366f1';
                            mapCtx.lineWidth = 1.5;
                            mapCtx.strokeRect(baseDrawX, baseDrawY, destW, destH);

                            mapCtx.fillStyle = '#ef4444';
                            mapCtx.strokeStyle = '#ffffff';
                            mapCtx.lineWidth = 1;
                            mapCtx.beginPath();
                            mapCtx.arc(cellX, cellY, 4, 0, Math.PI * 2);
                            mapCtx.fill();
                            mapCtx.stroke();
                        }
                    }
                }
            }
        }
    }

    /**
     * Translates a mouse pointer event on a canvas into `{ col, row, x, y }` coordinates.
     * Accounts for tileset palette zoom scaling when querying tileset viewer canvases.
     */
    function getCanvasPixelCoordinates(canvas, event) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;

        const isTilesetCanvas = canvas && canvas.id && canvas.id.includes('tileset');
        const zoom = isTilesetCanvas ? (state.tilesetZoom || 1.0) : 1.0;

        if (isTilesetCanvas) {
            const ts = state.tilesets[state.activeTilesetIndex];
            const margin = ts ? (ts.margin || 0) * zoom : 0;
            const spacing = ts ? (ts.spacing || 0) * zoom : 0;
            const step = (state.TILE_SIZE * zoom) + spacing;

            return {
                x: Math.round(x),
                y: Math.round(y),
                col: Math.floor(Math.max(0, x - margin) / (step > 0 ? step : 1)),
                row: Math.floor(Math.max(0, y - margin) / (step > 0 ? step : 1))
            };
        }

        // Map Canvas & Generic Viewport Canvases (always uniform TILE_SIZE grid)
        return {
            x: Math.round(x),
            y: Math.round(y),
            col: Math.floor(Math.max(0, x) / state.TILE_SIZE),
            row: Math.floor(Math.max(0, y) / state.TILE_SIZE)
        };
    }

    /**
     * Translates a mouse pointer event on a canvas into `{ col, row }` grid coordinates.
     */
    function getGridCoordinates(canvas, event) {
        return getCanvasPixelCoordinates(canvas, event);
    }

    /**
     * Bresenham's Line Algorithm: Computes discrete grid points along a line between two coordinates.
     */
    function getLinePoints(x0, y0, x1, y1) {
        const points = [];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        let currX = x0;
        let currY = y0;

        while (true) {
            points.push({ col: currX, row: currY });
            if (currX === x1 && currY === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; currX += sx; }
            if (e2 < dx) { err += dx; currY += sy; }
        }
        return points;
    }

    /** Starts continuous requestAnimationFrame loop for animated ocean water tiles */
    let isLoopRunning = false;
    function startAnimationLoop() {
        if (isLoopRunning) return;
        isLoopRunning = true;

        function loop() {
            if (state.animatedTiles.length > 0) {
                drawMap();
            }
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    }

    // Expose rendering engine on window.TileWeaver namespace
    window.TileWeaver.rendering = {
        initRenderingElements,
        resizeCanvases,
        drawTileTransformed,
        drawTileset,
        drawMap,
        getGridCoordinates,
        getCanvasPixelCoordinates,
        getLinePoints,
        startAnimationLoop
    };
})();
