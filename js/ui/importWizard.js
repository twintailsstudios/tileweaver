/**
 * @fileoverview Interactive Map Import Wizard for TileWeaver.
 * Allows users to inspect required textures when importing native JSON or Tiled TMJ maps,
 * upload matching image assets in batch, preview missing vs embedded assets,
 * and gracefully handle missing textures with placeholder tilesets without state corruption.
 * 
 * @subsystem Modals, Wizards & Material Studio (Asset Ingestion & Deserialization Pipeline)
 * @frameBudget 0.00ms (Executes asynchronously outside 60 FPS requestAnimationFrame render loop)
 * @coordinateSpace DOM Modal UI / Asynchronous File Ingestion
 * @stateInvariants Safe multi-source fallback (window.TileWeaver.stateModule.state || window.TileWeaver.state)
 * @historyTracked Atomic undo/redo snapshot captured via exportImport.importMapJSON
 * @exportCompatibility Native Project JSON v3.3 & Tiled TMJ (.json, .tmj) format
 */
(function() {
    'use strict';

    window.TileWeaver = window.TileWeaver || {};

    let pendingMapFile = null;
    let pendingMapData = null;
    let pendingAnalysis = null;
    let stagedAssetFiles = [];
    let isImporting = false;

    /**
     * Sanitizes user strings to prevent HTML injection into checklist rows.
     * @param {string} str - Raw text string.
     * @returns {string} Sanitized HTML-safe string.
     */
    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Initializes DOM event listeners for the Map Import Wizard.
     */
    function initImportWizardUI() {
        const modal = document.getElementById('modal-import-map');
        if (!modal) return;

        // Close triggers
        const btnClose = document.getElementById('btn-close-import-map-modal');
        const btnCancel = document.getElementById('btn-cancel-import-map');
        if (btnClose) btnClose.addEventListener('click', () => { if (!isImporting) closeImportWizard(); });
        if (btnCancel) btnCancel.addEventListener('click', () => { if (!isImporting) closeImportWizard(); });

        // Backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal && !isImporting) closeImportWizard();
        });

        // Global Escape keydown listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !isImporting) {
                const targetModal = document.getElementById('modal-import-map');
                if (targetModal && !targetModal.classList.contains('hidden')) {
                    closeImportWizard();
                }
            }
        });

        // Map File Input & Dropzone
        const mapFileInput = document.getElementById('import-map-file-input');
        const mapDropzone = document.getElementById('import-map-dropzone');
        const btnBrowseMap = document.getElementById('btn-browse-map-file');

        if (btnBrowseMap && mapFileInput) {
            btnBrowseMap.addEventListener('click', () => mapFileInput.click());
        }

        if (mapFileInput) {
            mapFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleSelectedMapFile(e.target.files[0]);
                }
            });
        }

        if (mapDropzone) {
            ['dragenter', 'dragover'].forEach(eventName => {
                mapDropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mapDropzone.classList.add('border-blue-500', 'bg-slate-800/80');
                });
            });
            ['dragleave', 'drop'].forEach(eventName => {
                mapDropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mapDropzone.classList.remove('border-blue-500', 'bg-slate-800/80');
                });
            });
            mapDropzone.addEventListener('drop', (e) => {
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.name.endsWith('.json') || file.name.endsWith('.tmj')) {
                        handleSelectedMapFile(file);
                    } else if (file.type.startsWith('image/')) {
                        // If an image is dropped here, route to asset handler
                        handleSelectedAssetFiles(Array.from(e.dataTransfer.files));
                    }
                }
            });
        }

        // Asset Files Input & Dropzone
        const assetFileInput = document.getElementById('import-asset-files-input');
        const assetDropzone = document.getElementById('import-asset-dropzone');
        const btnBrowseAssets = document.getElementById('btn-browse-import-assets');

        if (btnBrowseAssets && assetFileInput) {
            btnBrowseAssets.addEventListener('click', () => assetFileInput.click());
        }

        if (assetFileInput) {
            assetFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    handleSelectedAssetFiles(Array.from(e.target.files));
                }
            });
        }

        if (assetDropzone) {
            ['dragenter', 'dragover'].forEach(eventName => {
                assetDropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    assetDropzone.classList.add('border-emerald-500', 'bg-slate-800/80');
                });
            });
            ['dragleave', 'drop'].forEach(eventName => {
                assetDropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    assetDropzone.classList.remove('border-emerald-500', 'bg-slate-800/80');
                });
            });
            assetDropzone.addEventListener('drop', (e) => {
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                    if (files.length > 0) {
                        handleSelectedAssetFiles(files);
                    }
                }
            });
        }

        // Submit Button
        const btnConfirm = document.getElementById('btn-confirm-import-map');
        if (btnConfirm) {
            btnConfirm.addEventListener('click', executeImportMap);
        }
    }

    /**
     * Opens the Map Import Wizard modal.
     * @param {File} [initialFile] - Optional map JSON file to pre-populate.
     */
    function openImportWizard(initialFile = null) {
        if (isImporting) return;
        const modal = document.getElementById('modal-import-map');
        if (!modal) return;

        pendingMapFile = null;
        pendingMapData = null;
        pendingAnalysis = null;
        stagedAssetFiles = [];

        // Reset UI elements
        const mapFileInput = document.getElementById('import-map-file-input');
        const assetFileInput = document.getElementById('import-asset-files-input');
        if (mapFileInput) mapFileInput.value = '';
        if (assetFileInput) assetFileInput.value = '';

        renderWizardStepState();
        modal.classList.remove('hidden');

        if (initialFile) {
            handleSelectedMapFile(initialFile);
        }
    }

    /**
     * Closes the Map Import Wizard modal and cleans up staging memory.
     */
    function closeImportWizard() {
        if (isImporting) return;
        const modal = document.getElementById('modal-import-map');
        if (modal) modal.classList.add('hidden');
        pendingMapFile = null;
        pendingMapData = null;
        pendingAnalysis = null;
        stagedAssetFiles = [];
    }

    /**
     * Handles parsing and analysis when a map JSON file is selected.
     * @param {File} file - Selected map file
     */
    async function handleSelectedMapFile(file) {
        if (!file || isImporting) return;
        pendingMapFile = file;

        try {
            const text = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsText(file);
            });

            pendingMapData = JSON.parse(text);
            if (!pendingMapData.width && !pendingMapData.mapWidth) {
                throw new Error("Invalid map file structure");
            }

            if (window.TileWeaver.exportImport && window.TileWeaver.exportImport.analyzeMapJSON) {
                pendingAnalysis = window.TileWeaver.exportImport.analyzeMapJSON(pendingMapData);
            }

            renderWizardStepState();
        } catch (err) {
            console.error("Map parsing error:", err);
            if (window.TileWeaver.toast) {
                window.TileWeaver.toast.showMessage("Selected file is not a valid map JSON.", "error");
            }
        }
    }

    /**
     * Handles staging uploaded asset images for the current import.
     * @param {File[]} files - Uploaded asset images
     */
    function handleSelectedAssetFiles(files) {
        if (!files || files.length === 0 || isImporting) return;

        // Append non-duplicate files (case-insensitive deduplication)
        files.forEach(f => {
            if (!f || !f.name) return;
            const exists = stagedAssetFiles.some(sf => sf.name.toLowerCase() === f.name.toLowerCase());
            if (!exists) {
                stagedAssetFiles.push(f);
            }
        });

        renderWizardStepState();
    }

    /**
     * Re-renders the wizard UI state: summary, asset matching checklist, and submit button.
     */
    function renderWizardStepState() {
        const mapSummary = document.getElementById('import-map-summary');
        const assetSection = document.getElementById('import-map-assets-section');
        const checklistContainer = document.getElementById('import-map-required-assets-list');
        const stagedPreviews = document.getElementById('import-map-staged-previews');
        const btnConfirm = document.getElementById('btn-confirm-import-map');

        if (!pendingMapData || !pendingAnalysis) {
            if (mapSummary) mapSummary.classList.add('hidden');
            if (assetSection) assetSection.classList.add('hidden');
            if (btnConfirm) {
                btnConfirm.disabled = true;
                btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
                btnConfirm.innerHTML = '<span>Import Map</span>';
            }
            return;
        }

        // Show Summary
        if (mapSummary) {
            mapSummary.classList.remove('hidden');
            const fileNameEl = document.getElementById('import-map-filename');
            const metaEl = document.getElementById('import-map-metadata');
            if (fileNameEl) fileNameEl.textContent = pendingMapFile ? pendingMapFile.name : 'map.json';
            if (metaEl) {
                metaEl.textContent = `${pendingAnalysis.mapWidth}×${pendingAnalysis.mapHeight} grid • ${pendingAnalysis.tileSize}px tiles • ${pendingAnalysis.layersCount} layers • ${pendingAnalysis.requiredAssets.length} required textures`;
            }
        }

        // Show Assets Section
        if (assetSection) assetSection.classList.remove('hidden');

        // Render Required Assets Checklist
        if (checklistContainer) {
            checklistContainer.innerHTML = '';

            const vaultAssets = (window.TileWeaver.stateModule?.state?.assets || window.TileWeaver.state?.assets || []);
            const embeddedAssets = (pendingMapData && Array.isArray(pendingMapData.assets)) ? pendingMapData.assets : [];
            let matchedCount = 0;
            const totalCount = pendingAnalysis.requiredAssets.length;

            if (totalCount === 0) {
                checklistContainer.innerHTML = `
                    <div class="text-xs text-slate-400 italic py-2">
                        No external texture files required for this map.
                    </div>
                `;
            } else {
                // OPTIMIZATION: O(1) Pre-indexed normalized Set lookup to eliminate O(N*M) nested loops and repeated inner-loop regex parsing.
                const embeddedSet = new Set();
                embeddedAssets.forEach(a => {
                    if (typeof a.filename === 'string' && a.filename) {
                        const fn = a.filename.toLowerCase();
                        embeddedSet.add(fn);
                        embeddedSet.add(fn.replace(/\.[^/.]+$/, ""));
                    }
                    if (typeof a.name === 'string' && a.name) {
                        const nm = a.name.toLowerCase();
                        embeddedSet.add(nm);
                        embeddedSet.add(nm.replace(/\.[^/.]+$/, ""));
                    }
                });

                const vaultSet = new Set();
                vaultAssets.forEach(a => {
                    if (typeof a.filename === 'string' && a.filename) {
                        const fn = a.filename.toLowerCase();
                        vaultSet.add(fn);
                        vaultSet.add(fn.replace(/\.[^/.]+$/, ""));
                    }
                    if (typeof a.name === 'string' && a.name) {
                        const nm = a.name.toLowerCase();
                        vaultSet.add(nm);
                        vaultSet.add(nm.replace(/\.[^/.]+$/, ""));
                    }
                });

                const stagedSet = new Set();
                stagedAssetFiles.forEach(f => {
                    if (typeof f.name === 'string' && f.name) {
                        const fn = f.name.toLowerCase();
                        stagedSet.add(fn);
                        stagedSet.add(fn.replace(/\.[^/.]+$/, ""));
                    }
                });

                pendingAnalysis.requiredAssets.forEach(req => {
                    const reqFilename = typeof req.filename === 'string' ? req.filename : '';
                    const reqName = typeof req.name === 'string' ? req.name : '';
                    const reqFileLower = reqFilename.toLowerCase();
                    const reqNameLower = reqName.toLowerCase();
                    const reqBase = reqFileLower.replace(/\.[^/.]+$/, "");

                    const isEmbedded = (reqFileLower && embeddedSet.has(reqFileLower)) ||
                                       (reqNameLower && embeddedSet.has(reqNameLower)) ||
                                       (reqBase && embeddedSet.has(reqBase));

                    const inVault = (reqFileLower && vaultSet.has(reqFileLower)) ||
                                    (reqNameLower && vaultSet.has(reqNameLower)) ||
                                    (reqBase && vaultSet.has(reqBase));

                    const inStaged = (reqFileLower && stagedSet.has(reqFileLower)) ||
                                     (reqBase && stagedSet.has(reqBase));

                    const isMatched = Boolean(isEmbedded || inVault || inStaged);
                    if (isMatched) matchedCount++;

                    const safeFilename = escapeHtml(reqFilename);
                    const safeWidth = Number(req.width) || 0;
                    const safeHeight = Number(req.height) || 0;
                    const propType = req.isCollection ? 'Collection Prop' : 'Grid Tileset';

                    const row = document.createElement('div');
                    row.className = `flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                        isMatched 
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                            : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                    }`;

                    const badgeHtml = isEmbedded
                        ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Embedded</span>'
                        : inStaged 
                            ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Uploaded</span>' 
                            : inVault 
                                ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">In Vault</span>' 
                                : '<span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">Missing</span>';

                    row.innerHTML = `
                        <div class="flex items-center space-x-2.5 overflow-hidden">
                            <span class="text-base">${isMatched ? '🟢' : '🔴'}</span>
                            <div class="truncate">
                                <div class="font-semibold text-slate-200 truncate">${safeFilename}</div>
                                <div class="text-[10px] text-slate-400">${propType} • ${safeWidth}×${safeHeight}px</div>
                            </div>
                        </div>
                        <div class="text-[11px] font-medium shrink-0 ml-2">
                            ${badgeHtml}
                        </div>
                    `;
                    checklistContainer.appendChild(row);
                });
            }

            // Render Staged Previews
            if (stagedPreviews) {
                if (stagedAssetFiles.length > 0) {
                    stagedPreviews.classList.remove('hidden');
                    const badge = document.getElementById('import-staged-count-badge');
                    if (badge) badge.textContent = `${stagedAssetFiles.length} files`;

                    const carousel = document.getElementById('import-staged-carousel');
                    if (carousel) {
                        carousel.innerHTML = '';
                        stagedAssetFiles.forEach((file, idx) => {
                            const chip = document.createElement('div');
                            chip.className = 'flex items-center space-x-2 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 shrink-0';
                            chip.innerHTML = `
                                <span>🖼️</span>
                                <span class="truncate max-w-[120px]">${escapeHtml(file.name)}</span>
                                <button class="text-slate-400 hover:text-rose-400 font-bold ml-1 text-sm remove-staged-btn" data-idx="${idx}">&times;</button>
                            `;
                            carousel.appendChild(chip);
                        });

                        carousel.querySelectorAll('.remove-staged-btn').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                if (isImporting) return;
                                const idx = parseInt(e.target.dataset.idx, 10);
                                if (!isNaN(idx) && idx >= 0 && idx < stagedAssetFiles.length) {
                                    stagedAssetFiles.splice(idx, 1);
                                    renderWizardStepState();
                                }
                            });
                        });
                    }
                } else {
                    stagedPreviews.classList.add('hidden');
                }
            }

            // Update Submit Button
            if (btnConfirm && !isImporting) {
                btnConfirm.disabled = false;
                btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
                if (matchedCount === totalCount || totalCount === 0) {
                    btnConfirm.innerHTML = `<span>Import Map (All Assets Ready)</span>`;
                } else {
                    btnConfirm.innerHTML = `<span>Import Map (${matchedCount}/${totalCount} Assets Ready)</span>`;
                }
            }
        }
    }

    /**
     * Executes map importation via the engine and closes the wizard.
     */
    async function executeImportMap() {
        if (!pendingMapData || isImporting) return;
        isImporting = true;

        const btnConfirm = document.getElementById('btn-confirm-import-map');
        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.innerHTML = `<span class="animate-pulse">Importing Map...</span>`;
        }

        try {
            if (window.TileWeaver.exportImport && window.TileWeaver.exportImport.importMapJSON) {
                await window.TileWeaver.exportImport.importMapJSON(
                    pendingMapData,
                    stagedAssetFiles,
                    () => {
                        if (window.TileWeaver.exportImport.synchronizeAppAfterMapImport) {
                            window.TileWeaver.exportImport.synchronizeAppAfterMapImport();
                        }
                        isImporting = false;
                        closeImportWizard();
                    }
                );
            }
            isImporting = false;
            closeImportWizard();
        } catch (err) {
            isImporting = false;
            console.error("Map import error:", err);
            if (window.TileWeaver.toast) {
                window.TileWeaver.toast.showMessage("Failed to import map.", "error");
            }
            if (btnConfirm) {
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = `<span>Import Map</span>`;
            }
        }
    }

    // Expose import wizard on window.TileWeaver namespace
    window.TileWeaver.importWizard = {
        initImportWizardUI,
        openImportWizard,
        closeImportWizard,
        handleSelectedMapFile,
        handleSelectedAssetFiles,
        getIsImporting: () => isImporting
    };
})();
