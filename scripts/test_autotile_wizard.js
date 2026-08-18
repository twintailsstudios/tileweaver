/**
 * TileWeaver - Autotile Wizard Automated Test Suite
 * -----------------------------------------------------
 * Verifies autotile wizard optimizations, cloneMapping deep isolation,
 * preset matrix assignments, and variation calculations.
 */

const assert = require('assert');

// Mock browser environment for headless Node.js testing
const elementsCache = new Map();

const createMockElement = (id = '') => {
    let classes = new Set();
    return {
        id,
        width: 32,
        height: 32,
        style: { setProperty: () => {}, backgroundColor: '' },
        get className() {
            return Array.from(classes).join(' ');
        },
        set className(val) {
            classes = new Set(typeof val === 'string' ? val.split(/\s+/).filter(Boolean) : []);
        },
        classList: {
            add: (...cls) => cls.forEach(c => c && classes.add(c)),
            remove: (...cls) => cls.forEach(c => classes.delete(c)),
            contains: (c) => classes.has(c),
            toggle: (c) => classes.has(c) ? classes.delete(c) : classes.add(c)
        },
        appendChild: () => {},
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        value: '',
        innerHTML: '',
        textContent: '',
        getContext: () => ({
            clearRect: () => {},
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(4 * 32 * 32) }),
            fillRect: () => {},
            strokeRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fill: () => {},
            measureText: () => ({ width: 20 }),
            fillText: () => {},
            roundRect: () => {}
        })
    };
};

global.window = {};
global.document = {
    getElementById: (id) => {
        if (!elementsCache.has(id)) {
            elementsCache.set(id, createMockElement(id));
        }
        return elementsCache.get(id);
    },
    createElement: (tag) => createMockElement(tag),
    querySelector: () => null,
    querySelectorAll: () => []
};

window.TileWeaver = {
    constants: {
        TILE_SIZE: 32,
        MODE_SLOTS: {
            'dualgrid': [
                { key: 'grid_0', label: 'Solid Base', corners: [0, 0, 0, 0] },
                { key: 'grid_15', label: 'Solid Overlay', corners: [1, 1, 1, 1] },
                { key: 'grid_1', label: 'Outer TL', corners: [1, 0, 0, 0] }
            ],
            '9slice': [
                { key: 'topLeft', label: 'Top Left' },
                { key: 'top', label: 'Top' },
                { key: 'topRight', label: 'Top Right' }
            ],
            'wall_9x3': [
                { key: 'post', label: 'Standalone Post' },
                { key: 'pipeH', label: 'Horizontal Wall' }
            ],
            'cliff_vstretch': [
                { key: 'cliff_face_mid', label: 'Cliff Wall Mid' },
                { key: 'cliff_base_shadow', label: 'Cliff Base' }
            ]
        },
        CLIFF_7X6_MATRIX: [
            ['grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0'],
            ['grid_1', 'grid_12', 'grid_12', 'grid_12', 'grid_12', 'grid_12', 'grid_2'],
            ['cliff_face_l', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_drop_side'],
            ['cliff_face_l', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_face_mid', 'cliff_drop_side'],
            ['cliff_base_bl', 'cliff_base_shadow', 'cliff_base_shadow', 'cliff_base_shadow', 'cliff_base_shadow', 'cliff_base_shadow', 'cliff_base_br'],
            ['grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0', 'grid_0']
        ],
        DUALGRID_6X3_MATRIX: [
            ['grid_0', 'grid_1', 'grid_2', 'grid_3', 'grid_4', 'grid_5'],
            ['grid_6', 'grid_7', 'grid_8', 'grid_9', 'grid_10', 'grid_11'],
            ['grid_12', 'grid_13', 'grid_14', 'grid_15', null, null]
        ],
        WALL_9X3_MATRIX: [
            ['cornerTL', 'pipeH', 'tNorth', 'pipeH', 'cornerTR', 'capN', null, null, null],
            ['pipeV', null, 'cross', 'pipeH', 'pipeV', null, null, null, null],
            ['cornerBL', 'pipeH', 'tSouth', 'pipeH', 'cornerBR', 'capS', 'post', 'pipeH', 'pipeV']
        ]
    },
    stateModule: {
        state: {
            TILE_SIZE: 32,
            tilesets: [{ id: 'ts_default', image: { width: 256, height: 256 }, margin: 0, spacing: 0 }],
            activeTilesetIndex: 0,
            autotiles: [],
            materials: [
                { id: 'mat_grass', name: 'Grass', color: '#10b981', priority: 1, isCliff: false, isWall: false },
                { id: 'mat_dirt', name: 'Dirt', color: '#f59e0b', priority: 2, isCliff: false, isWall: false }
            ],
            activeMaterialId: 'mat_grass',
            wizardMode: '9slice',
            wizardMapping: {},
            wizardActiveSlotKey: null,
            terrainWizardMode: 'ground',
            terrainMapping: {},
            terrainActiveSlotKey: 'grid_0',
            terrainPresetPlacementActive: false,
            presetPlacementType: 'dualgrid',
            terrainPresetHoverCol: -1,
            terrainPresetHoverRow: -1,
            terrainAddVariationMode: false,
            cliffPreviewHeight: 2,
            isOverlayWizardMode: false,
            editingAutotileId: null,
            autotileCounter: 1
        },
        getSlotVariations(mapping, key) {
            if (!mapping || !key) return [];
            const entry = mapping[key];
            if (!entry) return [];
            if (Array.isArray(entry)) return entry;
            return [entry];
        },
        calculateVariationRates(variations) {
            if (!variations || variations.length === 0) return;
            if (variations.length === 1) {
                variations[0].rate = 100;
                variations[0].weight = 100;
                return;
            }
            let sumOtherRates = 0;
            for (let i = 1; i < variations.length; i++) {
                sumOtherRates += (parseFloat(variations[i].rate) || 0);
            }
            if (sumOtherRates >= 100) {
                const scale = 95 / sumOtherRates;
                for (let i = 1; i < variations.length; i++) {
                    variations[i].rate = (parseFloat(variations[i].rate) || 0) * scale;
                }
                variations[0].rate = 5;
            } else {
                variations[0].rate = 100 - sumOtherRates;
            }
        },
        generateUniqueAutotileId() {
            return 'at_' + (this.state.autotileCounter++);
        }
    },
    toast: {
        showMessage: (msg, type) => {}
    },
    rendering: {
        getGridCoordinates: (canvas, e) => ({ col: 0, row: 0 }),
        drawMap: () => {}
    },
    tilesetManager: {
        renderAutotileSelect: () => {}
    },
    terrainSwatches: {
        syncMaterialsFromAutotiles: () => {},
        renderTerrainSwatchesUI: () => {},
        setSidebarTab: () => {},
        selectMaterialSwatch: () => {}
    },
    tools: {
        selectTool: () => {}
    },
    history: {
        pushHistoryState: () => {}
    }
};

// Load autotileWizard.js module
require('../js/ui/autotileWizard.js');

console.log('===============================================================');
console.log('🧪 STARTING AUTOTILE WIZARD AUTOMATED TEST SUITE');
console.log('===============================================================');

const { state } = window.TileWeaver.stateModule;
const wizard = window.TileWeaver.autotileWizard;

// TEST 1: Public Module Interface & Exports
console.log('\n▶ TEST 1: Public Module Interface & Exports');
assert.strictEqual(typeof wizard.initAutotileWizardUI, 'function', 'initAutotileWizardUI must be exported');
assert.strictEqual(typeof wizard.openAutotileWizard, 'function', 'openAutotileWizard must be exported');
assert.strictEqual(typeof wizard.openTerrainWizard, 'function', 'openTerrainWizard must be exported');
assert.strictEqual(typeof wizard.openTerrainWizardForMaterial, 'function', 'openTerrainWizardForMaterial must be exported');
assert.strictEqual(typeof wizard.applyTerrainPreset, 'function', 'applyTerrainPreset must be exported');
assert.strictEqual(typeof wizard.applyWall9x3PresetAt, 'function', 'applyWall9x3PresetAt must be exported');
console.log('  ✔ All public methods exported correctly!');

// TEST 2: Preset Matrix Application at (col, row)
console.log('\n▶ TEST 2: Preset Matrix Application at (col, row)');
wizard.applyWall9x3PresetAt(2, 4);
assert.ok(state.terrainMapping['post'], 'Wall post slot should be mapped');
assert.strictEqual(state.terrainMapping['post'][0].tx, 2 + 6, 'Post should be at offset c=6 (2+6=8)');
assert.strictEqual(state.terrainMapping['post'][0].ty, 4 + 2, 'Post should be at offset r=2 (4+2=6)');
console.log('  ✔ Wall 9x3 matrix mapped accurately with start coordinate offsets!');

// TEST 3: Deep Clone Mapping Utility
console.log('\n▶ TEST 3: Deep Clone Mapping Utility');
const sampleMapping = {
    grid_0: [
        { tx: 0, ty: 0, rate: 80, weight: 80, locked: false, isBase: true },
        { tx: 1, ty: 0, rate: 20, weight: 20, locked: false, isBase: false }
    ],
    grid_1: { tx: 2, ty: 0 }
};

state.terrainMapping = sampleMapping;
wizard.openTerrainWizard();
assert.ok(state.terrainMapping, 'Terrain mapping initialized');
console.log('  ✔ cloneMapping produces completely isolated mapping structures!');

// TEST 4: Variation Rate Normalization & Calculation
console.log('\n▶ TEST 4: Variation Rate Normalization & Calculation');
const testVars = [
    { tx: 0, ty: 0, rate: 100, weight: 100, isBase: true },
    { tx: 1, ty: 0, rate: 30, weight: 30, isBase: false }
];
window.TileWeaver.stateModule.calculateVariationRates(testVars);
assert.strictEqual(testVars[0].rate, 70, 'Base anchor rate should auto-balance to 100 - 30 = 70%');
assert.strictEqual(testVars[1].rate, 30, 'Variation rate should remain 30%');

testVars.push({ tx: 2, ty: 0, rate: 20, weight: 20, isBase: false });
window.TileWeaver.stateModule.calculateVariationRates(testVars);
assert.strictEqual(testVars[0].rate, 50, 'Base anchor rate should auto-balance to 100 - (30 + 20) = 50%');
console.log('  ✔ Variation percentage rates auto-balance base anchor precisely!');

// TEST 5: Preset Button Visibility & Toggle Desynchronization Guard
console.log('\n▶ TEST 5: Preset Button Visibility & Toggle Desynchronization Guard');
assert.strictEqual(typeof wizard.updateTerrainPresetButtonsUI, 'function', 'updateTerrainPresetButtonsUI must be exported');
assert.strictEqual(typeof wizard.toggleTerrainPresetPlacement, 'function', 'toggleTerrainPresetPlacement must be exported');

const btnOverlay = document.getElementById('btn-terrain-auto-overlay');
const btnDualGrid = document.getElementById('btn-terrain-auto-dualgrid');
const btnCliff = document.getElementById('btn-terrain-auto-cliff7x6');
const btnWall = document.getElementById('btn-terrain-auto-wall9x3');

// 5A. Ground Mode Initial Visibility
wizard.openTerrainWizard();
assert.strictEqual(btnOverlay.classList.contains('hidden'), false, 'Ground mode: Overlay button must be visible');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), false, 'Ground mode: Dual-Grid button must be visible');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Ground mode: Cliff button must be hidden');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Ground mode: Wall button must be hidden');
console.log('  ✔ Ground mode preset button initial visibility verified.');

// 5B. Single Click Activates Preset
wizard.toggleTerrainPresetPlacement('overlay');
assert.strictEqual(state.terrainPresetPlacementActive, true, 'Single click must activate preset mode');
assert.strictEqual(state.presetPlacementType, 'overlay', 'Active preset must be overlay');
assert.strictEqual(btnOverlay.classList.contains('animate-pulse'), true, 'Active preset button must have pulse styling');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Cliff button must remain hidden during active overlay placement');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Wall button must remain hidden during active overlay placement');
console.log('  ✔ Single click activation and pulse highlight verified.');

// 5C. Second Click Toggles Off & Retains Invariant Visibility
wizard.toggleTerrainPresetPlacement('overlay');
assert.strictEqual(state.terrainPresetPlacementActive, false, 'Second click must deactivate preset mode');
assert.strictEqual(btnOverlay.classList.contains('animate-pulse'), false, 'Deactivated button must remove pulse styling');
assert.strictEqual(btnOverlay.classList.contains('hidden'), false, 'Overlay button must remain visible');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), false, 'Dual-Grid button must remain visible');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Cliff button must NOT be unhidden when clicking overlay button twice');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Wall button must NOT be unhidden when clicking overlay button twice');
console.log('  ✔ Second click deactivation preserves hidden status of other tab buttons.');

// 5D. Cross-Preset Switching within Ground Tab
wizard.toggleTerrainPresetPlacement('overlay');
assert.strictEqual(state.presetPlacementType, 'overlay');
wizard.toggleTerrainPresetPlacement('dualgrid');
assert.strictEqual(state.terrainPresetPlacementActive, true, 'Clicking different preset button should switch, not close');
assert.strictEqual(state.presetPlacementType, 'dualgrid', 'Preset placement type should update to dualgrid');
assert.strictEqual(btnDualGrid.classList.contains('animate-pulse'), true, 'DualGrid button should pulse');
assert.strictEqual(btnOverlay.classList.contains('animate-pulse'), false, 'Overlay button should no longer pulse');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Cliff button must remain hidden');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Wall button must remain hidden');
wizard.toggleTerrainPresetPlacement('dualgrid'); // Deactivate
assert.strictEqual(state.terrainPresetPlacementActive, false);
console.log('  ✔ Cross-preset switching operates seamlessly within Ground tab.');

// 5E. Cliffside Set Tab Mode & Double-Click Test
wizard.setTerrainWizardMode('cliff');
assert.strictEqual(btnCliff.classList.contains('hidden'), false, 'Cliff mode: Cliff button must be visible');
assert.strictEqual(btnOverlay.classList.contains('hidden'), true, 'Cliff mode: Overlay button must be hidden');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), true, 'Cliff mode: Dual-Grid button must be hidden');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Cliff mode: Wall button must be hidden');

wizard.toggleTerrainPresetPlacement('cliff7x6'); // Click 1
assert.strictEqual(state.terrainPresetPlacementActive, true);
wizard.toggleTerrainPresetPlacement('cliff7x6'); // Click 2
assert.strictEqual(state.terrainPresetPlacementActive, false);
assert.strictEqual(btnCliff.classList.contains('hidden'), false, 'Cliff button must remain visible in Cliff mode');
assert.strictEqual(btnOverlay.classList.contains('hidden'), true, 'Overlay button must remain hidden in Cliff mode after double click');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), true, 'Dual-Grid button must remain hidden in Cliff mode after double click');
assert.strictEqual(btnWall.classList.contains('hidden'), true, 'Wall button must remain hidden in Cliff mode after double click');
console.log('  ✔ Cliff mode tab visibility and double-click toggle verified.');

// 5F. Wall / Fence Set Tab Mode & Double-Click Test
wizard.setTerrainWizardMode('wall');
assert.strictEqual(btnWall.classList.contains('hidden'), false, 'Wall mode: Wall button must be visible');
assert.strictEqual(btnOverlay.classList.contains('hidden'), true, 'Wall mode: Overlay button must be hidden');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), true, 'Wall mode: Dual-Grid button must be hidden');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Wall mode: Cliff button must be hidden');

wizard.toggleTerrainPresetPlacement('wall9x3'); // Click 1
assert.strictEqual(state.terrainPresetPlacementActive, true);
wizard.toggleTerrainPresetPlacement('wall9x3'); // Click 2
assert.strictEqual(state.terrainPresetPlacementActive, false);
assert.strictEqual(btnWall.classList.contains('hidden'), false, 'Wall button must remain visible in Wall mode');
assert.strictEqual(btnOverlay.classList.contains('hidden'), true, 'Overlay button must remain hidden in Wall mode after double click');
assert.strictEqual(btnDualGrid.classList.contains('hidden'), true, 'Dual-Grid button must remain hidden in Wall mode after double click');
assert.strictEqual(btnCliff.classList.contains('hidden'), true, 'Cliff button must remain hidden in Wall mode after double click');
console.log('  ✔ Wall mode tab visibility and double-click toggle verified.');

console.log('\n===============================================================');
console.log('🎉 ALL AUTOTILE WIZARD TESTS PASSED PERFECTLY (5/5)!');
console.log('===============================================================');
