/**
 * Verification Test: Reverse Tile Tool Auto-Switching & Dynamic Tool Tab Locking
 */
const { createCanvas } = require('@napi-rs/canvas');

console.log("--- STARTING REVERSE AUTO-SWITCH & TAB LOCKING VERIFICATION TEST ---");

// Mock DOM elements for tabs and tools
const mockElements = {};
function getOrCreateMockElement(id) {
    if (!mockElements[id]) {
        let _disabled = false;
        const classes = new Set();
        mockElements[id] = {
            id,
            classList: {
                add: (...cls) => cls.forEach(c => classes.add(c)),
                remove: (...cls) => cls.forEach(c => classes.delete(c)),
                contains: (c) => classes.has(c)
            },
            setAttribute: (attr, val) => { if (attr === 'disabled') _disabled = true; },
            removeAttribute: (attr) => { if (attr === 'disabled') _disabled = false; },
            hasAttribute: (attr) => (attr === 'disabled' ? _disabled : false),
            addEventListener: () => {},
            style: {},
            textContent: ''
        };
    }
    return mockElements[id];
}

global.window = { addEventListener: () => {} };
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') return createCanvas(160, 160);
        return { style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, addEventListener: () => {} };
    },
    getElementById: (id) => getOrCreateMockElement(id),
    querySelectorAll: () => []
};
global.Image = function(w = 160, h = 160) {
    const canvas = createCanvas(w, h);
    canvas.naturalWidth = w;
    canvas.naturalHeight = h;
    return canvas;
};

// Require modular code
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.autotile = { drawAutotileCellSubQuadrants: () => {}, updateAutotileCell: () => {} };
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/rendering.js');
window.TileWeaver.rendering = { drawTileset: () => {}, drawMap: () => {}, renderTilesetOnCanvas: () => {} };
require('../js/ui/terrainSwatches.js');
require('../js/ui/tools.js');
require('../js/ui/tilesetManager.js');
require('../js/ui/objectInspector.js');
require('../js/ui/layerManager.js');
require('../js/ui/viewport.js');

// 1. Initialize State
window.TileWeaver.stateModule.initMapData();
window.TileWeaver.tools.initToolsUI();
const state = window.TileWeaver.stateModule.state;

console.log("1. State initialized. Active layer:", state.mapLayers[state.activeLayerIndex].name, "type:", state.mapLayers[state.activeLayerIndex].type);

// 2. Test Tile Context: Object tab should be disabled
window.TileWeaver.tools.updateToolTabStates();
const objectTab = document.getElementById('tool-tab-object');
const drawTab = document.getElementById('tool-tab-draw');

if (!objectTab.hasAttribute('disabled') || !objectTab.classList.contains('pointer-events-none')) {
    console.error("❌ FAILED: Object tab should be disabled in Tile context!", objectTab);
    process.exit(1);
}
if (drawTab.hasAttribute('disabled')) {
    console.error("❌ FAILED: Draw tab should be enabled in Tile context!");
    process.exit(1);
}
console.log("2. Verified Tile Context: Object tab is GREYED OUT & DISABLED, Draw tab is ENABLED.");

// 3. Select Object Layer: Tool should switch to objectPlace and Draw tab should be disabled
const objLayer = window.TileWeaver.stateModule.createNewLayerObject("Test Objects", "objectgroup");
state.mapLayers.push(objLayer);
state.activeLayerIndex = state.mapLayers.length - 1;

window.TileWeaver.tools.selectTool('objectPlace');
window.TileWeaver.tools.updateToolTabStates();

if (!drawTab.hasAttribute('disabled') || !drawTab.classList.contains('pointer-events-none')) {
    console.error("❌ FAILED: Draw tab should be disabled in Object context!");
    process.exit(1);
}
if (objectTab.hasAttribute('disabled')) {
    console.error("❌ FAILED: Object tab should be enabled in Object context!");
    process.exit(1);
}
if (state.currentTool !== 'objectPlace') {
    console.error("❌ FAILED: Active tool should be objectPlace!");
    process.exit(1);
}
console.log("3. Verified Object Context: Draw tab is GREYED OUT & DISABLED, Object tab is ENABLED, tool is 'objectPlace'.");

// 4. Reverse Auto-Switch: Selecting a normal Tile layer switches tool to 'paint'
state.activeLayerIndex = 0; // Base Layer (tilelayer)
if (window.TileWeaver.tools && window.TileWeaver.tools.selectTool) {
    window.TileWeaver.tools.selectTool('paint');
}
window.TileWeaver.tools.updateToolTabStates();

if (state.currentTool !== 'paint') {
    console.error("❌ FAILED: Selecting Tile layer did not auto-switch tool to 'paint'!", state.currentTool);
    process.exit(1);
}
if (!objectTab.hasAttribute('disabled')) {
    console.error("❌ FAILED: Object tab should be disabled after returning to Tile layer!");
    process.exit(1);
}
console.log("4. Verified Reverse Auto-Switch: Selecting Tile layer switched tool to 'paint' and locked Object tab.");

console.log("🎉 ALL REVERSE AUTO-SWITCH & TAB LOCKING TESTS PASSED PERFECTLY!");
