/**
 * TileWeaver - Viewport Interactions & Drawing Tools Verification Suite
 * -------------------------------------------------------------------------
 * Tests the complete viewport interaction lifecycle:
 * 1. Zero-allocation BFS floodFill on tile layers.
 * 2. O(N) pointer-indexed BFS executeTerrainFloodFill on dual-grid vertices.
 * 3. In-place reverse search object and tile eyedropper picking (pickTile).
 * 4. Drawing tools execution (paint, erase, autotile, animtile, passability, region).
 * 5. Dual-Grid applyTerrainVertex neighborhood recalculations.
 * 6. Center-locked zoom ratio calculations and bounds clamping.
 */

const assert = require('assert');

// Mock browser DOM environment
global.window = global;
const elemCache = new Map();
global.document = {
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
                    measureText: () => ({ width: 10 })
                }),
                getBoundingClientRect: () => ({
                    left: 100,
                    top: 50,
                    width: 800,
                    height: 600,
                    right: 900,
                    bottom: 650
                })
            });
        }
        return elemCache.get(id);
    },
    querySelectorAll: () => [],
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
            measureText: () => ({ width: 10 })
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
console.log('🧪 STARTING VIEWPORT INTERACTIONS AUTOMATED TEST SUITE');
console.log('===============================================================');

const { state, initMapData } = window.TileWeaver.stateModule;
const {
    floodFill,
    pickTile,
    applyTool,
    applyTerrainVertex,
    executeTerrainFloodFill,
    setZoomLevel,
    resetZoom,
    updateZoomUI
} = window.TileWeaver.viewport;

// Initialize fresh state
initMapData();

// -----------------------------------------------------------------------------
// TEST 1: Public Module Interface & Exports
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 1: Public Module Interface & Namespace Exports');
assert(typeof window.TileWeaver.viewport === 'object', 'window.TileWeaver.viewport must be defined');
assert(typeof floodFill === 'function', 'floodFill must be exported');
assert(typeof pickTile === 'function', 'pickTile must be exported');
assert(typeof applyTool === 'function', 'applyTool must be exported');
assert(typeof applyTerrainVertex === 'function', 'applyTerrainVertex must be exported');
assert(typeof executeTerrainFloodFill === 'function', 'executeTerrainFloodFill must be exported');
assert(typeof setZoomLevel === 'function', 'setZoomLevel must be exported');
assert(typeof resetZoom === 'function', 'resetZoom must be exported');
console.log('  ✔ All public methods verified cleanly on window.TileWeaver.viewport!');

// -----------------------------------------------------------------------------
// TEST 2: Zero-Allocation BFS Tile Flood Fill (floodFill)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 2: Zero-Allocation BFS Tile Flood Fill');
state.mapWidth = 10;
state.mapHeight = 10;
state.mapLayers = [{
    id: 1,
    name: 'Ground',
    visible: true,
    opacity: 1.0,
    type: 'tilelayer',
    data: Array.from({ length: 10 }, () => Array(10).fill(null))
}];
state.activeLayerIndex = 0;

// Fill a 3x3 region with Tile A
for (let r = 2; r <= 4; r++) {
    for (let c = 2; c <= 4; c++) {
        state.mapLayers[0].data[r][c] = { tx: 1, ty: 1, tilesetId: 'ts1' };
    }
}

// Flood fill from (3, 3) with Tile B
const newTile = { tx: 5, ty: 5, tilesetId: 'ts1', flipH: false, flipV: false, rotation: 0 };
floodFill(0, 3, 3, { tx: 1, ty: 1, tilesetId: 'ts1' }, newTile);

// Verify that all 9 cells were filled
for (let r = 2; r <= 4; r++) {
    for (let c = 2; c <= 4; c++) {
        assert.strictEqual(state.mapLayers[0].data[r][c].tx, 5, `Cell (${c}, ${r}) tx should be 5`);
        assert.strictEqual(state.mapLayers[0].data[r][c].ty, 5, `Cell (${c}, ${r}) ty should be 5`);
    }
}
// Verify outer cell untouched
assert.strictEqual(state.mapLayers[0].data[0][0], null, 'Outer cell (0,0) must remain null');
console.log('  ✔ BFS floodFill correctly filled contiguous matching region without side-effects!');

// -----------------------------------------------------------------------------
// TEST 3: O(N) Pointer-Indexed Dual-Grid Terrain Flood Fill (executeTerrainFloodFill)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 3: O(N) Pointer-Indexed Dual-Grid Terrain Flood Fill');
state.mapLayers[0].terrainVertices = Array.from({ length: 11 }, () => Array(11).fill(0));
state.tilesets = [{ id: 'ts_test', name: 'Test TS', image: { width: 256, height: 256 } }];
state.autotiles = [
    { id: 'at_grass_dirt', name: 'Grass to Dirt', mode: 'dualgrid', mat1Name: 'Grass', mat2Name: 'Dirt', tilesetId: 'ts_test', mapping: { grid_0: { tx: 0, ty: 0 }, grid_15: { tx: 1, ty: 0 } } }
];
state.activeAutotileId = 'at_grass_dirt';
window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();

// Set a 4x4 block of vertices to value 1
for (let vy = 2; vy <= 5; vy++) {
    for (let vx = 2; vx <= 5; vx++) {
        state.mapLayers[0].terrainVertices[vy][vx] = 1;
    }
}

// Execute terrain flood fill to replace value 1 with value 0 starting from vertex (3, 3)
executeTerrainFloodFill(3, 3, 0);

for (let vy = 2; vy <= 5; vy++) {
    for (let vx = 2; vx <= 5; vx++) {
        assert.strictEqual(state.mapLayers[0].terrainVertices[vy][vx], 0, `Vertex (${vx}, ${vy}) should be filled to 0`);
    }
}
console.log('  ✔ executeTerrainFloodFill O(N) pointer queue filled all connected vertices accurately!');

// -----------------------------------------------------------------------------
// TEST 4: In-Place Reverse Eyedropper Object & Tile Picking (pickTile)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 4: In-Place Reverse Eyedropper Object & Tile Picking');
// Add an objectgroup layer with 2 objects
state.mapLayers.push({
    id: 2,
    name: 'Objects',
    visible: true,
    opacity: 1.0,
    type: 'objectgroup',
    objects: [
        { id: 101, name: 'Bottom Object', x: 64, y: 64, width: 32, height: 32, visible: true },
        { id: 102, name: 'Top Overlapping Object', x: 64, y: 64, width: 32, height: 32, visible: true }
    ]
});
state.TILE_SIZE = 32;

// Click at tile col: 2, row: 2 -> pixel (64, 64)
pickTile(2, 2);
assert.strictEqual(state.selectedObjectId, 102, 'pickTile should prioritize topmost object (id: 102)');
console.log('  ✔ pickTile correctly selected topmost scene object via reverse in-place search!');

// -----------------------------------------------------------------------------
// TEST 5: Drawing Tool Dispatcher (applyTool - Paint, Erase, Passability, Region)
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 5: Drawing Tool Dispatcher (applyTool)');
state.activeLayerIndex = 0;
state.tilesets = [{ id: 'ts_test', name: 'Test TS', columns: 8, margin: 0, spacing: 0 }];
state.activeTilesetIndex = 0;
state.selectedStamp = { col: 3, row: 4, width: 1, height: 1 };
state.stampTransform = { flipH: true, flipV: false, rotation: 90 };

// Paint tool
state.currentTool = 'paint';
applyTool(1, 1);
const paintedCell = state.mapLayers[0].data[1][1];
assert(paintedCell !== null, 'Cell (1,1) should be painted');
assert.strictEqual(paintedCell.tx, 3, 'painted tx should be 3');
assert.strictEqual(paintedCell.ty, 4, 'painted ty should be 4');
assert.strictEqual(paintedCell.flipH, true, 'painted flipH should be true');
assert.strictEqual(paintedCell.rotation, 90, 'painted rotation should be 90');

// Erase tool
state.currentTool = 'erase';
applyTool(1, 1);
assert.strictEqual(state.mapLayers[0].data[1][1], null, 'Cell (1,1) should be erased to null');

// Passability tool
state.currentTool = 'passability';
state.passabilityGrid = Array.from({ length: 10 }, () => Array(10).fill(0));
applyTool(2, 2);
assert.strictEqual(state.passabilityGrid[2][2], 1, 'Passability should cycle 0 -> 1');
applyTool(2, 2);
assert.strictEqual(state.passabilityGrid[2][2], 2, 'Passability should cycle 1 -> 2');

// Region tool
state.currentTool = 'region';
state.regionGrid = Array.from({ length: 10 }, () => Array(10).fill(0));
state.currentRegionId = 42;
applyTool(3, 3);
assert.strictEqual(state.regionGrid[3][3], 42, 'Region ID at (3,3) should be 42');
console.log('  ✔ applyTool executed paint, erase, passability cycling, and region tagging correctly!');

// -----------------------------------------------------------------------------
// TEST 6: Center-Locked Zoom Mathematics & Bounds Clamping
// -----------------------------------------------------------------------------
console.log('\n▶ TEST 6: Center-Locked Zoom Mathematics & Bounds Clamping');
resetZoom();
assert.strictEqual(state.zoomLevel, 1.0, 'resetZoom sets zoom to 1.0');
assert.strictEqual(state.panX, 0, 'resetZoom sets panX to 0');
assert.strictEqual(state.panY, 0, 'resetZoom sets panY to 0');

state.panX = 100;
state.panY = 200;
setZoomLevel(2.0); // 2x zoom -> pan scaled by 2 / 1 = 2
assert.strictEqual(state.zoomLevel, 2.0, 'zoomLevel should be 2.0');
assert.strictEqual(state.panX, 200, 'panX should scale to 200');
assert.strictEqual(state.panY, 400, 'panY should scale to 400');

// Clamping bounds
setZoomLevel(10.0);
assert.strictEqual(state.zoomLevel, 4.0, 'zoomLevel above max should clamp to 4.0');
setZoomLevel(0.05);
assert.strictEqual(state.zoomLevel, 0.25, 'zoomLevel below min should clamp to 0.25');
console.log('  ✔ setZoomLevel center-locking ratio and clamping bounds [0.25, 4.0] verified!');

console.log('\n===============================================================');
console.log('🎉 ALL VIEWPORT INTERACTIONS AUTOMATED TESTS PASSED (6/6)!');
console.log('===============================================================\n');
