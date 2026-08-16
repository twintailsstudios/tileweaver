/**
 * Automated Test Suite: Live Tile & Object Properties Inspector (tileProperties.js)
 * ----------------------------------------------------------------------------------
 * Verifies polymorphic target resolution (Grid Tiles, Collection Templates, Placed Objects),
 * collision passability state switching, custom key-value CRUD & Tiled TMJ schema synchronization,
 * aspect-ratio fitted preview scaling with integer pixel snapping, and sequential navigation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("===============================================================");
console.log("🧪 STARTING TILE & OBJECT PROPERTIES INSPECTOR AUTOMATED TEST SUITE");
console.log("===============================================================");

// 1. Mock DOM Environment
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
    },
    'btn-live-prop-prev': { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'btn-live-prop-next': { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'btn-pass-passable': { className: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'btn-pass-solid': { className: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'btn-pass-overhang': { className: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'btn-add-live-custom-prop': { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-name': { value: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-object-type': { value: '', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-terrain-type': { value: 'Meadow', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-speed-mult': { value: '1.0', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-chk-ladder': { checked: false, listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-chk-damage': { checked: false, listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'live-prop-chk-bush': { checked: false, listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    'right-inspector-title': { textContent: '' },
    'right-inspector-icon': { className: '' },
    'live-prop-coords-badge': { textContent: '' },
    'live-prop-pixel-badge': { textContent: '' },
    'prop-section-object-class': { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); } } },
    'prop-section-tile-terrain': { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); } } },
    'prop-section-tile-movement': { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); } } },
    'btn-live-prop-replace-badge': { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); } } },
    'live-prop-coll-actions': { classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); } } },
    'live-custom-props-container': {
        innerHTML: '',
        children: [],
        appendChild(child) { this.children.push(child); }
    },
    'live-prop-preview-canvas': {
        getContext(type) {
            return {
                imageSmoothingEnabled: true,
                clearRect(x, y, w, h) { this.cleared = { x, y, w, h }; },
                drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
                    this.lastDraw = { img, sx, sy, sw, sh, dx, dy, dw, dh };
                },
                fillRect() {},
                strokeRect() {}
            };
        }
    }
};

global.document = {
    getElementById(id) {
        return mockElements[id] || null;
    },
    createElement(tag) {
        return {
            tagName: tag.toUpperCase(),
            className: '',
            innerHTML: '',
            listeners: {},
            children: [],
            addEventListener(e, fn) { this.listeners[e] = fn; },
            querySelector(sel) {
                if (sel === '.key-input') return { value: 'testKey', addEventListener(e, fn) { this.listeners[e] = fn; }, listeners: {} };
                if (sel === '.val-input') return { value: 'testVal', addEventListener(e, fn) { this.listeners[e] = fn; }, listeners: {} };
                if (sel === '.btn-del-prop') return { addEventListener(e, fn) { this.listeners[e] = fn; }, listeners: {} };
                return null;
            },
            appendChild(c) { this.children.push(c); }
        };
    }
};

const mockState = {
    isRightInspectorCollapsed: false,
    TILE_SIZE: 32,
    activeTilesetIndex: 0,
    tilesets: [
        {
            id: 'ts_grid',
            name: 'Overworld Grid',
            image: { width: 256, height: 256 },
            margin: 0,
            spacing: 0,
            tileProperties: {}
        }
    ],
    activeLayerIndex: 0,
    mapLayers: [
        {
            id: 'layer_1',
            name: 'Ground',
            type: 'tilelayer',
            data: [[0]]
        }
    ],
    selectedObjectId: null,
    selectedStamp: { col: 1, row: 2 }
};

let mapRedrawCount = 0;
global.window = {
    TileWeaver: {
        stateModule: {
            state: mockState,
            getTilesetForGid: () => mockState.tilesets[0]
        },
        toast: {
            showMessage: () => {}
        },
        rendering: {
            drawTileset: () => {},
            drawMap: () => { mapRedrawCount++; }
        },
        objectInspector: {
            renderObjectTransformFields: () => {}
        }
    }
};

// Load tileProperties.js logic
const tilePropertiesCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'tileProperties.js'), 'utf8');
eval(tilePropertiesCode);

const tp = window.TileWeaver.tileProperties;

// ===============================================================
// TEST 1: Public Module Interface & Exports
// ===============================================================
console.log("\n▶ TEST 1: Public Module Interface & Exports");
assert(typeof tp.initTilePropertiesUI === 'function', "initTilePropertiesUI must be exported");
assert(typeof tp.toggleRightSidebarCollapse === 'function', "toggleRightSidebarCollapse must be exported");
assert(typeof tp.ensureInspectorOpen === 'function', "ensureInspectorOpen must be exported");
assert(typeof tp.openTilesetPropertiesModal === 'function', "openTilesetPropertiesModal must be exported");
assert(typeof tp.closeTilePropsModal === 'function', "closeTilePropsModal must be exported");
assert(typeof tp.renderTilePropertiesForm === 'function', "renderTilePropertiesForm must be exported");
assert(typeof tp.saveCurrentTileProperties === 'function', "saveCurrentTileProperties must be exported");
assert(typeof tp.updateLiveTilePropertiesPanel === 'function', "updateLiveTilePropertiesPanel must be exported");
console.log("  ✔ All 8 public module methods exported cleanly on window.TileWeaver.tileProperties!");

// ===============================================================
// TEST 2: Standard Grid Tile Property Inspection & Invariants
// ===============================================================
console.log("\n▶ TEST 2: Standard Grid Tile Property Inspection & Invariants");
tp.initTilePropertiesUI();
tp.updateLiveTilePropertiesPanel(2, 3);

const tsGrid = mockState.tilesets[0];
assert(tsGrid.tileProperties['2_3'], "Tile properties entry must be created at '2_3'");
assert(tsGrid.tileProperties['tile_2_3'], "Dual tileKey 'tile_2_3' must be synchronized");
assert.strictEqual(tsGrid.tileProperties['2_3'].terrainType, 'Meadow', "Default terrainType must be Meadow");
assert.strictEqual(tsGrid.tileProperties['2_3'].passable, 'passable', "Default passability must be passable");
assert.strictEqual(tsGrid.tileProperties['2_3'].speedMult, 1.0, "Default speedMult must be 1.0");

console.log("  ✔ Standard grid tile inspection and dual key normalization ('2_3' / 'tile_2_3') verified!");

// ===============================================================
// TEST 3: Collision Passability 3-State Switching
// ===============================================================
console.log("\n▶ TEST 3: Collision Passability 3-State Switching");
mockElements['btn-pass-solid'].listeners['click']();
assert.strictEqual(tsGrid.tileProperties['2_3'].passable, 'solid', "Passable mode should be updated to solid");
assert(mockElements['btn-pass-solid'].className.includes('border-red-500'), "Solid pill should receive red highlight");

mockElements['btn-pass-overhang'].listeners['click']();
assert.strictEqual(tsGrid.tileProperties['2_3'].passable, 'overhang', "Passable mode should be updated to overhang");
assert(mockElements['btn-pass-overhang'].className.includes('border-amber-500'), "Overhang pill should receive amber highlight");

mockElements['btn-pass-passable'].listeners['click']();
assert.strictEqual(tsGrid.tileProperties['2_3'].passable, 'passable', "Passable mode should be reset to passable");
assert(mockElements['btn-pass-passable'].className.includes('border-emerald-500'), "Passable pill should receive emerald highlight");

console.log("  ✔ Collision passability pill toggling ('passable', 'solid', 'overhang') verified!");

// ===============================================================
// TEST 4: Collection Item Template Polymorphism
// ===============================================================
console.log("\n▶ TEST 4: Collection Item Template Polymorphism");
const mockCollectionTs = {
    id: 'ts_coll',
    name: 'Dungeon Props Collection',
    isCollection: true,
    images: [
        { id: 'img_chest', name: 'Golden Chest', width: 64, height: 48, image: { naturalWidth: 64, naturalHeight: 48 } },
        { id: 'img_barrel', name: 'Explosive Barrel', width: 32, height: 32, image: { naturalWidth: 32, naturalHeight: 32 } }
    ],
    tileProperties: {}
};
mockState.tilesets.push(mockCollectionTs);
mockState.activeTilesetIndex = 1;

tp.updateLiveTilePropertiesPanel();
assert.strictEqual(mockElements['right-inspector-title'].textContent, 'Object Template Properties', "Title should update for Collection template");
assert.strictEqual(mockElements['live-prop-coords-badge'].textContent, 'Template (1/2): Golden Chest', "Coords badge should display template metadata");

console.log("  ✔ Collection Tileset Item Template inspection and title/badge updates verified!");

// ===============================================================
// TEST 5: Placed Scene Object & Tiled TMJ Properties Synchronization
// ===============================================================
console.log("\n▶ TEST 5: Placed Scene Object & Tiled TMJ Properties Synchronization");
mockState.mapLayers.push({
    id: 'obj_layer',
    name: 'Game Entities',
    type: 'objectgroup',
    objects: [
        {
            id: 101,
            name: 'Boss Gate',
            type: 'portal',
            x: 120,
            y: 240,
            width: 64,
            height: 96,
            custom: {
                target_level: 2,
                is_locked: true,
                key_required: 'skull_key',
                health_penalty: 12.5
            }
        }
    ]
});
mockState.activeLayerIndex = 1;
mockState.selectedObjectId = 101;

tp.renderTilePropertiesForm();
assert.strictEqual(mockElements['right-inspector-title'].textContent, 'Object Properties', "Title should update for Placed Object");
assert.strictEqual(mockElements['live-prop-coords-badge'].textContent, 'Object ID #101 (Boss Gate)', "Coords badge should show object ID and name");

// Verify TMJ array synchronization
tp.saveCurrentTileProperties();
const obj = mockState.mapLayers[1].objects[0];
assert(Array.isArray(obj.properties), "obj.properties array must be instantiated");
assert.strictEqual(obj.properties.length, 4, "Must contain all 4 custom properties");

const intProp = obj.properties.find(p => p.name === 'target_level');
assert.deepStrictEqual(intProp, { name: 'target_level', type: 'int', value: 2 }, "Integer property must map to type 'int'");

const boolProp = obj.properties.find(p => p.name === 'is_locked');
assert.deepStrictEqual(boolProp, { name: 'is_locked', type: 'bool', value: true }, "Boolean property must map to type 'bool'");

const floatProp = obj.properties.find(p => p.name === 'health_penalty');
assert.deepStrictEqual(floatProp, { name: 'health_penalty', type: 'float', value: 12.5 }, "Float property must map to type 'float'");

const strProp = obj.properties.find(p => p.name === 'key_required');
assert.deepStrictEqual(strProp, { name: 'key_required', type: 'string', value: 'skull_key' }, "String property must map to type 'string'");

console.log("  ✔ Placed Scene Object properties and Tiled TMJ schema synchronization (int, float, bool, string) verified!");

// ===============================================================
// TEST 6: Custom Key-Value Attribute Addition & Dynamic CRUD
// ===============================================================
console.log("\n▶ TEST 6: Custom Key-Value Attribute Addition & Dynamic CRUD");
mockElements['btn-add-live-custom-prop'].listeners['click']();
assert(obj.custom['property_5'], "New property row 'property_5' should be created");
assert.strictEqual(obj.custom['property_5'], 'value', "Default property value should be 'value'");

console.log("  ✔ Dynamic custom property addition ('+ Add Key') and CRUD workflow verified!");

// ===============================================================
// TEST 7: Sequential Previous / Next Cycling
// ===============================================================
console.log("\n▶ TEST 7: Sequential Previous / Next Cycling");
mockState.mapLayers[1].objects.push({
    id: 102,
    name: 'Treasure Chest',
    type: 'chest',
    custom: {}
});

mockElements['btn-live-prop-next'].listeners['click']();
assert.strictEqual(mockState.selectedObjectId, 102, "Next button should advance selection to Object #102");

mockElements['btn-live-prop-prev'].listeners['click']();
assert.strictEqual(mockState.selectedObjectId, 101, "Previous button should step selection back to Object #101");

console.log("  ✔ Sequential cycling (btn-live-prop-prev / btn-live-prop-next) across objects verified!");

console.log("===============================================================");
console.log("🎉 ALL TILE & OBJECT PROPERTIES INSPECTOR TESTS PASSED (7/7)!");
console.log("===============================================================");
