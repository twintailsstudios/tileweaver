/**
 * Test: Right Inspector Panel Collapse / Expand Behavior
 * --------------------------------------------------------
 * Verifies that collapsing and expanding the right Tile Properties dock
 * keeps the toggle arrow button visible, functional, and responsive.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("===============================================================");
console.log("🧪 STARTING RIGHT INSPECTOR COLLAPSE / EXPAND VERIFICATION");
console.log("===============================================================");

// 1. Verify index.html markup
const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

assert(html.includes('id="right-inspector-panel"'), "index.html must contain #right-inspector-panel");
assert(html.includes('id="right-inspector-header"'), "index.html must contain #right-inspector-header");
assert(html.includes('id="btn-toggle-right-sidebar"'), "index.html must contain #btn-toggle-right-sidebar");
assert(html.includes('id="right-sidebar-toggle-icon"'), "index.html must contain #right-sidebar-toggle-icon");
assert(html.includes('id="right-inspector-title-container"'), "index.html must contain #right-inspector-title-container");
assert(html.includes('id="right-inspector-nav-controls"'), "index.html must contain #right-inspector-nav-controls");

// Check that title and nav controls have hide-on-collapse
const titleMatch = html.match(/id="right-inspector-title-container"[^>]*class="([^"]*)"/);
assert(titleMatch && titleMatch[1].includes('hide-on-collapse'), "#right-inspector-title-container must have hide-on-collapse class");

const navMatch = html.match(/id="right-inspector-nav-controls"[^>]*class="([^"]*)"/);
assert(navMatch && navMatch[1].includes('hide-on-collapse'), "#right-inspector-nav-controls must have hide-on-collapse class");

console.log("✔ 1. HTML Markup & hide-on-collapse classes verified!");

// 2. Verify CSS styles
const cssPath = path.join(__dirname, '..', 'css', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

assert(css.includes('.right-inspector-panel.right-sidebar-collapsed'), "css must contain .right-inspector-panel.right-sidebar-collapsed");
assert(css.includes('.right-inspector-panel.right-sidebar-collapsed #right-inspector-header'), "css must contain collapsed header centering style");
assert(css.includes('.right-inspector-panel.right-sidebar-collapsed .hide-on-collapse'), "css must contain collapsed hide-on-collapse style");

console.log("✔ 2. CSS Stylesheet rules verified!");

// 3. Mock DOM and dependencies
const mockElements = {
    'right-inspector-panel': {
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
        }
    },
    'right-sidebar-toggle-icon': { className: 'ph ph-caret-right' },
    'btn-toggle-right-sidebar': { title: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'right-inspector-header': { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'right-inspector-body': {
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
        }
    }
};

global.document = {
    getElementById(id) {
        return mockElements[id] || null;
    }
};

const mockState = {
    isRightInspectorCollapsed: false,
    tilesets: [{ tileProperties: {} }],
    activeTilesetIndex: 0,
    mapLayers: [],
    activeLayerIndex: 0
};

global.window = {
    TileWeaver: {
        stateModule: {
            state: mockState
        },
        toast: {
            showMessage: () => {}
        },
        rendering: {
            drawTileset: () => {},
            drawMap: () => {}
        }
    }
};

// Load tileProperties.js logic
const tilePropertiesCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'tileProperties.js'), 'utf8');
eval(tilePropertiesCode);

const tp = window.TileWeaver.tileProperties;
assert(typeof tp.toggleRightSidebarCollapse === 'function', "toggleRightSidebarCollapse must be exposed on tileProperties");

// Test Collapse
tp.toggleRightSidebarCollapse();
assert.strictEqual(mockState.isRightInspectorCollapsed, true, "State should be collapsed");
assert(mockElements['right-inspector-panel'].classList.contains('right-sidebar-collapsed'), "Panel must have right-sidebar-collapsed class");
assert(mockElements['right-inspector-body'].classList.contains('hidden'), "Body must have hidden class");
assert.strictEqual(mockElements['right-sidebar-toggle-icon'].className, 'ph ph-caret-left', "Icon should be caret-left when collapsed");
assert.strictEqual(mockElements['btn-toggle-right-sidebar'].title, 'Expand Live Properties Inspector', "Button title should prompt expand");

console.log("✔ 3. Collapse action state, CSS class, and icon toggling verified!");

// Test Expand
tp.toggleRightSidebarCollapse();
assert.strictEqual(mockState.isRightInspectorCollapsed, false, "State should be expanded");
assert(!mockElements['right-inspector-panel'].classList.contains('right-sidebar-collapsed'), "Panel must not have right-sidebar-collapsed class");
assert(!mockElements['right-inspector-body'].classList.contains('hidden'), "Body must not have hidden class");
assert.strictEqual(mockElements['right-sidebar-toggle-icon'].className, 'ph ph-caret-right', "Icon should be caret-right when expanded");
assert.strictEqual(mockElements['btn-toggle-right-sidebar'].title, 'Collapse Live Properties Inspector', "Button title should prompt collapse");

console.log("✔ 4. Expand action state, CSS class, and icon toggling verified!");

// Test Event Listener bindings
tp.initTilePropertiesUI();

// Trigger click on toggle button
mockElements['btn-toggle-right-sidebar'].listeners['click']({ stopPropagation: () => {} });
assert.strictEqual(mockState.isRightInspectorCollapsed, true, "Clicking toggle button should collapse panel");

// Trigger click on collapsed header
mockElements['right-inspector-header'].listeners['click']({ target: { closest: () => null } });
assert.strictEqual(mockState.isRightInspectorCollapsed, false, "Clicking collapsed header should expand panel");

console.log("✔ 5. Event listener interactions verified!");

console.log("===============================================================");
console.log("🎉 ALL RIGHT INSPECTOR COLLAPSE / EXPAND TESTS PASSED!");
console.log("===============================================================");
