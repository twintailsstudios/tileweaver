/**
 * @fileoverview TileWeaver - 4-Way Asset Ingestion & Batch Upload Wizard Module
 * @subsystem Asset, Tileset & Extrusion Pipeline / Modals & Ingestion Wizards
 * @frameBudget Decoupled asynchronous file I/O & event-driven modal pipeline (<0.4ms dispatch)
 * @coordinateSpace Image Pixel Dimensions -> Tileset Grid Dimensions (Cols/Rows) -> GID Sequence
 * @stateInvariants Single-source-of-truth in state.assets; GIDs realigned via recomputeTilesetGids()
 * @historyTracked Snapshots recorded via pushHistoryState() prior to batch asset/tileset commits
 * @exportCompatibility Native JSON v3.3 / Tiled TMJ 1.10+ relative asset path mapping
 * ---------------------------------------------------------------------------------------------
 * Provides an intelligent, intent-driven asset upload pipeline:
 * Choice 1: 🌟 Create Standard Tileset(s) (Grid / Spritesheet)
 * Choice 2: 🔄 Replace / Hot-Swap Existing Tileset Texture (Single File)
 * Choice 3: 📦 Add to Image Collection Tileset (Multi-Size Props / Batch)
 * Choice 4: 🗄️ Import to Asset Library Pool (Stage for Later / Batch)
 * 
 * Fully supports single file and high-volume batch image ingestion (10s to 100s of images).
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};

    const { state, createNewAssetRecord, addAssetToState, updateAssetInState, addCollectionImage, createNewCollectionTileset, recomputeTilesetGids } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { pushHistoryState } = window.TileWeaver.history;
    const { drawTileset, drawMap } = window.TileWeaver.rendering;

    let pendingFiles = [];
    let pendingLoadedBatch = []; // Array of { file, name, filename, dataUrl, image, size, type, width, height }
    let pendingCurrentFile = null;
    let pendingDataUrl = '';
    let pendingImgElement = null;
    let pendingExistingAsset = null;
    let activeChoice = 4; // Default to 4 (Asset Pool) or 1

    /**
     * Reads and decodes a single File into memory asynchronously.
     * Scoped cleanup helper nulls event callbacks to prevent V8 closure retention.
     * @param {File} file - Raw File instance.
     * @returns {Promise<Object>} Decoded image descriptor.
     */
    function readImageFileAsync(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            function cleanup() {
                reader.onload = null;
                reader.onerror = null;
                if (img) {
                    img.onload = null;
                    img.onerror = null;
                }
            }

            let img = null;

            reader.onload = (event) => {
                const dataUrl = event.target.result;
                img = new Image();
                img.onload = () => {
                    cleanup();
                    resolve({
                        file,
                        name: file.name.replace(/\.[^/.]+$/, ""),
                        filename: file.name,
                        dataUrl,
                        image: img,
                        size: file.size || 0,
                        type: file.type || 'image/png',
                        width: img.naturalWidth || img.width || 32,
                        height: img.naturalHeight || img.height || 32
                    });
                };
                img.onerror = () => {
                    cleanup();
                    reject(new Error(`Failed to decode image data for file: ${file.name}`));
                };
                img.src = dataUrl;
            };
            reader.onerror = () => {
                cleanup();
                reject(new Error(`Failed to read file: ${file.name}`));
            };
            reader.readAsDataURL(file);
        });
    }

    /**
     * Opens the 4-Way Upload Wizard with a given file or FileList.
     * @param {File|FileList|Array<File>} [files] - File(s) to process.
     * @param {Object} [options] - Initial configuration options.
     */
    async function openUploadWizard(files, options = {}) {
        if (!files) {
            const input = document.getElementById('modal-upload-wizard-file-input');
            if (input) {
                input.value = '';
                input.click();
            }
            return;
        }

        const fileList = Array.isArray(files) ? files : (files instanceof FileList ? Array.from(files) : [files]);
        const validFiles = fileList.filter(f => f && (f.type ? f.type.startsWith('image/') : /\.(png|jpe?g|webp|svg)$/i.test(f.name || '')));

        if (validFiles.length === 0) {
            showMessage("Please select valid image file(s) (.png, .jpg, .webp, .svg).", "error");
            return;
        }

        try {
            // Load all files in parallel
            const loadedBatch = await Promise.all(validFiles.map(f => readImageFileAsync(f)));
            
            pendingFiles = validFiles;
            pendingLoadedBatch = loadedBatch;
            pendingCurrentFile = validFiles[0];
            pendingExistingAsset = null;
            pendingDataUrl = loadedBatch[0].dataUrl;
            pendingImgElement = loadedBatch[0].image;

            showWizardModal(options);
        } catch (err) {
            console.error("Batch image load error:", err);
            showMessage("Failed to load some of the selected images.", "error");
        }
    }

    /**
     * Opens the upload wizard using an existing staged asset from the Asset Vault.
     * @param {Object} asset - Existing AssetRecord.
     */
    function openFromExistingAsset(asset) {
        if (!asset) return;
        pendingFiles = [];
        pendingLoadedBatch = [{
            file: null,
            name: asset.name,
            filename: asset.filename,
            dataUrl: asset.dataUrl || (asset.image ? asset.image.src : ''),
            image: asset.image,
            size: asset.sizeBytes || 0,
            type: asset.mimeType || 'image/png',
            width: asset.width,
            height: asset.height
        }];
        pendingCurrentFile = null;
        pendingExistingAsset = asset;
        pendingDataUrl = asset.dataUrl || (asset.image ? asset.image.src : '');
        pendingImgElement = asset.image;

        showWizardModal({ mode: 1 });
    }

    /**
     * Displays and populates the Wizard modal window with single or batch telemetry.
     */
    function showWizardModal(options = {}) {
        const modal = document.getElementById('modal-upload-wizard');
        if (!modal) return;

        modal.classList.remove('hidden');

        const isBatch = pendingLoadedBatch.length > 1;
        const totalCount = pendingLoadedBatch.length;
        const totalSizeBytes = pendingLoadedBatch.reduce((sum, item) => sum + item.size, 0);

        // Preview containers
        const singlePreview = document.getElementById('upload-wizard-single-preview');
        const batchPreview = document.getElementById('upload-wizard-batch-preview');
        const previewImg = document.getElementById('upload-wizard-preview-img');
        const filenameEl = document.getElementById('upload-wizard-filename');
        const dimsEl = document.getElementById('upload-wizard-dims');
        const sizeEl = document.getElementById('upload-wizard-size');
        const batchBadge = document.getElementById('upload-wizard-batch-badge');
        const batchInfo = document.getElementById('upload-wizard-batch-info');
        const batchCarousel = document.getElementById('upload-wizard-batch-carousel');

        // Dynamic Choice Elements
        const choice1Title = document.getElementById('upload-choice-1-title');
        const choice1Desc = document.getElementById('upload-choice-1-desc');
        const choice1NameContainer = document.getElementById('upload-choice-1-name-container');
        const choice2Card = document.getElementById('upload-choice-card-2');
        const choice3Title = document.getElementById('upload-choice-3-title');
        const choice3Desc = document.getElementById('upload-choice-3-desc');
        const choice4Title = document.getElementById('upload-choice-4-title');
        const choice4Desc = document.getElementById('upload-choice-4-desc');
        const choice4NameContainer = document.getElementById('upload-choice-4-name-container');
        const confirmBtnText = document.getElementById('upload-wizard-confirm-btn-text');

        if (batchBadge) {
            if (isBatch) {
                batchBadge.classList.remove('hidden');
                batchBadge.textContent = `Batch: ${totalCount} images`;
            } else {
                batchBadge.classList.add('hidden');
            }
        }

        if (isBatch) {
            if (singlePreview) singlePreview.classList.add('hidden');
            if (batchPreview) batchPreview.classList.remove('hidden');

            if (batchInfo) {
                batchInfo.innerHTML = `<i class="ph-fill ph-files text-indigo-400"></i> Batch Import: <strong>${totalCount} Images Selected</strong> (${formatBytes(totalSizeBytes)} total)`;
            }

            if (batchCarousel) {
                batchCarousel.innerHTML = '';
                // OPTIMIZATION: Assemble batch chip nodes on a single DocumentFragment to eliminate layout thrashing
                const fragment = document.createDocumentFragment();
                pendingLoadedBatch.forEach((item, idx) => {
                    const chip = document.createElement('div');
                    chip.className = "flex items-center gap-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 shrink-0 select-none";
                    chip.innerHTML = `
                        <div class="w-6 h-6 checkerboard rounded overflow-hidden flex items-center justify-center border border-slate-650 shrink-0">
                            <img src="${item.dataUrl}" alt="${item.filename}" class="max-w-full max-h-full object-contain pixelated">
                        </div>
                        <div class="flex flex-col min-w-0">
                            <span class="text-[10px] font-bold text-white truncate max-w-[90px]">${item.filename}</span>
                            <span class="text-[9px] text-slate-400 font-mono">${item.width}x${item.height}</span>
                        </div>
                    `;
                    fragment.appendChild(chip);
                });
                batchCarousel.appendChild(fragment);
            }

            // Update Dynamic Choice Labels for Batch
            if (choice4Title) choice4Title.textContent = `🗄️ Batch Import All ${totalCount} Images to Asset Library Pool`;
            if (choice4Desc) choice4Desc.textContent = `Adds all ${totalCount} image files into your Project Digital Assets Vault at once so they are immediately available in your project.`;
            if (choice4NameContainer) choice4NameContainer.classList.add('hidden');

            if (choice3Title) choice3Title.textContent = `📦 Add All ${totalCount} Images to Collection Tileset`;
            if (choice3Desc) choice3Desc.textContent = `Appends all ${totalCount} images as standalone props / objects (e.g. trees, furniture) into a Collection Tileset in one click.`;

            if (choice1Title) choice1Title.textContent = `🌟 Create ${totalCount} Individual Standard Tilesets`;
            if (choice1Desc) choice1Desc.textContent = `Generates ${totalCount} separate standard grid tilesets (one for each image in the batch) using the specified tile size.`;
            if (choice1NameContainer) choice1NameContainer.classList.add('hidden');

            // Disable Hot-Swap in batch mode
            if (choice2Card) {
                choice2Card.classList.add('opacity-50', 'pointer-events-none');
                choice2Card.title = "Hot-Swap is designed for single-texture replacement. To update multiple assets, stage them in the Asset Vault.";
            }

            if (confirmBtnText) confirmBtnText.textContent = `Import All ${totalCount} Assets`;

        } else {
            if (singlePreview) singlePreview.classList.remove('hidden');
            if (batchPreview) batchPreview.classList.add('hidden');

            const item = pendingLoadedBatch[0] || {};
            const name = pendingExistingAsset ? pendingExistingAsset.name : (item.name || 'New Asset');
            const filename = pendingExistingAsset ? pendingExistingAsset.filename : (item.filename || `${name}.png`);
            const w = item.width || 32;
            const h = item.height || 32;
            const sizeBytes = pendingExistingAsset ? pendingExistingAsset.sizeBytes : (item.size || 0);

            if (previewImg) previewImg.src = item.dataUrl || pendingDataUrl;
            if (filenameEl) filenameEl.textContent = filename;
            if (dimsEl) dimsEl.textContent = `${w} x ${h} px`;
            if (sizeEl) sizeEl.textContent = formatBytes(sizeBytes);

            // Update Dynamic Choice Labels for Single File
            if (choice4Title) choice4Title.textContent = `🗄️ Import to Asset Library Pool`;
            if (choice4Desc) choice4Desc.textContent = `Store in the Project Assets Vault without immediately creating a tileset. You can assign or use it at any time.`;
            if (choice4NameContainer) choice4NameContainer.classList.remove('hidden');

            if (choice3Title) choice3Title.textContent = `📦 Add to Collection Tileset`;
            if (choice3Desc) choice3Desc.textContent = `Append this image as a standalone prop / object (e.g. tree, furniture) to a Collection Tileset.`;

            if (choice1Title) choice1Title.textContent = `🌟 Create New Standard Tileset`;
            if (choice1Desc) choice1Desc.textContent = `Create a classic grid tileset palette (e.g. 32x32px tiles) and make it available for brush painting.`;
            if (choice1NameContainer) choice1NameContainer.classList.remove('hidden');

            // Re-enable Hot-Swap for single file
            if (choice2Card) {
                choice2Card.classList.remove('opacity-50', 'pointer-events-none');
                choice2Card.title = "";
            }

            if (confirmBtnText) confirmBtnText.textContent = `Process & Add Asset`;
        }

        // Initialize subform input defaults
        const nameInput = document.getElementById('upload-choice-1-name');
        if (nameInput) nameInput.value = pendingLoadedBatch[0]?.name || 'New Tileset';

        const tileSizeInput = document.getElementById('upload-choice-1-tilesize');
        if (tileSizeInput) tileSizeInput.value = state.TILE_SIZE || 32;

        const marginInput = document.getElementById('upload-choice-1-margin');
        if (marginInput) marginInput.value = 0;

        const spacingInput = document.getElementById('upload-choice-1-spacing');
        if (spacingInput) spacingInput.value = 0;

        // Choice 2: Target Tileset Select
        populateTargetTilesetSelect();

        // Choice 3: Target Collection Select
        populateTargetCollectionSelect();

        // Choice 4: Staged Asset name
        const stagedNameInput = document.getElementById('upload-choice-4-name');
        if (stagedNameInput) stagedNameInput.value = pendingLoadedBatch[0]?.name || 'Staged Asset';

        // Set default choice (For batch: Choice 4, for single: Choice 1 or options.mode)
        const defaultChoice = options.mode || (isBatch ? 4 : 1);
        selectUploadChoice(defaultChoice);
        updateGridCalculations();
    }

    /**
     * Populates target tileset select for Choice 2 (Hot-Swap).
     */
    function populateTargetTilesetSelect() {
        const select = document.getElementById('upload-choice-2-target-tileset');
        if (!select) return;

        select.innerHTML = '';
        if (!state.tilesets || state.tilesets.length === 0) {
            select.innerHTML = '<option value="" disabled>No existing tilesets found in project</option>';
            return;
        }

        state.tilesets.forEach((ts, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${ts.name} (${ts.isCollection ? 'Collection' : `${ts.columns || '?'} cols`})`;
            select.appendChild(opt);
        });

        select.onchange = updateHotSwapDiffBadge;
        updateHotSwapDiffBadge();
    }

    /**
     * Updates dimension comparison preview badge for Choice 2 (Hot-Swap).
     */
    function updateHotSwapDiffBadge() {
        const select = document.getElementById('upload-choice-2-target-tileset');
        const badge = document.getElementById('upload-choice-2-diff-badge');
        if (!select || !badge) return;

        const tsIdx = parseInt(select.value);
        const targetTs = state.tilesets[tsIdx];
        if (!targetTs) {
            badge.textContent = "Select a target tileset";
            return;
        }

        const oldW = targetTs.image ? (targetTs.image.naturalWidth || targetTs.image.width) : (targetTs.imagewidth || 0);
        const oldH = targetTs.image ? (targetTs.image.naturalHeight || targetTs.image.height) : (targetTs.imageheight || 0);

        const newW = pendingImgElement ? (pendingImgElement.naturalWidth || pendingImgElement.width) : 0;
        const newH = pendingImgElement ? (pendingImgElement.naturalHeight || pendingImgElement.height) : 0;

        if (oldW === newW && oldH === newH) {
            badge.className = "text-xs font-mono px-2 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300";
            badge.textContent = `✓ Dimensions Match (${oldW}x${oldH}px) — 100% Safe 1:1 Replacement`;
        } else {
            badge.className = "text-xs font-mono px-2 py-1 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300";
            badge.textContent = `⚠️ Size Change: Current ${oldW}x${oldH}px -> Upload ${newW}x${newH}px. Grid bounds will adjust dynamically.`;
        }
    }

    /**
     * Populates target collection select for Choice 3.
     */
    function populateTargetCollectionSelect() {
        const select = document.getElementById('upload-choice-3-target-collection');
        if (!select) return;

        select.innerHTML = '';
        const colls = (state.tilesets || []).filter(ts => ts.isCollection);

        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = '➕ Create New Collection Tileset';
        select.appendChild(newOpt);

        colls.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name} (${c.images ? c.images.length : 0} items)`;
            select.appendChild(opt);
        });

        if (colls.length > 0) {
            select.value = colls[0].id;
        }
    }

    /**
     * Activates one of the 4 choices visually and updates subforms.
     * @param {number} choiceNum - 1, 2, 3, or 4.
     */
    function selectUploadChoice(choiceNum) {
        activeChoice = choiceNum;

        for (let i = 1; i <= 4; i++) {
            const card = document.getElementById(`upload-choice-card-${i}`);
            const subform = document.getElementById(`upload-choice-${i}-subform`);
            const radio = document.getElementById(`upload-choice-${i}-radio`);

            if (card) {
                if (i === choiceNum) {
                    card.className = "upload-choice-card flex items-start gap-3 p-3 rounded-lg border border-blue-500 bg-blue-950/40 cursor-pointer transition-all shadow-md ring-2 ring-blue-500/30";
                } else {
                    card.className = "upload-choice-card flex items-start gap-3 p-3 rounded-lg border border-slate-700 bg-slate-850 hover:border-slate-500 hover:bg-slate-800 cursor-pointer transition-all";
                }
            }

            if (subform) {
                if (i === choiceNum) {
                    subform.classList.remove('hidden');
                } else {
                    subform.classList.add('hidden');
                }
            }

            if (radio) {
                radio.checked = (i === choiceNum);
            }
        }
    }

    /**
     * Updates auto-calculated grid columns and rows badge for Choice 1.
     * Enforces strict non-zero step bounds to prevent division by zero or NaN values.
     */
    function updateGridCalculations() {
        const sizeInput = document.getElementById('upload-choice-1-tilesize');
        const marginInput = document.getElementById('upload-choice-1-margin');
        const spacingInput = document.getElementById('upload-choice-1-spacing');
        const badge = document.getElementById('upload-choice-1-grid-badge');

        if (!sizeInput || !badge) return;

        // INVARIANT: Clamped tile dimensions and defensive step bounds
        const rawTs = parseInt(sizeInput.value, 10);
        const ts = (isNaN(rawTs) || rawTs < 8) ? (state.TILE_SIZE || 32) : Math.min(256, Math.max(8, rawTs));
        const margin = Math.max(0, Math.min(128, parseInt(marginInput?.value, 10) || 0));
        const spacing = Math.max(0, Math.min(128, parseInt(spacingInput?.value, 10) || 0));
        const step = Math.max(8, ts + spacing);

        const w = pendingImgElement ? (pendingImgElement.naturalWidth || pendingImgElement.width) : 32;
        const h = pendingImgElement ? (pendingImgElement.naturalHeight || pendingImgElement.height) : 32;

        const cols = Math.max(1, Math.floor(Math.max(0, w - margin) / step));
        const rows = Math.max(1, Math.floor(Math.max(0, h - margin) / step));
        const total = cols * rows;

        if (pendingLoadedBatch.length > 1) {
            badge.textContent = `Batch Grid Settings: @ ${ts}px tiles (${margin}px margin, ${spacing}px spacing) applied to all ${pendingLoadedBatch.length} tilesets`;
        } else {
            badge.textContent = `Grid: ${cols} cols x ${rows} rows (${total} tiles @ ${ts}px)`;
        }
    }

    /**
     * Executes the chosen upload pathway (Single or Batch).
     */
    function executeUploadChoice() {
        if (pendingLoadedBatch.length === 0 && !pendingExistingAsset) {
            showMessage("No image assets ready to upload.", "error");
            return;
        }

        pushHistoryState();

        if (activeChoice === 1) {
            // Choice 1: Create Standard Tileset(s)
            executeCreateStandardTilesets();
        } else if (activeChoice === 2) {
            // Choice 2: Replace / Hot-Swap Existing Tileset Texture
            executeHotSwapTilesetTexture();
        } else if (activeChoice === 3) {
            // Choice 3: Add to Image Collection Tileset
            executeAddToCollectionTileset();
        } else if (activeChoice === 4) {
            // Choice 4: Add to Asset Library Pool (Stage for Later)
            executeStageToAssetPool();
        }

        closeUploadWizard();

        if (window.TileWeaver.assetManager && window.TileWeaver.assetManager.updateAssetCountBadge) {
            window.TileWeaver.assetManager.updateAssetCountBadge();
            if (state.isAssetManagerOpen) {
                window.TileWeaver.assetManager.renderAssetGallery();
                window.TileWeaver.assetManager.renderAssetInspector(state.activeAssetId);
            }
        }
    }

    /**
     * Choice 1 execution: Creates new standard grid tileset(s) and registers AssetRecord(s).
     * Enforces mathematical bounds on tile dimensions, margins, and column counts.
     */
    function executeCreateStandardTilesets() {
        const nameInput = document.getElementById('upload-choice-1-name');
        const sizeInput = document.getElementById('upload-choice-1-tilesize');
        const marginInput = document.getElementById('upload-choice-1-margin');
        const spacingInput = document.getElementById('upload-choice-1-spacing');

        // INVARIANT: Clamped tile dimensions and defensive step bounds
        const rawTs = parseInt(sizeInput?.value, 10);
        const tsSize = (isNaN(rawTs) || rawTs < 8) ? (state.TILE_SIZE || 32) : Math.min(256, Math.max(8, rawTs));
        const margin = Math.max(0, Math.min(128, parseInt(marginInput?.value, 10) || 0));
        const spacing = Math.max(0, Math.min(128, parseInt(spacingInput?.value, 10) || 0));
        const step = Math.max(8, tsSize + spacing);

        const isBatch = pendingLoadedBatch.length > 1;
        let createdCount = 0;

        pendingLoadedBatch.forEach((item, idx) => {
            const tsName = isBatch ? item.name : (nameInput?.value.trim() || item.name || 'New Tileset');
            const filename = item.filename || `${tsName}.png`;
            const img = item.image;
            const dataUrl = item.dataUrl;

            // 1. Create AssetRecord
            let asset = pendingExistingAsset && !isBatch ? pendingExistingAsset : null;
            if (!asset) {
                asset = createNewAssetRecord(
                    tsName,
                    filename,
                    img,
                    dataUrl,
                    item.size,
                    item.type,
                    ['tileset', 'spritesheet']
                );
                addAssetToState(asset);
            } else {
                if (!asset.tags.includes('tileset')) asset.tags.push('tileset');
            }

            // 2. Create Tileset Object
            const tsId = 'ts_' + (state.tilesetIdCounter++);
            const w = item.width || 32;
            const h = item.height || 32;
            const cols = Math.max(1, Math.floor(Math.max(0, w - margin) / step));
            const rows = Math.max(1, Math.floor(Math.max(0, h - margin) / step));

            const newTileset = {
                id: tsId,
                assetId: asset.id,
                name: tsName,
                filename: filename,
                image: img,
                margin: margin,
                spacing: spacing,
                tilewidth: tsSize,
                tileheight: tsSize,
                columns: cols,
                tilecount: cols * rows,
                tileProperties: {}
            };

            if (!asset.assignedTilesetIds) asset.assignedTilesetIds = [];
            if (!asset.assignedTilesetIds.includes(tsId)) asset.assignedTilesetIds.push(tsId);

            state.tilesets.push(newTileset);
            createdCount++;
        });

        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }

        state.activeTilesetIndex = state.tilesets.length - 1;
        state.selectedStamp = { col: 0, row: 0, width: 1, height: 1 };

        if (window.TileWeaver.tilesetManager) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }
        drawTileset();
        drawMap();

        if (isBatch) {
            showMessage(`Created ${createdCount} standard grid tilesets from batch upload!`, "success");
        } else {
            showMessage(`Created new standard tileset '${pendingLoadedBatch[0]?.name}'`, "success");
        }
    }

    /**
     * Choice 2 execution: Hot-swaps the texture of an existing tileset safely.
     */
    function executeHotSwapTilesetTexture() {
        const select = document.getElementById('upload-choice-2-target-tileset');
        const tsIdx = parseInt(select?.value) || 0;
        const targetTs = state.tilesets[tsIdx];

        if (!targetTs) {
            showMessage("No valid target tileset selected for hot-swap.", "error");
            return;
        }

        const item = pendingLoadedBatch[0] || {};
        const img = item.image || pendingImgElement;
        const dataUrl = item.dataUrl || pendingDataUrl;
        const filename = pendingExistingAsset ? pendingExistingAsset.filename : (item.filename || targetTs.filename);
        const newW = item.width || (img.naturalWidth || img.width);
        const newH = item.height || (img.naturalHeight || img.height);

        // 1. Update target tileset image
        targetTs.image = img;
        targetTs.filename = filename;
        if (!targetTs.isCollection) {
            targetTs.columns = Math.max(1, Math.floor((newW - (targetTs.margin || 0)) / ((targetTs.tilewidth || state.TILE_SIZE) + (targetTs.spacing || 0))));
            targetTs.tilecount = targetTs.columns * Math.max(1, Math.floor((newH - (targetTs.margin || 0)) / ((targetTs.tileheight || state.TILE_SIZE) + (targetTs.spacing || 0))));
        }

        // 2. Update or register corresponding AssetRecord
        let asset = targetTs.assetId ? window.TileWeaver.stateModule.getAssetById(targetTs.assetId) : null;
        if (asset) {
            updateAssetInState(asset.id, img, dataUrl, filename);
        } else {
            asset = createNewAssetRecord(
                targetTs.name,
                filename,
                img,
                dataUrl,
                item.size || 0,
                item.type || 'image/png',
                ['tileset'],
                [targetTs.id]
            );
            targetTs.assetId = asset.id;
            addAssetToState(asset);
        }

        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }

        if (window.TileWeaver.tilesetManager) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }
        drawTileset();
        drawMap();

        showMessage(`Hot-swapped texture for tileset '${targetTs.name}'`, "success");
    }

    /**
     * Choice 3 execution: Appends single or multiple batch images to a Collection Tileset.
     */
    function executeAddToCollectionTileset() {
        const select = document.getElementById('upload-choice-3-target-collection');
        const anchorSelect = document.getElementById('upload-choice-3-anchor');
        const anchor = anchorSelect?.value || 'bottom-center';
        const collVal = select?.value || '__new__';

        let targetColl = null;
        if (collVal === '__new__') {
            targetColl = createNewCollectionTileset("Props & Objects Collection");
            state.tilesets.push(targetColl);
        } else {
            targetColl = state.tilesets.find(ts => ts.id === collVal);
        }

        if (!targetColl) {
            targetColl = createNewCollectionTileset("Props Collection");
            state.tilesets.push(targetColl);
        }

        let addedCount = 0;

        pendingLoadedBatch.forEach(item => {
            const name = item.name;
            const fname = item.filename;

            // Ingest AssetRecord
            let asset = createNewAssetRecord(
                name,
                fname,
                item.image,
                item.dataUrl,
                item.size,
                item.type,
                ['prop', 'collection'],
                [targetColl.id]
            );
            addAssetToState(asset);

            const addedImg = addCollectionImage(targetColl, name, fname, item.image, item.dataUrl, anchor);
            if (addedImg) {
                addedImg.assetId = asset.id;
            }
            addedCount++;
        });

        if (window.TileWeaver.stateModule && window.TileWeaver.stateModule.recomputeTilesetGids) {
            window.TileWeaver.stateModule.recomputeTilesetGids();
        }

        state.activeTilesetIndex = state.tilesets.findIndex(t => t.id === targetColl.id);
        if (window.TileWeaver.tilesetManager) {
            window.TileWeaver.tilesetManager.renderTilesetSelect();
        }
        drawTileset();
        drawMap();

        showMessage(`Successfully added ${addedCount} prop image${addedCount > 1 ? 's' : ''} to collection '${targetColl.name}'!`, "success");
    }

    /**
     * Choice 4 execution: Batch imports images to the Asset Vault without creating a tileset.
     */
    function executeStageToAssetPool() {
        const nameInput = document.getElementById('upload-choice-4-name');
        const tagsInput = document.getElementById('upload-choice-4-tags');

        const isBatch = pendingLoadedBatch.length > 1;
        const rawTags = tagsInput?.value ? tagsInput.value.split(',').map(t => t.trim()).filter(Boolean) : ['staged'];
        if (!rawTags.includes('staged')) rawTags.push('staged');

        let importedCount = 0;

        pendingLoadedBatch.forEach(item => {
            const name = isBatch ? item.name : (nameInput?.value.trim() || item.name || 'Staged Asset');
            const filename = item.filename || `${name}.png`;

            const asset = createNewAssetRecord(
                name,
                filename,
                item.image,
                item.dataUrl,
                item.size,
                item.type,
                [...rawTags]
            );
            addAssetToState(asset);
            importedCount++;
        });

        if (isBatch) {
            showMessage(`Successfully imported all ${importedCount} images into Project Digital Assets Vault!`, "success");
        } else {
            showMessage(`Added '${pendingLoadedBatch[0]?.name}' to project asset vault (Staged)`, "success");
        }
    }

    /**
     * Closes the Upload Wizard modal.
     */
    function closeUploadWizard() {
        const modal = document.getElementById('modal-upload-wizard');
        if (modal) modal.classList.add('hidden');
        pendingFiles = [];
        pendingLoadedBatch = [];
        pendingCurrentFile = null;
        pendingDataUrl = '';
        pendingImgElement = null;
        pendingExistingAsset = null;
    }

    /**
     * Formats bytes into human-readable string.
     */
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Initializes DOM event listeners for the 4-Way Upload Wizard.
     */
    function initUploadWizardUI() {
        // Modal Close buttons
        document.getElementById('btn-close-upload-wizard')?.addEventListener('click', closeUploadWizard);
        document.getElementById('btn-cancel-upload-wizard')?.addEventListener('click', closeUploadWizard);

        // Upload Submit button
        document.getElementById('btn-confirm-upload-wizard')?.addEventListener('click', executeUploadChoice);

        // Hidden file input reader
        const fileInput = document.getElementById('modal-upload-wizard-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    openUploadWizard(e.target.files);
                }
            });
        }

        // Choice selection cards click events
        for (let i = 1; i <= 4; i++) {
            const card = document.getElementById(`upload-choice-card-${i}`);
            const radio = document.getElementById(`upload-choice-${i}-radio`);

            if (card) {
                card.addEventListener('click', () => {
                    if (pendingLoadedBatch.length > 1 && i === 2) return; // Hot-swap disabled for batch
                    selectUploadChoice(i);
                });
            }
            if (radio) {
                radio.addEventListener('change', () => {
                    if (pendingLoadedBatch.length > 1 && i === 2) return;
                    selectUploadChoice(i);
                });
            }
        }

        // Choice 1 dynamic calculation listeners
        ['upload-choice-1-tilesize', 'upload-choice-1-margin', 'upload-choice-1-spacing'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', updateGridCalculations);
        });

        // Backdrop click to close
        document.getElementById('modal-upload-wizard')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-upload-wizard') {
                closeUploadWizard();
            }
        });

        // Global Escape key listener to close modal safely with visibility shielding
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('modal-upload-wizard');
                if (modal && !modal.classList.contains('hidden')) {
                    closeUploadWizard();
                }
            }
        });
    }

    // Expose on window.TileWeaver namespace
    window.TileWeaver.uploadWizard = {
        initUploadWizardUI,
        openUploadWizard,
        openFromExistingAsset,
        closeUploadWizard,
        selectUploadChoice,
        executeUploadChoice
    };
})();
