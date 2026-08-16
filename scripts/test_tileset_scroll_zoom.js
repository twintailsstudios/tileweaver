/**
 * TileWeaver - Tileset Scroll & Ctrl-Zoom Event Isolation Test Suite
 * -----------------------------------------------------------------------
 * Verifies:
 * 1. Scrolling wheel over the map zooms the map without affecting tileset zoom.
 * 2. Scrolling wheel over the tileset inspector (without Ctrl) preserves natural
 *    scrolling and NEVER triggers map zoom (map remains static).
 * 3. Holding Ctrl and scrolling wheel inside the tileset inspector ONLY zooms
 *    the tileset palette itself and NEVER triggers map zoom (map remains static).
 */

const assert = require('assert');
const { createCanvas } = require('@napi-rs/canvas');

// Build mock DOM environment with event dispatching and propagation support
const listeners = new Map();
const elements = new Map();

function createMockElement(id, parentId = null) {
    const el = {
        id,
        parentId,
        dataset: {},
        scrollLeft: 0,
        scrollTop: 0,
        scrollWidth: 1000,
        clientWidth: 500,
        scrollHeight: 1000,
        clientHeight: 500,
        style: {},
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => {}
        },
        innerHTML: '',
        value: '',
        textContent: '',
        appendChild: () => {},
        querySelector: () => createMockElement('sub_' + Math.random()),
        querySelectorAll: () => [],
        setAttribute: () => {},
        removeAttribute: () => {},
        closest: (selector) => {
            const clean = selector.replace('#', '').replace('.', '');
            if (id === clean) return el;
            if (parentId && elements.has(parentId)) {
                return elements.get(parentId).closest(selector);
            }
            return null;
        },
        addEventListener: (event, handler) => {
            const key = `${id}:${event}`;
            if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(handler);
        },
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 800,
            height: 600,
            right: 800,
            bottom: 600
        }),
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
            measureText: () => ({ width: 0 })
        })
    };
    elements.set(id, el);
    return el;
}

// Set up hierarchy:
// map-container
//   -> canvas-wrapper -> map-canvas
//   -> dock-tileset-panel
//        -> dock-tileset-container -> dock-tileset-canvas
//        -> dock-collection-grid
createMockElement('map-container', null);
createMockElement('canvas-wrapper', 'map-container');
createMockElement('map-canvas', 'canvas-wrapper');
createMockElement('dock-tileset-panel', 'map-container');
createMockElement('dock-tileset-container', 'dock-tileset-panel');
createMockElement('dock-tileset-canvas', 'dock-tileset-container');
createMockElement('dock-collection-grid', 'dock-tileset-panel');
createMockElement('contextual-viewport-hud', 'map-container');
createMockElement('tileset-container', null);
createMockElement('popout-tileset-container', null);
createMockElement('popout-collection-grid', null);

global.window = {
    addEventListener: () => {}
};
global.document = {
    getElementById: (id) => elements.get(id) || createMockElement(id, null),
    querySelectorAll: () => [],
    createElement: (tag) => {
        if (tag === 'canvas') return createCanvas(160, 160);
        return createMockElement('temp_' + Math.random());
    },
    addEventListener: () => {}
};
global.Image = function(w = 160, h = 160) {
    const canvas = createCanvas(w, h);
    canvas.naturalWidth = w;
    canvas.naturalHeight = h;
    let _src = '';
    Object.defineProperty(canvas, 'src', {
        get: () => _src,
        set: (v) => {
            _src = v;
            setTimeout(() => { if (canvas.onload) canvas.onload(); }, 2);
        }
    });
    return canvas;
};

// Dispatch synthetic wheel event through DOM tree simulation
function dispatchWheelEvent(targetId, { deltaY = 100, deltaX = 0, ctrlKey = false, metaKey = false, shiftKey = false }) {
    let propagationStopped = false;
    let defaultPrevented = false;

    const event = {
        target: elements.get(targetId),
        deltaY,
        deltaX,
        ctrlKey,
        metaKey,
        shiftKey,
        stopPropagation: () => { propagationStopped = true; },
        preventDefault: () => { defaultPrevented = true; }
    };

    let curr = elements.get(targetId);
    while (curr && !propagationStopped) {
        const key = `${curr.id}:wheel`;
        if (listeners.has(key)) {
            listeners.get(key).forEach(handler => handler(event));
        }
        if (propagationStopped) break;
        curr = curr.parentId ? elements.get(curr.parentId) : null;
    }

    return { propagationStopped, defaultPrevented };
}

// Load Modules
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/autotile.js');
require('../js/engine/rendering.js');
require('../js/engine/exportImport.js');
require('../js/ui/viewport.js');
require('../js/ui/tilesetManager.js');

const { state } = window.TileWeaver.stateModule;

async function runTests() {
    console.log('--- STARTING TILESET SCROLL & CTRL-ZOOM ISOLATION TESTS ---');

    // Initialize event listeners
    window.TileWeaver.viewport.initViewportUI();
    await window.TileWeaver.tilesetManager.initTilesetsUI();

    // 1. Test Wheel over Map Canvas (Mouse hovering over map)
    console.log('1. Testing mouse wheel over Map Canvas...');
    state.zoomLevel = 1.0;
    state.tilesetZoom = 1.0;

    dispatchWheelEvent('map-canvas', { deltaY: -100, ctrlKey: false });
    console.log(`   After wheel on map (deltaY < 0): map zoom = ${state.zoomLevel}x, tileset zoom = ${state.tilesetZoom}x`);
    assert.strictEqual(state.zoomLevel, 1.1, 'Map zoom should increase when scrolling over map canvas');
    assert.strictEqual(state.tilesetZoom, 1.0, 'Tileset zoom must remain unchanged when scrolling over map canvas');

    dispatchWheelEvent('map-canvas', { deltaY: 100, ctrlKey: false });
    console.log(`   After wheel on map (deltaY > 0): map zoom = ${state.zoomLevel}x, tileset zoom = ${state.tilesetZoom}x`);
    assert.strictEqual(state.zoomLevel, 1.0, 'Map zoom should return to 1.0');
    assert.strictEqual(state.tilesetZoom, 1.0, 'Tileset zoom must remain unchanged');
    console.log('✅ Map canvas wheel zooming verified.');

    // 2. Test Wheel over Tileset Inspector WITHOUT Ctrl (Normal Scrolling)
    console.log('2. Testing normal mouse wheel over Tileset Inspector (dock-tileset-container)...');
    state.zoomLevel = 1.0;
    state.tilesetZoom = 1.0;

    const normalScrollRes = dispatchWheelEvent('dock-tileset-canvas', { deltaY: 100, ctrlKey: false });
    console.log(`   After normal wheel inside inspector: map zoom = ${state.zoomLevel}x, tileset zoom = ${state.tilesetZoom}x, stopped = ${normalScrollRes.propagationStopped}, prevented = ${normalScrollRes.defaultPrevented}`);
    assert.strictEqual(state.zoomLevel, 1.0, 'Map zoom MUST NOT CHANGE when scrolling over tileset inspector!');
    assert.strictEqual(state.tilesetZoom, 1.0, 'Tileset zoom MUST NOT CHANGE on normal scroll (only Ctrl+wheel zooms)');
    assert.strictEqual(normalScrollRes.propagationStopped, true, 'Event propagation MUST be stopped to protect map');
    assert.strictEqual(normalScrollRes.defaultPrevented, false, 'Default scroll MUST NOT be prevented on vertical scrollable container');
    console.log('✅ Tileset inspector normal scrolling isolation verified.');

    // 3. Test Ctrl + Wheel over Tileset Inspector (Ctrl-Zoom inside Tileset)
    console.log('3. Testing Ctrl + mouse wheel over Tileset Inspector (dock-tileset-container)...');
    state.zoomLevel = 1.0;
    state.tilesetZoom = 1.0;

    const ctrlZoomInRes = dispatchWheelEvent('dock-tileset-canvas', { deltaY: -100, ctrlKey: true });
    console.log(`   After Ctrl+wheel zoom-in inside inspector: map zoom = ${state.zoomLevel}x, tileset zoom = ${state.tilesetZoom}x, stopped = ${ctrlZoomInRes.propagationStopped}, prevented = ${ctrlZoomInRes.defaultPrevented}`);
    assert.strictEqual(state.zoomLevel, 1.0, 'Map zoom MUST REMAIN STATIC when Ctrl-zooming in tileset inspector!');
    assert.strictEqual(state.tilesetZoom, 1.25, 'Tileset zoom must increase with Ctrl+wheel in inspector');
    assert.strictEqual(ctrlZoomInRes.propagationStopped, true, 'Event propagation must be stopped');
    assert.strictEqual(ctrlZoomInRes.defaultPrevented, true, 'Browser page zoom must be prevented');

    const ctrlZoomOutRes = dispatchWheelEvent('dock-tileset-canvas', { deltaY: 100, ctrlKey: true });
    console.log(`   After Ctrl+wheel zoom-out inside inspector: map zoom = ${state.zoomLevel}x, tileset zoom = ${state.tilesetZoom}x`);
    assert.strictEqual(state.zoomLevel, 1.0, 'Map zoom MUST REMAIN STATIC!');
    assert.strictEqual(state.tilesetZoom, 1.0, 'Tileset zoom must decrease back to 1.0');
    console.log('✅ Ctrl+Wheel tileset zooming isolation verified.');

    // 4. Test Collection Grid Horizontal Wheel Translation
    console.log('4. Testing normal mouse wheel over horizontal Collection Grid...');
    const collGrid = elements.get('dock-collection-grid');
    collGrid.scrollWidth = 1200;
    collGrid.clientWidth = 600;
    collGrid.scrollHeight = 100;
    collGrid.clientHeight = 100;
    collGrid.scrollLeft = 0;

    dispatchWheelEvent('dock-collection-grid', { deltaY: 80, ctrlKey: false });
    console.log(`   Collection grid scrollLeft after vertical wheel = ${collGrid.scrollLeft}px, map zoom = ${state.zoomLevel}x`);
    assert.strictEqual(collGrid.scrollLeft, 80, 'Vertical wheel should translate to horizontal scroll on horizontal grid');
    assert.strictEqual(state.zoomLevel, 1.0, 'Map zoom MUST remain static');
    console.log('✅ Collection grid horizontal wheel scrolling verified.');

    console.log('🎉 ALL TILESET SCROLL & CTRL-ZOOM ISOLATION TESTS PASSED PERFECTLY!');
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
