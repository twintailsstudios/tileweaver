/**
 * @fileoverview TileWeaver - Project Digital Assets Management Hub Module
 * @subsystem Asset, Tileset & Extrusion Pipeline
 * @frameBudget Sub-millisecond (<1.0ms) event-driven modal workflow; decoupled from 60 FPS animation loop
 * @coordinateSpace Pixel-based asset dimension inspection & tileset stride math
 * @stateInvariants Single-source-of-truth in state.assets; history-tracked via pushHistoryState()
 * @historyTracked Snapshots recorded on executeAssetHotSwap, convertAssetToNewTileset, executeDeleteAsset, executeCleanUnusedAssets
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ relative path alignment
 * -----------------------------------------------------------------------------
 * Provides a user-facing visual digital asset vault:
 * 1. Visual asset matrix gallery with pixelated checkerboard previews and status badges.
 * 2. Real-time search and multi-category filtering (All, In-Use, Staged/Unassigned, Spritesheets, Props).
 * 3. Live Asset Inspector displaying dimensions, file size, format, and dependency usage graph.
 * 4. Safe texture hot-swapping hooks and asset conversion to tilesets.
 * 5. Safe Orphan Cleaner (bulk pruning of unreferenced staged assets).
 * 6. Direct PNG downloads and dependency-guarded asset deletion.
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state, getAssetById, getAssetUsage, removeAssetFromState, syncAssetsFromExistingTilesets } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawTileset, drawMap } = window.TileWeaver.rendering;

    let pendingDeleteAssetId = null;
    let searchDebounceTimer = null;

    /**
     * Cancels any pending search debounce timer to prevent asynchronous layout calculations.
     */
    function cancelSearchDebounce() {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = null;
        }
    }

    /**
     * Updates the navbar asset count badge and modal status indicators.
     * @param {number} [explicitTotal] - Optional pre-computed total asset count.
     * @param {number} [explicitInUseCount] - Optional pre-computed in-use asset count.
     */
    function updateAssetCountBadge(explicitTotal, explicitInUseCount) {
        const assets = (state.assets && Array.isArray(state.assets)) ? state.assets : [];
        const total = typeof explicitTotal === 'number' ? explicitTotal : assets.length;
        
        let inUseCount = explicitInUseCount;
        if (typeof inUseCount !== 'number') {
            // OPTIMIZATION: Count in-use assets in a single pass
            inUseCount = 0;
            assets.forEach(a => {
                if (a && a.id && getAssetUsage(a.id).isUsed) {
                    inUseCount++;
                }
            });
        }

        const headerBadge = document.getElementById('header-asset-count-badge');
        if (headerBadge) {
            headerBadge.textContent = total;
        }

        const modalTotalBadge = document.getElementById('asset-manager-total-badge');
        if (modalTotalBadge) {
            modalTotalBadge.textContent = `${total} Asset${total === 1 ? '' : 's'}`;
        }

        const filterAllCount = document.getElementById('asset-filter-count-all');
        if (filterAllCount) filterAllCount.textContent = total;

        const filterInUseCount = document.getElementById('asset-filter-count-inuse');
        if (filterInUseCount) filterInUseCount.textContent = inUseCount;

        const filterUnusedCount = document.getElementById('asset-filter-count-unused');
        if (filterUnusedCount) filterUnusedCount.textContent = total - inUseCount;
    }

    /**
     * Opens the Asset Manager modal window.
     */
    function openAssetManager() {
        state.isAssetManagerOpen = true;
        
        // Ensure all current tilesets and collections are indexed into state.assets
        syncAssetsFromExistingTilesets();
        updateAssetCountBadge();

        const modal = document.getElementById('modal-asset-manager');
        if (modal) {
            modal.classList.remove('hidden');
        }

        renderAssetGallery();
        renderAssetInspector(state.activeAssetId || (state.assets && state.assets.length > 0 ? state.assets[0].id : null));
        showMessage("Opened Project Assets Manager", "info");
    }

    /**
     * Closes the Asset Manager modal window.
     */
    function closeAssetManager() {
        cancelSearchDebounce();
        state.isAssetManagerOpen = false;
        const modal = document.getElementById('modal-asset-manager');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * Builds and renders the asset thumbnail cards in the gallery grid.
     * Uses a local frame-scoped memoization map to prevent redundant full-map matrix scans.
     */
    function renderAssetGallery() {
        const grid = document.getElementById('asset-gallery-grid');
        const emptyState = document.getElementById('asset-gallery-empty');
        if (!grid) return;

        grid.innerHTML = '';
        syncAssetsFromExistingTilesets();

        const assets = (state.assets && Array.isArray(state.assets)) ? state.assets : [];

        // OPTIMIZATION (Algorithmic Complexity): Compute dependency usage once per asset for this render tick
        // instead of repeating 3 full-map matrix scans per asset during filtering, badge count, and card rendering.
        const usageMap = new Map();
        let inUseCount = 0;

        assets.forEach(asset => {
            if (!asset || !asset.id) return;
            const usage = getAssetUsage(asset.id) || { isUsed: false, tilesets: [], autotiles: [], layers: [], placedTilesCount: 0 };
            usageMap.set(asset.id, usage);
            if (usage.isUsed) inUseCount++;
        });

        updateAssetCountBadge(assets.length, inUseCount);

        const filter = state.assetFilter || 'all';
        const query = (state.assetSearchQuery || '').toLowerCase().trim();

        const filtered = assets.filter(asset => {
            const usage = usageMap.get(asset.id) || { isUsed: false };
            const isUsed = usage.isUsed;
            const isCollectionProp = asset.tags && asset.tags.includes('prop');
            const isTilesetSheet = asset.tags && (asset.tags.includes('tileset') || asset.tags.includes('spritesheet'));

            // Category filter check
            if (filter === 'in-use' && !isUsed) return false;
            if (filter === 'unassigned' && isUsed) return false;
            if (filter === 'spritesheet' && !isTilesetSheet) return false;
            if (filter === 'collection' && !isCollectionProp) return false;

            // Search query check
            if (query) {
                const nameMatch = asset.name && asset.name.toLowerCase().includes(query);
                const fileMatch = asset.filename && asset.filename.toLowerCase().includes(query);
                const tagMatch = asset.tags && asset.tags.some(t => t.toLowerCase().includes(query));
                if (!nameMatch && !fileMatch && !tagMatch) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        filtered.forEach(asset => {
            const isSelected = asset.id === state.activeAssetId;
            const usage = usageMap.get(asset.id) || { isUsed: false };
            const isUsed = usage.isUsed;

            const card = document.createElement('div');
            card.className = `asset-card group relative flex flex-col p-2 rounded-lg border cursor-pointer transition-all duration-150 select-none ${
                isSelected 
                    ? 'border-blue-500 bg-blue-950/40 shadow-lg ring-2 ring-blue-500/40' 
                    : 'border-slate-700 bg-slate-850 hover:border-slate-500 hover:bg-slate-800'
            }`;
            card.dataset.assetId = asset.id;

            // Thumbnail container with pixelated rendering and checkerboard
            const thumbContainer = document.createElement('div');
            thumbContainer.className = "w-full h-24 flex items-center justify-center checkerboard rounded overflow-hidden relative border border-slate-750 group-hover:border-slate-600";

            const img = document.createElement('img');
            img.src = asset.dataUrl || (asset.image ? asset.image.src : '');
            img.className = "max-w-full max-h-full object-contain pixelated transition-transform group-hover:scale-105";
            img.alt = asset.name || 'Asset Thumbnail';
            
            // Broken image fallback handling
            img.onerror = () => {
                img.onerror = null;
                img.style.display = 'none';
                const fallbackIcon = document.createElement('i');
                fallbackIcon.className = "ph ph-image-broken text-2xl text-slate-600";
                thumbContainer.appendChild(fallbackIcon);
            };

            thumbContainer.appendChild(img);

            // Status Badge Overlay (Top Left)
            const badge = document.createElement('span');
            badge.className = `absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold shadow ${
                isUsed 
                    ? 'bg-emerald-900/90 text-emerald-300 border border-emerald-500/40' 
                    : 'bg-amber-900/90 text-amber-300 border border-amber-500/40'
            }`;
            badge.innerHTML = isUsed 
                ? `<i class="ph ph-check-circle"></i> In-Use` 
                : `<i class="ph ph-archive"></i> Staged`;
            thumbContainer.appendChild(badge);

            // Metadata text row
            const metaContainer = document.createElement('div');
            metaContainer.className = "mt-2 flex flex-col gap-0.5";

            const title = document.createElement('span');
            title.className = "text-xs font-semibold text-slate-200 truncate group-hover:text-white";
            title.textContent = asset.name || 'Untitled Asset';
            title.title = asset.filename || asset.name;

            const dimsRow = document.createElement('div');
            dimsRow.className = "flex items-center justify-between text-[10px] text-slate-400 font-mono";

            const dimSpan = document.createElement('span');
            dimSpan.textContent = `${asset.width || 0}x${asset.height || 0}px`;

            const sizeSpan = document.createElement('span');
            sizeSpan.textContent = formatBytes(asset.sizeBytes);

            dimsRow.appendChild(dimSpan);
            dimsRow.appendChild(sizeSpan);

            metaContainer.appendChild(title);
            metaContainer.appendChild(dimsRow);

            card.appendChild(thumbContainer);
            card.appendChild(metaContainer);

            // Click listener: Select asset and update inspector
            card.addEventListener('click', () => {
                state.activeAssetId = asset.id;
                renderAssetGallery();
                renderAssetInspector(asset.id);
            });

            // Double-click listener: Open Quick Hot-Swap
            card.addEventListener('dblclick', () => {
                state.activeAssetId = asset.id;
                triggerHotSwapForAsset(asset.id);
            });

            grid.appendChild(card);
        });
    }

    /**
     * Renders the right-hand Asset Inspector panel with telemetry, preview, dependency graph, and action buttons.
     * @param {string} assetId - Selected asset ID.
     */
    function renderAssetInspector(assetId) {
        const inspector = document.getElementById('asset-inspector-content');
        const emptyInspector = document.getElementById('asset-inspector-empty');
        if (!inspector) return;

        const asset = getAssetById(assetId);
        if (!asset) {
            inspector.classList.add('hidden');
            if (emptyInspector) emptyInspector.classList.remove('hidden');
            return;
        }

        inspector.classList.remove('hidden');
        if (emptyInspector) emptyInspector.classList.add('hidden');

        // 1. High-DPI Preview Image
        const previewImg = document.getElementById('asset-inspector-preview-img');
        if (previewImg) {
            previewImg.src = asset.dataUrl || (asset.image ? asset.image.src : '');
            previewImg.alt = asset.name || 'Asset Preview';
            previewImg.onerror = () => {
                previewImg.onerror = null;
                previewImg.src = '';
            };
        }

        // 2. Telemetry Details
        const nameEl = document.getElementById('asset-inspector-name');
        const fileEl = document.getElementById('asset-inspector-filename');
        const pathEl = document.getElementById('asset-inspector-path');
        const dimsEl = document.getElementById('asset-inspector-dims');
        const sizeEl = document.getElementById('asset-inspector-size');
        const mimeEl = document.getElementById('asset-inspector-mime');
        const dateEl = document.getElementById('asset-inspector-date');

        if (nameEl) nameEl.textContent = asset.name || '--';
        if (fileEl) fileEl.textContent = asset.filename || '--';
        if (pathEl) pathEl.textContent = asset.relativePath || `assets/${asset.filename || 'asset.png'}`;
        if (dimsEl) dimsEl.textContent = `${asset.width || 0} x ${asset.height || 0} px`;
        if (sizeEl) sizeEl.textContent = formatBytes(asset.sizeBytes);
        if (mimeEl) mimeEl.textContent = asset.mimeType || 'image/png';
        if (dateEl) {
            const dateStr = asset.updatedAt ? new Date(asset.updatedAt).toLocaleDateString() : 'N/A';
            dateEl.textContent = dateStr;
        }

        // 3. Real-Time Dependency Usage Graph
        const usage = getAssetUsage(asset.id);
        const usageList = document.getElementById('asset-inspector-usage-list');
        const usageStatusBadge = document.getElementById('asset-inspector-usage-badge');

        if (usageStatusBadge) {
            usageStatusBadge.className = `px-2 py-0.5 rounded text-xs font-bold ${
                usage.isUsed 
                    ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/40' 
                    : 'bg-amber-900/60 text-amber-300 border border-amber-500/40'
            }`;
            usageStatusBadge.innerHTML = usage.isUsed 
                ? `<i class="ph ph-check-circle"></i> In-Use (${usage.placedTilesCount} placed instance${usage.placedTilesCount === 1 ? '' : 's'})` 
                : `<i class="ph ph-archive"></i> Staged (Unassigned)`;
        }

        if (usageList) {
            usageList.innerHTML = '';

            if (!usage.isUsed) {
                const emptyItem = document.createElement('div');
                emptyItem.className = "text-xs text-slate-400 italic py-1";
                emptyItem.textContent = "This asset is staged in your project library and is not currently assigned to any active tileset or layer.";
                usageList.appendChild(emptyItem);
            } else {
                // Tilesets list
                if (usage.tilesets && usage.tilesets.length > 0) {
                    const tsHeader = document.createElement('div');
                    tsHeader.className = "text-[11px] font-semibold text-slate-300 mt-1 mb-0.5 flex items-center gap-1";
                    tsHeader.innerHTML = `<i class="ph ph-squares-four text-blue-400"></i> Linked Tileset${usage.tilesets.length > 1 ? 's' : ''}:`;
                    usageList.appendChild(tsHeader);

                    usage.tilesets.forEach(ts => {
                        const row = document.createElement('div');
                        row.className = "text-xs bg-slate-900 border border-slate-750 px-2 py-1 rounded text-slate-300 flex items-center justify-between";
                        row.innerHTML = `<span class="truncate">${ts.name}</span> <span class="text-[10px] text-blue-400 font-mono">${ts.isCollection ? 'Collection' : 'Spritesheet'}</span>`;
                        usageList.appendChild(row);
                    });
                }

                // Autotiles list
                if (usage.autotiles && usage.autotiles.length > 0) {
                    const atHeader = document.createElement('div');
                    atHeader.className = "text-[11px] font-semibold text-slate-300 mt-2 mb-0.5 flex items-center gap-1";
                    atHeader.innerHTML = `<i class="ph ph-sparkle text-emerald-400"></i> Linked Autotile${usage.autotiles.length > 1 ? 's' : ''}:`;
                    usageList.appendChild(atHeader);

                    usage.autotiles.forEach(at => {
                        const row = document.createElement('div');
                        row.className = "text-xs bg-slate-900 border border-slate-750 px-2 py-1 rounded text-slate-300 flex items-center justify-between";
                        row.innerHTML = `<span class="truncate">${at.name}</span> <span class="text-[10px] text-emerald-400 font-mono">${at.mode}</span>`;
                        usageList.appendChild(row);
                    });
                }

                // Placed layers list
                if (usage.layers && usage.layers.length > 0) {
                    const lHeader = document.createElement('div');
                    lHeader.className = "text-[11px] font-semibold text-slate-300 mt-2 mb-0.5 flex items-center gap-1";
                    lHeader.innerHTML = `<i class="ph ph-stack text-indigo-400"></i> Placed on Layers:`;
                    usageList.appendChild(lHeader);

                    usage.layers.forEach(l => {
                        const row = document.createElement('div');
                        row.className = "text-xs bg-slate-900 border border-slate-750 px-2 py-1 rounded text-slate-300 flex items-center justify-between";
                        row.innerHTML = `<span class="truncate">${l.name}</span> <span class="text-[10px] text-indigo-300 font-mono">${l.placedCount} instance${l.placedCount === 1 ? '' : 's'}</span>`;
                        usageList.appendChild(row);
                    });
                }
            }
        }

        // 4. Bind Action Buttons
        const btnHotSwap = document.getElementById('btn-inspector-hotswap');
        const btnCreateTs = document.getElementById('btn-inspector-create-tileset');
        const btnDownload = document.getElementById('btn-inspector-download');
        const btnDelete = document.getElementById('btn-inspector-delete');

        if (btnHotSwap) {
            btnHotSwap.onclick = () => triggerHotSwapForAsset(asset.id);
        }

        if (btnCreateTs) {
            btnCreateTs.onclick = () => {
                if (window.TileWeaver.uploadWizard && window.TileWeaver.uploadWizard.openFromExistingAsset) {
                    window.TileWeaver.uploadWizard.openFromExistingAsset(asset);
                } else {
                    convertAssetToNewTileset(asset);
                }
            };
        }

        if (btnDownload) {
            btnDownload.onclick = () => downloadAssetPNG(asset);
        }

        if (btnDelete) {
            btnDelete.onclick = () => openConfirmDeleteAssetModal(asset.id);
        }
    }

    /**
     * Triggers the texture hot-swap workflow for an asset.
     * @param {string} assetId - Asset ID to replace.
     */
    function triggerHotSwapForAsset(assetId) {
        const asset = getAssetById(assetId);
        if (!asset) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png, image/jpeg, image/webp, image/svg+xml';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                executeAssetHotSwap(asset.id, file);
            }
        };
        input.click();
    }

    /**
     * Executes the hot-swap of an asset texture and propagates the new image
     * to all referencing tilesets, collection images, and canvas render loops.
     * @param {string} assetId - ID of asset to hot-swap.
     * @param {File} file - Replacement image file.
     */
    function executeAssetHotSwap(assetId, file) {
        const asset = getAssetById(assetId);
        if (!asset || !file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const img = new Image();
            img.onload = () => {
                // HISTORY INVARIANT: Snapshot state before propagating texture mutations
                pushHistoryState();

                const oldW = asset.width;
                const oldH = asset.height;
                const newW = img.naturalWidth || img.width;
                const newH = img.naturalHeight || img.height;

                // 1. Update Asset Record in master state vault
                window.TileWeaver.stateModule.updateAssetInState(assetId, img, dataUrl, file.name);

                // 2. Cascade update to all referencing tilesets in state.tilesets
                if (state.tilesets) {
                    state.tilesets.forEach(ts => {
                        const isReferenced = ts.assetId === assetId || 
                            (asset.assignedTilesetIds && asset.assignedTilesetIds.includes(ts.id)) ||
                            (ts.filename && ts.filename === asset.filename);

                        if (isReferenced && !ts.isCollection) {
                            ts.image = img;
                            ts.filename = file.name;
                            const tsTileW = ts.tilewidth || state.TILE_SIZE || 32;
                            const tsTileH = ts.tileheight || state.TILE_SIZE || 32;
                            ts.columns = Math.max(1, Math.floor((newW - (ts.margin || 0)) / (tsTileW + (ts.spacing || 0))));
                            ts.tilecount = ts.columns * Math.max(1, Math.floor((newH - (ts.margin || 0)) / (tsTileH + (ts.spacing || 0))));
                        }

                        if (ts.isCollection && ts.images) {
                            ts.images.forEach(cImg => {
                                if (cImg.assetId === assetId || cImg.id === assetId || cImg.filename === asset.filename) {
                                    cImg.image = img;
                                    cImg.dataUrl = dataUrl;
                                    cImg.filename = file.name;
                                    cImg.width = newW;
                                    cImg.height = newH;
                                    const tileSize = state.TILE_SIZE || 32;
                                    cImg.colsSpan = Math.max(1, Math.ceil(newW / tileSize));
                                    cImg.rowsSpan = Math.max(1, Math.ceil(newH / tileSize));
                                }
                            });
                        }
                    });
                }

                // 3. Update active UI components, invalidate composite caches, and redraw all canvases
                if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
                    window.TileWeaver.stateModule.recomputeTilesetGids();
                }

                renderAssetGallery();
                renderAssetInspector(assetId);
                if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
                    window.TileWeaver.tilesetManager.renderTilesetSelect();
                }

                // Subsystem invalidation: Refresh Material Swatches Studio procedural composite thumbnails
                if (window.TileWeaver.terrainSwatches) {
                    if (typeof window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles === 'function') {
                        window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
                    }
                    if (typeof window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI === 'function') {
                        window.TileWeaver.terrainSwatches.renderTerrainSwatchesUI();
                    }
                }

                drawTileset();
                drawMap();

                let diffMsg = `Hot-swapped texture for '${asset.name}'`;
                if (oldW !== newW || oldH !== newH) {
                    diffMsg += ` (${oldW}x${oldH} -> ${newW}x${newH}px)`;
                }
                showMessage(diffMsg, "success");
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    /**
     * Converts a staged asset into a new standard grid tileset.
     * @param {Object} asset - Asset record.
     */
    function convertAssetToNewTileset(asset) {
        if (!asset || !asset.image) return;

        // HISTORY INVARIANT: Snapshot state before converting asset to tileset
        pushHistoryState();

        const tsId = 'ts_' + (state.tilesetIdCounter++);
        const tileSize = state.TILE_SIZE || 32;
        const assetW = asset.width || (asset.image ? (asset.image.naturalWidth || asset.image.width) : tileSize);
        const assetH = asset.height || (asset.image ? (asset.image.naturalHeight || asset.image.height) : tileSize);
        const cols = Math.max(1, Math.floor(assetW / tileSize));
        const rows = Math.max(1, Math.floor(assetH / tileSize));

        const newTileset = {
            id: tsId,
            assetId: asset.id,
            name: asset.name,
            filename: asset.filename,
            image: asset.image,
            margin: 0,
            spacing: 0,
            tilewidth: tileSize,
            tileheight: tileSize,
            columns: cols,
            tilecount: cols * rows,
            tileProperties: {}
        };

        if (!asset.assignedTilesetIds) asset.assignedTilesetIds = [];
        if (!asset.assignedTilesetIds.includes(tsId)) {
            asset.assignedTilesetIds.push(tsId);
        }
        if (!asset.tags.includes('tileset')) {
            asset.tags.push('tileset');
        }

        state.tilesets.push(newTileset);
        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }

        state.activeTilesetIndex = state.tilesets.length - 1;
        if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderTilesetSelect) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }
        drawTileset();
        drawMap();

        renderAssetGallery();
        renderAssetInspector(asset.id);
        showMessage(`Created new Tileset '${asset.name}' from asset`, "success");
    }

    /**
     * Downloads an asset's raw PNG file.
     * @param {Object} asset - Asset record.
     */
    function downloadAssetPNG(asset) {
        if (!asset) return;
        const dataUrl = asset.dataUrl || (asset.image ? asset.image.src : '');
        if (!dataUrl) {
            showMessage("No image data available for download.", "error");
            return;
        }

        const a = document.createElement('a');
        a.download = asset.filename || `${asset.name || 'asset'}.png`;
        a.href = dataUrl;
        a.click();
        showMessage(`Downloaded ${asset.filename || 'asset'}`, "info");
    }

    /**
     * Opens confirmation modal before deleting an asset.
     * @param {string} assetId - ID of asset to delete.
     */
    function openConfirmDeleteAssetModal(assetId) {
        const asset = getAssetById(assetId);
        if (!asset) return;

        pendingDeleteAssetId = assetId;
        const usage = getAssetUsage(assetId);

        const modal = document.getElementById('modal-confirm-delete-asset');
        const nameEl = document.getElementById('delete-asset-name');
        const warningEl = document.getElementById('delete-asset-warning-inuse');
        const countEl = document.getElementById('delete-asset-inuse-count');

        if (nameEl) nameEl.textContent = asset.name || 'Asset';

        if (warningEl) {
            if (usage.isUsed) {
                warningEl.classList.remove('hidden');
                if (countEl) countEl.textContent = `${usage.tilesets.length} tileset(s) and ${usage.placedTilesCount} placed tile(s)`;
            } else {
                warningEl.classList.add('hidden');
            }
        }

        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('btn-cancel-delete-asset')?.focus();
        }
    }

    /** Closes confirmation modal for asset deletion */
    function closeConfirmDeleteAssetModal() {
        const modal = document.getElementById('modal-confirm-delete-asset');
        if (modal) modal.classList.add('hidden');
        pendingDeleteAssetId = null;
    }

    /**
     * Executes the actual deletion of an asset.
     */
    function executeDeleteAsset() {
        if (!pendingDeleteAssetId) return;
        const assetId = pendingDeleteAssetId;
        const asset = getAssetById(assetId);
        const assetName = asset ? asset.name : 'Asset';

        // HISTORY INVARIANT: Snapshot state before deletion
        pushHistoryState();

        removeAssetFromState(assetId);
        closeConfirmDeleteAssetModal();

        updateAssetCountBadge();
        renderAssetGallery();
        renderAssetInspector(state.activeAssetId);

        showMessage(`Deleted '${assetName}' from asset vault`, "info");
    }

    /**
     * Opens the Safe Orphan Cleaner modal.
     */
    function openCleanUnusedModal() {
        syncAssetsFromExistingTilesets();
        const unusedAssets = (state.assets || []).filter(a => a && !getAssetUsage(a.id).isUsed);

        if (unusedAssets.length === 0) {
            showMessage("No unreferenced or staged assets to clean. All assets are actively in use!", "info");
            return;
        }

        const modal = document.getElementById('modal-clean-unused-assets');
        const countEl = document.getElementById('clean-unused-count');
        const listEl = document.getElementById('clean-unused-list');

        if (countEl) countEl.textContent = unusedAssets.length;
        if (listEl) {
            listEl.innerHTML = '';
            unusedAssets.forEach(a => {
                const item = document.createElement('div');
                item.className = "flex items-center justify-between py-1 px-2 bg-slate-900 border border-slate-750 rounded text-xs text-slate-300";
                item.innerHTML = `<span class="truncate">${a.name} (${a.filename})</span> <span class="font-mono text-[10px] text-amber-400">${a.width}x${a.height}px</span>`;
                listEl.appendChild(item);
            });
        }

        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    /** Closes Safe Orphan Cleaner modal */
    function closeCleanUnusedModal() {
        const modal = document.getElementById('modal-clean-unused-assets');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * Executes the pruning of all unreferenced assets.
     */
    function executeCleanUnusedAssets() {
        const unusedAssets = (state.assets || []).filter(a => a && !getAssetUsage(a.id).isUsed);
        if (unusedAssets.length === 0) return;

        // HISTORY INVARIANT: Snapshot state before bulk pruning unreferenced assets
        pushHistoryState();

        const count = unusedAssets.length;
        unusedAssets.forEach(a => {
            removeAssetFromState(a.id);
        });

        // Defensive reset of activeAssetId if pruned
        if (!getAssetById(state.activeAssetId)) {
            state.activeAssetId = (state.assets && state.assets.length > 0) ? state.assets[0].id : null;
        }

        closeCleanUnusedModal();
        updateAssetCountBadge();
        renderAssetGallery();
        renderAssetInspector(state.activeAssetId);

        showMessage(`Cleaned ${count} unreferenced asset${count > 1 ? 's' : ''} from project`, "success");
    }

    /**
     * Formats bytes into human-readable string (KB, MB).
     * @param {number} bytes - Raw file size in bytes.
     * @returns {string} Human-readable byte representation.
     */
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Initializes DOM event listeners for the Asset Manager.
     */
    function initAssetManagerUI() {
        // Top Header button
        document.getElementById('btn-open-asset-manager')?.addEventListener('click', openAssetManager);

        // Modal Close buttons
        document.getElementById('btn-close-asset-manager')?.addEventListener('click', closeAssetManager);
        document.getElementById('btn-close-asset-manager-footer')?.addEventListener('click', closeAssetManager);

        // Upload new asset button in Asset Manager
        document.getElementById('btn-asset-manager-upload')?.addEventListener('click', () => {
            if (window.TileWeaver.uploadWizard && window.TileWeaver.uploadWizard.openUploadWizard) {
                window.TileWeaver.uploadWizard.openUploadWizard();
            } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/png, image/jpeg, image/webp, image/svg+xml';
                input.multiple = true;
                input.onchange = (e) => {
                    if (e.target.files && e.target.files.length > 0) {
                        if (window.TileWeaver.uploadWizard && window.TileWeaver.uploadWizard.handleFiles) {
                            window.TileWeaver.uploadWizard.handleFiles(e.target.files);
                        }
                    }
                };
                input.click();
            }
        });

        // Filter category buttons
        const filterBtns = document.querySelectorAll('.asset-filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                cancelSearchDebounce();
                filterBtns.forEach(b => b.classList.remove('bg-blue-600', 'text-white', 'font-bold'));
                filterBtns.forEach(b => b.classList.add('bg-slate-800', 'text-slate-300'));
                btn.classList.remove('bg-slate-800', 'text-slate-300');
                btn.classList.add('bg-blue-600', 'text-white', 'font-bold');

                state.assetFilter = btn.dataset.filter || 'all';
                renderAssetGallery();
            });
        });

        // Search input with 50ms active debounce timer to eliminate keystroke lag
        const searchInput = document.getElementById('asset-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.assetSearchQuery = e.target.value;
                cancelSearchDebounce();
                searchDebounceTimer = setTimeout(() => {
                    renderAssetGallery();
                }, 50);
            });
        }

        // Clean Unused modal triggers
        document.getElementById('btn-clean-unused-assets')?.addEventListener('click', openCleanUnusedModal);
        document.getElementById('btn-cancel-clean-unused')?.addEventListener('click', closeCleanUnusedModal);
        document.getElementById('btn-confirm-clean-unused')?.addEventListener('click', executeCleanUnusedAssets);

        // Delete Asset modal triggers
        document.getElementById('btn-cancel-delete-asset')?.addEventListener('click', closeConfirmDeleteAssetModal);
        document.getElementById('btn-confirm-delete-asset')?.addEventListener('click', executeDeleteAsset);

        // Backdrop click to close modals
        document.getElementById('modal-asset-manager')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-asset-manager') closeAssetManager();
        });
        document.getElementById('modal-confirm-delete-asset')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-confirm-delete-asset') closeConfirmDeleteAssetModal();
        });
        document.getElementById('modal-clean-unused-assets')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-clean-unused-assets') closeCleanUnusedModal();
        });
    }

    // Expose on window.TileWeaver namespace
    window.TileWeaver.assetManager = {
        initAssetManagerUI,
        openAssetManager,
        closeAssetManager,
        renderAssetGallery,
        renderAssetInspector,
        updateAssetCountBadge,
        triggerHotSwapForAsset,
        executeAssetHotSwap,
        convertAssetToNewTileset,
        downloadAssetPNG,
        openCleanUnusedModal,
        executeCleanUnusedAssets,
        openConfirmDeleteAssetModal,
        executeDeleteAsset
    };
})();
