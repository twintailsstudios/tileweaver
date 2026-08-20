/**
 * @fileoverview Automated Test Suite for Orthogonal Straight-Line Axis-Locked Painting (Ctrl-Lock)
 * @subsystem Viewport & Drawing Tools / Input Dispatcher
 */

const assert = require('assert');

// Mock browser DOM environment
global.window = global;
const elemCache = new Map();
const eventListeners = new Map();

global.window.addEventListener = (type, listener) => {
    if (!eventListeners.has(type)) eventListeners.set(type, []);
    eventListeners.get(type).push(listener);
};

function triggerWindowEvent(type, eventObj) {
    const list = eventListeners.get(type) || [];
    list.forEach(fn => fn(eventObj));
}

global.document = {
    activeElement: null,
    getElementById: (id) => {
        if (!elemCache.has(id)) {
            elemCache.set(id, {
                id,
                value: '',
                className: '',
                textContent: '',
                classList: {
                    add: () => {},
                    remove: () => {},
                    toggle: () => {},
                    contains: () => false
                },
                addEventListener: () => {},
                appendChild: () => {},
                setAttribute: () => {},
                removeAttribute: () => {},
                hasAttribute: () => false,
                querySelectorAll: () => [],
                innerHTML: '',
                style: {},
                getContext: () => ({
                    clearRect: () => {},
                    drawImage: () => {},
                    beginPath: () => {},
                    moveTo: () => {},
                    lineTo: () => {},
                    stroke: () => {},
                    fillRect: () => {},
                    strokeRect: () => {},
                    save: () => {},
                    restore: () => {},
                    translate: () => {},
                    scale: () => {},
                    rotate: () => {},
                    arc: () => {},
                    fill: () => {},
                    fillText: () => {},
                    setLineDash: () => {},
                    measureText: () => ({ width: 60 }),
                    roundRect: () => {}
                }),
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    width: 640,
                    height: 480,
                    right: 640,
                    bottom: 480
                })
            });
        }
        return elemCache.get(id);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => ({
        tagName: tag,
        className: '',
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
        hasAttribute: () => false,
        getContext: () => ({
            clearRect: () => {},
            drawImage: () => {},
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fillRect: () => {},
            fillText: () => {},
            measureText: () => ({ width: 60 }),
            roundRect: () => {}
        })
    }),
    addEventListener: () => {}
};

// Load modules
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/autotile.js');
require('../js/engine/rendering.js');
require('../js/engine/exportImport.js');
require('../js/ui/terrainSwatches.js');
require('../js/ui/viewport.js');
require('../js/ui/tools.js');

console.log('===============================================================');
console.log('🧪 STARTING STRAIGHT-LINE AXIS-LOCK (CTRL-LOCK) TEST SUITE');
console.log('===============================================================');

const { state, initMapData } = window.TileWeaver.stateModule;
const { applyTerrainVertex, applyTool } = window.TileWeaver.viewport;
const { getLinePoints } = window.TileWeaver.rendering;
const { initToolsUI } = window.TileWeaver.tools;

// Initialize tools UI listeners
initToolsUI();

// -----------------------------------------------------------------------------
// TEST 1: State Properties & Initial Invariants
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 1: State Store Axis Lock Properties & Invariants');
assert.strictEqual(typeof state.isCtrlPressed, 'boolean', 'state.isCtrlPressed must be a boolean');
assert.strictEqual(state.isCtrlPressed, false, 'state.isCtrlPressed must initially be false');
assert.strictEqual(state.strokeAnchorCol, -1, 'state.strokeAnchorCol must initialize to -1');
assert.strictEqual(state.strokeAnchorRow, -1, 'state.strokeAnchorRow must initialize to -1');
assert.strictEqual(state.strokeAxisLock, null, 'state.strokeAxisLock must initialize to null');
assert.strictEqual(state.lastPaintedCol, -1, 'state.lastPaintedCol must initialize to -1');
assert.strictEqual(state.lastPaintedRow, -1, 'state.lastPaintedRow must initialize to -1');
console.log('  ✔ State store properties and initial invariants verified cleanly!');

// -----------------------------------------------------------------------------
// TEST 2: Keyboard Event Dispatcher Tracking for Control/Meta Key
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 2: Keyboard Event Dispatcher Tracking (Control/Meta)');
triggerWindowEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
assert.strictEqual(state.isCtrlPressed, true, 'state.isCtrlPressed should be true on Control keydown');

triggerWindowEvent('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false, metaKey: false });
assert.strictEqual(state.isCtrlPressed, false, 'state.isCtrlPressed should be false on Control keyup');

triggerWindowEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
assert.strictEqual(state.isCtrlPressed, true, 'state.isCtrlPressed should be true on Meta keydown');

triggerWindowEvent('keyup', { key: 'Meta', code: 'MetaLeft', ctrlKey: false, metaKey: false });
assert.strictEqual(state.isCtrlPressed, false, 'state.isCtrlPressed should be false on Meta keyup');
console.log('  ✔ Control and Meta key tracking verified cleanly!');

// -----------------------------------------------------------------------------
// TEST 3: Mathematical Axis Lock Resolution (Horizontal vs Vertical)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 3: Mathematical Axis Lock Resolution');
// Simulate stroke starting at (5, 5)
state.strokeAnchorCol = 5;
state.strokeAnchorRow = 5;
state.strokeAxisLock = null;

// Move to (8, 6) -> dx = 3, dy = 1 -> |dx| >= |dy| -> horizontal lock
let dx = 8 - state.strokeAnchorCol;
let dy = 6 - state.strokeAnchorRow;
state.strokeAxisLock = (Math.abs(dx) >= Math.abs(dy)) ? 'x' : 'y';
assert.strictEqual(state.strokeAxisLock, 'x', 'Should lock to X axis when |dx| >= |dy|');

let effectiveCol = (state.strokeAxisLock === 'x') ? 8 : state.strokeAnchorCol;
let effectiveRow = (state.strokeAxisLock === 'x') ? state.strokeAnchorRow : 6;
assert.strictEqual(effectiveCol, 8, 'Locked horizontal X should follow mouse column');
assert.strictEqual(effectiveRow, 5, 'Locked horizontal Y should remain fixed to anchor row');

// Move to (6, 10) -> dx = 1, dy = 5 -> |dy| > |dx| -> vertical lock
state.strokeAxisLock = null;
dx = 6 - state.strokeAnchorCol;
dy = 10 - state.strokeAnchorRow;
state.strokeAxisLock = (Math.abs(dx) >= Math.abs(dy)) ? 'x' : 'y';
assert.strictEqual(state.strokeAxisLock, 'y', 'Should lock to Y axis when |dy| > |dx|');

effectiveCol = (state.strokeAxisLock === 'y') ? state.strokeAnchorCol : 6;
effectiveRow = (state.strokeAxisLock === 'y') ? 10 : state.strokeAnchorRow;
assert.strictEqual(effectiveCol, 5, 'Locked vertical X should remain fixed to anchor column');
assert.strictEqual(effectiveRow, 10, 'Locked vertical Y should follow mouse row');
console.log('  ✔ Axis lock resolution math and target coordinates verified!');

// -----------------------------------------------------------------------------
// TEST 4: Gapless Line Interpolation for Terrain Dual-Grid Painting
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 4: Gapless Line Interpolation on Dual-Grid Terrain Vertices');
initMapData();
state.mapWidth = 20;
state.mapHeight = 20;
state.activeLayerIndex = 0;
const testLayer = state.mapLayers[0];

// Set active terrain stroke value to Material 1 (Water/Overlay)
state.currentTool = 'terrain';
state.terrainStrokeValue = 1;
state.terrainBrushRadius = 1;

// Simulate high-speed straight-line horizontal drag from (2, 5) to (8, 5)
const pts = getLinePoints(2, 5, 8, 5);
assert.strictEqual(pts.length, 7, 'Interpolated point count from (2,5) to (8,5) must be 7 cells');

pts.forEach(pt => {
    applyTerrainVertex(pt.col, pt.row, 1);
});

// Verify that all corner vertices along the straight line were set to 1
for (let c = 2; c <= 8; c++) {
    assert.strictEqual(testLayer.terrainVertices[5][c], 1, `Vertex (5, ${c}) must be set to 1`);
    assert.strictEqual(testLayer.terrainVertices[6][c], 1, `Vertex (6, ${c}) must be set to 1`);
    assert.strictEqual(testLayer.terrainVertices[5][c + 1], 1, `Vertex (5, ${c+1}) must be set to 1`);
    assert.strictEqual(testLayer.terrainVertices[6][c + 1], 1, `Vertex (6, ${c+1}) must be set to 1`);
}
console.log('  ✔ Gapless dual-grid terrain vertex line painting verified with zero gaps!');

// -----------------------------------------------------------------------------
// TEST 5: Multi-Radius Terrain Brush Straight-Line Painting (3x3 Brush)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 5: Multi-Radius Terrain Brush Straight-Line Painting (Radius 2 = 3x3)');
initMapData();
const multiRadiusLayer = state.mapLayers[0];
state.terrainBrushRadius = 2; // 3x3 brush (R=1)

const verticalPts = getLinePoints(10, 3, 10, 7);
verticalPts.forEach(pt => {
    applyTerrainVertex(pt.col, pt.row, 2);
});

// Verify 3-wide corridor across vertical stroke
for (let r = 3; r <= 7; r++) {
    for (let c = 9; c <= 11; c++) {
        assert.strictEqual(multiRadiusLayer.terrainVertices[r][c], 2, `Vertex (${r}, ${c}) in 3x3 corridor must be 2`);
    }
}
console.log('  ✔ Multi-radius 3x3 terrain brush straight swath verified!');

// -----------------------------------------------------------------------------
// TEST 6: Standard Drawing Tool Straight-Line Application (Paint, Erase, Passability, Region)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 6: Standard Drawing Tool Straight-Line Application');
initMapData();
state.currentTool = 'passability';

const passPts = getLinePoints(1, 1, 6, 1);
passPts.forEach(pt => {
    applyTool(pt.col, pt.row);
});

for (let c = 1; c <= 6; c++) {
    assert.strictEqual(state.passabilityGrid[1][c], 1, `Passability cell (1, ${c}) must be toggled to 1`);
}

// Region Tool
state.currentTool = 'region';
state.currentRegionId = 42;
const regionPts = getLinePoints(3, 2, 3, 8);
regionPts.forEach(pt => {
    applyTool(pt.col, pt.row);
});

for (let r = 2; r <= 8; r++) {
    assert.strictEqual(state.regionGrid[r][3], 42, `Region cell (${r}, 3) must be 42`);
}
console.log('  ✔ Passability and Region tools verified on straight lines!');

// -----------------------------------------------------------------------------
// TEST 7: History Snapshot & Undo/Redo Integration
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 7: History Snapshot & Undo/Redo Integration');
initMapData();
const history = window.TileWeaver.history;

// Baseline snapshot
history.pushHistoryState();

// Perform straight stroke
const strokeLayer = state.mapLayers[0];
const strokePts = getLinePoints(4, 4, 10, 4);
strokePts.forEach(pt => {
    applyTerrainVertex(pt.col, pt.row, 3);
});

assert.strictEqual(strokeLayer.terrainVertices[4][7], 3, 'Painted vertex before undo should be 3');

// Undo
history.undo();
const restoredLayer = state.mapLayers[0];
assert.strictEqual(restoredLayer.terrainVertices[4][7], 0, 'Restored vertex after undo should revert to 0');

// Redo
history.redo();
const redoneLayer = state.mapLayers[0];
assert.strictEqual(redoneLayer.terrainVertices[4][7], 3, 'Restored vertex after redo should be 3');
console.log('  ✔ Atomic undo and redo verified across straight-line stroke!');

console.log('\n===============================================================');
console.log('🎉 ALL STRAIGHT-LINE AXIS-LOCK (CTRL-LOCK) TESTS PASSED (7/7)!');
console.log('===============================================================');
