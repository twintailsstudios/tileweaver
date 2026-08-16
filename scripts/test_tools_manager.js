/**
 * @fileoverview Automated Test Suite for TileWeaver Drawing Tools & Input Dispatcher (tools.js)
 * Verifies tool selection, tab locking, terrain radius clamping, modal shielding, and keyboard handling.
 */

const assert = require('assert');
const { createCanvas } = require('@napi-rs/canvas');

console.log("===============================================================");
console.log("🧪 STARTING DRAWING TOOLS & INPUT DISPATCHER TEST SUITE");
console.log("===============================================================\n");

// Mock DOM elements and document
const mockElements = {};
const globalEventListeners = {};

function getOrCreateMockElement(id) {
    if (!mockElements[id]) {
        let _disabled = false;
        let _textContent = '';
        let _className = '';
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
            addEventListener: (event, handler) => {
                mockElements[id][`on_${event}`] = handler;
            },
            click: () => {
                if (mockElements[id][`on_click`]) mockElements[id][`on_click`]();
            },
            get textContent() { return _textContent; },
            set textContent(val) { _textContent = val; },
            get className() { return _className; },
            set className(val) {
                _className = val;
                classes.clear();
                val.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
            },
            style: {}
        };
    }
    return mockElements[id];
}

let activeModalOverlay = null;

global.window = {
    addEventListener: (event, handler) => {
        globalEventListeners[event] = globalEventListeners[event] || [];
        globalEventListeners[event].push(handler);
    }
};

global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') return createCanvas(160, 160);
        return { style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, addEventListener: () => {} };
    },
    getElementById: (id) => getOrCreateMockElement(id),
    querySelectorAll: (selector) => {
        const matches = [];
        if (selector === '.btn-tool-active' || selector === '.btn-toggle-active') {
            Object.values(mockElements).forEach(el => {
                if (el.classList.contains(selector.replace('.', ''))) matches.push(el);
            });
        }
        return matches;
    },
    querySelector: (selector) => {
        if (selector.includes('.modal-overlay') || selector.includes('.fixed.inset-0')) {
            return activeModalOverlay;
        }
        return null;
    },
    activeElement: { tagName: 'BODY' }
};

global.Image = function(w = 160, h = 160) {
    const canvas = createCanvas(w, h);
    canvas.naturalWidth = w;
    canvas.naturalHeight = h;
    return canvas;
};

// Require core modules
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.rendering = { drawTileset: () => {}, drawMap: () => {} };
window.TileWeaver.history = { undo: () => {}, redo: () => {} };
window.TileWeaver.toast = { showMessage: () => {} };

require('../js/constants.js');
require('../js/state.js');
require('../js/ui/tools.js');

const { state } = window.TileWeaver.stateModule;
const tools = window.TileWeaver.tools;

// -------------------------------------------------------------
// TEST 1: Public Module Interface & Exports
// -------------------------------------------------------------
console.log("▶ TEST 1: Public Module Interface & Namespace Exports");
assert.ok(tools, "tools module must exist on window.TileWeaver");
assert.strictEqual(typeof tools.selectTool, 'function', "selectTool must be exported");
assert.strictEqual(typeof tools.switchToolTab, 'function', "switchToolTab must be exported");
assert.strictEqual(typeof tools.updateToolTabStates, 'function', "updateToolTabStates must be exported");
assert.strictEqual(typeof tools.setTerrainBrushRadius, 'function', "setTerrainBrushRadius must be exported");
assert.strictEqual(typeof tools.initToolsUI, 'function', "initToolsUI must be exported");
assert.ok(tools.TOOL_BUTTON_MAP, "TOOL_BUTTON_MAP must be exported");
assert.strictEqual(Object.isFrozen(tools.TOOL_BUTTON_MAP), true, "TOOL_BUTTON_MAP must be frozen");
console.log("  ✔ Module interface and frozen static dictionary verified cleanly!\n");

// -------------------------------------------------------------
// TEST 2: Tool Selection & UI Synchronization
// -------------------------------------------------------------
console.log("▶ TEST 2: Tool Selection & UI Synchronization");
window.TileWeaver.stateModule.initMapData();
tools.initToolsUI();

tools.selectTool('paint');
assert.strictEqual(state.currentTool, 'paint', "state.currentTool must be 'paint'");
assert.strictEqual(document.getElementById('tool-paint').classList.contains('btn-tool-active'), true);
assert.strictEqual(document.getElementById('active-tool-badge').textContent, 'Brush [P]');

tools.selectTool('terrain');
assert.strictEqual(state.currentTool, 'terrain', "state.currentTool must be 'terrain'");
assert.strictEqual(document.getElementById('tool-terrain').classList.contains('btn-toggle-active'), true);
assert.strictEqual(document.getElementById('tool-paint').classList.contains('btn-tool-active'), false);
assert.strictEqual(document.getElementById('active-tool-badge').textContent, 'Terrain Brush [T]');
console.log("  ✔ Tool selection, toggle styling, and badge text verified!\n");

// -------------------------------------------------------------
// TEST 3: Terrain Brush Radius Clamping & Sanitization
// -------------------------------------------------------------
console.log("▶ TEST 3: Terrain Brush Radius Clamping & Sanitization");
tools.setTerrainBrushRadius(1);
assert.strictEqual(state.terrainBrushRadius, 1);
assert.strictEqual(document.getElementById('btn-radius-1').classList.contains('bg-teal-600'), true);

tools.setTerrainBrushRadius(3);
assert.strictEqual(state.terrainBrushRadius, 3);
assert.strictEqual(document.getElementById('btn-radius-3').classList.contains('bg-teal-600'), true);

// Boundary clamping
tools.setTerrainBrushRadius(99);
assert.strictEqual(state.terrainBrushRadius, 3, "Radius > 3 must clamp to 3");

tools.setTerrainBrushRadius(0);
assert.strictEqual(state.terrainBrushRadius, 1, "Radius < 1 must clamp to 1");

tools.setTerrainBrushRadius('invalid');
assert.strictEqual(state.terrainBrushRadius, 1, "Invalid string must fallback to 1");
console.log("  ✔ Radius setting and defensive clamping [1, 3] verified!\n");

// -------------------------------------------------------------
// TEST 4: Tab Context Locking (Tile Layer vs Object Layer)
// -------------------------------------------------------------
console.log("▶ TEST 4: Tab Context Locking (Tile Layer vs Object Layer)");
// Tile context
state.activeLayerIndex = 0; // tilelayer
tools.updateToolTabStates();
const drawTab = document.getElementById('tool-tab-draw');
const objectTab = document.getElementById('tool-tab-object');
assert.strictEqual(drawTab.hasAttribute('disabled'), false, "Draw tab must be enabled in tile context");
assert.strictEqual(objectTab.hasAttribute('disabled'), true, "Object tab must be disabled in tile context");

// Switch to object group layer
const objLayer = window.TileWeaver.stateModule.createNewLayerObject("Object Layer", "objectgroup");
state.mapLayers.push(objLayer);
state.activeLayerIndex = state.mapLayers.length - 1;
tools.updateToolTabStates();
assert.strictEqual(drawTab.hasAttribute('disabled'), true, "Draw tab must be disabled in object context");
assert.strictEqual(objectTab.hasAttribute('disabled'), false, "Object tab must be enabled in object context");
console.log("  ✔ Tab context locking across tile and object layers verified!\n");

// -------------------------------------------------------------
// TEST 5: Global Keyboard Shortcuts & Modal Shielding
// -------------------------------------------------------------
console.log("▶ TEST 5: Global Keyboard Shortcuts & Modal Shielding");
const keydownHandlers = globalEventListeners['keydown'] || [];
assert.ok(keydownHandlers.length > 0, "Keydown listeners must be registered");

function dispatchKey(key, code = null, ctrl = false, shift = false, repeat = false) {
    const event = {
        key,
        code: code || key,
        ctrlKey: ctrl,
        metaKey: false,
        shiftKey: shift,
        altKey: false,
        repeat,
        preventDefault: () => {}
    };
    keydownHandlers.forEach(h => h(event));
}

// Press 'e' -> Eraser
dispatchKey('e', 'KeyE');
assert.strictEqual(state.currentTool, 'erase', "Key 'e' must switch tool to erase");

// Press 'p' -> Paint
dispatchKey('p', 'KeyP');
assert.strictEqual(state.currentTool, 'paint', "Key 'p' must switch tool to paint");

// Simulate Modal Dialog Open
activeModalOverlay = { className: 'modal-overlay' };
dispatchKey('e', 'KeyE');
assert.strictEqual(state.currentTool, 'paint', "Shortcuts must be shielded and ignored when modal is open");

// Close Modal Dialog
activeModalOverlay = null;
dispatchKey('e', 'KeyE');
assert.strictEqual(state.currentTool, 'erase', "Shortcuts must resume when modal is closed");
console.log("  ✔ Keyboard hotkeys and modal shielding verified!\n");

// -------------------------------------------------------------
// TEST 6: Spacebar Pan Mode & Auto-Repeat Protection
// -------------------------------------------------------------
console.log("▶ TEST 6: Spacebar Pan Mode & Auto-Repeat Protection");
const keyupHandlers = globalEventListeners['keyup'] || [];

// Initial Space press
state.isSpacePressed = false;
dispatchKey(' ', 'Space', false, false, false);
assert.strictEqual(state.isSpacePressed, true, "Space press must engage isSpacePressed");

// Space auto-repeat (should return early without re-mutating)
dispatchKey(' ', 'Space', false, false, true);
assert.strictEqual(state.isSpacePressed, true);

// Keyup Space
keyupHandlers.forEach(h => h({ code: 'Space', shiftKey: false }));
assert.strictEqual(state.isSpacePressed, false, "Space release must reset isSpacePressed");
assert.strictEqual(state.isPanning, false, "Space release must reset isPanning");
console.log("  ✔ Spacebar pan mode and auto-repeat guard verified!\n");

console.log("===============================================================");
console.log("🎉 ALL DRAWING TOOLS & INPUT DISPATCHER TESTS PASSED (6/6)!");
console.log("===============================================================\n");
