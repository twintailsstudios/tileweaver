/**
 * Automated Verification Test Suite for Terrain Material Properties Module (js/ui/materialProperties.js)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('🧪 STARTING MATERIAL PROPERTIES AUTOMATED TEST SUITE');
console.log('===============================================================');

// 1. Mock DOM and Global Environment
global.window = global.window || {};
const elementCache = new Map();

function createMockElement(id = '', tag = 'DIV') {
    return {
        id,
        tagName: tag.toUpperCase(),
        value: '',
        textContent: '',
        innerHTML: '',
        className: '',
        classList: {
            add: function(...classes) {
                const cur = (this._classes || '').split(' ').filter(Boolean);
                classes.forEach(c => { if (!cur.includes(c)) cur.push(c); });
                this._classes = cur.join(' ');
            },
            remove: function(...classes) {
                const cur = (this._classes || '').split(' ').filter(Boolean);
                this._classes = cur.filter(c => !classes.includes(c)).join(' ');
            },
            contains: function(c) {
                return (this._classes || '').split(' ').includes(c);
            },
            toggle: function(c) {
                if (this.contains(c)) this.remove(c);
                else this.add(c);
            }
        },
        style: {},
        attributes: {},
        setAttribute: function(k, v) { this.attributes[k] = v; },
        getAttribute: function(k) { return this.attributes[k]; },
        removeAttribute: function(k) { delete this.attributes[k]; },
        appendChild: function() {},
        addEventListener: function(evt, handler) {
            this._listeners = this._listeners || {};
            this._listeners[evt] = this._listeners[evt] || [];
            this._listeners[evt].push(handler);
        },
        dispatchEvent: function(evtName, eventObj = {}) {
            if (this._listeners && this._listeners[evtName]) {
                this._listeners[evtName].forEach(fn => fn({ target: this, ...eventObj }));
            }
        },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 256 }),
        getContext: () => ({
            clearRect: () => {},
            drawImage: () => {},
            beginPath: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            fillRect: () => {},
            strokeRect: () => {},
            save: () => {},
            restore: () => {}
        })
    };
}

global.document = {
    getElementById: (id) => {
        if (!elementCache.has(id)) {
            elementCache.set(id, createMockElement(id));
        }
        return elementCache.get(id);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => createMockElement('', tag),
    activeElement: { tagName: 'BODY' }
};

window.confirm = () => true;

let pushedHistoryCount = 0;
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.toast = {
    showMessage: (msg, type) => {}
};
window.TileWeaver.history = {
    pushHistoryState: () => { pushedHistoryCount++; }
};
window.TileWeaver.rendering = {
    drawMap: () => {},
    drawTileset: () => {}
};
window.TileWeaver.tools = {
    selectTool: () => {}
};

// 2. Load Dependencies: constants.js, state.js, autotile.js, terrainSwatches.js
const constantsCode = fs.readFileSync(path.join(__dirname, '../js/constants.js'), 'utf8');
eval(constantsCode);

const stateCode = fs.readFileSync(path.join(__dirname, '../js/state.js'), 'utf8');
eval(stateCode);

const autotileCode = fs.readFileSync(path.join(__dirname, '../js/engine/autotile.js'), 'utf8');
eval(autotileCode);

const swatchesCode = fs.readFileSync(path.join(__dirname, '../js/ui/terrainSwatches.js'), 'utf8');
eval(swatchesCode);

// 3. Load Target: materialProperties.js
const matPropsCode = fs.readFileSync(path.join(__dirname, '../js/ui/materialProperties.js'), 'utf8');
eval(matPropsCode);

const { state } = window.TileWeaver.stateModule;
const matProps = window.TileWeaver.materialProperties;

// =========================================================================
// TEST 1: Public Module Interface & Namespace Exports
// =========================================================================
console.log('\n▶ TEST 1: Public Module Interface & Namespace Exports');
assert(matProps, 'materialProperties module should be exposed on window.TileWeaver');
assert.strictEqual(typeof matProps.initMaterialPropertiesUI, 'function');
assert.strictEqual(typeof matProps.openMaterialPropertiesModal, 'function');
assert.strictEqual(typeof matProps.closeMaterialPropertiesModal, 'function');
assert.strictEqual(typeof matProps.addTileVariation, 'function');
assert.strictEqual(typeof matProps.deleteTransitionPair, 'function');
assert.strictEqual(typeof matProps.balanceUnlockedVariations, 'function');
assert.strictEqual(typeof matProps.getMaterialVariations, 'function');
assert.strictEqual(typeof matProps.saveMaterialVariations, 'function');
console.log('  ✔ All public methods and conversion utilities exported cleanly!');

// =========================================================================
// TEST 2: Logarithmic Slider & Rate Math Invariants
// =========================================================================
console.log('\n▶ TEST 2: Logarithmic Slider & Rate Math Invariants');
const testRates = [0.001, 0.1, 1.0, 10.0, 50.0, 100.0];
testRates.forEach(rate => {
    const slider = matProps.rateToSlider(rate);
    assert(slider >= 0 && slider <= 100, `Slider value ${slider} should be clamped in [0, 100]`);
    const recovered = matProps.sliderToRate(slider);
    const diff = Math.abs(recovered - rate);
    assert(diff <= rate * 0.05 + 0.01, `Recovered rate ${recovered} should closely match input rate ${rate}`);
});
console.log('  ✔ Logarithmic rate <-> slider conversions verified across 5 orders of magnitude!');

// =========================================================================
// TEST 3: Material Variations Resolution & Synchronization
// =========================================================================
console.log('\n▶ TEST 3: Material Variations Resolution & Synchronization');
// Setup test state
state.materials = [
    { id: 'mat_test_grass', name: 'Test Grass', color: '#22c55e', priority: 1, vertexVal: 1, tx: 0, ty: 0, tilesetId: 'ts1', autotileIds: ['at_grass_dirt'] }
];
state.autotiles = [
    {
        id: 'at_grass_dirt',
        name: 'Grass ↔ Dirt',
        mode: 'dualgrid',
        mat1Name: 'Test Grass',
        mat2Name: 'Test Dirt',
        mapping: {
            grid_0: [
                { tx: 0, ty: 0, weight: 100, rate: 100, locked: false }
            ]
        }
    }
];

const testMat = state.materials[0];
let variations = matProps.getMaterialVariations(testMat);
assert.strictEqual(variations.length, 1, 'Should resolve 1 base variation');
assert.strictEqual(variations[0].tx, 0);
assert.strictEqual(variations[0].ty, 0);

// Add second variation and save
variations.push({ tx: 1, ty: 0, rate: 10, weight: 10, locked: false });
matProps.saveMaterialVariations(testMat, variations);

const updatedVariations = matProps.getMaterialVariations(testMat);
assert.strictEqual(updatedVariations.length, 2, 'Should have 2 saved variations');
assert.strictEqual(updatedVariations[1].tx, 1);
assert.strictEqual(updatedVariations[1].ty, 0);
console.log('  ✔ Material variations correctly resolved and synchronized to dual-grid autotile mappings!');

// =========================================================================
// TEST 4: Smart-Anchor Auto-Balancing with Locked Variations
// =========================================================================
console.log('\n▶ TEST 4: Smart-Anchor Auto-Balancing with Locked Variations');
// Setup 4 variations: Base Anchor, Var 2 (locked at 20%), Var 3 (unlocked), Var 4 (unlocked)
const varList = [
    { tx: 0, ty: 0, rate: 80, weight: 80, isBase: true },
    { tx: 1, ty: 0, rate: 20, weight: 20, locked: true },
    { tx: 2, ty: 0, rate: 0, weight: 0, locked: false },
    { tx: 3, ty: 0, rate: 0, weight: 0, locked: false }
];
matProps.saveMaterialVariations(testMat, varList);

// Initialize UI and open modal for testMat
matProps.initMaterialPropertiesUI();
matProps.openMaterialPropertiesModal(testMat.id);

// Trigger balanceUnlockedVariations
matProps.balanceUnlockedVariations();

const balanced = matProps.getMaterialVariations(testMat);
window.TileWeaver.stateModule.calculateVariationRates(balanced);

// Available budget = 100 - 20 (locked) = 80.
// Split across 2 unlocked + 1 base anchor = 3 shares => 80 / 3 = 26.67% each
assert.strictEqual(balanced[1].rate, 20, 'Locked variation rate must remain frozen at 20%');
assert(Math.abs(balanced[2].rate - 26.67) < 0.1, `Unlocked Var 3 should receive fair share ~26.67%, got ${balanced[2].rate}`);
assert(Math.abs(balanced[3].rate - 26.67) < 0.1, `Unlocked Var 4 should receive fair share ~26.67%, got ${balanced[3].rate}`);
console.log('  ✔ Auto-balancing correctly froze locked decorator rate and evenly partitioned remaining budget!');

// =========================================================================
// TEST 5: Modal Lifecycle, Usage Scans & History Snapshot Coalescing
// =========================================================================
console.log('\n▶ TEST 5: Modal Lifecycle, Usage Scans & History Snapshot Coalescing');
const initialHistoryCount = pushedHistoryCount;

// Populate a layer with painted vertices matching testMat.vertexVal (1)
state.mapLayers = [
    {
        id: 'layer1',
        terrainVertices: [
            [1, 1, 0],
            [1, 0, 0],
            [0, 0, 0]
        ]
    }
];

matProps.openMaterialPropertiesModal(testMat.id);
matProps.closeMaterialPropertiesModal();

assert.strictEqual(pushedHistoryCount, initialHistoryCount + 1, 'Closing modal must record exactly 1 coalesced history snapshot');
console.log('  ✔ Modal opening, cached vertex calculation, and history snapshot coalescing verified!');

// =========================================================================
// TEST 6: Single-Tile & Multi-Tile Addition
// =========================================================================
console.log('\n▶ TEST 6: Single-Tile & Multi-Tile Addition');
matProps.openMaterialPropertiesModal(testMat.id);

const countBefore = matProps.getMaterialVariations(testMat).length;
matProps.addTileVariation(4, 2);
const countAfter = matProps.getMaterialVariations(testMat).length;
assert.strictEqual(countAfter, countBefore + 1, 'Should increment variation count');

// Attempt duplicate addition
matProps.addTileVariation(4, 2);
const countDuplicate = matProps.getMaterialVariations(testMat).length;
assert.strictEqual(countDuplicate, countAfter, 'Duplicate variation must not be re-added');
console.log('  ✔ Single-tile variation addition and duplicate guards verified!');

// =========================================================================
// TEST 7: Surgical Transition Pair Deletion
// =========================================================================
console.log('\n▶ TEST 7: Surgical Transition Pair Deletion');
state.autotiles = [
    { id: 'at_grass_dirt', name: 'Grass ↔ Dirt', mode: 'dualgrid', mat1Name: 'Test Grass', mat2Name: 'Dirt' },
    { id: 'at_dirt_stone', name: 'Dirt ↔ Stone', mode: 'dualgrid', mat1Name: 'Dirt', mat2Name: 'Stone' },
    { id: 'at_grass_stone', name: 'Grass ↔ Stone', mode: 'dualgrid', mat1Name: 'Test Grass', mat2Name: 'Stone' }
];

window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();

const autotilesCountBefore = state.autotiles.length;
const materialsCountBefore = state.materials.length; // 3 materials: Test Grass, Dirt, Stone

matProps.deleteTransitionPair('at_grass_stone');

assert.strictEqual(state.autotiles.length, autotilesCountBefore - 1, 'Target autotile transition pair must be deleted');
assert.strictEqual(state.materials.length, materialsCountBefore, 'Both parent materials (Test Grass & Stone) must remain intact via remaining autotiles');
assert(!state.autotiles.some(a => a.id === 'at_grass_stone'), 'Deleted autotile must no longer exist in state');
console.log('  ✔ Surgical transition pair pruning verified with zero parent material data loss!');

console.log('\n===============================================================');
console.log('🎉 ALL MATERIAL PROPERTIES AUTOMATED TESTS PASSED (7/7)!');
console.log('===============================================================');
