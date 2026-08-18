/**
 * @fileoverview TileWeaver - Tileset Manager, Palette Viewer & Collection Pipeline Module
 * @subsystem Asset, Tileset & Extrusion Pipeline / Tileset Viewer & Palette UI
 * @frameBudget <0.5ms on pointer events (standalone drawTileset, decoupled from 60 FPS map RAF loop)
 * @coordinateSpace Screen/Viewport Pointer (px) -> Canvas DPR -> Tileset Grid Cell (col, row) -> selectedStamp Bounding Box
 * @stateInvariants state.tilesets[*] valid GIDs; selectedStamp col/row >= 0, w/h >= 1; tilesetZoom in [0.5, 4.0]
 * @historyTracked Snapshots recorded prior to collection additions, deletions, replacements, and tileset deletes
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+ (firstgid sequencing & 32-bit transformation flags)
 * ------------------------------------------------------------------
 * Handles:
 * 1. Procedural tileset canvas generators:
 *    - `generateDefaultTileset()`: 5x4 Grass Meadow autotile set & animated water tiles.
 *    - `generateDirtPathTileset()`: 5x4 Dirt Path terrain set.
 *    - `generateDualGridDirtTileset()`: 4x4 Standard Dual-Grid 16-tile set.
 *    - `generateDefaultCollectionTileset()`: Procedural multi-size Foliage & Props collection.
 * 2. Async image loading promise helpers (`loadImage`).
 * 3. Tri-view tileset synchronization (Sidebar, Widescreen Bottom Dock, Floating Pop-Out Window).
 * 4. Tileset viewer canvas mouse interactions (click to select stamp, drag multi-tile stamp).
 * 5. Tile stamp transformations (Flip Horizontal, Flip Vertical, Rotate 90°).
 * 6. Collection of Images prop workflow (drag/drop ingestion, image replacement, GID cascade deletion).
 * 7. 1px Tile Extrusion Studio & isolated Ctrl+Wheel zoom navigation.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { drawTileset, drawMap, getGridCoordinates, resizeCanvases } = window.TileWeaver.rendering;

    /**
     * Generates default Grass Meadow 5x4 procedural tileset image.
     * @returns {string} PNG Data URL.
     */
    function generateDefaultTileset() {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        
        const dark = '#15803d';
        const light = '#4ade80';
        const detail = '#22c55e';

        // 1. Grass 3x3 Outer Block (0,0 to 2,2)
        ctx.fillStyle = dark; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 8, 24, 24);
        ctx.fillStyle = dark; ctx.fillRect(32, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(32, 8, 32, 24);
        ctx.fillStyle = dark; ctx.fillRect(64, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 8, 24, 24);
        ctx.fillStyle = dark; ctx.fillRect(0, 32, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 32, 24, 32);
        ctx.fillStyle = light; ctx.fillRect(32, 32, 32, 32); ctx.fillStyle = detail; ctx.fillRect(36, 36, 4, 4); ctx.fillRect(52, 44, 4, 4);
        ctx.fillStyle = dark; ctx.fillRect(64, 32, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 32, 24, 32);
        ctx.fillStyle = dark; ctx.fillRect(0, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 64, 24, 24);
        ctx.fillStyle = dark; ctx.fillRect(32, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(32, 64, 32, 24);
        ctx.fillStyle = dark; ctx.fillRect(64, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 64, 24, 24);

        // 2. Inner Corners (Cols 3..4, Rows 0..1)
        ctx.fillStyle = light; ctx.fillRect(96, 0, 32, 32); ctx.fillStyle = dark; ctx.fillRect(96, 0, 8, 8);
        ctx.fillStyle = light; ctx.fillRect(128, 0, 32, 32); ctx.fillStyle = dark; ctx.fillRect(152, 0, 8, 8);
        ctx.fillStyle = light; ctx.fillRect(96, 32, 32, 32); ctx.fillStyle = dark; ctx.fillRect(96, 56, 8, 8);
        ctx.fillStyle = light; ctx.fillRect(128, 32, 32, 32); ctx.fillStyle = dark; ctx.fillRect(152, 56, 8, 8);

        // 3. 45-Degree Diagonal Slopes (Cols 3..4, Rows 2..3)
        ctx.fillStyle = light; ctx.fillRect(96, 64, 32, 32); ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(96, 64); ctx.lineTo(128, 64); ctx.lineTo(96, 96); ctx.closePath(); ctx.fill();

        ctx.fillStyle = light; ctx.fillRect(128, 64, 32, 32); ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(128, 64); ctx.lineTo(160, 64); ctx.lineTo(160, 96); ctx.closePath(); ctx.fill();

        ctx.fillStyle = light; ctx.fillRect(96, 96, 32, 32); ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(96, 96); ctx.lineTo(96, 128); ctx.lineTo(128, 128); ctx.closePath(); ctx.fill();

        ctx.fillStyle = light; ctx.fillRect(128, 96, 32, 32); ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(160, 96); ctx.lineTo(160, 128); ctx.lineTo(128, 128); ctx.closePath(); ctx.fill();

        // 4. Animated Water Frames (Row 3, Cols 0..2)
        ctx.fillStyle = '#1d4ed8'; ctx.fillRect(0, 96, 32, 32); ctx.fillStyle = '#60a5fa'; ctx.fillRect(4, 8, 12, 2);
        ctx.fillStyle = '#2563eb'; ctx.fillRect(32, 96, 32, 32); ctx.fillStyle = '#93c5fd'; ctx.fillRect(10, 14, 12, 2);
        ctx.fillStyle = '#3b82f6'; ctx.fillRect(64, 96, 32, 32); ctx.fillStyle = '#bfdbfe'; ctx.fillRect(6, 20, 12, 2);

        return canvas.toDataURL('image/png');
    }

    /**
     * Generates default Dirt Path 5x4 procedural tileset image.
     * @returns {string} PNG Data URL.
     */
    function generateDirtPathTileset() {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        
        const grassBg = '#15803d';
        const dirtDark = '#78350f';
        const dirtFill = '#d97706';
        const dirtDetail = '#b45309';

        ctx.fillStyle = grassBg; ctx.fillRect(0, 0, 160, 160);
        ctx.fillStyle = '#22c55e';
        for (let i = 0; i < 40; i++) {
            ctx.fillRect((i * 19) % 155, (i * 29) % 155, 2, 2);
        }

        function drawDirtTile(tx, ty, drawFn) {
            ctx.save();
            ctx.translate(tx * 32, ty * 32);
            drawFn(ctx, dirtDark, dirtFill, dirtDetail);
            ctx.restore();
        }

        drawDirtTile(0, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 8, 24, 24); c.fillStyle = f; c.fillRect(10, 10, 22, 22); });
        drawDirtTile(1, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 8, 32, 24); c.fillStyle = f; c.fillRect(0, 10, 32, 22); });
        drawDirtTile(2, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 8, 24, 24); c.fillStyle = f; c.fillRect(0, 10, 22, 22); });
        drawDirtTile(0, 1, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 0, 24, 32); c.fillStyle = f; c.fillRect(10, 0, 22, 32); });
        drawDirtTile(1, 1, (c, d, f, dt) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = dt; c.fillRect(6, 6, 4, 4); c.fillRect(20, 18, 4, 4); });
        drawDirtTile(2, 1, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 24, 32); c.fillStyle = f; c.fillRect(0, 0, 22, 32); });
        drawDirtTile(0, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 0, 24, 24); c.fillStyle = f; c.fillRect(10, 0, 22, 22); });
        drawDirtTile(1, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 32, 24); c.fillStyle = f; c.fillRect(0, 0, 32, 22); });
        drawDirtTile(2, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 24, 24); c.fillStyle = f; c.fillRect(0, 0, 22, 22); });

        drawDirtTile(3, 0, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(0, 0, 8, 8); c.fillStyle = d; c.fillRect(0, 7, 8, 2); c.fillRect(7, 0, 2, 8); });
        drawDirtTile(4, 0, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(24, 0, 8, 8); c.fillStyle = d; c.fillRect(24, 7, 8, 2); c.fillRect(24, 0, 2, 8); });
        drawDirtTile(3, 1, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(0, 24, 8, 8); c.fillStyle = d; c.fillRect(0, 24, 8, 2); c.fillRect(7, 24, 2, 8); });
        drawDirtTile(4, 1, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(24, 24, 8, 8); c.fillStyle = d; c.fillRect(24, 24, 8, 2); c.fillRect(24, 24, 2, 8); });

        drawDirtTile(3, 2, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 0); c.lineTo(0, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 0); c.lineTo(0, 32); c.stroke(); });
        drawDirtTile(4, 2, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 0); c.lineTo(32, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 32); c.stroke(); });
        drawDirtTile(3, 3, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 32); c.lineTo(32, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 32); c.stroke(); });
        drawDirtTile(4, 3, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 32); c.lineTo(0, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 0); c.lineTo(0, 32); c.stroke(); });

        ctx.fillStyle = '#92400e'; ctx.fillRect(0, 96, 32, 32);
        ctx.fillStyle = '#78350f'; ctx.fillRect(32, 96, 32, 32);
        ctx.fillStyle = '#451a03'; ctx.fillRect(64, 96, 32, 32);

        return canvas.toDataURL('image/png');
    }

    /**
     * Generates standard 16-Tile Dual-Grid 4x4 procedural tileset image.
     * @returns {string} PNG Data URL.
     */
    function generateDualGridDirtTileset() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const grassBg = '#15803d';
        const grassDetail = '#22c55e';
        const dirtDark = '#78350f';
        const dirtFill = '#d97706';
        const dirtDetail = '#b45309';

        ctx.fillStyle = grassBg; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = grassDetail;
        for (let i = 0; i < 90; i++) {
            ctx.fillRect((i * 17) % 125, (i * 23) % 125, 2, 2);
        }

        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const mask = r * 4 + c;
                const ox = c * 32;
                const oy = r * 32;

                const vTL = (mask & 1) !== 0;
                const vTR = (mask & 2) !== 0;
                const vBL = (mask & 4) !== 0;
                const vBR = (mask & 8) !== 0;

                if (vTL) { ctx.fillStyle = dirtDark; ctx.fillRect(ox, oy, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox, oy, 16, 16); }
                if (vTR) { ctx.fillStyle = dirtDark; ctx.fillRect(ox + 14, oy, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox + 16, oy, 16, 16); }
                if (vBL) { ctx.fillStyle = dirtDark; ctx.fillRect(ox, oy + 14, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox, oy + 16, 16, 16); }
                if (vBR) { ctx.fillStyle = dirtDark; ctx.fillRect(ox + 14, oy + 14, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox + 16, oy + 16, 16, 16); }

                if (vTL && vTR && vBL && vBR) {
                    ctx.fillStyle = dirtDetail;
                    ctx.fillRect(ox + 6, oy + 6, 4, 4);
                    ctx.fillRect(ox + 20, oy + 18, 4, 4);
                    ctx.fillRect(ox + 12, oy + 24, 3, 3);
                }
            }
        }

        return canvas.toDataURL('image/png');
    }

    /**
     * Generates a procedural default "Foliage & Props" Collection of Images Tileset.
     * Creates multi-size prop images (Oak Tree 64x96, Wooden Chest 32x32, Stone Pillar 32x64, Signpost 32x32).
     * @returns {Promise<Object>} Populated Collection Tileset object.
     */
    async function generateDefaultCollectionTileset() {
        const { createNewCollectionTileset, addCollectionImage } = window.TileWeaver.stateModule;
        const coll = createNewCollectionTileset("Foliage & Props (Collection)");

        // 1. Procedural Oak Tree (64x96px)
        const canvasTree = document.createElement('canvas');
        canvasTree.width = 64; canvasTree.height = 96;
        const ctxT = canvasTree.getContext('2d');
        // Trunk
        ctxT.fillStyle = '#78350f'; ctxT.fillRect(24, 50, 16, 44);
        ctxT.fillStyle = '#451a03'; ctxT.fillRect(36, 50, 4, 44);
        // Canopy Layers
        ctxT.fillStyle = '#14532d'; ctxT.beginPath(); ctxT.arc(32, 36, 28, 0, Math.PI * 2); ctxT.fill();
        ctxT.fillStyle = '#166534'; ctxT.beginPath(); ctxT.arc(26, 30, 22, 0, Math.PI * 2); ctxT.fill();
        ctxT.fillStyle = '#22c55e'; ctxT.beginPath(); ctxT.arc(34, 24, 18, 0, Math.PI * 2); ctxT.fill();
        ctxT.fillStyle = '#4ade80'; ctxT.beginPath(); ctxT.arc(30, 18, 10, 0, Math.PI * 2); ctxT.fill();
        const imgTreeData = canvasTree.toDataURL('image/png');
        const imgTree = await loadImage(imgTreeData);
        addCollectionImage(coll, "Oak Tree", "tree_oak.png", imgTree, imgTreeData, "bottom-center");

        // 2. Procedural Wooden Chest (32x32px)
        const canvasChest = document.createElement('canvas');
        canvasChest.width = 32; canvasChest.height = 32;
        const ctxC = canvasChest.getContext('2d');
        ctxC.fillStyle = '#78350f'; ctxC.fillRect(4, 8, 24, 20);
        ctxC.fillStyle = '#b45309'; ctxC.fillRect(6, 10, 20, 16);
        ctxC.fillStyle = '#eab308'; ctxC.fillRect(4, 14, 24, 3); ctxC.fillRect(14, 14, 4, 6);
        const imgChestData = canvasChest.toDataURL('image/png');
        const imgChest = await loadImage(imgChestData);
        addCollectionImage(coll, "Wooden Chest", "chest_wooden.png", imgChest, imgChestData, "bottom-center");

        // 3. Procedural Stone Pillar (32x64px)
        const canvasPillar = document.createElement('canvas');
        canvasPillar.width = 32; canvasPillar.height = 64;
        const ctxP = canvasPillar.getContext('2d');
        ctxP.fillStyle = '#475569'; ctxP.fillRect(4, 8, 24, 52);
        ctxP.fillStyle = '#64748b'; ctxP.fillRect(6, 12, 20, 44);
        ctxP.fillStyle = '#94a3b8'; ctxP.fillRect(6, 12, 8, 44);
        ctxP.fillStyle = '#334155'; ctxP.fillRect(2, 4, 28, 8); ctxP.fillRect(2, 56, 28, 8);
        const imgPillarData = canvasPillar.toDataURL('image/png');
        const imgPillar = await loadImage(imgPillarData);
        addCollectionImage(coll, "Stone Pillar", "pillar_stone.png", imgPillar, imgPillarData, "bottom-center");

        // 4. Procedural Wooden Signpost (32x32px)
        const canvasSign = document.createElement('canvas');
        canvasSign.width = 32; canvasSign.height = 32;
        const ctxS = canvasSign.getContext('2d');
        ctxS.fillStyle = '#451a03'; ctxS.fillRect(14, 12, 4, 18);
        ctxS.fillStyle = '#92400e'; ctxS.fillRect(4, 4, 24, 12);
        ctxS.fillStyle = '#b45309'; ctxS.fillRect(6, 6, 20, 8);
        ctxS.fillStyle = '#78350f'; ctxS.fillRect(8, 9, 16, 2);
        const imgSignData = canvasSign.toDataURL('image/png');
        const imgSign = await loadImage(imgSignData);
        addCollectionImage(coll, "Wooden Signpost", "signpost.png", imgSign, imgSignData, "bottom-center");

        return coll;
    }

    /**
     * Promise wrapper for loading an HTMLImageElement from a Data URL cleanly.
     */
    function loadImage(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img);
            img.src = dataUrl;
            if (img.complete) {
                resolve(img);
            }
        });
    }

    /** Populates tileset select dropdowns across all view modes and toggles Collection vs Spritesheet UI */
    function renderTilesetSelect() {
        const selectIds = ['tileset-select', 'popout-tileset-select', 'dock-tileset-select'];
        
        selectIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '';

            if (!state.tilesets || state.tilesets.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '-- No Tileset Loaded --';
                el.appendChild(opt);
                return;
            }

            state.tilesets.forEach((ts, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = (ts.isMissing ? '⚠️ ' : '') + ts.name + (ts.isCollection ? ' [Collection]' : '') + (ts.isMissing ? ' (Missing Asset)' : '');
                if (idx === state.activeTilesetIndex) opt.selected = true;
                el.appendChild(opt);
            });
        });

        // Toggle UI modes for Collection Tilesets vs Standard Spritesheet Tilesets
        const activeTs = state.tilesets[state.activeTilesetIndex];
        const collContainer = document.getElementById('collection-inspector-container');
        const gridConfig = document.getElementById('tileset-grid-config');
        const tilesetCanvasContainer = document.getElementById('tileset-container');

        if (activeTs) {
            ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = activeTs.margin || 0;
            });
            ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = activeTs.spacing || 0;
            });
            ['tile-size-input', 'tile-size-dock', 'tile-size-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = state.TILE_SIZE || 32;
            });

            const nameBadge = document.getElementById('popout-tileset-name-badge');
            if (nameBadge) nameBadge.textContent = activeTs.name;

            const dimsEl = document.getElementById('popout-tileset-dims');
            if (dimsEl && activeTs.image) {
                dimsEl.textContent = `Dim: ${activeTs.image.width}x${activeTs.image.height}px`;
            }

            const alignSel = document.getElementById('dock-object-alignment-select');
            if (alignSel) alignSel.value = activeTs.objectalignment || 'bottomleft';
        } else {
            ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = 0;
            });
            ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = 0;
            });
            ['tile-size-input', 'tile-size-dock', 'tile-size-popout'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = state.TILE_SIZE || 32;
            });

            const nameBadge = document.getElementById('popout-tileset-name-badge');
            if (nameBadge) nameBadge.textContent = 'No Tileset';

            const dimsEl = document.getElementById('popout-tileset-dims');
            if (dimsEl) dimsEl.textContent = 'Dim: 0x0px';
        }

        const dockCanvasContainer = document.getElementById('dock-tileset-canvas');
        const dockCollectionGrid = document.getElementById('dock-collection-grid');
        const dockGridMetrics = document.getElementById('dock-grid-metrics-group');
        const dockCollectionActions = document.getElementById('dock-collection-actions');
        const dockExtrudeBtn = document.getElementById('btn-extrude-dock');
        const dockMakeAnimBtn = document.getElementById('btn-make-anim-dock');

        const popoutCanvasContainer = document.getElementById('popout-tileset-canvas');
        const popoutCollectionGrid = document.getElementById('popout-collection-grid');
        const popoutGridMetrics = document.getElementById('popout-grid-metrics-group');
        const popoutCollectionActions = document.getElementById('popout-collection-actions');
        const popoutExtrudeBtn = document.getElementById('btn-extrude-popout');
        const popoutMakeAnimBtn = document.getElementById('btn-make-anim-popout');

        if (activeTs && activeTs.isCollection) {
            if (collContainer) collContainer.classList.remove('hidden');
            if (gridConfig) gridConfig.classList.add('hidden');
            if (tilesetCanvasContainer) tilesetCanvasContainer.classList.add('hidden');

            // Hide Margin, Spacing, Px for collection tilesets
            if (dockGridMetrics) dockGridMetrics.classList.add('hidden');
            if (popoutGridMetrics) popoutGridMetrics.classList.add('hidden');

            // Hide Extrude & Make Anim for collection tilesets
            if (dockExtrudeBtn) dockExtrudeBtn.classList.add('hidden');
            if (dockMakeAnimBtn) dockMakeAnimBtn.classList.add('hidden');
            if (popoutExtrudeBtn) popoutExtrudeBtn.classList.add('hidden');
            if (popoutMakeAnimBtn) popoutMakeAnimBtn.classList.add('hidden');

            // Show Collection Actions toolbar in dock & popout
            if (dockCollectionActions) dockCollectionActions.classList.remove('hidden');
            if (popoutCollectionActions) popoutCollectionActions.classList.remove('hidden');

            if (dockCanvasContainer) dockCanvasContainer.classList.add('hidden');
            if (dockCollectionGrid) dockCollectionGrid.classList.remove('hidden');

            if (popoutCanvasContainer) popoutCanvasContainer.classList.add('hidden');
            if (popoutCollectionGrid) popoutCollectionGrid.classList.remove('hidden');
            renderCollectionGallery(activeTs);
        } else {
            if (collContainer) collContainer.classList.add('hidden');
            if (gridConfig) gridConfig.classList.remove('hidden');
            if (tilesetCanvasContainer) tilesetCanvasContainer.classList.remove('hidden');

            // Show Margin, Spacing, Px for spritesheet tilesets
            if (dockGridMetrics) dockGridMetrics.classList.remove('hidden');
            if (popoutGridMetrics) popoutGridMetrics.classList.remove('hidden');

            // Show Extrude & Make Anim for spritesheet tilesets
            if (dockExtrudeBtn) dockExtrudeBtn.classList.remove('hidden');
            if (dockMakeAnimBtn) dockMakeAnimBtn.classList.remove('hidden');
            if (popoutExtrudeBtn) popoutExtrudeBtn.classList.remove('hidden');
            if (popoutMakeAnimBtn) popoutMakeAnimBtn.classList.remove('hidden');

            // Hide Collection Actions toolbar in dock & popout
            if (dockCollectionActions) dockCollectionActions.classList.add('hidden');
            if (popoutCollectionActions) popoutCollectionActions.classList.add('hidden');

            if (dockCanvasContainer) dockCanvasContainer.classList.remove('hidden');
            if (dockCollectionGrid) dockCollectionGrid.classList.add('hidden');

            if (popoutCanvasContainer) popoutCanvasContainer.classList.remove('hidden');
            if (popoutCollectionGrid) popoutCollectionGrid.classList.add('hidden');
        }
    }

    /** Helper to build a collection thumbnail card for sidebar, dock or popout view */
    function createCollectionItemCard(collTileset, imgObj, isSelected, targetMode) {
        const item = document.createElement('div');
        const isDock = targetMode === 'dock';
        const isPopout = targetMode === 'popout';
        
        item.className = `collection-item-card relative group flex flex-col items-center p-1.5 border rounded-lg cursor-pointer transition-all shrink-0 ${
            isDock ? 'w-24 h-24 justify-center bg-slate-900' : isPopout ? 'w-28 h-28 justify-center bg-slate-900' : 'w-20 h-20 justify-center bg-slate-850'
        } ${
            isSelected 
                ? 'border-indigo-500 bg-indigo-900/60 shadow-md ring-2 ring-indigo-500/50' 
                : 'border-slate-700 bg-slate-800 hover:border-slate-500'
        }`;
        item.dataset.imageId = imgObj.id;
        item.title = `${imgObj.name} (${imgObj.width}x${imgObj.height}px, ${imgObj.anchor})`;

        const thumb = document.createElement('div');
        thumb.className = `${isDock || isPopout ? 'w-16 h-16' : 'w-12 h-12'} flex items-center justify-center checkerboard rounded overflow-hidden relative`;

        const img = document.createElement('img');
        img.src = imgObj.dataUrl || (imgObj.image ? imgObj.image.src : '');
        img.className = "max-w-full max-h-full object-contain pixelated";
        thumb.appendChild(img);

        const label = document.createElement('span');
        label.className = `text-[9px] font-bold text-slate-300 truncate ${isDock || isPopout ? 'w-24' : 'w-16'} text-center mt-0.5`;
        label.textContent = imgObj.name;

        const dim = document.createElement('span');
        dim.className = "text-[8px] text-indigo-300 font-mono";
        dim.textContent = `${imgObj.width}x${imgObj.height}`;

        // Top-right Action Buttons Container (Quick Replace & Delete)
        const actionsContainer = document.createElement('div');
        actionsContainer.className = "absolute top-1 right-1 hidden group-hover:flex items-center gap-1 z-10";

        // Quick Replace Image button on card
        const repLabel = document.createElement('label');
        repLabel.className = "flex items-center justify-center w-4 h-4 bg-amber-600/90 hover:bg-amber-500 text-white rounded text-[9px] cursor-pointer transition-colors shadow-sm";
        repLabel.innerHTML = `<i class="ph ph-arrows-clockwise"></i>`;
        repLabel.title = "Upload new version of this image";
        const repInput = document.createElement('input');
        repInput.type = 'file';
        repInput.accept = 'image/png, image/jpeg, image/webp, image/svg+xml';
        repInput.className = 'hidden';
        repInput.addEventListener('change', (e) => {
            e.stopPropagation();
            if (e.target.files && e.target.files[0]) {
                handleReplaceCollectionImage(e.target.files[0], collTileset, imgObj.id);
                e.target.value = '';
            }
        });
        repLabel.appendChild(repInput);
        repLabel.addEventListener('click', (e) => e.stopPropagation());

        // Delete button on card
        const delBtn = document.createElement('button');
        delBtn.className = "flex items-center justify-center w-4 h-4 bg-red-900/90 hover:bg-red-700 text-red-100 rounded text-[9px] transition-colors shadow-sm";
        delBtn.innerHTML = `<i class="ph ph-trash"></i>`;
        delBtn.title = "Delete image from collection";
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteCollectionImage(collTileset, imgObj.id);
        });

        actionsContainer.appendChild(repLabel);
        actionsContainer.appendChild(delBtn);

        item.appendChild(thumb);
        item.appendChild(label);
        item.appendChild(dim);
        item.appendChild(actionsContainer);

        item.addEventListener('click', () => {
            collTileset.activeImageId = imgObj.id;
            state.selectedObjectId = null;
            renderCollectionGallery(collTileset);
            renderTilesetSelect();
            if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
            }
            if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                window.TileWeaver.tools.selectTool('objectPlace');
            }
            drawMap();
        });

        return item;
    }

    /** Helper to build an "+ Add Image" dashed card tile at the end of collection grid */
    function createAddCollectionItemCard(collTileset, targetMode) {
        const isDock = targetMode === 'dock';
        const isPopout = targetMode === 'popout';

        const addCard = document.createElement('label');
        addCard.className = `flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-indigo-400 hover:bg-indigo-950/30 rounded-lg cursor-pointer text-slate-400 hover:text-indigo-300 transition-all shrink-0 ${
            isDock ? 'w-24 h-24' : isPopout ? 'w-28 h-28' : 'w-20 h-20'
        }`;
        addCard.title = "Click to add new image(s) to this collection";

        addCard.innerHTML = `
            <i class="ph ph-plus-circle text-xl mb-1 text-indigo-400"></i>
            <span class="text-[9px] font-bold text-center">Add Image</span>
            <input type="file" accept="image/png, image/jpeg, image/webp, image/svg+xml" multiple class="hidden">
        `;

        const fileInput = addCard.querySelector('input');
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleAddCollectionImages(e.target.files, collTileset);
                e.target.value = '';
            }
        });

        return addCard;
    }

    /**
     * Renders thumbnail gallery for an active Collection Tileset across Sidebar, Bottom Dock, and Pop-Out views.
     * Uses DocumentFragment batching for single-pass O(1) DOM attachment to prevent layout thrashing.
     * @param {Object} collTileset - Collection tileset object.
     */
    function renderCollectionGallery(collTileset) {
        const gridEl = document.getElementById('collection-images-grid');
        const dockGridEl = document.getElementById('dock-collection-grid');
        const popoutGridEl = document.getElementById('popout-collection-grid');
        const propsEl = document.getElementById('collection-image-props');
        const imgNameEl = document.getElementById('collection-active-img-name');
        const anchorSelect = document.getElementById('collection-anchor-select');

        if (gridEl) gridEl.innerHTML = '';
        if (dockGridEl) dockGridEl.innerHTML = '';
        if (popoutGridEl) popoutGridEl.innerHTML = '';

        const imgCount = (collTileset && collTileset.images) ? collTileset.images.length : 0;

        // Update count badges
        ['dock-collection-count-badge', 'popout-collection-count-badge'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = `${imgCount} item${imgCount === 1 ? '' : 's'}`;
        });

        // OPTIMIZATION: DocumentFragment batching prevents repeated DOM reflows per collection item
        const canUseFrag = typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function';
        const fragSidebar = (gridEl && canUseFrag) ? document.createDocumentFragment() : null;
        const fragDock = (dockGridEl && canUseFrag) ? document.createDocumentFragment() : null;
        const fragPopout = (popoutGridEl && canUseFrag) ? document.createDocumentFragment() : null;

        const targetSidebar = fragSidebar || gridEl;
        const targetDock = fragDock || dockGridEl;
        const targetPopout = fragPopout || popoutGridEl;

        if (collTileset && collTileset.images && collTileset.images.length > 0) {
            collTileset.images.forEach(imgObj => {
                const isSelected = imgObj.id === collTileset.activeImageId;
                if (targetSidebar) targetSidebar.appendChild(createCollectionItemCard(collTileset, imgObj, isSelected, 'sidebar'));
                if (targetDock) targetDock.appendChild(createCollectionItemCard(collTileset, imgObj, isSelected, 'dock'));
                if (targetPopout) targetPopout.appendChild(createCollectionItemCard(collTileset, imgObj, isSelected, 'popout'));
            });
        }

        // Append interactive "+ Add Image" dashed card tile
        if (collTileset && collTileset.isCollection) {
            if (targetSidebar) targetSidebar.appendChild(createAddCollectionItemCard(collTileset, 'sidebar'));
            if (targetDock) targetDock.appendChild(createAddCollectionItemCard(collTileset, 'dock'));
            if (targetPopout) targetPopout.appendChild(createAddCollectionItemCard(collTileset, 'popout'));
        }

        if (gridEl && fragSidebar) gridEl.appendChild(fragSidebar);
        if (dockGridEl && fragDock) dockGridEl.appendChild(fragDock);
        if (popoutGridEl && fragPopout) popoutGridEl.appendChild(fragPopout);

        // Update properties inspector for active image
        const activeImg = (collTileset && collTileset.images) ? collTileset.images.find(img => img.id === collTileset.activeImageId) : null;
        if (activeImg) {
            if (propsEl) propsEl.classList.remove('hidden');
            if (imgNameEl) imgNameEl.textContent = activeImg.name;
            if (anchorSelect) anchorSelect.value = activeImg.anchor || 'bottom-center';
        } else if (propsEl) {
            propsEl.classList.add('hidden');
        }

        // Update replace / delete button enabled states in dock & popout toolbars
        const hasActiveImg = !!activeImg;
        ['btn-dock-replace-collection-img', 'btn-popout-replace-collection-img', 'btn-dock-delete-collection-img', 'btn-popout-delete-collection-img'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (hasActiveImg) {
                    el.classList.remove('opacity-40', 'pointer-events-none');
                    el.removeAttribute('disabled');
                } else {
                    el.classList.add('opacity-40', 'pointer-events-none');
                    el.setAttribute('disabled', 'true');
                }
            }
        });
    }

    /**
     * Batch uploads and adds new image files to active or target Collection Tileset.
     * @param {FileList|Array<File>} files - Image file list to add.
     * @param {Object} [targetTs] - Target collection tileset (defaults to active).
     */
    function handleAddCollectionImages(files, targetTs) {
        const ts = targetTs || state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.isCollection) {
            showMessage("Active tileset is not a Collection Tileset.", "error");
            return;
        }
        if (!files || files.length === 0) return;

        const validFiles = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
        if (validFiles.length === 0) {
            showMessage("Please select valid image files (.png, .jpg, .webp, .svg).", "error");
            return;
        }

        let loadedCount = 0;
        let lastAddedImg = null;

        validFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                const img = new Image();
                img.onload = () => {
                    const name = file.name.replace(/\.[^/.]+$/, "");
                    const added = window.TileWeaver.stateModule.addCollectionImage(ts, name, file.name, img, dataUrl, 'bottom-center');
                    lastAddedImg = added;
                    loadedCount++;
                    if (loadedCount === validFiles.length) {
                        if (lastAddedImg) ts.activeImageId = lastAddedImg.id;
                        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.syncAssetsFromExistingTilesets) {
                            window.TileWeaver.stateModule.syncAssetsFromExistingTilesets();
                        }
                        if (window.TileWeaver.assetManager && window.TileWeaver.assetManager.updateAssetCountBadge) {
                            window.TileWeaver.assetManager.updateAssetCountBadge();
                        }
                        if (window.TileWeaver.history) window.TileWeaver.history.pushHistoryState();
                        renderCollectionGallery(ts);
                        renderTilesetSelect();
                        if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                            window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                        }
                        drawTileset();
                        drawMap();
                        showMessage(`Added ${validFiles.length} image${validFiles.length > 1 ? 's' : ''} to collection '${ts.name}'`, "success");
                    }
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        });
    }

    let pendingDeleteContext = null;

    /**
     * Opens the confirmation modal before deleting an image from a collection tileset.
     * @param {Object} [targetTs] - Target collection tileset (defaults to active).
     * @param {string} [imageId] - ID of image to remove (defaults to activeImageId).
     */
    function openDeleteCollectionImageModal(targetTs, imageId) {
        const ts = targetTs || state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.isCollection || !ts.images) return;
        const imgId = imageId || ts.activeImageId;
        if (!imgId) {
            showMessage("No image selected to delete.", "info");
            return;
        }

        const imgObj = ts.images.find(img => img.id === imgId);
        if (!imgObj) return;

        pendingDeleteContext = { targetTs: ts, imageId: imgId };

        const modal = document.getElementById('modal-confirm-delete-collection-img');
        const nameEl = document.getElementById('delete-collection-img-name');
        const tsNameEl = document.getElementById('delete-collection-tileset-name');
        const canvas = document.getElementById('delete-collection-img-preview');

        if (nameEl) nameEl.textContent = imgObj.name || imgObj.filename || 'Image';
        if (tsNameEl) tsNameEl.textContent = ts.name;

        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const imgEl = imgObj.image;
            if (imgEl && (imgEl.naturalWidth || imgEl.width)) {
                const nw = imgEl.naturalWidth || imgEl.width;
                const nh = imgEl.naturalHeight || imgEl.height;
                const scale = Math.min(canvas.width / nw, canvas.height / nh);
                const dw = nw * scale;
                const dh = nh * scale;
                const dx = (canvas.width - dw) / 2;
                const dy = (canvas.height - dh) / 2;
                ctx.drawImage(imgEl, dx, dy, dw, dh);
            } else if (imgObj.dataUrl) {
                const tmp = new Image();
                tmp.onload = () => {
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    const scale = Math.min(canvas.width / tmp.width, canvas.height / tmp.height);
                    const dw = tmp.width * scale;
                    const dh = tmp.height * scale;
                    ctx.drawImage(tmp, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
                };
                tmp.src = imgObj.dataUrl;
            }
        }

        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('btn-cancel-delete-collection-img')?.focus();
        }
    }

    /** Closes the collection image deletion confirmation modal */
    function closeDeleteCollectionImageModal() {
        const modal = document.getElementById('modal-confirm-delete-collection-img');
        if (modal) modal.classList.add('hidden');
        pendingDeleteContext = null;
    }

    /**
     * Executes the actual deletion of a collection image and removes all placed instances from map layers.
     * Enforces unsigned 32-bit GID bitmask shifts to handle flipped object instances accurately.
     * @param {Object} targetTs - Target collection tileset.
     * @param {string} imageId - ID of image to delete.
     */
    function executeDeleteCollectionImage(targetTs, imageId) {
        const ts = targetTs || state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.isCollection || !ts.images) return;
        const imgId = imageId || ts.activeImageId;
        if (!imgId) return;

        const imgObj = ts.images.find(img => img.id === imgId);
        const imgName = imgObj ? imgObj.name : 'Image';
        const targetTileId = (imgObj && typeof imgObj.tileId === 'number') ? imgObj.tileId : 0;
        const targetGid = (ts.firstgid || 1) + targetTileId;

        // INVARIANT: Record undo snapshot before destructive collection mutation
        if (window.TileWeaver.history) window.TileWeaver.history.pushHistoryState();

        // 1. Remove all placed instances of this collection object across all map layers
        let removedCount = 0;
        state.mapLayers.forEach(layer => {
            if (layer.objects && Array.isArray(layer.objects)) {
                const beforeCount = layer.objects.length;
                layer.objects = layer.objects.filter(obj => {
                    if (!obj) return true;
                    if (obj.imageId === imgId) return false;
                    if (obj.tilesetId === ts.id) {
                        if (obj.imageId === imgId) return false;
                        if (obj.gid !== undefined && ((obj.gid >>> 0) & 0x1FFFFFFF) === targetGid) return false;
                    }
                    if (!obj.tilesetId && obj.gid !== undefined && ((obj.gid >>> 0) & 0x1FFFFFFF) === targetGid) {
                        const resolvedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(obj.gid) : null;
                        if (resolvedTs && resolvedTs.id === ts.id) return false;
                    }
                    return true;
                });
                removedCount += (beforeCount - layer.objects.length);
            }
        });

        // 2. Clear selected object id if it was one of the deleted objects
        if (state.selectedObjectId) {
            const selRef = window.TileWeaver.objectInspector ? window.TileWeaver.objectInspector.getSelectedObjectRef() : null;
            if (!selRef) {
                state.selectedObjectId = null;
            }
        }

        // 3. Clear custom tile properties for this image
        if (ts.tileProperties && ts.tileProperties[imgId]) {
            delete ts.tileProperties[imgId];
        }

        // 4. Remove image from collection (recomputes firstgids automatically)
        window.TileWeaver.stateModule.removeCollectionImage(ts, imgId);

        // 5. Update UI and re-render
        renderCollectionGallery(ts);
        renderTilesetSelect();
        if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
            window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
        }
        if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
            window.TileWeaver.layerManager.renderLayersList();
        }
        drawTileset();
        drawMap();

        const msg = removedCount > 0 
            ? `Deleted '${imgName}' and removed ${removedCount} placed instance${removedCount > 1 ? 's' : ''} from map.`
            : `Deleted '${imgName}' from collection.`;
        showMessage(msg, "info");
    }

    /**
     * Handles image deletion with confirmation modal prompting.
     * @param {Object} [targetTs] - Target collection tileset (defaults to active).
     * @param {string} [imageId] - ID of image to remove (defaults to activeImageId).
     * @param {boolean} [skipConfirm=false] - If true, bypasses modal (for automated testing / scripting).
     */
    function handleDeleteCollectionImage(targetTs, imageId, skipConfirm = false) {
        const modal = typeof document !== 'undefined' ? document.getElementById('modal-confirm-delete-collection-img') : null;
        if (skipConfirm || !modal) {
            executeDeleteCollectionImage(targetTs, imageId);
        } else {
            openDeleteCollectionImageModal(targetTs, imageId);
        }
    }

    /**
     * Replaces an existing image with a newly uploaded version and synchronizes all placed objects on map.
     * @param {File} file - Replacement image file.
     * @param {Object} [targetTs] - Target collection tileset (defaults to active).
     * @param {string} [imageId] - ID of image to replace (defaults to activeImageId).
     */
    function handleReplaceCollectionImage(file, targetTs, imageId) {
        const ts = targetTs || state.tilesets[state.activeTilesetIndex];
        if (!ts || !ts.isCollection || !ts.images) return;
        const imgId = imageId || ts.activeImageId;
        if (!imgId) {
            showMessage("No image selected to replace.", "error");
            return;
        }
        if (!file || (file.type && !file.type.startsWith('image/'))) {
            showMessage("Please select a valid image file to replace.", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const img = new Image();
            img.onload = () => {
                const oldImgObj = ts.images.find(i => i.id === imgId);
                const oldTileId = oldImgObj ? oldImgObj.tileId : undefined;
                
                if (window.TileWeaver.history) window.TileWeaver.history.pushHistoryState();

                const updatedImg = window.TileWeaver.stateModule.updateCollectionImage(ts, imgId, img, dataUrl, file.name);
                if (!updatedImg) return;

                // Cascade new dimensions to all placed map objects referencing this collection image
                if (state.mapLayers) {
                    state.mapLayers.forEach(l => {
                        if (l.type === 'objectgroup' && l.objects) {
                            l.objects.forEach(obj => {
                                const isMatch = (obj.imageId === imgId) || 
                                    ((obj.gid !== undefined) && oldTileId !== undefined && ((obj.gid & 0x1FFFFFFF) === (ts.firstgid || 1) + oldTileId));
                                if (isMatch) {
                                    obj.width = updatedImg.width;
                                    obj.height = updatedImg.height;
                                    if (!obj.imageId) obj.imageId = imgId;
                                }
                            });
                        }
                    });
                }

                renderCollectionGallery(ts);
                renderTilesetSelect();
                if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                    window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                }
                drawTileset();
                drawMap();
                showMessage(`Updated '${updatedImg.name}' across collection and map`, "success");
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    /** Populates autotile select dropdown */
    function renderAutotileSelect() {
        const container = document.getElementById('autotile-selector-container');
        const selectEl = document.getElementById('autotile-select');
        if (!container || !selectEl) return;
        selectEl.innerHTML = '';

        if (state.autotiles.length === 0) {
            container.classList.add('hidden');
            return;
        }

        state.autotiles.forEach(at => {
            const opt = document.createElement('option');
            opt.value = at.id;
            const modeLabel = at.isWall ? 'Wall 9x3' : (at.isCliff ? 'Cliff 7x6' : (at.mode || '9slice'));
            opt.textContent = `${at.name} [${modeLabel}]`;
            if (at.id === state.activeAutotileId) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    /** Populates animated tile select dropdown */
    function renderAnimSelect() {
        const container = document.getElementById('anim-selector-container');
        const selectEl = document.getElementById('anim-select');
        if (!container || !selectEl) return;
        selectEl.innerHTML = '';

        if (state.animatedTiles.length === 0) {
            container.classList.add('hidden');
            return;
        }

        state.animatedTiles.forEach(anim => {
            const opt = document.createElement('option');
            opt.value = anim.id;
            opt.textContent = anim.name;
            if (anim.id === state.activeAnimTileId) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    /** Updates active toggle button styles for Flip H, Flip V, and Rotation */
    function updateTransformUI() {
        const btnFlipH = document.getElementById('btn-flip-h');
        const btnFlipV = document.getElementById('btn-flip-v');
        const btnRotate = document.getElementById('btn-rotate');

        if (btnFlipH) {
            btnFlipH.className = `px-2 py-1 bg-slate-700 hover:bg-slate-600 border rounded text-xs transition-colors ${state.stampTransform.flipH ? 'btn-toggle-active border-blue-500 text-white font-bold' : 'border-slate-600 text-slate-200'}`;
        }
        if (btnFlipV) {
            btnFlipV.className = `px-2 py-1 bg-slate-700 hover:bg-slate-600 border rounded text-xs transition-colors ${state.stampTransform.flipV ? 'btn-toggle-active border-blue-500 text-white font-bold' : 'border-slate-600 text-slate-200'}`;
        }
        if (btnRotate) {
            btnRotate.className = `px-2 py-1 bg-slate-700 hover:bg-slate-600 border rounded text-xs transition-colors ${state.stampTransform.rotation !== 0 ? 'btn-toggle-active border-blue-500 text-white font-bold' : 'border-slate-600 text-slate-200'}`;
            btnRotate.innerHTML = `<i class="ph ph-arrow-clockwise"></i> ${state.stampTransform.rotation}°`;
        }
    }

    /** Palette zoom manager */
    function setTilesetZoom(level) {
        state.tilesetZoom = Math.max(0.5, Math.min(4.0, Math.round(level * 100) / 100));
        updateZoomUI();
        drawTileset();
    }

    function updateZoomUI() {
        const pct = Math.round((state.tilesetZoom || 1.0) * 100) + '%';
        ['tileset-zoom-label', 'popout-zoom-label', 'dock-zoom-label'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = pct;
        });

        const scaleBadge = document.getElementById('popout-scale-badge');
        if (scaleBadge) scaleBadge.textContent = 'Zoom: ' + pct;
    }

    /** Open Pop-Out Inspector Modal Window */
    function openTilesetPopout() {
        state.isTilesetPopoutOpen = true;
        const modal = document.getElementById('modal-tileset-popout');
        if (modal) modal.classList.remove('hidden');
        renderTilesetSelect();
        drawTileset();
        showMessage("Opened Tileset Pop-Out Inspector", "info");
    }

    /** Close Pop-Out Inspector Modal Window */
    function closeTilesetPopout() {
        state.isTilesetPopoutOpen = false;
        const modal = document.getElementById('modal-tileset-popout');
        if (modal) modal.classList.add('hidden');
    }

    /** Toggle Widescreen Bottom Dock Panel View */
    function toggleTilesetDock() {
        state.isTilesetDockOpen = !state.isTilesetDockOpen;
        const dock = document.getElementById('dock-tileset-panel');
        if (dock) {
            if (state.isTilesetDockOpen) {
                dock.classList.remove('hidden');
                renderTilesetSelect();
                drawTileset();
                showMessage("Opened Widescreen Bottom Dock Panel", "info");
            } else {
                dock.classList.add('hidden');
            }
        }
    }

    /** Collapse or Expand Widescreen Bottom Dock Panel View */
    function toggleCollapseDock() {
        state.isTilesetDockCollapsed = !state.isTilesetDockCollapsed;
        const dock = document.getElementById('dock-tileset-panel');
        const icon = document.getElementById('dock-toggle-icon');
        const container = document.getElementById('dock-tileset-container');
        const resizer = document.getElementById('dock-resizer');

        if (!dock) return;
        if (state.isTilesetDockCollapsed) {
            dock.dataset.expandedHeight = dock.style.height || '280px';
            dock.style.height = '36px';
            if (container) container.classList.add('hidden');
            if (resizer) resizer.classList.add('hidden');
            if (icon) icon.className = 'ph ph-caret-up';
            showMessage("Collapsed Widescreen Bottom Dock", "info");
        } else {
            dock.style.height = dock.dataset.expandedHeight || '280px';
            if (container) container.classList.remove('hidden');
            if (resizer) resizer.classList.remove('hidden');
            if (icon) icon.className = 'ph ph-caret-down';
            drawTileset();
            showMessage("Expanded Widescreen Bottom Dock", "info");
        }
    }

    /**
     * Updates live hover status bar details in popout footer.
     * Short-circuits when the pop-out modal is closed to eliminate hot-path DOM query overhead.
     * @param {number} col - Grid column index
     * @param {number} row - Grid row index
     */
    function updateStatusBarDetails(col, row) {
        // OPTIMIZATION: Skip DOM element queries and string parsing when Popout Inspector is closed
        if (!state.isTilesetPopoutOpen) return;

        const safeCol = typeof col === 'number' && col >= 0 ? col : 0;
        const safeRow = typeof row === 'number' && row >= 0 ? row : 0;

        const hoverCoordEl = document.getElementById('popout-hover-coord');
        if (hoverCoordEl) {
            hoverCoordEl.innerHTML = `<i class="ph ph-crosshair text-blue-400"></i> Hover: Col ${safeCol}, Row ${safeRow}`;
        }

        const stampBoundsEl = document.getElementById('popout-stamp-bounds');
        if (stampBoundsEl && state.selectedStamp) {
            const w = state.selectedStamp.width || 1;
            const h = state.selectedStamp.height || 1;
            const pxW = w * (state.TILE_SIZE || 32);
            const pxH = h * (state.TILE_SIZE || 32);
            stampBoundsEl.innerHTML = `<i class="ph ph-selection text-emerald-400"></i> Selected Stamp: ${w}x${h} (${pxW}x${pxH}px)`;
        }

        const ts = state.tilesets[state.activeTilesetIndex];
        const dimsEl = document.getElementById('popout-tileset-dims');
        if (dimsEl && ts && ts.image) {
            dimsEl.textContent = `Dim: ${ts.image.width}x${ts.image.height}px`;
        }
    }

    /** Attaches drag-selection and click listeners to a tileset viewer canvas */
    function attachTilesetCanvasEvents(canvas) {
        if (!canvas) return;

        canvas.addEventListener('mousedown', (e) => {
            const { col, row } = getGridCoordinates(canvas, e);
            state.isSelectingTileset = true;
            state.selectedObjectId = null;
            state.tilesetDragStart = { col, row };
            state.selectedStamp = { col, row, width: 1, height: 1 };
            const activeLayer = state.mapLayers[state.activeLayerIndex];
            if (activeLayer && activeLayer.type !== 'tilelayer') {
                const tileLayerIdx = state.mapLayers.findIndex(l => l.type === 'tilelayer');
                if (tileLayerIdx >= 0) {
                    state.activeLayerIndex = tileLayerIdx;
                    if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                        window.TileWeaver.layerManager.renderLayersList();
                    }
                }
            }
            if (state.currentTool !== 'paint' && state.currentTool !== 'autotile') {
                window.TileWeaver.tools.selectTool('paint');
            }
            updateStatusBarDetails(col, row);
            if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
                window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel(col, row);
            }
            drawTileset();
        });

        canvas.addEventListener('mousemove', (e) => {
            const { col, row } = getGridCoordinates(canvas, e);
            state.tilesetHoverCoord = { col, row };

            if (state.isSelectingTileset) {
                const minCol = Math.min(state.tilesetDragStart.col, col);
                const maxCol = Math.max(state.tilesetDragStart.col, col);
                const minRow = Math.min(state.tilesetDragStart.row, row);
                const maxRow = Math.max(state.tilesetDragStart.row, row);

                state.selectedStamp = {
                    col: minCol,
                    row: minRow,
                    width: maxCol - minCol + 1,
                    height: maxRow - minRow + 1
                };
            }
            updateStatusBarDetails(col, row);
            drawTileset();
        });

        canvas.addEventListener('mouseleave', () => {
            state.tilesetHoverCoord = { col: -1, row: -1 };
            drawTileset();
        });
    }

    /** Enables window dragging for floating pop-out window */
    function initPopoutDrag() {
        const modal = document.getElementById('modal-tileset-popout');
        const header = document.getElementById('tileset-popout-header');
        if (!modal || !header) return;

        let isDragging = false;
        let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('select')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = modal.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            modal.style.right = 'auto';
            modal.style.bottom = 'auto';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            const newLeft = Math.max(10, Math.min(window.innerWidth - 100, initialLeft + dx));
            const newTop = Math.max(10, Math.min(window.innerHeight - 50, initialTop + dy));

            modal.style.left = newLeft + 'px';
            modal.style.top = newTop + 'px';
        }

        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    }

    /** Enables height resizing for bottom dock panel */
    function initDockResize() {
        const dock = document.getElementById('dock-tileset-panel');
        const resizer = document.getElementById('dock-resizer');
        if (!dock || !resizer) return;

        let isResizing = false;
        let startY = 0, startHeight = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = dock.offsetHeight;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isResizing) return;
            const dy = startY - e.clientY;
            const newHeight = Math.max(160, Math.min(600, startHeight + dy));
            dock.style.height = newHeight + 'px';
            drawTileset();
        }

        function onMouseUp() {
            isResizing = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    }

    /**
     * Enables scroll-wheel zooming on tileset viewer containers when holding Ctrl/Cmd.
     * When Ctrl is not pressed, normal wheel scrolling is preserved within the tileset inspector
     * without triggering map zoom.
     */
    function initWheelZoom(container) {
        if (!container) return;
        container.addEventListener('wheel', (e) => {
            // Stop event bubbling so map canvas viewport never receives this wheel event
            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                // Ctrl + Wheel: Zoom the tileset inspector palette
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.25 : -0.25;
                setTilesetZoom((state.tilesetZoom || 1.0) + delta);
            } else {
                // Regular Wheel: Allow native scrolling within the tileset container.
                // If container has horizontal overflow and no vertical scroll (e.g. collection items grid),
                // translate vertical scroll wheel into horizontal scroll.
                if (container.scrollWidth > container.clientWidth && container.scrollHeight <= container.clientHeight) {
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        e.preventDefault();
                        container.scrollLeft += e.deltaY;
                    }
                }
            }
        }, { passive: false });
    }

    /**
     * Deletes the currently active tileset, prunes orphaned placed objects referencing it,
     * recomputes GIDs across remaining tilesets and objects, and updates UI.
     */
    function handleDeleteTileset() {
        if (!state.tilesets || state.tilesets.length === 0) {
            showMessage("No tileset to delete.", "error");
            return;
        }

        const targetTs = state.tilesets[state.activeTilesetIndex];
        if (!targetTs) return;

        // HISTORY INVARIANT: Record undo snapshot before destructive tileset deletion
        if (window.TileWeaver.history && window.TileWeaver.history.pushHistoryState) {
            window.TileWeaver.history.pushHistoryState();
        }

        // 1. Prune all placed objects belonging to the deleted tileset across all map layers
        if (state.mapLayers && Array.isArray(state.mapLayers)) {
            state.mapLayers.forEach(layer => {
                if (layer.objects && Array.isArray(layer.objects)) {
                    layer.objects = layer.objects.filter(obj => {
                        if (!obj) return true;
                        if (obj.tilesetId === targetTs.id) return false;
                        if (!obj.tilesetId && obj.gid !== undefined) {
                            const resolvedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(obj.gid) : null;
                            if (resolvedTs && resolvedTs.id === targetTs.id) return false;
                        }
                        return true;
                    });
                }
            });
        }

        // 2. Clear selected object id if it was one of the deleted objects
        if (state.selectedObjectId) {
            const selRef = window.TileWeaver.objectInspector ? window.TileWeaver.objectInspector.getSelectedObjectRef() : null;
            if (!selRef) {
                state.selectedObjectId = null;
            }
        }

        // 3. Remove tileset from state and recompute GIDs
        state.tilesets.splice(state.activeTilesetIndex, 1);
        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }
        state.activeTilesetIndex = Math.max(0, Math.min(state.activeTilesetIndex, state.tilesets.length - 1));

        // 4. Update UI & re-render
        renderTilesetSelect();
        if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
            window.TileWeaver.layerManager.renderLayersList();
        }
        if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel) {
            window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
        }
        drawTileset();
        drawMap();
        showMessage(`Tileset '${targetTs.name || "Tileset"}' deleted.`, "info");
    }

    /**
     * Initializes state for `state.tilesets`, `state.autotiles`, `state.animatedTiles`,
     * and `state.materials` with clean empty project defaults, then attaches event listeners.
     * @param {Function} [onInitComplete] - Callback invoked when initialization completes.
     */
    async function initTilesetsUI(onInitComplete) {
        state.tilesets = [];
        state.activeTilesetIndex = 0;
        state.autotiles = [];
        state.activeAutotileId = null;
        state.animatedTiles = [];
        state.activeAnimTileId = null;
        state.materials = [];
        state.activeMaterialId = null;

        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }

        renderTilesetSelect();
        renderAutotileSelect();
        renderAnimSelect();
        if (window.TileWeaver.terrainSwatches) {
            window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
        }
        drawTileset();
        drawMap();
        if (onInitComplete) onInitComplete();

        // Register DOM event listeners for tileset select dropdowns across sidebar, popout, and dock
        ['tileset-select', 'popout-tileset-select', 'dock-tileset-select'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                state.activeTilesetIndex = parseInt(e.target.value) || 0;
                state.selectedStamp = { col: 0, row: 0, width: 1, height: 1 };
                const activeTs = state.tilesets[state.activeTilesetIndex];
                const activeLayer = state.mapLayers[state.activeLayerIndex];
                if (activeTs && activeTs.isCollection) {
                    if (activeLayer && activeLayer.type !== 'objectgroup') {
                        const objLayerIdx = state.mapLayers.findIndex(l => l.type === 'objectgroup');
                        if (objLayerIdx >= 0) state.activeLayerIndex = objLayerIdx;
                    }
                    if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                        window.TileWeaver.tools.selectTool('objectPlace');
                    }
                } else if (activeTs && !activeTs.isCollection) {
                    if (activeLayer && activeLayer.type !== 'tilelayer') {
                        const tileLayerIdx = state.mapLayers.findIndex(l => l.type === 'tilelayer');
                        if (tileLayerIdx >= 0) state.activeLayerIndex = tileLayerIdx;
                    }
                    if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
                        window.TileWeaver.tools.selectTool('paint');
                    }
                }
                if (window.TileWeaver.layerManager && window.TileWeaver.layerManager.renderLayersList) {
                    window.TileWeaver.layerManager.renderLayersList();
                }
                renderTilesetSelect();
                drawTileset();
                drawMap();
            });
        });

        // Zoom button event listeners across viewports
        ['btn-tileset-zoom-in', 'btn-popout-zoom-in', 'btn-dock-zoom-in'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => setTilesetZoom((state.tilesetZoom || 1.0) + 0.5));
        });

        ['btn-tileset-zoom-out', 'btn-popout-zoom-out', 'btn-dock-zoom-out'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => setTilesetZoom((state.tilesetZoom || 1.0) - 0.5));
        });

        ['btn-tileset-zoom-100', 'btn-popout-zoom-100', 'btn-dock-zoom-100'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => setTilesetZoom(1.0));
        });

        ['btn-tileset-zoom-200', 'btn-popout-zoom-200', 'btn-dock-zoom-200'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => setTilesetZoom(2.0));
        });

        ['btn-tileset-zoom-400', 'btn-popout-zoom-400', 'btn-dock-zoom-400'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => setTilesetZoom(4.0));
        });

        // View Mode toggle & collapse buttons
        document.getElementById('btn-tileset-popout')?.addEventListener('click', openTilesetPopout);
        document.getElementById('btn-dock-popout')?.addEventListener('click', openTilesetPopout);
        document.getElementById('btn-tileset-dock')?.addEventListener('click', toggleTilesetDock);
        document.getElementById('btn-toggle-dock')?.addEventListener('click', toggleCollapseDock);
        document.getElementById('btn-close-popout')?.addEventListener('click', closeTilesetPopout);
        document.getElementById('btn-close-dock')?.addEventListener('click', () => {
            state.isTilesetDockOpen = false;
            document.getElementById('dock-tileset-panel')?.classList.add('hidden');
        });

        document.getElementById('autotile-select')?.addEventListener('change', (e) => {
            state.activeAutotileId = e.target.value;
        });

        document.getElementById('anim-select')?.addEventListener('change', (e) => {
            state.activeAnimTileId = e.target.value;
        });

        // Tile size input binding across dock, popout, sidebar
        ['tile-size-input', 'tile-size-dock', 'tile-size-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                state.TILE_SIZE = parseInt(e.target.value) || 32;
                ['tile-size-input', 'tile-size-dock', 'tile-size-popout'].forEach(subId => {
                    const el = document.getElementById(subId);
                    if (el) el.value = state.TILE_SIZE;
                });
                resizeCanvases();
                drawTileset();
                drawMap();
            });
        });

        // Margin input binding across dock, popout, sidebar
        ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', (e) => {
                const ts = state.tilesets[state.activeTilesetIndex];
                if (ts) {
                    ts.margin = parseInt(e.target.value) || 0;
                    ['tileset-margin-input', 'tileset-margin-dock', 'tileset-margin-popout'].forEach(subId => {
                        const el = document.getElementById(subId);
                        if (el) el.value = ts.margin;
                    });
                    drawTileset();
                }
            });
        });

        // Spacing input binding across dock, popout, sidebar
        ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', (e) => {
                const ts = state.tilesets[state.activeTilesetIndex];
                if (ts) {
                    ts.spacing = parseInt(e.target.value) || 0;
                    ['tileset-spacing-input', 'tileset-spacing-dock', 'tileset-spacing-popout'].forEach(subId => {
                        const el = document.getElementById(subId);
                        if (el) el.value = ts.spacing;
                    });
                    drawTileset();
                }
            });
        });

        // Upload custom PNG tileset helper
        const handlePngUpload = (file) => {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const newTileset = {
                        id: 'ts_' + (state.tilesetIdCounter++),
                        name: file.name.replace(/\.[^/.]+$/, ""),
                        filename: file.name,
                        image: img,
                        margin: 0,
                        spacing: 0
                    };
                    state.tilesets.push(newTileset);
                    if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
                        window.TileWeaver.stateModule.recomputeTilesetGids();
                    }
                    if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.syncAssetsFromExistingTilesets) {
                        window.TileWeaver.stateModule.syncAssetsFromExistingTilesets();
                    }
                    if (window.TileWeaver.assetManager && window.TileWeaver.assetManager.updateAssetCountBadge) {
                        window.TileWeaver.assetManager.updateAssetCountBadge();
                    }
                    state.activeTilesetIndex = state.tilesets.length - 1;
                    renderTilesetSelect();
                    drawTileset();
                    drawMap();
                    showMessage(`Uploaded tileset '${file.name}'`, "success");
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        // Unified Add Tileset button listeners (Dock, Popout, Sidebar)
        ['btn-add-tileset', 'btn-add-tileset-dock', 'btn-add-tileset-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', openAddTilesetModal);
        });

        // Close Add Tileset Modal buttons & backdrop
        document.getElementById('btn-close-add-tileset-modal')?.addEventListener('click', closeAddTilesetModal);
        document.getElementById('btn-cancel-add-tileset')?.addEventListener('click', closeAddTilesetModal);
        document.getElementById('modal-add-tileset')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-add-tileset') {
                closeAddTilesetModal();
            }
        });

        // Option 1: Standard / Normal Tileset card click
        document.getElementById('btn-option-normal-tileset')?.addEventListener('click', () => {
            document.getElementById('modal-upload-normal-input')?.click();
        });

        document.getElementById('modal-upload-normal-input')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handlePngUpload(e.target.files[0]);
                closeAddTilesetModal();
            }
        });

        // Option 2: Collection of Images card click
        document.getElementById('btn-option-collection-tileset')?.addEventListener('click', () => {
            document.getElementById('modal-upload-collection-input')?.click();
        });

        document.getElementById('modal-upload-collection-input')?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const files = e.target.files;
                const newColl = window.TileWeaver.stateModule.createNewCollectionTileset();
                state.tilesets.push(newColl);
                if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
                    window.TileWeaver.stateModule.recomputeTilesetGids();
                }
                state.activeTilesetIndex = state.tilesets.length - 1;
                renderTilesetSelect();
                handleAddCollectionImages(files, newColl);
                closeAddTilesetModal();
            }
        });

        // Add Tileset Modal Tab Navigation
        const tabs = ['tab-add-preset', 'tab-add-upload', 'tab-add-collection'];
        tabs.forEach(tabId => {
            document.getElementById(tabId)?.addEventListener('click', () => {
                // Update active tab button styles
                tabs.forEach(t => {
                    const btn = document.getElementById(t);
                    if (btn) {
                        btn.className = (t === tabId)
                            ? 'pb-2 border-b-2 border-blue-500 text-blue-400 font-bold text-xs flex items-center gap-1.5 transition-colors'
                            : 'pb-2 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-medium text-xs flex items-center gap-1.5 transition-colors';
                    }
                });
                // Switch panel view
                document.querySelectorAll('.add-tileset-panel').forEach(panel => panel.classList.add('hidden'));
                const activePanelId = tabId.replace('tab-add-', 'panel-add-');
                document.getElementById(activePanelId)?.classList.remove('hidden');
            });
        });

        // Preset cards selection in modal
        document.querySelectorAll('.btn-load-preset-modal').forEach(card => {
            card.addEventListener('click', () => {
                const presetId = card.getAttribute('data-preset');
                if (presetId === 'grass') generateDefaultTileset();
                else if (presetId === 'dirt') generateDirtPathTileset();
                else if (presetId === 'dualgrid') generateDualGridDirtTileset();
                else if (presetId === 'collection') generateDefaultCollectionTileset();
                closeAddTilesetModal();
            });
        });

        // Direct Collection creation in modal
        document.getElementById('btn-create-collection-confirm')?.addEventListener('click', () => {
            const nameInput = document.getElementById('input-collection-name');
            const name = nameInput ? nameInput.value.trim() : '';
            handleCreateCollection(name || "Custom Props");
            closeAddTilesetModal();
        });

        // Single Spritesheet upload dropzone in modal
        const singleDropzone = document.getElementById('dropzone-modal-single');
        const singleFileInput = document.getElementById('input-modal-single-file');
        if (singleDropzone && singleFileInput) {
            singleDropzone.addEventListener('click', () => singleFileInput.click());
            singleDropzone.addEventListener('dragover', (e) => { e.preventDefault(); singleDropzone.classList.add('border-blue-500', 'bg-blue-950/20'); });
            singleDropzone.addEventListener('dragleave', () => { singleDropzone.classList.remove('border-blue-500', 'bg-blue-950/20'); });
            singleDropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                singleDropzone.classList.remove('border-blue-500', 'bg-blue-950/20');
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handlePngUpload(e.dataTransfer.files[0]);
                    closeAddTilesetModal();
                }
            });
            singleFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    handlePngUpload(e.target.files[0]);
                    closeAddTilesetModal();
                }
            });
        }

        // Multi-image upload dropzone for Collection in modal
        const multiDropzone = document.getElementById('dropzone-modal-multi');
        const multiFileInput = document.getElementById('input-modal-multi-file');
        if (multiDropzone && multiFileInput) {
            multiDropzone.addEventListener('click', () => multiFileInput.click());
            multiDropzone.addEventListener('dragover', (e) => { e.preventDefault(); multiDropzone.classList.add('border-purple-500', 'bg-purple-950/20'); });
            multiDropzone.addEventListener('dragleave', () => { multiDropzone.classList.remove('border-purple-500', 'bg-purple-950/20'); });
            multiDropzone.addEventListener('drop', async (e) => {
                e.preventDefault();
                multiDropzone.classList.remove('border-purple-500', 'bg-purple-950/20');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    await handleMultiImageCollectionUpload(e.dataTransfer.files);
                    closeAddTilesetModal();
                }
            });
            multiFileInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    await handleMultiImageCollectionUpload(e.target.files);
                    closeAddTilesetModal();
                }
            });
        }

        // Empty Collection direct link
        document.getElementById('btn-create-empty-collection-link')?.addEventListener('click', () => {
            handleCreateCollection();
            closeAddTilesetModal();
        });

        // Legacy / fallback upload inputs
        ['input-upload-tileset', 'input-upload-tileset-dock', 'input-upload-tileset-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                handlePngUpload(e.target.files[0]);
            });
        });

        // Delete tileset listeners
        ['btn-delete-tileset', 'btn-delete-tileset-dock', 'btn-delete-tileset-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', handleDeleteTileset);
        });

        // Stamp transformation buttons
        document.getElementById('btn-flip-h')?.addEventListener('click', () => {
            state.stampTransform.flipH = !state.stampTransform.flipH;
            updateTransformUI();
            drawMap();
        });

        document.getElementById('btn-flip-v')?.addEventListener('click', () => {
            state.stampTransform.flipV = !state.stampTransform.flipV;
            updateTransformUI();
            drawMap();
        });

        document.getElementById('btn-rotate')?.addEventListener('click', () => {
            state.stampTransform.rotation = (state.stampTransform.rotation + 90) % 360;
            updateTransformUI();
            drawMap();
        });

        document.getElementById('btn-reset-transform')?.addEventListener('click', () => {
            state.stampTransform = { flipH: false, flipV: false, rotation: 0 };
            updateTransformUI();
            drawMap();
        });

        // Attach canvas mouse event handlers for all three viewer canvases
        attachTilesetCanvasEvents(document.getElementById('tileset-canvas'));
        attachTilesetCanvasEvents(document.getElementById('popout-tileset-canvas'));
        attachTilesetCanvasEvents(document.getElementById('dock-tileset-canvas'));

        // Attach wheel zoom listener to scroll containers
        initWheelZoom(document.getElementById('tileset-container'));
        initWheelZoom(document.getElementById('popout-tileset-container'));
        initWheelZoom(document.getElementById('dock-tileset-container'));
        initWheelZoom(document.getElementById('dock-collection-grid'));
        initWheelZoom(document.getElementById('popout-collection-grid'));

        // Prevent wheel events on dock header/toolbar from bubbling to map container
        const dockPanel = document.getElementById('dock-tileset-panel');
        if (dockPanel) {
            dockPanel.addEventListener('wheel', (e) => {
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 0.25 : -0.25;
                    setTilesetZoom((state.tilesetZoom || 1.0) + delta);
                }
            }, { passive: false });
        }

        // Initialize window drag and bottom dock resize handles
        initPopoutDrag();
        initDockResize();

        window.addEventListener('mouseup', () => {
            state.isSelectingTileset = false;
        });

        // Create Collection Tileset helper
        const handleCreateCollection = () => {
            const newColl = window.TileWeaver.stateModule.createNewCollectionTileset();
            state.tilesets.push(newColl);
            if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
                window.TileWeaver.stateModule.recomputeTilesetGids();
            }
            state.activeTilesetIndex = state.tilesets.length - 1;
            renderTilesetSelect();
            drawMap();
            showMessage(`Created new Collection Tileset '${newColl.name}'`, "success");
        };

        ['btn-create-collection', 'btn-create-collection-dock', 'btn-create-collection-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', handleCreateCollection);
        });

        // Wire Add Collection Image inputs
        ['input-upload-collection-images', 'input-add-collection-image-dock', 'input-add-collection-image-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleAddCollectionImages(e.target.files);
                    e.target.value = '';
                }
            });
        });

        // Wire Replace Collection Image inputs
        ['input-replace-collection-image-dock', 'input-replace-collection-image-popout', 'input-replace-live-prop-image', 'input-replace-live-prop-link'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    handleReplaceCollectionImage(e.target.files[0]);
                    e.target.value = '';
                }
            });
        });

        // Wire Delete Collection Image buttons
        ['btn-dock-delete-collection-img', 'btn-popout-delete-collection-img'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => {
                handleDeleteCollectionImage();
            });
        });

        // Wire Delete Collection Image Confirmation Modal buttons
        document.getElementById('btn-close-delete-collection-modal')?.addEventListener('click', closeDeleteCollectionImageModal);
        document.getElementById('btn-cancel-delete-collection-img')?.addEventListener('click', closeDeleteCollectionImageModal);
        document.getElementById('btn-confirm-delete-collection-img')?.addEventListener('click', () => {
            if (pendingDeleteContext) {
                const { targetTs, imageId } = pendingDeleteContext;
                closeDeleteCollectionImageModal();
                executeDeleteCollectionImage(targetTs, imageId);
            }
        });

        document.getElementById('modal-confirm-delete-collection-img')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-confirm-delete-collection-img') {
                closeDeleteCollectionImageModal();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeDeleteCollectionImageModal();
                closeExtrudeModal();
                closeAddTilesetModal();
            }
        });

        // Dropzone & grid drag & drop handlers
        ['collection-dropzone', 'dock-collection-grid', 'popout-collection-grid'].forEach(id => {
            const dropzone = document.getElementById(id);
            if (!dropzone) return;
            if (id === 'collection-dropzone') {
                dropzone.addEventListener('click', () => {
                    document.getElementById('input-upload-collection-images')?.click();
                });
            }
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('border-indigo-400', 'bg-indigo-900/40');
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('border-indigo-400', 'bg-indigo-900/40');
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('border-indigo-400', 'bg-indigo-900/40');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleAddCollectionImages(e.dataTransfer.files);
                }
            });
        });

        // Active Collection Image Anchor selector
        document.getElementById('collection-anchor-select')?.addEventListener('change', (e) => {
            const ts = state.tilesets[state.activeTilesetIndex];
            if (ts && ts.isCollection && ts.images) {
                const activeImg = ts.images.find(img => img.id === ts.activeImageId);
                if (activeImg) {
                    activeImg.anchor = e.target.value;
                    drawMap();
                    showMessage(`Updated anchor for '${activeImg.name}' to ${e.target.value}`, "info");
                }
            }
        });

        // Convert horizontal stamp selection to Animation helper
        const handleMakeAnim = () => {
            if (state.selectedStamp.width < 2) {
                showMessage("Please select 2 or more horizontal tiles on the palette.", "error");
                return;
            }
            const ts = state.tilesets[state.activeTilesetIndex];
            if (!ts || ts.isCollection) return;
            const frames = [];
            for (let c = 0; c < state.selectedStamp.width; c++) {
                frames.push({ tx: state.selectedStamp.col + c, ty: state.selectedStamp.row });
            }
            const newAnim = {
                id: 'anim_' + (state.animCounter++),
                name: `Anim (${state.selectedStamp.width} frames)`,
                tilesetId: ts.id,
                frames,
                frameDurationMs: 250
            };
            state.animatedTiles.push(newAnim);
            state.activeAnimTileId = newAnim.id;
            renderAnimSelect();
            window.TileWeaver.tools.selectTool('animtile');
            showMessage(`Created Animation with ${frames.length} frames!`, "success");
        };

        ['btn-make-anim', 'btn-make-anim-dock', 'btn-make-anim-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', handleMakeAnim);
        });

        // Tile Properties modal button handler helper (if legacy trigger present)
        const handleOpenTileProperties = () => {
            if (window.TileWeaver.tileProperties && window.TileWeaver.tileProperties.openTilesetPropertiesModal) {
                window.TileWeaver.tileProperties.openTilesetPropertiesModal();
            }
        };

        ['btn-open-tile-properties'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', handleOpenTileProperties);
        });

        // Object Alignment change handler
        document.getElementById('dock-object-alignment-select')?.addEventListener('change', (e) => {
            const activeTs = state.tilesets[state.activeTilesetIndex];
            if (activeTs) {
                activeTs.objectalignment = e.target.value;
                window.TileWeaver.toast.showMessage(`Tileset Object Alignment set to ${e.target.value}`, "info");
                drawMap();
            }
        });

        // Extrude button handler helpers
        ['btn-extrude-dock', 'btn-extrude-popout'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', openExtrudeModal);
        });

        document.getElementById('btn-close-extrude-modal')?.addEventListener('click', closeExtrudeModal);
        document.getElementById('btn-cancel-extrude')?.addEventListener('click', closeExtrudeModal);

        // Extrude modal control changes trigger live preview update
        document.getElementById('extrude-tileset-select')?.addEventListener('change', () => {
            populateExtrudeSampleTiles();
            updateExtrudePreview();
        });
        document.getElementById('extrude-depth-select')?.addEventListener('change', updateExtrudePreview);
        document.getElementById('extrude-sample-tile-select')?.addEventListener('change', updateExtrudePreview);
        document.getElementById('extrude-tile-w')?.addEventListener('input', () => {
            populateExtrudeSampleTiles();
            updateExtrudePreview();
        });
        document.getElementById('extrude-tile-h')?.addEventListener('input', () => {
            populateExtrudeSampleTiles();
            updateExtrudePreview();
        });

        // Extrude action buttons
        document.getElementById('btn-confirm-apply-extrude')?.addEventListener('click', async () => {
            const tsSelect = document.getElementById('extrude-tileset-select');
            const depthSelect = document.getElementById('extrude-depth-select');
            const tileWEl = document.getElementById('extrude-tile-w');
            const tileHEl = document.getElementById('extrude-tile-h');

            const tsIdx = parseInt(tsSelect ? tsSelect.value : state.activeTilesetIndex) || 0;
            const extrude = parseInt(depthSelect ? depthSelect.value : 1) || 1;
            const tileWidth = parseInt(tileWEl ? tileWEl.value : 32) || state.TILE_SIZE || 32;
            const tileHeight = parseInt(tileHEl ? tileHEl.value : 32) || state.TILE_SIZE || 32;

            if (window.TileWeaver.extruder && window.TileWeaver.extruder.applyExtrusionToTileset) {
                try {
                    await window.TileWeaver.extruder.applyExtrusionToTileset(tsIdx, { tileWidth, tileHeight, extrude });
                    closeExtrudeModal();
                } catch (err) {
                    showMessage(`Extrusion error: ${err.message}`, "error");
                }
            }
        });

        document.getElementById('btn-extrude-clone-new')?.addEventListener('click', async () => {
            const tsSelect = document.getElementById('extrude-tileset-select');
            const depthSelect = document.getElementById('extrude-depth-select');
            const tileWEl = document.getElementById('extrude-tile-w');
            const tileHEl = document.getElementById('extrude-tile-h');

            const tsIdx = parseInt(tsSelect ? tsSelect.value : state.activeTilesetIndex) || 0;
            const extrude = parseInt(depthSelect ? depthSelect.value : 1) || 1;
            const tileWidth = parseInt(tileWEl ? tileWEl.value : 32) || state.TILE_SIZE || 32;
            const tileHeight = parseInt(tileHEl ? tileHEl.value : 32) || state.TILE_SIZE || 32;

            if (window.TileWeaver.extruder && window.TileWeaver.extruder.cloneAsExtrudedTileset) {
                try {
                    await window.TileWeaver.extruder.cloneAsExtrudedTileset(tsIdx, { tileWidth, tileHeight, extrude });
                    closeExtrudeModal();
                } catch (err) {
                    showMessage(`Extrusion error: ${err.message}`, "error");
                }
            }
        });

        document.getElementById('btn-extrude-download-png')?.addEventListener('click', () => {
            const tsSelect = document.getElementById('extrude-tileset-select');
            const depthSelect = document.getElementById('extrude-depth-select');
            const tileWEl = document.getElementById('extrude-tile-w');
            const tileHEl = document.getElementById('extrude-tile-h');

            const tsIdx = parseInt(tsSelect ? tsSelect.value : state.activeTilesetIndex) || 0;
            const extrude = parseInt(depthSelect ? depthSelect.value : 1) || 1;
            const tileWidth = parseInt(tileWEl ? tileWEl.value : 32) || state.TILE_SIZE || 32;
            const tileHeight = parseInt(tileHEl ? tileHEl.value : 32) || state.TILE_SIZE || 32;

            if (window.TileWeaver.extruder && window.TileWeaver.extruder.downloadExtrudedTileset) {
                window.TileWeaver.extruder.downloadExtrudedTileset(tsIdx, { tileWidth, tileHeight, extrude });
            }
        });
    }

    /** Opens Extrude Tileset Modal Dialog */
    function openExtrudeModal() {
        const modal = document.getElementById('modal-tileset-extrude');
        if (!modal) return;

        const selectEl = document.getElementById('extrude-tileset-select');
        if (selectEl) {
            selectEl.innerHTML = '';
            state.tilesets.forEach((ts, idx) => {
                if (ts.isCollection) return;
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = ts.name;
                if (idx === state.activeTilesetIndex) opt.selected = true;
                selectEl.appendChild(opt);
            });
            if (selectEl.options.length === 0) {
                showMessage("No spritesheet tilesets available to extrude.", "error");
                return;
            }
        }

        const activeTs = state.tilesets[state.activeTilesetIndex];
        const tileWEl = document.getElementById('extrude-tile-w');
        const tileHEl = document.getElementById('extrude-tile-h');
        if (tileWEl) tileWEl.value = (activeTs && activeTs.tilewidth) || state.TILE_SIZE || 32;
        if (tileHEl) tileHEl.value = (activeTs && activeTs.tileheight) || state.TILE_SIZE || 32;

        populateExtrudeSampleTiles();
        updateExtrudePreview();

        modal.classList.remove('hidden');
    }

    /** Closes Extrude Tileset Modal Dialog */
    function closeExtrudeModal() {
        const modal = document.getElementById('modal-tileset-extrude');
        if (modal) modal.classList.add('hidden');
    }

    /** Opens Add New Tileset Type Selection Modal Dialog */
    function openAddTilesetModal() {
        const modal = document.getElementById('modal-add-tileset');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    /** Closes Add New Tileset Type Selection Modal Dialog */
    function closeAddTilesetModal() {
        const modal = document.getElementById('modal-add-tileset');
        if (modal) {
            modal.classList.add('hidden');
        }
        const inputNormal = document.getElementById('modal-upload-normal-input');
        if (inputNormal) inputNormal.value = '';
        const inputColl = document.getElementById('modal-upload-collection-input');
        if (inputColl) inputColl.value = '';
    }

    /** Populates sample tile selection dropdown for extrusion preview */
    function populateExtrudeSampleTiles() {
        const selectEl = document.getElementById('extrude-sample-tile-select');
        const tsSelectEl = document.getElementById('extrude-tileset-select');
        if (!selectEl) return;
        selectEl.innerHTML = '';

        const tsIdx = parseInt(tsSelectEl ? tsSelectEl.value : state.activeTilesetIndex) || 0;
        const ts = state.tilesets[tsIdx];
        if (!ts || !ts.image) return;

        const tw = parseInt(document.getElementById('extrude-tile-w')?.value) || state.TILE_SIZE || 32;
        const th = parseInt(document.getElementById('extrude-tile-h')?.value) || state.TILE_SIZE || 32;
        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;

        const cols = Math.max(1, Math.floor((ts.image.width - margin) / (tw + spacing)));
        const rows = Math.max(1, Math.floor((ts.image.height - margin) / (th + spacing)));

        for (let r = 0; r < Math.min(rows, 6); r++) {
            for (let c = 0; c < Math.min(cols, 6); c++) {
                const opt = document.createElement('option');
                opt.value = `${c},${r}`;
                opt.textContent = `Tile (Col ${c}, Row ${r})`;
                if (c === 0 && r === 0) opt.selected = true;
                selectEl.appendChild(opt);
            }
        }
    }

    /** Updates live side-by-side zoom preview comparing unextruded tile vs extruded tile */
    function updateExtrudePreview() {
        const tsSelectEl = document.getElementById('extrude-tileset-select');
        const depthSelectEl = document.getElementById('extrude-depth-select');
        const sampleSelectEl = document.getElementById('extrude-sample-tile-select');
        const tileWEl = document.getElementById('extrude-tile-w');
        const tileHEl = document.getElementById('extrude-tile-h');

        const tsIdx = parseInt(tsSelectEl ? tsSelectEl.value : state.activeTilesetIndex) || 0;
        const ts = state.tilesets[tsIdx];
        if (!ts || !ts.image) return;

        const extrude = parseInt(depthSelectEl ? depthSelectEl.value : 1) || 1;
        const tw = parseInt(tileWEl ? tileWEl.value : 32) || state.TILE_SIZE || 32;
        const th = parseInt(tileHEl ? tileHEl.value : 32) || state.TILE_SIZE || 32;
        const margin = ts.margin || 0;
        const spacing = ts.spacing || 0;

        const cols = Math.max(1, Math.floor((ts.image.width - margin) / (tw + spacing)));
        const rows = Math.max(1, Math.floor((ts.image.height - margin) / (th + spacing)));

        const newMargin = margin + extrude;
        const newSpacing = spacing + (2 * extrude);
        const newWidth = 2 * newMargin + cols * tw + (cols - 1) * newSpacing;
        const newHeight = 2 * newMargin + rows * th + (rows - 1) * newSpacing;

        // Update metric summaries
        const dimsMetric = document.getElementById('extrude-metric-dims');
        if (dimsMetric) dimsMetric.textContent = `${ts.image.width}x${ts.image.height} → ${newWidth}x${newHeight}px`;

        const marginMetric = document.getElementById('extrude-metric-margin');
        if (marginMetric) marginMetric.textContent = `${margin}px → ${newMargin}px`;

        const spacingMetric = document.getElementById('extrude-metric-spacing');
        if (spacingMetric) spacingMetric.textContent = `${spacing}px → ${newSpacing}px`;

        // Get sample tile coordinate
        const sampleCoord = (sampleSelectEl && sampleSelectEl.value) ? sampleSelectEl.value.split(',').map(Number) : [0, 0];
        const sc = sampleCoord[0] || 0;
        const sr = sampleCoord[1] || 0;

        const srcX = margin + sc * (tw + spacing);
        const srcY = margin + sr * (th + spacing);

        // Render Original Single Tile (Zoom factor: 4x scale)
        const origCanvas = document.getElementById('extrude-preview-orig');
        if (origCanvas) {
            const zoom = Math.min(4, Math.max(2, Math.floor(120 / Math.max(tw, th))));
            origCanvas.width = tw * zoom;
            origCanvas.height = th * zoom;
            const ctxO = origCanvas.getContext('2d');
            ctxO.imageSmoothingEnabled = false;
            ctxO.clearRect(0, 0, origCanvas.width, origCanvas.height);
            ctxO.drawImage(ts.image, srcX, srcY, tw, th, 0, 0, origCanvas.width, origCanvas.height);

            const metaO = document.getElementById('extrude-orig-meta');
            if (metaO) metaO.textContent = `Dim: ${tw}x${th}px (Col ${sc}, Row ${sr})`;
        }

        // Render Extruded Single Tile (with highlighted 1px border)
        const destCanvas = document.getElementById('extrude-preview-dest');
        if (destCanvas) {
            const zoom = Math.min(4, Math.max(2, Math.floor(120 / Math.max(tw, th))));
            const destW = tw + 2 * extrude;
            const destH = th + 2 * extrude;
            destCanvas.width = destW * zoom;
            destCanvas.height = destH * zoom;
            const ctxD = destCanvas.getContext('2d');
            ctxD.imageSmoothingEnabled = false;
            ctxD.clearRect(0, 0, destCanvas.width, destCanvas.height);

            // Create 1-tile extruded canvas helper
            const singleCanvas = document.createElement('canvas');
            singleCanvas.width = destW;
            singleCanvas.height = destH;
            const sCtx = singleCanvas.getContext('2d');
            sCtx.imageSmoothingEnabled = false;

            // Center tile
            sCtx.drawImage(ts.image, srcX, srcY, tw, th, extrude, extrude, tw, th);
            // Edges
            for (let k = 1; k <= extrude; k++) {
                sCtx.drawImage(ts.image, srcX, srcY, tw, 1, extrude, extrude - k, tw, 1);
                sCtx.drawImage(ts.image, srcX, srcY + th - 1, tw, 1, extrude, extrude + th + k - 1, tw, 1);
                sCtx.drawImage(ts.image, srcX, srcY, 1, th, extrude - k, extrude, 1, th);
                sCtx.drawImage(ts.image, srcX + tw - 1, srcY, 1, th, extrude + tw + k - 1, extrude, 1, th);
            }
            // Corners
            for (let kx = 1; kx <= extrude; kx++) {
                for (let ky = 1; ky <= extrude; ky++) {
                    sCtx.drawImage(ts.image, srcX, srcY, 1, 1, extrude - kx, extrude - ky, 1, 1);
                    sCtx.drawImage(ts.image, srcX + tw - 1, srcY, 1, 1, extrude + tw + kx - 1, extrude - ky, 1, 1);
                    sCtx.drawImage(ts.image, srcX, srcY + th - 1, 1, 1, extrude - kx, extrude + th + ky - 1, 1, 1);
                    sCtx.drawImage(ts.image, srcX + tw - 1, srcY + th - 1, 1, 1, extrude + tw + kx - 1, extrude + th + ky - 1, 1, 1);
                }
            }

            // Draw to destination preview
            ctxD.drawImage(singleCanvas, 0, 0, destW, destH, 0, 0, destCanvas.width, destCanvas.height);

            // Draw cyan bounding box around the core tile to highlight extruded padding
            ctxD.strokeStyle = 'rgba(16, 185, 129, 0.9)';
            ctxD.lineWidth = 1.5;
            ctxD.strokeRect(extrude * zoom, extrude * zoom, tw * zoom, th * zoom);

            const metaD = document.getElementById('extrude-dest-meta');
            if (metaD) metaD.textContent = `Extruded: ${destW}x${destH}px (+${extrude}px padding)`;
        }
    }

    /**
     * Smoothly scrolls active visible Tileset Inspector containers (dock, popout, sidebar)
     * to bring the currently selected tile stamp or collection item card into center view.
     */
    function scrollToSelectedTile() {
        const ts = state.tilesets[state.activeTilesetIndex];
        if (!ts) return;

        if (ts.isCollection) {
            if (!ts.activeImageId) return;
            const cardSelector = `.collection-item-card[data-image-id="${ts.activeImageId}"]`;
            const cards = document.querySelectorAll(cardSelector);
            cards.forEach(card => {
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            });
            return;
        }

        // Standard Spritesheet Tileset
        if (!state.selectedStamp) return;

        const zoom = state.tilesetZoom || 1.0;
        const margin = (ts.margin || 0) * zoom;
        const spacing = (ts.spacing || 0) * zoom;
        const tileSizeScaled = state.TILE_SIZE * zoom;
        const step = tileSizeScaled + spacing;

        const stampCol = state.selectedStamp.col || 0;
        const stampRow = state.selectedStamp.row || 0;
        const stampW = state.selectedStamp.width || 1;
        const stampH = state.selectedStamp.height || 1;

        // Target pixel bounds of selected stamp box on tileset canvas
        const targetX = margin + stampCol * step;
        const targetY = margin + stampRow * step;
        const targetW = stampW * tileSizeScaled + (stampW - 1) * spacing;
        const targetH = stampH * tileSizeScaled + (stampH - 1) * spacing;

        const containerIds = ['dock-tileset-container', 'popout-tileset-container', 'tileset-container'];
        containerIds.forEach(id => {
            const container = document.getElementById(id);
            if (!container || container.classList.contains('hidden') || container.offsetWidth === 0) return;

            const cW = container.clientWidth;
            const cH = container.clientHeight;

            // Center of selected stamp
            const centerX = targetX + targetW / 2;
            const centerY = targetY + targetH / 2;

            const scrollLeft = Math.max(0, centerX - cW / 2);
            const scrollTop = Math.max(0, centerY - cH / 2);

            container.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'smooth' });
        });
    }

    // Expose tileset manager on window.TileWeaver namespace
    window.TileWeaver.tilesetManager = {
        generateDefaultTileset,
        generateDirtPathTileset,
        generateDualGridDirtTileset,
        generateDefaultCollectionTileset,
        renderTilesetSelect,
        renderCollectionGallery,
        renderAutotileSelect,
        renderAnimSelect,
        updateTransformUI,
        setTilesetZoom,
        openTilesetPopout,
        closeTilesetPopout,
        toggleTilesetDock,
        scrollToSelectedTile,
        openExtrudeModal,
        closeExtrudeModal,
        openAddTilesetModal,
        closeAddTilesetModal,
        updateExtrudePreview,
        handleAddCollectionImages,
        handleDeleteCollectionImage,
        handleReplaceCollectionImage,
        handleDeleteTileset,
        initTilesetsUI
    };
})();
