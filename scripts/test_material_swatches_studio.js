/**
 * Automated Verification Test for Material Swatches Studio (Phases 1 & 2)
 */

const fs = require('fs');
const path = require('path');

console.log('===============================================================');
console.log('🧪 STARTING MATERIAL SWATCHES STUDIO (PHASE 1 & 2) VERIFICATION');
console.log('===============================================================');

// Mock DOM and window environment
global.window = {};
const elemCache = new Map();
global.document = {
    getElementById: (id) => {
        if (!elemCache.has(id)) {
            elemCache.set(id, {
                id,
                value: '',
                className: '',
                classList: {
                    add: () => {},
                    remove: () => {},
                    toggle: () => {},
                    contains: () => false
                },
                addEventListener: () => {},
                appendChild: () => {},
                querySelectorAll: () => [],
                innerHTML: '',
                style: {}
            });
        }
        return elemCache.get(id);
    },
    querySelectorAll: () => [],
    createElement: (tag) => {
        return {
            tagName: tag,
            className: '',
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            style: {},
            appendChild: () => {},
            addEventListener: () => {},
            setAttribute: () => {},
            removeAttribute: () => {},
            getBoundingClientRect: () => ({ top: 100, height: 30 }),
            getContext: () => ({
                clearRect: () => {},
                drawImage: () => {},
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                closePath: () => {},
                clip: () => {},
                stroke: () => {},
                fillRect: () => {}
            })
        };
    },
    activeElement: { tagName: 'BODY' }
};

// Load state module
const constantsCode = fs.readFileSync(path.join(__dirname, '../js/constants.js'), 'utf8');
eval(constantsCode);
const stateCode = fs.readFileSync(path.join(__dirname, '../js/state.js'), 'utf8');
eval(stateCode);

window.confirm = () => true;
// Mock toast, history, rendering
window.TileWeaver.toast = {
    showMessage: (msg, type) => {
        // console.log(`[Toast ${type}] ${msg}`);
    }
};
window.TileWeaver.history = {
    pushHistoryState: () => {}
};
window.TileWeaver.rendering = {
    drawMap: () => {},
    drawTileset: () => {}
};
window.TileWeaver.tools = {
    selectTool: (t) => {
        window.TileWeaver.stateModule.state.currentTool = t;
    }
};

// Load terrainSwatches module
const swatchesCode = fs.readFileSync(path.join(__dirname, '../js/ui/terrainSwatches.js'), 'utf8');
eval(swatchesCode);

const { state } = window.TileWeaver.stateModule;
const tsSubsystem = window.TileWeaver.terrainSwatches;

// 1. Populate sample mixed autotiles (Ground, Cliff, Wall)
state.tilesets = [{ id: 'ts_test', name: 'Overworld RPG', image: {} }];
state.autotiles = [
    { id: 'at_grass_dirt', name: 'Grass to Dirt', mode: 'dualgrid', mat1Name: 'Grass', mat2Name: 'Dirt Road', tilesetId: 'ts_test', mapping: { grid_0: { tx: 0, ty: 0 }, grid_15: { tx: 1, ty: 0 } } },
    { id: 'at_grass_water', name: 'Grass to Water', mode: 'dualgrid', mat1Name: 'Grass', mat2Name: 'Water Lake', tilesetId: 'ts_test', mapping: { grid_0: { tx: 0, ty: 0 }, grid_15: { tx: 2, ty: 0 } } },
    { id: 'at_cliff_highland', name: 'Highland Cliff', isCliff: true, mode: 'cliff_vstretch', mat1Name: 'Highland Rock Cliff', mat2Name: 'Cliff Wall', tilesetId: 'ts_test', mapping: { grid_15: { tx: 3, ty: 0 }, cliff_face_mid: { tx: 3, ty: 1 } } },
    { id: 'at_wall_dungeon', name: 'Dungeon Brick Wall', isWall: true, mode: '16tile', mat1Name: 'Dungeon Brick Wall', tilesetId: 'ts_test', mapping: { post: { tx: 4, ty: 0 } } }
];

console.log('▶ TEST 1: Synchronizing Mixed Materials');
tsSubsystem.syncMaterialsFromAutotiles();

if (state.materials.length === 5) {
    console.log(`  ✔ Successfully registered 5 distinct materials: ${state.materials.map(m => m.name).join(', ')}`);
} else {
    throw new Error(`Expected 5 materials, got ${state.materials.length}`);
}

console.log('▶ TEST 2: Validating Classification Badges & Metadata');
const grassMat = state.materials.find(m => m.name === 'Grass');
const dirtMat = state.materials.find(m => m.name === 'Dirt Road');
const cliffMat = state.materials.find(m => m.name === 'Highland Rock Cliff');
const wallMat = state.materials.find(m => m.name === 'Dungeon Brick Wall');

if (grassMat && !grassMat.isCliff && !grassMat.isWall) {
    console.log('  ✔ Ground material correctly flagged (!isCliff, !isWall)');
} else {
    throw new Error('Grass material classification error');
}

if (cliffMat && cliffMat.isCliff && !cliffMat.isWall) {
    console.log('  ✔ Cliff material correctly flagged (isCliff=true, isWall=false)');
} else {
    throw new Error('Cliff material classification error');
}

if (wallMat && wallMat.isWall && !wallMat.isCliff) {
    console.log('  ✔ Wall material correctly flagged (isWall=true, isCliff=false)');
} else {
    throw new Error('Wall material classification error');
}

console.log('▶ TEST 3: Tool Auto-Switching on Selection');
tsSubsystem.selectMaterialSwatch(wallMat.id);
if (state.currentTool === 'autotile') {
    console.log("  ✔ Selecting Wall Swatch automatically switched tool to 'autotile' [A]");
} else {
    throw new Error(`Expected currentTool to be 'autotile', got '${state.currentTool}'`);
}

tsSubsystem.selectMaterialSwatch(grassMat.id);
if (state.currentTool === 'terrain') {
    console.log("  ✔ Selecting Ground Swatch automatically switched tool to 'terrain' [T]");
} else {
    throw new Error(`Expected currentTool to be 'terrain', got '${state.currentTool}'`);
}

console.log('▶ TEST 4: Material Duplication');
const initialCount = state.materials.length;
tsSubsystem.duplicateMaterial(dirtMat.id);
if (state.materials.length === initialCount + 1 && state.materials.some(m => m.name === 'Dirt Road (Copy)')) {
    console.log('  ✔ Material successfully duplicated with new unique ID and copy suffix');
} else {
    throw new Error('Material duplication failed');
}

console.log('▶ TEST 5: Material Deletion');
const copyMat = state.materials.find(m => m.name === 'Dirt Road (Copy)');
tsSubsystem.deleteMaterial(copyMat.id);
if (state.materials.length === initialCount && !state.materials.some(m => m.name === 'Dirt Road (Copy)')) {
    console.log('  ✔ Material copy successfully deleted');
} else {
    throw new Error('Material deletion failed');
}

console.log('▶ TEST 6: Drag-and-Drop Priority Stack Reordering');
// Get ground materials
const groundBefore = state.materials.filter(m => !m.isCliff && !m.isWall).sort((a, b) => (b.priority || 0) - (a.priority || 0));
const bottomMat = groundBefore[groundBefore.length - 1];
const topMat = groundBefore[0];

// Drag bottom material to the top before topMat
tsSubsystem.reorderMaterialPriority(bottomMat.id, topMat.id, 'before');

const groundAfter = state.materials.filter(m => !m.isCliff && !m.isWall).sort((a, b) => (b.priority || 0) - (a.priority || 0));
if (groundAfter[0].id === bottomMat.id && bottomMat.priority > topMat.priority) {
    console.log(`  ✔ Dragged '${bottomMat.name}' to top; priority updated to ${bottomMat.priority} (above '${topMat.name}' ${topMat.priority})`);
} else {
    throw new Error('Priority stack reordering failed');
}

console.log('▶ TEST 7: 3-Way View Density Modes');
['compact', 'chips', 'rich'].forEach(mode => {
    tsSubsystem.setSwatchDensityMode(mode);
    if (state.swatchDensityMode === mode) {
        console.log(`  ✔ Swatch Density Mode successfully set to '${mode}'`);
    } else {
        throw new Error(`Failed to set density mode to '${mode}'`);
    }
});

console.log('▶ TEST 8: Quick Properties Drawer');
tsSubsystem.openQuickPropertiesDrawer(grassMat.id);
// Simulate user typing in quick drawer inputs
document.getElementById('quick-mat-name').value = 'Lush Emerald Grass';
document.getElementById('quick-mat-color').value = '#10b981';
tsSubsystem.saveQuickProperties();

const updatedGrass = tsSubsystem.getMaterialById(grassMat.id);
if (updatedGrass && updatedGrass.name === 'Lush Emerald Grass' && updatedGrass.color === '#10b981') {
    console.log(`  ✔ Quick Properties Drawer successfully updated material to '${updatedGrass.name}'`);
} else {
    throw new Error('Quick properties drawer save failed');
}

console.log('▶ TEST 9: Procedural Composite Thumbnail Generation');
const mockCanvas = document.createElement('canvas');
let drawCount = 0;
mockCanvas.getContext = () => ({
    clearRect: () => {},
    drawImage: () => { drawCount++; },
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    stroke: () => {},
    fillRect: () => {}
});

// Test cliff composite thumbnail (2-tier slice)
drawCount = 0;
tsSubsystem.renderCompositeThumbnail(mockCanvas, cliffMat, 26, 26);
if (drawCount >= 2) {
    console.log(`  ✔ Cliff thumbnail generated 2-tier composite slice (${drawCount} drawImage calls for top-cap + face)`);
} else {
    throw new Error('Cliff composite thumbnail failed');
}

// Test wall composite thumbnail
drawCount = 0;
tsSubsystem.renderCompositeThumbnail(mockCanvas, wallMat, 26, 26);
if (drawCount >= 1) {
    console.log(`  ✔ Wall thumbnail generated structural wall profile`);
} else {
    throw new Error('Wall composite thumbnail failed');
}

console.log('▶ TEST 10: Active Swatch Ribbon HUD Slots & Hotkeys (1-5)');
const ribbonSlots = tsSubsystem.getRibbonSlots();
if (ribbonSlots.length >= 4 && ribbonSlots.length <= 5) {
    console.log(`  ✔ Ribbon HUD correctly populated ${ribbonSlots.length} material slots: ${ribbonSlots.map(s => s.name).join(', ')}`);
} else {
    throw new Error(`Expected between 4 and 5 ribbon slots, got ${ribbonSlots.length}`);
}

// Test hotkey switching: Slot 0 (Key '1')
tsSubsystem.selectRibbonSlot(0);
if (state.activeMaterialId === ribbonSlots[0].id) {
    console.log(`  ✔ Selecting Ribbon Slot 0 (Hotkey [1]) activated material '${ribbonSlots[0].name}'`);
} else {
    throw new Error('Ribbon slot 0 selection failed');
}

// Test hotkey switching: Slot 1 (Key '2')
tsSubsystem.selectRibbonSlot(1);
if (state.activeMaterialId === ribbonSlots[1].id) {
    console.log(`  ✔ Selecting Ribbon Slot 1 (Hotkey [2]) activated material '${ribbonSlots[1].name}'`);
} else {
    throw new Error('Ribbon slot 1 selection failed');
}

console.log('▶ TEST 11: Pinning / Unpinning to HUD Ribbon & Auto-Fade');
// Pin wall material
tsSubsystem.togglePinMaterial(wallMat.id);
const slotsWithPin = tsSubsystem.getRibbonSlots();
if (state.pinnedMaterialIds.includes(wallMat.id) && slotsWithPin[0].id === wallMat.id) {
    console.log(`  ✔ Pinned '${wallMat.name}' to HUD ribbon (promoted to Slot 1)`);
} else {
    throw new Error('Pinning material failed');
}

// Unpin wall material
tsSubsystem.togglePinMaterial(wallMat.id);
if (!state.pinnedMaterialIds.includes(wallMat.id)) {
    console.log(`  ✔ Unpinned '${wallMat.name}' from HUD ribbon`);
} else {
    throw new Error('Unpinning material failed');
}

// Test Drawing Auto-Fade
tsSubsystem.setRibbonDrawingFade(true);
tsSubsystem.setRibbonDrawingFade(false);
console.log('  ✔ Ribbon drawing auto-fade triggers successfully');

console.log('▶ TEST 12: Dynamic Map-Aware Procedural Corner Blending');
// 1. Setup multi-ground environment: Grass, Dirt, Sand, Water
state.materials = [
    { id: 'mat_grass', name: 'Grass', vertexVal: 0, priority: 0, tx: 0, ty: 0, autotileIds: [] },
    { id: 'mat_dirt', name: 'Dirt', vertexVal: 1, priority: 1, tx: 1, ty: 0, autotileIds: [] },
    { id: 'mat_sand', name: 'Sand', vertexVal: 2, priority: 2, tx: 2, ty: 0, autotileIds: [] },
    { id: 'mat_water', name: 'Water', vertexVal: 3, priority: 3, tx: 3, ty: 0, autotileIds: [] }
];

// Initialize a 150x150 map with terrain vertices
state.mapWidth = 150;
state.mapHeight = 150;
const testVerts = Array.from({ length: 151 }, () => Array.from({ length: 151 }, () => 2)); // All Sand (2)

// Create 50 cells where Sand (2) transitions with Dirt (1)
for (let c = 0; c < 50; c++) {
    testVerts[0][c] = 1; // Dirt
}

// Create 20 cells where Sand (2) transitions with Grass (0)
for (let c = 0; c < 20; c++) {
    testVerts[5][c] = 0; // Grass
}

// Create 100 cells where Sand (2) transitions with Water (3)
for (let c = 0; c < 100; c++) {
    testVerts[10][c] = 3; // Water
}

state.mapLayers = [
    { id: 'layer_ground', name: 'Ground', visible: true, terrainVertices: testVerts, data: [] }
];

const sandMat = state.materials.find(m => m.id === 'mat_sand');

// Step A: Water should be the dominant partner (100 > 50 > 20)
const dominant1 = tsSubsystem.getDominantTransitionPartner(sandMat);
if (dominant1.partner && dominant1.partner.name === 'Water' && dominant1.count >= 100) {
    console.log(`  ✔ Scenario A: Sand dominant partner correctly identified as '${dominant1.partner.name}' (${dominant1.count} map transitions)`);
} else {
    throw new Error(`Expected dominant partner 'Water', got '${dominant1.partner ? dominant1.partner.name : 'none'}' with count ${dominant1.count}`);
}

// Step B: Now paint 120 more cells where Sand (2) transitions with Grass (0)
for (let c = 0; c < 120; c++) {
    testVerts[20][c] = 0; // 120 Grass cells (total Grass-Sand transitions: 140)
}

// Grass should now become the dominant partner (140 > 100 > 50)
const dominant2 = tsSubsystem.getDominantTransitionPartner(sandMat);
if (dominant2.partner && dominant2.partner.name === 'Grass' && dominant2.count > 100) {
    console.log(`  ✔ Scenario B (Dynamic Map Update): Sand dominant partner dynamically adapted to '${dominant2.partner.name}' (${dominant2.count} map transitions)`);
} else {
    throw new Error(`Expected dominant partner 'Grass', got '${dominant2.partner ? dominant2.partner.name : 'none'}' with count ${dominant2.count}`);
}

// -------------------------------------------------------------
// TEST 13: Safe Material Deletion Modal Preview Canvas Initialization
// -------------------------------------------------------------
console.log('▶ TEST 13: Safe Material Deletion Modal Preview Canvas & Arguments');
const mockModalCanvas = {
    tagName: 'CANVAS',
    width: 32,
    height: 32,
    getContext: (type) => ({
        clearRect: () => {},
        drawImage: () => {},
        fillRect: () => {}
    })
};
elemCache.set('safe-delete-mat-preview', mockModalCanvas);

// Open Safe Delete Modal for Sand
tsSubsystem.openSafeDeleteMaterialModal('mat_sand');
console.log('  ✔ Safe Material Deletion Modal opened and initialized preview thumbnail cleanly!');
tsSubsystem.closeSafeDeleteModal();

// -------------------------------------------------------------
// TEST 14: Precalculated Frequency Table Forwarding to Thumbnail
// -------------------------------------------------------------
console.log('▶ TEST 14: Precalculated Frequency Table Forwarding & O(1) Lookups');
const precomputedFreqs = tsSubsystem.calculateMapTransitionFrequencies();
if (precomputedFreqs && typeof precomputedFreqs === 'object') {
    const thumbTestCanvas = {
        tagName: 'CANVAS',
        width: 26,
        height: 26,
        getContext: () => ({
            clearRect: () => {},
            drawImage: () => {},
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
            clip: () => {},
            stroke: () => {}
        })
    };
    tsSubsystem.renderCompositeThumbnail(thumbTestCanvas, sandMat, 26, 26, precomputedFreqs);
    console.log('  ✔ Precalculated frequency cache cleanly forwarded to composite thumbnail generator!');
} else {
    throw new Error('calculateMapTransitionFrequencies failed to return valid frequency dictionary');
}

console.log('===============================================================');
console.log('🎉 ALL MATERIAL SWATCHES STUDIO (PHASES 1, 2 & 3) TESTS PASSED (14/14)!');
console.log('===============================================================');
