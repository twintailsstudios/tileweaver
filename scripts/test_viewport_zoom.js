/**
 * TileWeaver - Viewport Center-Locked Zoom Verification Test Suite
 * --------------------------------------------------------------------
 * Tests that zooming in and out on maps of any size preserves the exact
 * map coordinates focused at the center of the viewport window.
 */

const assert = require('assert');

// Mock browser DOM environment
global.window = global;
global.document = {
    getElementById: (id) => {
        return {
            id,
            textContent: '',
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            addEventListener: () => {},
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
                fill: () => {}
            }),
            getBoundingClientRect: () => ({
                left: 100,
                top: 50,
                width: 800,
                height: 600,
                right: 900,
                bottom: 650
            })
        };
    },
    querySelectorAll: () => [],
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
require('../js/ui/viewport.js');
require('../js/ui/header.js');
require('../js/ui/tools.js');

console.log('--- STARTING VIEWPORT CENTER-LOCKED ZOOM VERIFICATION TESTS ---');

const { state } = window.TileWeaver.stateModule;
const { setZoomLevel, resetZoom } = window.TileWeaver.viewport;

// Helper: Calculate the map pixel coordinate currently at the center of the viewport window
function getViewportCenterMapCoord() {
    const mapW = state.mapWidth * state.TILE_SIZE;
    const mapH = state.mapHeight * state.TILE_SIZE;
    const midX = mapW / 2;
    const midY = mapH / 2;
    const currentZoom = state.zoomLevel;

    const mapX = midX - (state.panX / currentZoom);
    const mapY = midY - (state.panY / currentZoom);
    return { mapX, mapY };
}

// 1. Verify Default Initial State
console.log('1. Checking default initial zoom and pan state...');
assert.strictEqual(state.zoomLevel, 1.0, 'Initial zoomLevel should be 1.0');
assert.strictEqual(state.panX, 0, 'Initial panX should be 0');
assert.strictEqual(state.panY, 0, 'Initial panY should be 0');
const initialCenter = getViewportCenterMapCoord();
console.log(`   Initial center on ${state.mapWidth}x${state.mapHeight} map: (${initialCenter.mapX}px, ${initialCenter.mapY}px)`);
assert.strictEqual(initialCenter.mapX, (state.mapWidth * state.TILE_SIZE) / 2);
assert.strictEqual(initialCenter.mapY, (state.mapHeight * state.TILE_SIZE) / 2);
console.log('✅ Initial state verified.');

// 2. Large Map Test (100x100 tiles = 3200x3200px)
console.log('2. Simulating navigation to edge of a large 100x100 map...');
state.mapWidth = 100;
state.mapHeight = 100;
state.TILE_SIZE = 32;

// User pans to bottom-right edge of map: tile (95, 90) -> (3040px, 2880px)
const targetEdgeX = 95 * 32; // 3040
const targetEdgeY = 90 * 32; // 2880
const mapMidX = (100 * 32) / 2; // 1600
const mapMidY = (100 * 32) / 2; // 1600

state.zoomLevel = 1.0;
state.panX = mapMidX - targetEdgeX; // 1600 - 3040 = -1440
state.panY = mapMidY - targetEdgeY; // 1600 - 2880 = -1280

let currentCenter = getViewportCenterMapCoord();
console.log(`   Panned to edge position: (${currentCenter.mapX}, ${currentCenter.mapY})`);
assert.strictEqual(currentCenter.mapX, targetEdgeX, 'Center map X should match targetEdgeX');
assert.strictEqual(currentCenter.mapY, targetEdgeY, 'Center map Y should match targetEdgeY');

// 3. Test Zoom In from 1.0x to 2.0x, 3.0x, 4.0x
console.log('3. Testing Zoom In on edge of large map...');
[1.5, 2.0, 2.75, 3.5, 4.0].forEach(targetZoom => {
    setZoomLevel(targetZoom);
    const centerAfterZoom = getViewportCenterMapCoord();
    console.log(`   Zoomed to ${targetZoom}x: Center = (${centerAfterZoom.mapX.toFixed(2)}, ${centerAfterZoom.mapY.toFixed(2)}), panX = ${state.panX}, panY = ${state.panY}`);
    assert(Math.abs(centerAfterZoom.mapX - targetEdgeX) < 0.001, `Map X center must not drift at zoom ${targetZoom}`);
    assert(Math.abs(centerAfterZoom.mapY - targetEdgeY) < 0.001, `Map Y center must not drift at zoom ${targetZoom}`);
});
console.log('✅ Zoom In center-locking verified.');

// 4. Test Zoom Out from 4.0x to 0.25x
console.log('4. Testing Zoom Out on edge of large map...');
[3.0, 2.0, 1.0, 0.75, 0.5, 0.25].forEach(targetZoom => {
    setZoomLevel(targetZoom);
    const centerAfterZoom = getViewportCenterMapCoord();
    console.log(`   Zoomed to ${targetZoom}x: Center = (${centerAfterZoom.mapX.toFixed(2)}, ${centerAfterZoom.mapY.toFixed(2)}), panX = ${state.panX}, panY = ${state.panY}`);
    assert(Math.abs(centerAfterZoom.mapX - targetEdgeX) < 0.001, `Map X center must not drift at zoom ${targetZoom}`);
    assert(Math.abs(centerAfterZoom.mapY - targetEdgeY) < 0.001, `Map Y center must not drift at zoom ${targetZoom}`);
});
console.log('✅ Zoom Out center-locking verified.');

// 5. Test Incremental Wheel Zoom simulation (40 zoom ticks)
console.log('5. Testing continuous incremental wheel zoom in/out ticks...');
state.zoomLevel = 1.0;
state.panX = -1440;
state.panY = -1280;

// 20 ticks of zoom in (+0.1 each)
for (let i = 0; i < 20; i++) {
    setZoomLevel(state.zoomLevel + 0.1);
}
let afterWheelZoomIn = getViewportCenterMapCoord();
console.log(`   After 20 zoom-in wheel ticks (${state.zoomLevel}x): Center = (${afterWheelZoomIn.mapX.toFixed(2)}, ${afterWheelZoomIn.mapY.toFixed(2)})`);
assert(Math.abs(afterWheelZoomIn.mapX - targetEdgeX) < 0.01, 'Center map X drifted after wheel zoom in');
assert(Math.abs(afterWheelZoomIn.mapY - targetEdgeY) < 0.01, 'Center map Y drifted after wheel zoom in');

// 20 ticks of zoom out (-0.1 each)
for (let i = 0; i < 20; i++) {
    setZoomLevel(state.zoomLevel - 0.1);
}
let afterWheelZoomOut = getViewportCenterMapCoord();
console.log(`   After 20 zoom-out wheel ticks (${state.zoomLevel}x): Center = (${afterWheelZoomOut.mapX.toFixed(2)}, ${afterWheelZoomOut.mapY.toFixed(2)})`);
assert(Math.abs(afterWheelZoomOut.mapX - targetEdgeX) < 0.01, 'Center map X drifted after wheel zoom out');
assert(Math.abs(afterWheelZoomOut.mapY - targetEdgeY) < 0.01, 'Center map Y drifted after wheel zoom out');
console.log('✅ Incremental wheel zoom stability verified.');

// 6. Test Zoom Clamping Limits
console.log('6. Testing Zoom clamping limits (min: 0.25x, max: 4.0x)...');
setZoomLevel(10.0);
assert.strictEqual(state.zoomLevel, 4.0, 'Zoom above 4.0 should clamp to 4.0');
setZoomLevel(0.01);
assert.strictEqual(state.zoomLevel, 0.25, 'Zoom below 0.25 should clamp to 0.25');
console.log('✅ Zoom clamping verified.');

// 7. Test Reset Zoom
console.log('7. Testing Reset Zoom...');
resetZoom();
assert.strictEqual(state.zoomLevel, 1.0, 'resetZoom should set zoomLevel to 1.0');
assert.strictEqual(state.panX, 0, 'resetZoom should set panX to 0');
assert.strictEqual(state.panY, 0, 'resetZoom should set panY to 0');
console.log('✅ Reset zoom verified.');

console.log('🎉 ALL VIEWPORT CENTER-LOCKED ZOOM TESTS PASSED PERFECTLY!');
