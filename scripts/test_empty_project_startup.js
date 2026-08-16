/**
 * Automated Verification Test: Clean Empty Project Startup in TileWeaver
 * ---------------------------------------------------------------------------
 * Verifies that when TileWeaver launches / bootstraps:
 * 1. state.tilesets is empty (length === 0)
 * 2. state.assets is empty (length === 0)
 * 3. state.autotiles is empty (length === 0)
 * 4. state.animatedTiles is empty (length === 0)
 * 5. state.materials is empty (length === 0)
 * 6. UI controls (tileset select, asset count badge, material swatches) cleanly show empty states.
 * 7. Tileset palette canvas and map canvas render without errors or exceptions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

console.log("===============================================================");
console.log("🧪 STARTING EMPTY PROJECT STARTUP VERIFICATION TEST");
console.log("===============================================================\n");

// 1. Setup mock DOM and browser globals
const domElements = {};

function createMockElement(id, tag = 'div') {
    const el = {
        id: id,
        tagName: tag.toUpperCase(),
        value: '',
        textContent: '',
        innerHTML: '',
        className: '',
        style: {},
        classList: {
            classes: new Set(),
            add: function(...cls) { cls.forEach(c => this.classes.add(c)); },
            remove: function(...cls) { cls.forEach(c => this.classes.delete(c)); },
            toggle: function(c, force) {
                if (force === undefined) {
                    if (this.classes.has(c)) this.classes.delete(c);
                    else this.classes.add(c);
                } else if (force) {
                    this.classes.add(c);
                } else {
                    this.classes.delete(c);
                }
            },
            contains: function(c) { return this.classes.has(c); }
        },
        children: [],
        appendChild: function(child) { this.children.push(child); return child; },
        addEventListener: function(event, handler) {},
        removeAttribute: function(attr) {},
        setAttribute: function(attr, val) {},
        hasAttribute: function(attr) { return false; },
        querySelector: function(sel) { return createMockElement('subelem_' + Math.random()); },
        querySelectorAll: function(sel) { return []; },
        focus: function() {},
        blur: function() {},
        getBoundingClientRect: function() { return { width: 320, height: 240, top: 0, left: 0, right: 320, bottom: 240 }; },
        scrollTo: function() {}
    };
    domElements[id] = el;
    return el;
}

global.window = {
    addEventListener: function() {},
    removeEventListener: function() {},
    requestAnimationFrame: function(fn) { return setTimeout(fn, 16); },
    cancelAnimationFrame: function(id) { clearTimeout(id); }
};
global.requestAnimationFrame = function(fn) { return setTimeout(fn, 16); };
global.cancelAnimationFrame = function(id) { clearTimeout(id); };
global.document = {
    readyState: 'complete',
    createElement: function(tag) {
        if (tag === 'canvas') {
            const canvas = createCanvas(240, 200);
            canvas.style = {};
            canvas.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
            canvas.addEventListener = function() {};
            canvas.removeEventListener = function() {};
            canvas.getBoundingClientRect = function() { return { width: 240, height: 200, top: 0, left: 0, right: 240, bottom: 200 }; };
            return canvas;
        }
        return createMockElement('elem_' + Math.random(), tag);
    },
    createDocumentFragment: function() {
        const frag = {
            children: [],
            appendChild: function(c) { this.children.push(c); return c; }
        };
        return frag;
    },
    getElementById: function(id) {
        if (!domElements[id]) {
            domElements[id] = createMockElement(id);
        }
        return domElements[id];
    },
    querySelectorAll: function(selector) {
        return [];
    },
    addEventListener: function() {},
    removeEventListener: function() {}
};

global.Image = function(w = 160, h = 160) {
    const canvas = createCanvas(w, h);
    canvas.naturalWidth = w;
    canvas.naturalHeight = h;
    canvas.addEventListener = function() {};
    canvas.removeEventListener = function() {};
    let _src = '';
    Object.defineProperty(canvas, 'src', {
        get: () => _src,
        set: (v) => {
            _src = v;
            setTimeout(() => { if (canvas.onload) canvas.onload(); }, 1);
        }
    });
    return canvas;
};

// Populate known DOM elements
const knownIds = [
    'tileset-select', 'popout-tileset-select', 'dock-tileset-select',
    'tileset-canvas', 'popout-tileset-canvas', 'dock-tileset-canvas',
    'map-canvas', 'map-container', 'tileset-container', 'popout-tileset-container', 'dock-tileset-container',
    'header-asset-count-badge', 'asset-manager-total-badge', 'asset-filter-count-all', 'asset-filter-count-inuse', 'asset-filter-count-unused',
    'swatch-total-count-badge', 'count-swatch-filter-all', 'count-swatch-filter-ground', 'count-swatch-filter-cliff', 'count-swatch-filter-wall',
    'terrain-swatches-grid', 'active-swatch-ribbon', 'collection-images-grid', 'dock-collection-grid', 'popout-collection-grid',
    'popout-tileset-name-badge', 'popout-tileset-dims', 'popout-hover-coord', 'popout-stamp-bounds',
    'collection-inspector-container', 'tileset-grid-config', 'dock-grid-metrics-group', 'popout-grid-metrics-group',
    'btn-extrude-dock', 'btn-make-anim-dock', 'btn-extrude-popout', 'btn-make-anim-popout',
    'dock-collection-actions', 'popout-collection-actions', 'live-prop-preview-canvas'
];
knownIds.forEach(id => {
    if (id.includes('canvas')) {
        domElements[id] = createCanvas(240, 200);
        domElements[id].id = id;
        domElements[id].style = {};
        domElements[id].classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
        domElements[id].addEventListener = function() {};
        domElements[id].removeEventListener = function() {};
        domElements[id].getBoundingClientRect = function() { return { width: 240, height: 200, top: 0, left: 0, right: 240, bottom: 200 }; };
    } else {
        createMockElement(id);
    }
});

// Load full modular runtime
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/rendering.js');
require('../js/engine/autotile.js');
require('../js/engine/extruder.js');
require('../js/engine/exportImport.js');
require('../js/ui/header.js');
require('../js/ui/tools.js');
require('../js/ui/tilesetManager.js');
require('../js/ui/terrainSwatches.js');
require('../js/ui/layerManager.js');
require('../js/ui/viewport.js');
require('../js/ui/autotileWizard.js');
require('../js/ui/tileProperties.js');
require('../js/ui/materialProperties.js');
require('../js/ui/objectInspector.js');
require('../js/ui/assetManager.js');
require('../js/ui/uploadWizard.js');
require('../js/ui/importWizard.js');
require('../js/app.js');

async function testCleanEmptyStartup() {
    console.log("▶ TEST 1: Launch & Bootstrap App");
    window.TileWeaver.app.resetBootstrapState();
    window.TileWeaver.app.bootstrapApp({ force: true });

    // Wait a tick for async initializations
    await new Promise(r => setTimeout(r, 50));

    const { state } = window.TileWeaver.stateModule;

    console.log("▶ TEST 2: Verify Empty Master State");
    assert.strictEqual(state.tilesets.length, 0, "state.tilesets MUST be empty (length === 0)");
    assert.strictEqual(state.assets.length, 0, "state.assets MUST be empty (length === 0)");
    assert.strictEqual(state.autotiles.length, 0, "state.autotiles MUST be empty (length === 0)");
    assert.strictEqual(state.animatedTiles.length, 0, "state.animatedTiles MUST be empty (length === 0)");
    assert.strictEqual(state.materials.length, 0, "state.materials MUST be empty (length === 0)");
    console.log("  ✔ state.tilesets = [], state.assets = [], state.autotiles = [], state.animatedTiles = [], state.materials = []");

    console.log("▶ TEST 3: Verify Empty UI Control States");
    const tsSelect = domElements['tileset-select'];
    assert.ok(tsSelect.children.length > 0, "Tileset select dropdown should have option element");
    assert.strictEqual(tsSelect.children[0].textContent, '-- No Tileset Loaded --', "Tileset select must display '-- No Tileset Loaded --'");

    const assetBadge = domElements['header-asset-count-badge'];
    assert.strictEqual(assetBadge.textContent, 0, "Header asset count badge must be 0");

    const popoutNameBadge = domElements['popout-tileset-name-badge'];
    assert.strictEqual(popoutNameBadge.textContent, 'No Tileset', "Popout name badge must be 'No Tileset'");

    const popoutDims = domElements['popout-tileset-dims'];
    assert.strictEqual(popoutDims.textContent, 'Dim: 0x0px', "Popout dims must be 'Dim: 0x0px'");

    console.log("  ✔ All UI selectors and badges accurately reflect empty project state.");

    console.log("▶ TEST 4: Verify Rendering Engine Safety with Empty State");
    assert.doesNotThrow(() => {
        window.TileWeaver.rendering.drawTileset();
        window.TileWeaver.rendering.drawMap();
    }, "drawTileset() and drawMap() must execute smoothly with zero exceptions on empty project");
    console.log("  ✔ Dual-canvas rendering completed with zero errors.");

    console.log("\n===============================================================");
    console.log("🎉 ALL EMPTY PROJECT STARTUP VERIFICATION TESTS PASSED (4/4)!");
    console.log("===============================================================\n");
    process.exit(0);
}

testCleanEmptyStartup().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
