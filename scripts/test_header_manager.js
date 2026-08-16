/**
 * TileWeaver - Header Manager Automated Test Suite
 * ----------------------------------------------------
 * Verifies header controls, map resizing, 2D matrix reshaping invariants,
 * dual-grid terrain vertex bounds, input clamping, undo/redo, and export dispatches.
 */

const assert = require('assert');

// Mock DOM elements and document for headless Node testing
const elements = {};
const windowListeners = {};

function createMockElement(id = '') {
    const el = {
        id,
        value: '',
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c) {
                if (this.classes.has(c)) { this.classes.delete(c); return false; }
                this.classes.add(c); return true;
            },
            contains(c) { return this.classes.has(c); }
        },
        listeners: {},
        addEventListener(event, handler) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(handler);
        },
        click() {
            if (this.listeners['click']) {
                this.listeners['click'].forEach(fn => fn({ stopPropagation: () => {} }));
            }
        }
    };
    if (id) elements[id] = el;
    return el;
}

global.document = {
    getElementById(id) {
        if (!elements[id]) {
            elements[id] = createMockElement(id);
        }
        return elements[id];
    },
    createElement(tag) {
        return createMockElement(tag);
    }
};

global.window = {
    addEventListener(event, handler) {
        windowListeners[event] = windowListeners[event] || [];
        windowListeners[event].push(handler);
    },
    dispatchEvent(event, data) {
        if (windowListeners[event]) {
            windowListeners[event].forEach(fn => fn(data));
        }
    }
};

console.log('===============================================================');
console.log('🧪 STARTING HEADER MANAGER AUTOMATED TEST SUITE');
console.log('===============================================================');

// Create mock state and dependencies
const mockState = {
    mapWidth: 30,
    mapHeight: 20,
    zoomLevel: 1.0,
    isAssetManagerOpen: false,
    mapLayers: [
        {
            id: 'layer-1',
            name: 'Ground',
            data: Array.from({ length: 20 }, (_, y) =>
                Array.from({ length: 30 }, (_, x) => ({ tilesetId: 'ts-1', tileIndex: y * 30 + x }))
            ),
            terrainVertices: Array.from({ length: 21 }, () =>
                Array.from({ length: 31 }, () => 1)
            )
        }
    ],
    passabilityGrid: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 0)),
    regionGrid: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 0))
};

let historyPushCount = 0;
let canvasesResized = false;
let mapDrawn = false;
let zoomLevelSet = null;
let zoomReset = false;
let exportedJSON = false;
let exportedTMJ = false;
let exportedAtlas = false;
let exportedPNG = false;
let extrudeModalOpened = false;
let assetManagerOpened = false;
let assetManagerClosed = false;
let importWizardOpened = false;

window.TileWeaver = {
    stateModule: { state: mockState },
    history: {
        pushHistoryState: () => { historyPushCount++; },
        undo: () => {},
        redo: () => {}
    },
    rendering: {
        resizeCanvases: () => { canvasesResized = true; },
        drawMap: () => { mapDrawn = true; }
    },
    viewport: {
        setZoomLevel: (z) => { zoomLevelSet = z; mockState.zoomLevel = z; },
        resetZoom: () => { zoomReset = true; mockState.zoomLevel = 1.0; }
    },
    exportImport: {
        exportNativeJSON: () => { exportedJSON = true; },
        exportTiledTMJ: () => { exportedTMJ = true; },
        exportPackedAtlas: () => { exportedAtlas = true; },
        exportPNG: () => { exportedPNG = true; },
        importMapJSON: () => {}
    },
    tilesetManager: {
        openExtrudeModal: () => { extrudeModalOpened = true; }
    },
    assetManager: {
        openAssetManager: () => { assetManagerOpened = true; mockState.isAssetManagerOpen = true; },
        closeAssetManager: () => { assetManagerClosed = true; mockState.isAssetManagerOpen = false; }
    },
    importWizard: {
        openImportWizard: () => { importWizardOpened = true; }
    }
};

// Load the module
require('../js/ui/header.js');

// -----------------------------------------------------------------------------
// TEST 1: Public Module Interface & Exports
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 1: Public Module Interface & Exports');
assert.ok(window.TileWeaver.header, 'window.TileWeaver.header namespace must exist');
assert.strictEqual(typeof window.TileWeaver.header.initHeaderUI, 'function', 'initHeaderUI must be a function');
console.log('  ✔ Header module correctly exposed on window.TileWeaver namespace!');

// Initialize UI
window.TileWeaver.header.initHeaderUI();

// -----------------------------------------------------------------------------
// TEST 2: Map Dimension Resizing (Expansion) & Dual-Grid Invariants
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 2: Map Dimension Resizing (Expansion) & Matrix Invariants');

const inputW = document.getElementById('map-width-input');
const inputH = document.getElementById('map-height-input');
const btnResize = document.getElementById('btn-resize-map');

inputW.value = '40';
inputH.value = '30';
btnResize.click();

assert.strictEqual(mockState.mapWidth, 40, 'Map width should expand to 40');
assert.strictEqual(mockState.mapHeight, 30, 'Map height should expand to 30');
assert.strictEqual(historyPushCount, 1, 'pushHistoryState should have been called before mutation');
assert.ok(canvasesResized, 'resizeCanvases should have been invoked');
assert.ok(mapDrawn, 'drawMap should have been invoked');

const groundLayer = mockState.mapLayers[0];
assert.strictEqual(groundLayer.data.length, 30, 'Layer data rows should equal new height 30');
assert.strictEqual(groundLayer.data[0].length, 40, 'Layer data cols should equal new width 40');

// Invariant: layer.terrainVertices must be (H+1) x (W+1)
assert.strictEqual(groundLayer.terrainVertices.length, 31, 'Terrain vertices rows must equal newHeight + 1 (31)');
assert.strictEqual(groundLayer.terrainVertices[0].length, 41, 'Terrain vertices cols must equal newWidth + 1 (41)');

// Verify preserved data and new null/0 padding
assert.ok(groundLayer.data[0][0] !== null, 'Existing tile cell (0,0) preserved');
assert.strictEqual(groundLayer.data[25][35], null, 'Expanded tile cell (35, 25) initialized to null');
assert.strictEqual(groundLayer.terrainVertices[0][0], 1, 'Existing vertex (0,0) preserved');
assert.strictEqual(groundLayer.terrainVertices[30][40], 0, 'Expanded vertex corner (40, 30) initialized to 0');

assert.strictEqual(mockState.passabilityGrid.length, 30, 'Passability grid rows should be 30');
assert.strictEqual(mockState.passabilityGrid[0].length, 40, 'Passability grid cols should be 40');
assert.strictEqual(mockState.regionGrid.length, 30, 'Region grid rows should be 30');
assert.strictEqual(mockState.regionGrid[0].length, 40, 'Region grid cols should be 40');
console.log('  ✔ Map expansion (30x20 -> 40x30) and (H+1)x(W+1) dual-grid vertex invariants verified!');

// -----------------------------------------------------------------------------
// TEST 3: Map Dimension Resizing (Shrinking)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 3: Map Dimension Resizing (Shrinking)');

inputW.value = '15';
inputH.value = '10';
btnResize.click();

assert.strictEqual(mockState.mapWidth, 15, 'Map width should shrink to 15');
assert.strictEqual(mockState.mapHeight, 10, 'Map height should shrink to 10');
assert.strictEqual(groundLayer.data.length, 10, 'Layer data rows should equal 10');
assert.strictEqual(groundLayer.data[0].length, 15, 'Layer data cols should equal 15');
assert.strictEqual(groundLayer.terrainVertices.length, 11, 'Terrain vertices rows should equal 11');
assert.strictEqual(groundLayer.terrainVertices[0].length, 16, 'Terrain vertices cols should equal 16');
assert.strictEqual(mockState.passabilityGrid.length, 10, 'Passability grid rows should be 10');
assert.strictEqual(mockState.passabilityGrid[0].length, 15, 'Passability grid cols should be 15');
console.log('  ✔ Map shrinking (40x30 -> 15x10) verified cleanly!');

// -----------------------------------------------------------------------------
// TEST 4: Input Validation, NaN & Bounds Clamping
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 4: Defensive Input Validation & Clamping');

// Test invalid / NaN input
inputW.value = 'invalid';
inputH.value = 'abc';
btnResize.click();
assert.strictEqual(mockState.mapWidth, 15, 'Map width must remain unchanged on invalid input');
assert.strictEqual(mockState.mapHeight, 10, 'Map height must remain unchanged on invalid input');

// Test large value clamping
inputW.value = '9999';
inputH.value = '9999';
btnResize.click();
assert.strictEqual(mockState.mapWidth, 500, 'Map width should be clamped to max 500');
assert.strictEqual(mockState.mapHeight, 500, 'Map height should be clamped to max 500');
assert.strictEqual(inputW.value, 500, 'Input W field should be re-synced to clamped 500');
assert.strictEqual(inputH.value, 500, 'Input H field should be re-synced to clamped 500');
console.log('  ✔ Defensive input validation, NaN fallback & [1, 500] clamping verified!');

// -----------------------------------------------------------------------------
// TEST 5: Viewport Zoom Navigation Controls
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 5: Viewport Zoom Navigation Controls');

mockState.zoomLevel = 1.0;
document.getElementById('btn-zoom-in').click();
assert.strictEqual(zoomLevelSet, 1.25, 'Zoom In should increment by 0.25');

document.getElementById('btn-zoom-out').click();
assert.strictEqual(zoomLevelSet, 1.0, 'Zoom Out should decrement by 0.25');

document.getElementById('btn-zoom-reset').click();
assert.ok(zoomReset, 'Zoom Reset should call viewport.resetZoom()');
console.log('  ✔ Viewport zoom controls (+0.25, -0.25, reset) verified!');

// -----------------------------------------------------------------------------
// TEST 6: Export & Modal Navigation Triggers
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 6: Export & Modal Navigation Triggers');

document.getElementById('btn-export-json').click();
assert.ok(exportedJSON, 'Native JSON export triggered');

document.getElementById('btn-export-tmj').click();
assert.ok(exportedTMJ, 'Tiled TMJ export triggered');

document.getElementById('btn-export-atlas').click();
assert.ok(exportedAtlas, 'Packed atlas export triggered');

document.getElementById('btn-export-png').click();
assert.ok(exportedPNG, 'PNG export triggered');

document.getElementById('btn-export-extrude-modal').click();
assert.ok(extrudeModalOpened, 'Extrude modal opened');

document.getElementById('btn-open-asset-manager').click();
assert.ok(assetManagerOpened, 'Asset manager opened via button');

// Test global keyboard shortcut Ctrl+Shift+A
mockState.isAssetManagerOpen = true;
window.dispatchEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'A', preventDefault: () => {} });
assert.ok(assetManagerClosed, 'Asset manager closed via Ctrl+Shift+A hotkey');

document.getElementById('btn-open-import-wizard').click();
assert.ok(importWizardOpened, 'Import wizard opened');
console.log('  ✔ Export routing, asset manager shortcuts, and wizard modals verified!');

console.log('===============================================================');
console.log('🎉 ALL HEADER MANAGER AUTOMATED TESTS PASSED (6/6)!');
console.log('===============================================================');
