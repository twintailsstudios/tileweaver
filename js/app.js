/**
 * @fileoverview TileWeaver - Application Entry Point & Master Bootstrapper
 * @subsystem Core State & Bootstrapper Subsystem
 * @frameBudget 0.00ms UI startup / Non-RAF decoupled lifecycle
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> WorldPixelXY (px)
 * @stateInvariants Master state initialized via initMapData(); single-source-of-truth in window.TileWeaver.state
 * @historyTracked Central history restoration callback relay coordinator via history.setHistoryRestoreCallback()
 * @exportCompatibility Native JSON v3.3 specification & Tiled TMJ 1.10+ compatible
 * ---------------------------------------------------------------------------------------------------------------
 * Initializes state stores, dual-canvas 2D rendering contexts, multi-dock history restoration hooks,
 * all 14 subsystem UI event listeners, clean state initialization, and kicks off the 60 FPS animation loop.
 * 
 * Safe for standard browser script loading (`file://` and `http://`), headless Node.js test runners,
 * and deferred/asynchronous module execution.
 */

(function() {
    'use strict';

    window.TileWeaver = window.TileWeaver || {};

    /**
     * Application bootstrapping status flag protecting against duplicate initialization
     * and redundant requestAnimationFrame loops.
     * @type {boolean}
     */
    let isAppBootstrapped = false;

    /**
     * Master bootstrapper function executing application initialization in sequence.
     * 
     * @param {Object} [options] - Optional bootstrap configuration
     * @param {boolean} [options.force=false] - Force re-initialization even if already bootstrapped
     * @returns {boolean} True if bootstrap succeeded or was already active
     */
    function bootstrapApp(options = {}) {
        const force = Boolean(options && options.force === true);
        if (isAppBootstrapped && !force) {
            return true;
        }

        // 1. Resilient Namespace Destructuring with Safe Fallbacks across all 14 Subsystems
        const { initMapData, syncAssetsFromExistingTilesets } = window.TileWeaver.stateModule || {};
        const { setHistoryRestoreCallback, updateHistoryButtons } = window.TileWeaver.history || {};
        const { initRenderingElements, resizeCanvases, drawMap, drawTileset, startAnimationLoop } = window.TileWeaver.rendering || {};
        const { initHeaderUI } = window.TileWeaver.header || {};
        const { initToolsUI } = window.TileWeaver.tools || {};
        const { initTilesetsUI, updateTransformUI } = window.TileWeaver.tilesetManager || {};
        const { initTerrainSwatchesUI, syncMaterialsFromAutotiles, renderTerrainSwatchesUI } = window.TileWeaver.terrainSwatches || {};
        const { initLayerUI, renderLayerUI } = window.TileWeaver.layerManager || {};
        const { initViewportUI } = window.TileWeaver.viewport || {};
        const { initAutotileWizardUI } = window.TileWeaver.autotileWizard || {};
        const { initTilePropertiesUI } = window.TileWeaver.tileProperties || {};
        const { initMaterialPropertiesUI } = window.TileWeaver.materialProperties || {};
        const { initAssetManagerUI, updateAssetCountBadge } = window.TileWeaver.assetManager || {};
        const { initUploadWizardUI } = window.TileWeaver.uploadWizard || {};
        const { initImportWizardUI } = window.TileWeaver.importWizard || {};

        // 2. Initialize Master State Store & 2D Data Grids
        if (typeof initMapData === 'function') {
            initMapData();
        }

        // 3. Initialize Dual-Canvas Rendering Elements & 2D Contexts
        if (typeof initRenderingElements === 'function') {
            initRenderingElements();
        }

        // 4. Register Multi-Dock History Restoration Callback Relay (Re-draws UI docks and canvases after Undo/Redo)
        if (typeof setHistoryRestoreCallback === 'function') {
            setHistoryRestoreCallback(() => {
                if (typeof resizeCanvases === 'function') resizeCanvases();
                if (typeof renderLayerUI === 'function') renderLayerUI();
                if (typeof syncMaterialsFromAutotiles === 'function') syncMaterialsFromAutotiles();
                if (typeof renderTerrainSwatchesUI === 'function') renderTerrainSwatchesUI();
                if (typeof syncAssetsFromExistingTilesets === 'function') syncAssetsFromExistingTilesets();
                if (typeof updateAssetCountBadge === 'function') updateAssetCountBadge();
                
                // Synchronize Live Tile/Object Properties Inspector & Transform HUD with defensive error isolation
                if (window.TileWeaver.tileProperties && typeof window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel === 'function') {
                    try {
                        window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                    } catch (err) {
                        console.warn('[TileWeaver:HistoryRestore] Non-fatal warning updating live tile properties:', err);
                    }
                }
                if (window.TileWeaver.tilesetManager && typeof window.TileWeaver.tilesetManager.updateTransformUI === 'function') {
                    try {
                        window.TileWeaver.tilesetManager.updateTransformUI();
                    } catch (err) {
                        console.warn('[TileWeaver:HistoryRestore] Non-fatal warning updating transform UI:', err);
                    }
                }

                if (typeof drawTileset === 'function') drawTileset();
                if (typeof drawMap === 'function') drawMap();
            });
        }

        // 5. Initialize Subsystem UI Event Listeners & Controllers
        if (typeof initHeaderUI === 'function') initHeaderUI();
        if (typeof initToolsUI === 'function') initToolsUI();
        if (typeof initLayerUI === 'function') initLayerUI();
        if (typeof initViewportUI === 'function') initViewportUI();
        if (typeof initTerrainSwatchesUI === 'function') initTerrainSwatchesUI();
        if (typeof initAutotileWizardUI === 'function') initAutotileWizardUI();
        if (typeof initTilePropertiesUI === 'function') initTilePropertiesUI();
        if (typeof initMaterialPropertiesUI === 'function') initMaterialPropertiesUI();
        if (typeof initAssetManagerUI === 'function') initAssetManagerUI();
        if (typeof initUploadWizardUI === 'function') initUploadWizardUI();
        if (typeof initImportWizardUI === 'function') initImportWizardUI();

        // 6. Asynchronously Initialize Tilesets & Trigger First Render Frame
        if (typeof initTilesetsUI === 'function') {
            initTilesetsUI(() => {
                if (typeof syncAssetsFromExistingTilesets === 'function') syncAssetsFromExistingTilesets();
                if (typeof updateAssetCountBadge === 'function') updateAssetCountBadge();
                if (typeof resizeCanvases === 'function') resizeCanvases();
                if (typeof renderLayerUI === 'function') renderLayerUI();
                if (typeof syncMaterialsFromAutotiles === 'function') syncMaterialsFromAutotiles();
                if (typeof renderTerrainSwatchesUI === 'function') renderTerrainSwatchesUI();
                if (typeof updateHistoryButtons === 'function') updateHistoryButtons();
                if (typeof updateTransformUI === 'function') updateTransformUI();
                if (typeof drawTileset === 'function') drawTileset();
                if (typeof drawMap === 'function') drawMap();

                if (window.TileWeaver.tileProperties && typeof window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel === 'function') {
                    try {
                        window.TileWeaver.tileProperties.updateLiveTilePropertiesPanel();
                    } catch (err) {
                        console.warn('[TileWeaver:Bootstrap] Non-fatal warning refreshing live properties panel:', err);
                    }
                }

                if (typeof startAnimationLoop === 'function') {
                    startAnimationLoop();
                }
            });
        }

        isAppBootstrapped = true;
        return true;
    }

    /**
     * Resets bootstrap state flag (primarily for test harness lifecycle resets).
     */
    function resetBootstrapState() {
        isAppBootstrapped = false;
    }

    // Ensure bootstrap runs whether script is loaded before or after DOMContentLoaded
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', () => bootstrapApp());
        } else {
            bootstrapApp();
        }
    }

    /**
     * Checks whether the current project has active unsaved data (placed tiles, objects, layers, or history).
     * @returns {boolean} True if project has active content worth guarding against loss
     */
    function hasActiveProjectData() {
        const btnUndo = typeof document !== 'undefined' ? document.getElementById('btn-undo') : null;
        if (btnUndo && !btnUndo.disabled) {
            return true;
        }

        const state = window.TileWeaver.state;
        if (!state) return false;

        // Check if any custom tilesets or assets are loaded
        if (Array.isArray(state.tilesets) && state.tilesets.length > 0) return true;
        if (Array.isArray(state.assets) && state.assets.length > 0) return true;

        // Check if any layer has placed tile cells or scene objects
        if (Array.isArray(state.mapLayers)) {
            for (const layer of state.mapLayers) {
                if (Array.isArray(layer.objects) && layer.objects.length > 0) return true;
                if (Array.isArray(layer.data)) {
                    for (const row of layer.data) {
                        if (Array.isArray(row) && row.some(cell => cell !== null && cell !== 0 && cell !== undefined)) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    // Safeguard active user projects from accidental browser tab refresh or navigation
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', (e) => {
            if (hasActiveProjectData()) {
                e.preventDefault();
                e.returnValue = ''; // Standard browser confirmation prompt
                return '';
            }
        });
    }

    // Expose application bootstrapper interface on window.TileWeaver namespace
    window.TileWeaver.app = {
        bootstrapApp,
        resetBootstrapState,
        hasActiveProjectData,
        get isBootstrapped() {
            return isAppBootstrapped;
        }
    };
})();
