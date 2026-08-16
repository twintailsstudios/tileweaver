/**
 * Automated Test Suite for TileWeaver Application Bootstrapper (js/app.js)
 * -----------------------------------------------------------------------------
 * Tests:
 * 1. Public namespace exports (bootstrapApp, resetBootstrapState, isBootstrapped)
 * 2. Idempotent initialization & re-entrancy protection with { force: true } override
 * 3. Multi-dock history restoration callback relay & error isolation
 * 4. Asynchronous tileset initialization completion & first-frame render flush
 * 5. Partial mock resilience against missing subsystem modules
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log("===============================================================");
console.log("🧪 STARTING APPLICATION BOOTSTRAPPER AUTOMATED TEST SUITE");
console.log("===============================================================\n");

function createMockEnvironment() {
    const mockDocument = {
        readyState: 'complete',
        addEventListener: (event, handler) => {},
        getElementById: (id) => null
    };

    const callLog = {
        initMapData: 0,
        initRenderingElements: 0,
        setHistoryRestoreCallback: 0,
        restoreCallbackFn: null,
        initHeaderUI: 0,
        initToolsUI: 0,
        initLayerUI: 0,
        initViewportUI: 0,
        initTerrainSwatchesUI: 0,
        initAutotileWizardUI: 0,
        initTilePropertiesUI: 0,
        initMaterialPropertiesUI: 0,
        initAssetManagerUI: 0,
        initUploadWizardUI: 0,
        initImportWizardUI: 0,
        initTilesetsUI: 0,
        tilesetCompleteCallback: null,
        syncAssetsFromExistingTilesets: 0,
        updateAssetCountBadge: 0,
        resizeCanvases: 0,
        renderLayerUI: 0,
        syncMaterialsFromAutotiles: 0,
        renderTerrainSwatchesUI: 0,
        updateHistoryButtons: 0,
        updateTransformUI: 0,
        drawTileset: 0,
        drawMap: 0,
        updateLiveTilePropertiesPanel: 0,
        startAnimationLoop: 0
    };

    const mockTileWeaver = {
        stateModule: {
            initMapData: () => { callLog.initMapData++; },
            syncAssetsFromExistingTilesets: () => { callLog.syncAssetsFromExistingTilesets++; }
        },
        history: {
            setHistoryRestoreCallback: (fn) => {
                callLog.setHistoryRestoreCallback++;
                callLog.restoreCallbackFn = fn;
            },
            updateHistoryButtons: () => { callLog.updateHistoryButtons++; }
        },
        rendering: {
            initRenderingElements: () => { callLog.initRenderingElements++; },
            resizeCanvases: () => { callLog.resizeCanvases++; },
            drawMap: () => { callLog.drawMap++; },
            drawTileset: () => { callLog.drawTileset++; },
            startAnimationLoop: () => { callLog.startAnimationLoop++; }
        },
        header: { initHeaderUI: () => { callLog.initHeaderUI++; } },
        tools: { initToolsUI: () => { callLog.initToolsUI++; } },
        tilesetManager: {
            initTilesetsUI: (cb) => {
                callLog.initTilesetsUI++;
                callLog.tilesetCompleteCallback = cb;
            },
            updateTransformUI: () => { callLog.updateTransformUI++; }
        },
        terrainSwatches: {
            initTerrainSwatchesUI: () => { callLog.initTerrainSwatchesUI++; },
            syncMaterialsFromAutotiles: () => { callLog.syncMaterialsFromAutotiles++; },
            renderTerrainSwatchesUI: () => { callLog.renderTerrainSwatchesUI++; }
        },
        layerManager: {
            initLayerUI: () => { callLog.initLayerUI++; },
            renderLayerUI: () => { callLog.renderLayerUI++; }
        },
        viewport: { initViewportUI: () => { callLog.initViewportUI++; } },
        autotileWizard: { initAutotileWizardUI: () => { callLog.initAutotileWizardUI++; } },
        tileProperties: {
            initTilePropertiesUI: () => { callLog.initTilePropertiesUI++; },
            updateLiveTilePropertiesPanel: () => { callLog.updateLiveTilePropertiesPanel++; }
        },
        materialProperties: { initMaterialPropertiesUI: () => { callLog.initMaterialPropertiesUI++; } },
        assetManager: {
            initAssetManagerUI: () => { callLog.initAssetManagerUI++; },
            updateAssetCountBadge: () => { callLog.updateAssetCountBadge++; }
        },
        uploadWizard: { initUploadWizardUI: () => { callLog.initUploadWizardUI++; } },
        importWizard: { initImportWizardUI: () => { callLog.initImportWizardUI++; } }
    };

    return { mockDocument, mockTileWeaver, callLog };
}

function loadAppScript(mockDocument, mockTileWeaver) {
    const code = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    const sandbox = {
        window: {
            TileWeaver: mockTileWeaver
        },
        document: mockDocument,
        console: console
    };
    const fn = new Function('window', 'document', 'console', code);
    fn(sandbox.window, sandbox.document, sandbox.console);
    return sandbox.window.TileWeaver;
}

// -------------------------------------------------------------
// TEST 1: Namespace Exports & Initial Bootstrap Execution
// -------------------------------------------------------------
console.log("▶ TEST 1: Public Module Interface & Namespace Exports");
const env1 = createMockEnvironment();
const tm1 = loadAppScript(env1.mockDocument, env1.mockTileWeaver);

assert.ok(tm1.app, "window.TileWeaver.app must be defined");
assert.strictEqual(typeof tm1.app.bootstrapApp, 'function', "bootstrapApp must be a function");
assert.strictEqual(typeof tm1.app.resetBootstrapState, 'function', "resetBootstrapState must be a function");
assert.strictEqual(tm1.app.isBootstrapped, true, "isBootstrapped must be true after initial run");
assert.strictEqual(env1.callLog.initMapData, 1, "initMapData must be called once");
assert.strictEqual(env1.callLog.initRenderingElements, 1, "initRenderingElements must be called once");
assert.strictEqual(env1.callLog.setHistoryRestoreCallback, 1, "setHistoryRestoreCallback must be called once");
console.log("  ✔ Public methods and initial startup sequence verified!\n");

// -------------------------------------------------------------
// TEST 2: Idempotency & Re-entrancy Protection
// -------------------------------------------------------------
console.log("▶ TEST 2: Idempotent Execution & Force Re-initialization");
// Second invocation without force should be a no-op
tm1.app.bootstrapApp();
assert.strictEqual(env1.callLog.initMapData, 1, "Duplicate bootstrap without force must not re-run initMapData");

// Invocation with { force: true } should re-run
tm1.app.bootstrapApp({ force: true });
assert.strictEqual(env1.callLog.initMapData, 2, "Bootstrap with { force: true } must re-run initialization");
console.log("  ✔ Idempotency guard and force re-initialization verified!\n");

// -------------------------------------------------------------
// TEST 3: Multi-Dock History Restoration Callback Relay
// -------------------------------------------------------------
console.log("▶ TEST 3: History Restoration Callback Relay & Error Isolation");
assert.ok(typeof env1.callLog.restoreCallbackFn === 'function', "History restore callback must be registered");

const baselineCanvases = env1.callLog.resizeCanvases;
const baselineLayers = env1.callLog.renderLayerUI;
const baselineSwatches = env1.callLog.renderTerrainSwatchesUI;
const baselineLiveProps = env1.callLog.updateLiveTilePropertiesPanel;
const baselineTransform = env1.callLog.updateTransformUI;

// Trigger history restoration
env1.callLog.restoreCallbackFn();

assert.strictEqual(env1.callLog.resizeCanvases, baselineCanvases + 1, "resizeCanvases must be called on restore");
assert.strictEqual(env1.callLog.renderLayerUI, baselineLayers + 1, "renderLayerUI must be called on restore");
assert.strictEqual(env1.callLog.renderTerrainSwatchesUI, baselineSwatches + 1, "renderTerrainSwatchesUI must be called on restore");
assert.strictEqual(env1.callLog.updateLiveTilePropertiesPanel, baselineLiveProps + 1, "updateLiveTilePropertiesPanel must be synchronized on restore");
assert.strictEqual(env1.callLog.updateTransformUI, baselineTransform + 1, "updateTransformUI must be synchronized on restore");
console.log("  ✔ History restoration multi-dock synchronization verified!\n");

// -------------------------------------------------------------
// TEST 4: Asynchronous Tileset Completion & First-Frame Render
// -------------------------------------------------------------
console.log("▶ TEST 4: Asynchronous Tileset Completion Callback & Frame Flush");
assert.ok(typeof env1.callLog.tilesetCompleteCallback === 'function', "Tileset completion callback must be registered");

const preFlushDrawMap = env1.callLog.drawMap;
const preFlushAnim = env1.callLog.startAnimationLoop;

// Invoke completion callback simulating images decoded
env1.callLog.tilesetCompleteCallback();

assert.strictEqual(env1.callLog.drawMap, preFlushDrawMap + 1, "drawMap must be called upon tileset load completion");
assert.strictEqual(env1.callLog.startAnimationLoop, preFlushAnim + 1, "startAnimationLoop must be started upon tileset completion");
console.log("  ✔ Async tileset completion and initial frame flush verified!\n");

// -------------------------------------------------------------
// TEST 5: Partial Mock & Missing Subsystem Resilience
// -------------------------------------------------------------
console.log("▶ TEST 5: Defensive Destructuring Resilience (Missing Subsystems)");
const envEmpty = {
    mockDocument: { readyState: 'complete', addEventListener: () => {} },
    mockTileWeaver: {} // Zero subsystems provided
};

// Loading app script with completely empty TileWeaver must NOT throw TypeError
assert.doesNotThrow(() => {
    loadAppScript(envEmpty.mockDocument, envEmpty.mockTileWeaver);
}, "bootstrapApp must gracefully handle missing subsystem modules without throwing TypeError");
console.log("  ✔ Defensive destructuring and fallback resilience verified!\n");

console.log("===============================================================");
console.log("🎉 ALL APPLICATION BOOTSTRAPPER TESTS PASSED (5/5)!");
console.log("===============================================================\n");
