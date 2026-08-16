/**
 * @fileoverview TileWeaver - Tileset Extruder Engine
 * @subsystem Asset, Tileset & Extrusion Pipeline
 * @frameBudget 0.0 ms (Decoupled from 60 FPS animation loop; user/modal-gated)
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY
 * @stateInvariants Mutates state.tilesets[i].image, margin, and spacing atomically
 * @historyTracked Snapshots recorded via history.pushHistoryState()
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+ (Margin & Spacing compliant)
 * -----------------------------------------------------------------------------------
 * Fixes texture bleeding and tile seams in WebGL/game engines (Phaser, Godot, PixiJS, Unity, etc.)
 * by repeating 1-pixel outer borders and corner pixels around each tile in a tileset.
 *
 * Mathematical formulas:
 *   cols = floor((W - margin) / (tileWidth + spacing))
 *   rows = floor((H - margin) / (tileHeight + spacing))
 *   newMargin = margin + extrude
 *   newSpacing = spacing + 2 * extrude
 *   newWidth = 2 * newMargin + cols * tileWidth + (cols - 1) * newSpacing
 *   newHeight = 2 * newMargin + rows * tileHeight + (rows - 1) * newSpacing
 */

(function() {
    /**
     * Creates an HTMLCanvasElement or node canvas abstraction.
     * @param {number} width - Canvas buffer width in pixels
     * @param {number} height - Canvas buffer height in pixels
     * @param {Function} [createCanvasFn] - Optional canvas factory (for Node.js headless environments)
     * @returns {HTMLCanvasElement} Instantiated canvas element
     */
    function createCanvas(width, height, createCanvasFn) {
        if (createCanvasFn) {
            return createCanvasFn(width, height);
        }
        if (typeof document !== 'undefined' && document.createElement) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
        }
        throw new Error("No canvas factory available in this environment.");
    }

    /**
     * Core extrusion function: Given a source image or canvas, performs pixel-perfect 8-directional
     * edge and corner extrusion for all tiles in the tileset.
     *
     * OPTIMIZATION (Draw Call Batching): Utilizes nearest-neighbor single-pass slice stretching
     * (ctx.imageSmoothingEnabled = false) to eliminate O(e^2) inner loops, executing exactly
     * 9 drawImage operations per tile regardless of extrusion depth.
     *
     * @param {HTMLImageElement|HTMLCanvasElement|Image} sourceImage - Source spritesheet image or canvas
     * @param {Object} [options] - Configuration options
     * @param {number} [options.tileWidth=32] - Tile width in pixels
     * @param {number} [options.tileHeight=32] - Tile height in pixels
     * @param {number} [options.margin=0] - Input margin around tileset in pixels
     * @param {number} [options.spacing=0] - Input spacing between tiles in pixels
     * @param {number} [options.extrude=1] - Extrusion padding amount in pixels (default 1px)
     * @param {Function} [options.createCanvasFn] - Optional canvas factory for Node.js
     * @returns {Object} Extrusion result containing canvas, metrics, and new margin/spacing
     */
    function extrudeTilesetCanvas(sourceImage, options = {}) {
        const tileWidth = Math.max(1, Math.floor(options.tileWidth || 32));
        const tileHeight = Math.max(1, Math.floor(options.tileHeight || 32));
        const margin = Math.max(0, Math.floor(options.margin !== undefined ? options.margin : 0));
        const spacing = Math.max(0, Math.floor(options.spacing !== undefined ? options.spacing : 0));
        const extrude = Math.max(1, Math.floor(options.extrude !== undefined ? options.extrude : 1));

        const srcWidth = sourceImage ? (sourceImage.naturalWidth || sourceImage.width) : 0;
        const srcHeight = sourceImage ? (sourceImage.naturalHeight || sourceImage.height) : 0;

        if (!srcWidth || !srcHeight) {
            throw new Error("Invalid source image dimensions.");
        }

        const cols = Math.floor((srcWidth - margin) / (tileWidth + spacing));
        const rows = Math.floor((srcHeight - margin) / (tileHeight + spacing));

        if (cols <= 0 || rows <= 0) {
            throw new Error(`Cannot extrude image of size ${srcWidth}x${srcHeight} with tile size ${tileWidth}x${tileHeight}`);
        }

        // INVARIANT: Linear layout math for padding and spacing inflation
        const newMargin = margin + extrude;
        const newSpacing = spacing + (2 * extrude);
        const newWidth = 2 * newMargin + cols * tileWidth + (cols - 1) * newSpacing;
        const newHeight = 2 * newMargin + rows * tileHeight + (rows - 1) * newSpacing;

        const outCanvas = createCanvas(newWidth, newHeight, options.createCanvasFn);
        const ctx = outCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        // Clear canvas with transparent alpha
        ctx.clearRect(0, 0, newWidth, newHeight);

        // Process every tile in the grid
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const srcX = margin + c * (tileWidth + spacing);
                const srcY = margin + r * (tileHeight + spacing);

                const destX = newMargin + c * (tileWidth + newSpacing);
                const destY = newMargin + r * (tileHeight + newSpacing);

                // 1. Central Tile Body (1:1 copy)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY, tileWidth, tileHeight,
                    destX, destY, tileWidth, tileHeight
                );

                // OPTIMIZATION: Batch single-stretch draw calls (O(1) draw calls per tile)
                // 2. North Edge Extrusion (Single-batch 1px stretch across e px height)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY, tileWidth, 1,
                    destX, destY - extrude, tileWidth, extrude
                );

                // 3. South Edge Extrusion (Single-batch 1px stretch across e px height)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY + tileHeight - 1, tileWidth, 1,
                    destX, destY + tileHeight, tileWidth, extrude
                );

                // 4. West Edge Extrusion (Single-batch 1px stretch across e px width)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY, 1, tileHeight,
                    destX - extrude, destY, extrude, tileHeight
                );

                // 5. East Edge Extrusion (Single-batch 1px stretch across e px width)
                ctx.drawImage(
                    sourceImage,
                    srcX + tileWidth - 1, srcY, 1, tileHeight,
                    destX + tileWidth, destY, extrude, tileHeight
                );

                // 6. Top-Left (NW) Corner Extrusion (Single-batch 1x1 stretch across e x e area)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY, 1, 1,
                    destX - extrude, destY - extrude, extrude, extrude
                );

                // 7. Top-Right (NE) Corner Extrusion (Single-batch 1x1 stretch across e x e area)
                ctx.drawImage(
                    sourceImage,
                    srcX + tileWidth - 1, srcY, 1, 1,
                    destX + tileWidth, destY - extrude, extrude, extrude
                );

                // 8. Bottom-Left (SW) Corner Extrusion (Single-batch 1x1 stretch across e x e area)
                ctx.drawImage(
                    sourceImage,
                    srcX, srcY + tileHeight - 1, 1, 1,
                    destX - extrude, destY + tileHeight, extrude, extrude
                );

                // 9. Bottom-Right (SE) Corner Extrusion (Single-batch 1x1 stretch across e x e area)
                ctx.drawImage(
                    sourceImage,
                    srcX + tileWidth - 1, srcY + tileHeight - 1, 1, 1,
                    destX + tileWidth, destY + tileHeight, extrude, extrude
                );
            }
        }

        let dataUrl = '';
        try {
            if (outCanvas.toDataURL) {
                dataUrl = outCanvas.toDataURL('image/png');
            }
        } catch (e) {
            // Tainted canvas under local file:// protocol or CORS restriction
            dataUrl = '';
        }

        return {
            canvas: outCanvas,
            dataUrl: dataUrl,
            srcWidth,
            srcHeight,
            newWidth,
            newHeight,
            cols,
            rows,
            tileWidth,
            tileHeight,
            oldMargin: margin,
            oldSpacing: spacing,
            newMargin,
            newSpacing,
            extrude
        };
    }

    /**
     * Loads an HTMLImageElement asynchronously from a Data URL or Image Source.
     * @param {string} src - Data URL or remote/local URL string
     * @returns {Promise<HTMLImageElement>} Resolved HTMLImageElement
     */
    function loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http') && typeof src === 'string' && !src.startsWith('data:')) {
                img.crossOrigin = "anonymous";
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to load image for extrusion"));
            img.src = src;
            if (img.complete) {
                resolve(img);
            }
        });
    }

    /**
     * Applies extrusion in-place to an active tileset in TileWeaver.
     * Replaces the image, adjusts margin/spacing, pushes a history state, and redraws canvases.
     *
     * @param {number} tilesetIndex - Index of tileset in state.tilesets
     * @param {Object} [options] - Extrusion options (tileWidth, tileHeight, extrude)
     * @returns {Promise<Object>} The extrusion result object
     */
    async function applyExtrusionToTileset(tilesetIndex, options = {}) {
        const stateModule = window.TileWeaver && window.TileWeaver.stateModule;
        if (!stateModule) throw new Error("State module not loaded.");
        const state = stateModule.state;

        const ts = state.tilesets[tilesetIndex];
        if (!ts) throw new Error(`Tileset index ${tilesetIndex} not found.`);
        if (ts.isCollection) throw new Error("Collection tilesets cannot be extruded as a single spritesheet.");

        const tileWidth = Math.max(1, Math.floor(options.tileWidth || ts.tilewidth || state.TILE_SIZE || 32));
        const tileHeight = Math.max(1, Math.floor(options.tileHeight || ts.tileheight || state.TILE_SIZE || 32));
        const extrude = Math.max(1, Math.floor(options.extrude !== undefined ? options.extrude : 1));

        const result = extrudeTilesetCanvas(ts.image, {
            tileWidth,
            tileHeight,
            margin: ts.margin || 0,
            spacing: ts.spacing || 0,
            extrude,
            createCanvasFn: options.createCanvasFn
        });

        // Load new HTMLImageElement or fallback to HTMLCanvasElement directly
        let newImg = result.canvas;
        if (result.dataUrl) {
            try {
                newImg = await loadImageAsync(result.dataUrl);
            } catch (e) {
                newImg = result.canvas;
            }
        }

        // INVARIANT: Atomic state assignment after texture hydration
        ts.image = newImg;
        ts.margin = result.newMargin;
        ts.spacing = result.newSpacing;

        // Synchronize input fields across dock, popout, and inspector UI
        ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = ts.margin;
        });
        ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = ts.spacing;
        });

        // Push undo history snapshot
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState(`Extruded Tileset: ${ts.name}`);
        }

        // Redraw canvases
        if (window.TileWeaver.rendering) {
            window.TileWeaver.rendering.drawTileset();
            window.TileWeaver.rendering.drawMap();
        }
        if (window.TileWeaver.tilesetManager) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }

        if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
            window.TileWeaver.toast.showMessage(`Extruded '${ts.name}' (Margin: ${ts.margin}px, Spacing: ${ts.spacing}px)`, "success");
        }

        return result;
    }

    /**
     * Clones a tileset as a new extruded tileset and adds it to state.tilesets.
     *
     * @param {number} tilesetIndex - Index of tileset in state.tilesets
     * @param {Object} [options] - Extrusion options (tileWidth, tileHeight, extrude)
     * @returns {Promise<Object>} The cloned tileset object
     */
    async function cloneAsExtrudedTileset(tilesetIndex, options = {}) {
        const stateModule = window.TileWeaver && window.TileWeaver.stateModule;
        if (!stateModule) throw new Error("State module not loaded.");
        const state = stateModule.state;

        const ts = state.tilesets[tilesetIndex];
        if (!ts) throw new Error(`Tileset index ${tilesetIndex} not found.`);
        if (ts.isCollection) throw new Error("Collection tilesets cannot be extruded as a single spritesheet.");

        const tileWidth = Math.max(1, Math.floor(options.tileWidth || ts.tilewidth || state.TILE_SIZE || 32));
        const tileHeight = Math.max(1, Math.floor(options.tileHeight || ts.tileheight || state.TILE_SIZE || 32));
        const extrude = Math.max(1, Math.floor(options.extrude !== undefined ? options.extrude : 1));

        const result = extrudeTilesetCanvas(ts.image, {
            tileWidth,
            tileHeight,
            margin: ts.margin || 0,
            spacing: ts.spacing || 0,
            extrude,
            createCanvasFn: options.createCanvasFn
        });

        let newImg = result.canvas;
        if (result.dataUrl) {
            try {
                newImg = await loadImageAsync(result.dataUrl);
            } catch (e) {
                newImg = result.canvas;
            }
        }

        const newTs = {
            id: 'ts_' + (state.tilesetIdCounter++),
            name: `${ts.name} (Extruded)`,
            filename: `${ts.name.toLowerCase().replace(/\s+/g, '_')}_extruded.png`,
            image: newImg,
            margin: result.newMargin,
            spacing: result.newSpacing,
            tilewidth: tileWidth,
            tileheight: tileHeight,
            tileProperties: JSON.parse(JSON.stringify(ts.tileProperties || {}))
        };

        state.tilesets.push(newTs);
        state.activeTilesetIndex = state.tilesets.length - 1;

        // Push history snapshot
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState(`Created Extruded Tileset: ${newTs.name}`);
        }

        // Redraw canvases
        if (window.TileWeaver.rendering) {
            window.TileWeaver.rendering.drawTileset();
            window.TileWeaver.rendering.drawMap();
        }
        if (window.TileWeaver.tilesetManager) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }

        if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
            window.TileWeaver.toast.showMessage(`Created extruded tileset '${newTs.name}'`, "success");
        }

        return newTs;
    }

    /**
     * Downloads the extruded PNG file directly via browser file download.
     *
     * @param {number} tilesetIndex - Index of tileset in state.tilesets
     * @param {Object} [options] - Extrusion options (tileWidth, tileHeight, extrude)
     */
    function downloadExtrudedTileset(tilesetIndex, options = {}) {
        const stateModule = window.TileWeaver && window.TileWeaver.stateModule;
        if (!stateModule) return;
        const state = stateModule.state;

        const ts = state.tilesets[tilesetIndex];
        if (!ts || !ts.image) return;

        const tileWidth = Math.max(1, Math.floor(options.tileWidth || ts.tilewidth || state.TILE_SIZE || 32));
        const tileHeight = Math.max(1, Math.floor(options.tileHeight || ts.tileheight || state.TILE_SIZE || 32));
        const extrude = Math.max(1, Math.floor(options.extrude !== undefined ? options.extrude : 1));

        const result = extrudeTilesetCanvas(ts.image, {
            tileWidth,
            tileHeight,
            margin: ts.margin || 0,
            spacing: ts.spacing || 0,
            extrude,
            createCanvasFn: options.createCanvasFn
        });

        const cleanName = (ts.name || 'tileset').toLowerCase().replace(/\s+/g, '_');
        const filename = `${cleanName}_extruded_${extrude}px.png`;

        if (result.dataUrl) {
            const a = document.createElement('a');
            a.href = result.dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
                window.TileWeaver.toast.showMessage(`Downloaded extruded tileset '${filename}'`, "success");
            }
        } else if (result.canvas && result.canvas.toBlob) {
            try {
                result.canvas.toBlob((blob) => {
                    if (!blob) {
                        throw new Error("Could not export tainted canvas");
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
                        window.TileWeaver.toast.showMessage(`Downloaded extruded tileset '${filename}'`, "success");
                    }
                }, 'image/png');
            } catch (e) {
                if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
                    window.TileWeaver.toast.showMessage("Direct PNG download is blocked by browser file:// security. Please run a local web server ('npm start') or use in-editor extrusion.", "error");
                }
            }
        } else {
            if (window.TileWeaver.toast && window.TileWeaver.toast.showMessage) {
                window.TileWeaver.toast.showMessage("Direct PNG download is blocked by browser file:// security. Please run a local web server ('npm start') or use in-editor extrusion.", "error");
            }
        }
    }

    const extruderModule = {
        extrudeTilesetCanvas,
        loadImageAsync,
        applyExtrusionToTileset,
        cloneAsExtrudedTileset,
        downloadExtrudedTileset
    };

    if (typeof window !== 'undefined') {
        window.TileWeaver = window.TileWeaver || {};
        window.TileWeaver.extruder = extruderModule;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = extruderModule;
    }
})();
