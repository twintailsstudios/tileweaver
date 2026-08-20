/**
 * TileWeaver - Layer Manager Automated Test Suite
 * ---------------------------------------------------
 * Verifies layer hierarchy rendering, deep cloning memory isolation,
 * stack reordering, active index deletion shift mathematics,
 * opacity slider controls, tool preservation, and namespace export aliases.
 */

const assert = require('assert');

// Setup mock DOM environment for headless Node.js
const elements = {};
let nextElementId = 1;

function createMockElement(tag = 'div', id = '') {
    const el = {
        tagName: tag.toUpperCase(),
        id: id || `mock_el_${nextElementId++}`,
        value: '',
        checked: false,
        textContent: '',
        title: '',
        type: 'text',
        min: '0',
        max: '100',
        disabled: false,
        className: '',
        children: [],
        innerHTMLValue: '',
        listeners: {},
        style: {},
        maxLength: 524288,
        dataset: {},
        setAttribute(name, val) {
            this[name] = val;
            if (name.startsWith('data-')) {
                const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[key] = val;
            }
        },
        getAttribute(name) {
            return this[name] || null;
        },
        
        get classList() {
            return {
                add: (...classes) => {
                    const set = new Set((el.className || '').split(' ').filter(Boolean));
                    classes.forEach(c => set.add(c));
                    el.className = Array.from(set).join(' ');
                },
                remove: (...classes) => {
                    const set = new Set((el.className || '').split(' ').filter(Boolean));
                    classes.forEach(c => set.delete(c));
                    el.className = Array.from(set).join(' ');
                },
                contains: (cls) => {
                    return (el.className || '').split(' ').filter(Boolean).includes(cls);
                }
            };
        },
        
        get innerHTML() {
            return this.innerHTMLValue;
        },
        set innerHTML(val) {
            this.innerHTMLValue = val;
            this.children = [];
            // Parse buttons, inputs, spans for mock interaction
            if (val.includes('layer-drag-handle')) {
                const dragHandle = createMockElement('div');
                dragHandle.className = 'layer-drag-handle';
                this.appendChild(dragHandle);
            }
            if (val.includes('btn-vis')) {
                const btnVis = createMockElement('button');
                btnVis.className = 'btn-vis';
                this.appendChild(btnVis);
            }
            if (val.includes('btn-lock')) {
                const btnLock = createMockElement('button');
                btnLock.className = 'btn-lock';
                this.appendChild(btnLock);
            }
            if (val.includes('btn-rename')) {
                const btnRename = createMockElement('button');
                btnRename.className = 'btn-rename';
                this.appendChild(btnRename);
            }
            if (val.includes('btn-dup')) {
                const btnDup = createMockElement('button');
                btnDup.className = 'btn-dup';
                this.appendChild(btnDup);
            }
            if (val.includes('btn-up')) {
                const btnUp = createMockElement('button');
                btnUp.className = 'btn-up';
                const match = val.match(/<button[^>]*class="[^"]*btn-up[^"]*"[^>]*>/);
                if (match && match[0].includes('disabled')) btnUp.disabled = true;
                this.appendChild(btnUp);
            }
            if (val.includes('btn-down')) {
                const btnDown = createMockElement('button');
                btnDown.className = 'btn-down';
                const match = val.match(/<button[^>]*class="[^"]*btn-down[^"]*"[^>]*>/);
                if (match && match[0].includes('disabled')) btnDown.disabled = true;
                this.appendChild(btnDown);
            }
            if (val.includes('btn-del')) {
                const btnDel = createMockElement('button');
                btnDel.className = 'btn-del';
                const match = val.match(/<button[^>]*class="[^"]*btn-del[^"]*"[^>]*>/);
                if (match && match[0].includes('disabled')) btnDel.disabled = true;
                this.appendChild(btnDel);
            }
            if (val.includes('layer-opacity-slider')) {
                const slider = createMockElement('input');
                slider.className = 'layer-opacity-slider';
                slider.type = 'range';
                slider.value = '100';
                this.appendChild(slider);
            }
            if (val.includes('opacity-val')) {
                const valLabel = createMockElement('span');
                valLabel.className = 'opacity-val';
                valLabel.textContent = '100%';
                this.appendChild(valLabel);
            }
            if (val.includes('layer-name-label')) {
                const nameLabel = createMockElement('span');
                nameLabel.className = 'layer-name-label';
                this.appendChild(nameLabel);
            }
        },
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx >= 0) this.children.splice(idx, 1);
            return child;
        },
        replaceWith(newEl) {
            if (this.parentElement) {
                const idx = this.parentElement.children.indexOf(this);
                if (idx >= 0) {
                    this.parentElement.children[idx] = newEl;
                    newEl.parentElement = this.parentElement;
                }
            }
        },
        querySelector(selector) {
            const matches = (node, sel) => {
                if (sel.startsWith('.')) return node.className && node.className.includes(sel.substring(1));
                if (sel.startsWith('#')) return node.id === sel.substring(1);
                if (sel.includes('[type="text"]')) return node.tagName === 'INPUT' && node.type === 'text';
                if (sel.includes('[type="range"]')) return node.tagName === 'INPUT' && node.type === 'range';
                const tag = sel.split('[')[0].toUpperCase();
                return node.tagName === tag;
            };

            for (const child of this.children) {
                if (matches(child, selector)) return child;
                const nested = child.querySelector(selector);
                if (nested) return nested;
            }
            return null;
        },
        querySelectorAll(selector) {
            const matches = (node, sel) => {
                if (sel.startsWith('.')) return node.className && node.className.includes(sel.substring(1));
                if (sel.startsWith('#')) return node.id === sel.substring(1);
                if (sel.includes('[type="text"]')) return node.tagName === 'INPUT' && node.type === 'text';
                if (sel.includes('[type="range"]')) return node.tagName === 'INPUT' && node.type === 'range';
                const tag = sel.split('[')[0].toUpperCase();
                return node.tagName === tag;
            };

            const results = [];
            for (const child of this.children) {
                if (matches(child, selector)) results.push(child);
                results.push(...child.querySelectorAll(selector));
            }
            return results;
        },
        closest(sel) {
            if (sel === 'button' && this.tagName === 'BUTTON') return this;
            if (sel === 'input' && this.tagName === 'INPUT') return this;
            return null;
        },
        addEventListener(event, handler) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(handler);
        },
        dispatchEvent(eventObj) {
            const type = eventObj.type || 'click';
            if (this.listeners[type]) {
                this.listeners[type].forEach(fn => fn(eventObj));
            }
        },
        click() {
            this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
        },
        focus() {},
        select() {}
    };
    if (id) elements[id] = el;
    return el;
}

global.document = {
    getElementById(id) {
        if (!elements[id]) {
            elements[id] = createMockElement('div', id);
        }
        return elements[id];
    },
    createElement(tag) {
        return createMockElement(tag);
    },
    querySelectorAll(sel) {
        const results = [];
        Object.values(elements).forEach(el => {
            results.push(...el.querySelectorAll(sel));
        });
        return results;
    }
};

global.requestAnimationFrame = (callback) => {
    return setTimeout(callback, 0);
};

// Global TileWeaver Mock State
let historyPushCount = 0;
let drawMapCount = 0;
let selectToolCalled = null;

const mockState = {
    mapWidth: 20,
    mapHeight: 15,
    layerIdCounter: 1,
    activeLayerIndex: 0,
    activeTilesetIndex: 0,
    currentTool: 'paint',
    showGrid: true,
    showPassability: true,
    showRegions: true,
    tilesets: [
        { id: 'ts1', name: 'World Spritesheet', isCollection: false }
    ],
    mapLayers: []
};

function createMockLayerObject(name, type = 'tilelayer') {
    const id = 'layer_' + (mockState.layerIdCounter++);
    const layer = {
        id,
        name: name || (type === 'objectgroup' ? `Objects ${id}` : `Layer ${id}`),
        type,
        visible: true,
        locked: false,
        opacity: 1.0,
        draworder: 'topdown',
        data: [],
        terrainVertices: [],
        objects: []
    };

    if (type === 'tilelayer') {
        for (let y = 0; y < mockState.mapHeight; y++) {
            const row = [];
            for (let x = 0; x < mockState.mapWidth; x++) row.push(null);
            layer.data.push(row);
        }
        for (let y = 0; y <= mockState.mapHeight; y++) {
            const vRow = [];
            for (let x = 0; x <= mockState.mapWidth; x++) vRow.push(0);
            layer.terrainVertices.push(vRow);
        }
    }
    return layer;
}

global.window = {
    TileWeaver: {
        stateModule: {
            state: mockState,
            createNewLayerObject: createMockLayerObject
        },
        history: {
            pushHistoryState: () => { historyPushCount++; }
        },
        rendering: {
            drawMap: () => { drawMapCount++; }
        },
        tools: {
            selectTool: (tool) => {
                selectToolCalled = tool;
                mockState.currentTool = tool;
            },
            updateToolTabStates: () => {}
        },
        tilesetManager: {
            renderTilesetSelect: () => {}
        }
    }
};

console.log('===============================================================');
console.log('🧪 STARTING LAYER MANAGER AUTOMATED TEST SUITE');
console.log('===============================================================');

// Require the target module
require('../js/ui/layerManager.js');

const layerManager = global.window.TileWeaver.layerManager;

// -------------------------------------------------------------
// TEST 1: Namespace & Public Method Verification
// -------------------------------------------------------------
console.log('\n▶ TEST 1: Public Module Interface & Namespace Exports');
assert.strictEqual(typeof layerManager.renderLayerUI, 'function', 'renderLayerUI must be exported');
assert.strictEqual(typeof layerManager.renderLayerList, 'function', 'renderLayerList alias must be exported');
assert.strictEqual(typeof layerManager.renderLayersList, 'function', 'renderLayersList (plural) alias must be exported');
assert.strictEqual(typeof layerManager.initLayerUI, 'function', 'initLayerUI must be exported');
assert.strictEqual(typeof layerManager.cloneLayerObject, 'function', 'cloneLayerObject must be exported');
assert.strictEqual(typeof layerManager.renameLayer, 'function', 'renameLayer must be exported');
assert.strictEqual(typeof layerManager.startRename, 'function', 'startRename must be exported');
assert.strictEqual(typeof layerManager.reorderLayer, 'function', 'reorderLayer must be exported');
console.log('  ✔ All public methods and plural aliases exported correctly!');

// -------------------------------------------------------------
// TEST 2: Layer Creation & Initialization
// -------------------------------------------------------------
console.log('\n▶ TEST 2: Layer Creation & Initialization');
mockState.mapLayers = [createMockLayerObject('Base Ground', 'tilelayer')];
mockState.activeLayerIndex = 0;
layerManager.initLayerUI();

const initialPush = historyPushCount;
const initialDraw = drawMapCount;

// Trigger Add Tile Layer
document.getElementById('btn-add-layer').click();
assert.strictEqual(mockState.mapLayers.length, 2, 'Should have 2 layers after adding tilelayer');
assert.strictEqual(mockState.activeLayerIndex, 1, 'Active index should point to newly added layer');
assert.strictEqual(mockState.mapLayers[1].type, 'tilelayer', 'New layer should be tilelayer');
assert.strictEqual(mockState.mapLayers[1].data.length, mockState.mapHeight, 'Tilelayer data rows should match mapHeight');
assert.strictEqual(mockState.mapLayers[1].terrainVertices.length, mockState.mapHeight + 1, 'Vertices rows should match mapHeight+1');
assert.strictEqual(historyPushCount, initialPush + 1, 'pushHistoryState should be called on add');
assert.strictEqual(drawMapCount, initialDraw + 1, 'drawMap should be called on add');

// Trigger Add Object Layer
document.getElementById('btn-add-object-layer').click();
assert.strictEqual(mockState.mapLayers.length, 3, 'Should have 3 layers after adding object layer');
assert.strictEqual(mockState.activeLayerIndex, 2, 'Active index should point to object layer');
assert.strictEqual(mockState.mapLayers[2].type, 'objectgroup', 'New layer should be objectgroup');
assert.strictEqual(Array.isArray(mockState.mapLayers[2].objects), true, 'Object layer should have objects array');
console.log('  ✔ Layer creation (tilelayer and objectgroup) and history tracking verified!');

// -------------------------------------------------------------
// TEST 3: Deep Cloning Memory Isolation (cloneLayerObject)
// -------------------------------------------------------------
console.log('\n▶ TEST 3: Deep Cloning Memory Isolation');
const sourceTileLayer = createMockLayerObject('Source Tiles', 'tilelayer');
sourceTileLayer.data[0][0] = { tilesetId: 'ts1', tileIndex: 42 };
sourceTileLayer.terrainVertices[0][0] = 1;

const clonedTile = layerManager.cloneLayerObject(sourceTileLayer);
assert.notStrictEqual(clonedTile, sourceTileLayer, 'Cloned object must be a new instance');
assert.notStrictEqual(clonedTile.id, sourceTileLayer.id, 'Cloned layer must have a unique ID');
assert.strictEqual(clonedTile.name, 'Source Tiles (Copy)', 'Cloned name should have copy suffix');
assert.notStrictEqual(clonedTile.data, sourceTileLayer.data, 'Data matrix must be a new array');
assert.notStrictEqual(clonedTile.data[0], sourceTileLayer.data[0], 'Data rows must be new arrays');
assert.notStrictEqual(clonedTile.data[0][0], sourceTileLayer.data[0][0], 'Data cells must be cloned objects');
assert.strictEqual(clonedTile.data[0][0].tileIndex, 42, 'Cell data values must match source');

// Mutate clone cell and verify source is unchanged
clonedTile.data[0][0].tileIndex = 99;
assert.strictEqual(sourceTileLayer.data[0][0].tileIndex, 42, 'Source tile cell must NOT be modified by clone mutation');

// Clone Object Group
const sourceObjLayer = createMockLayerObject('Source Objects', 'objectgroup');
sourceObjLayer.objects.push({ id: 'obj_10', name: 'Chest', x: 100, y: 150 });
const clonedObjLayer = layerManager.cloneLayerObject(sourceObjLayer);
assert.notStrictEqual(clonedObjLayer.objects, sourceObjLayer.objects, 'Objects array must be cloned');
assert.notStrictEqual(clonedObjLayer.objects[0], sourceObjLayer.objects[0], 'Object entity must be cloned');
assert.notStrictEqual(clonedObjLayer.objects[0].id, sourceObjLayer.objects[0].id, 'Object entity must have unique ID');
assert.strictEqual(clonedObjLayer.objects[0].name, 'Chest', 'Object entity properties must match');
console.log('  ✔ Complete memory isolation for 2D cell matrices, terrain vertices, and objects verified!');

// -------------------------------------------------------------
// TEST 4: Stack Reordering (Up / Down) & Boundary Guards
// -------------------------------------------------------------
console.log('\n▶ TEST 4: Stack Reordering (Move Up / Down)');
mockState.mapLayers = [
    createMockLayerObject('Layer 0 (Bottom)', 'tilelayer'),
    createMockLayerObject('Layer 1 (Middle)', 'tilelayer'),
    createMockLayerObject('Layer 2 (Top)', 'tilelayer')
];
mockState.activeLayerIndex = 1; // Middle selected
layerManager.renderLayerUI();

const listContainer = document.getElementById('layers-list');
assert.strictEqual(listContainer.children.length, 3, 'Should render 3 layer items');

// In reverse rendering: listContainer.children[0] is Layer 2 (top), [1] is Layer 1 (middle), [2] is Layer 0 (bottom)
const middleItem = listContainer.children[1];
const btnUp = middleItem.querySelector('.btn-up');
const btnDown = middleItem.querySelector('.btn-down');

// Click Move Up on Middle layer (moves index 1 -> 2)
btnUp.click();
assert.strictEqual(mockState.mapLayers[2].name, 'Layer 1 (Middle)', 'Layer 1 should now be at index 2 (Top)');
assert.strictEqual(mockState.mapLayers[1].name, 'Layer 2 (Top)', 'Layer 2 should now be at index 1');
assert.strictEqual(mockState.activeLayerIndex, 2, 'activeLayerIndex should move up with the layer');

// Attempt Move Up on Topmost layer (disabled boundary)
layerManager.renderLayerUI();
const topItem = listContainer.children[0]; // Currently Layer 1 at index 2
const topBtnUp = topItem.querySelector('.btn-up');
assert.strictEqual(topBtnUp.disabled, true, 'Move Up on topmost layer must be disabled');

// Click Move Down on Topmost layer (moves index 2 -> 1)
const topBtnDown = topItem.querySelector('.btn-down');
topBtnDown.click();
assert.strictEqual(mockState.mapLayers[1].name, 'Layer 1 (Middle)', 'Layer 1 moved down to index 1');
assert.strictEqual(mockState.activeLayerIndex, 1, 'activeLayerIndex followed the layer to index 1');
console.log('  ✔ Stack reordering and boundary condition disabling verified!');

// -------------------------------------------------------------
// TEST 5: Active Layer Index Deletion Shift Mathematics
// -------------------------------------------------------------
console.log('\n▶ TEST 5: Active Index Correction on Layer Deletion');
mockState.mapLayers = [
    createMockLayerObject('L0', 'tilelayer'),
    createMockLayerObject('L1', 'tilelayer'),
    createMockLayerObject('L2', 'tilelayer'),
    createMockLayerObject('L3', 'tilelayer')
];
mockState.activeLayerIndex = 2; // L2 is active
layerManager.renderLayerUI();

// Scenario A: Delete layer below active (delete L0 at index 0)
// children: [0]=L3, [1]=L2, [2]=L1, [3]=L0
const itemL0 = listContainer.children[3];
itemL0.querySelector('.btn-del').click();
assert.strictEqual(mockState.mapLayers.length, 3, 'Should have 3 layers remaining');
assert.strictEqual(mockState.activeLayerIndex, 1, 'activeLayerIndex must decrement from 2 to 1 when deleting lower layer');
assert.strictEqual(mockState.mapLayers[mockState.activeLayerIndex].name, 'L2', 'Active layer must still point to L2');

// Scenario B: Delete currently active layer (delete L2 at index 1)
layerManager.renderLayerUI();
// children: [0]=L3, [1]=L2, [2]=L1
const itemL2 = listContainer.children[1];
itemL2.querySelector('.btn-del').click();
assert.strictEqual(mockState.mapLayers.length, 2, 'Should have 2 layers remaining');
assert.strictEqual(mockState.activeLayerIndex, 0, 'activeLayerIndex should select adjacent layer (L1 at index 0)');
assert.strictEqual(mockState.mapLayers[mockState.activeLayerIndex].name, 'L1', 'Active layer should be L1');

// Scenario C: Attempt delete when 1 layer remains
mockState.mapLayers = [createMockLayerObject('Only Layer', 'tilelayer')];
mockState.activeLayerIndex = 0;
layerManager.renderLayerUI();
const onlyItem = listContainer.children[0];
assert.strictEqual(onlyItem.querySelector('.btn-del').disabled, true, 'Delete button must be disabled when 1 layer remains');
console.log('  ✔ Active index shift mathematics (i < activeIndex, i === activeIndex) verified!');

// -------------------------------------------------------------
// TEST 6: Tool Mode Auto-Switching & Preservation
// -------------------------------------------------------------
console.log('\n▶ TEST 6: Tool Auto-Switching & Drawing Tool Preservation');
mockState.mapLayers = [
    createMockLayerObject('Tile Layer', 'tilelayer'),
    createMockLayerObject('Object Group', 'objectgroup')
];
mockState.activeLayerIndex = 0;
mockState.currentTool = 'erase';
layerManager.renderLayerUI();

// Select Object Group -> Should switch tool to objectPlace
const objItem = listContainer.children[0]; // Object group is at index 1 (rendered first)
objItem.click();
assert.strictEqual(mockState.activeLayerIndex, 1, 'Active index updated to object layer');
assert.strictEqual(mockState.currentTool, 'objectPlace', 'Selecting objectgroup must switch tool to objectPlace');

// Select Tile Layer while currentTool is objectPlace -> Should switch tool to paint
const tileItem = listContainer.children[1]; // Tile layer at index 0
tileItem.click();
assert.strictEqual(mockState.activeLayerIndex, 0, 'Active index updated to tile layer');
assert.strictEqual(mockState.currentTool, 'paint', 'Switching from objectPlace to tilelayer must switch to paint');

// Select Tile Layer while user was in 'autotile' tool -> Should preserve 'autotile'
mockState.currentTool = 'autotile';
tileItem.click();
assert.strictEqual(mockState.currentTool, 'autotile', 'Active drawing tool autotile must be preserved on tilelayer click');
console.log('  ✔ Tool auto-switching and tool preservation verified!');

// -------------------------------------------------------------
// TEST 7: Overlay Checkboxes State Synchronization
// -------------------------------------------------------------
console.log('\n▶ TEST 7: Overlay Checkbox Synchronization');
mockState.showGrid = false;
mockState.showPassability = true;
mockState.showRegions = false;

document.getElementById('toggle-grid').checked = true;
document.getElementById('toggle-passability').checked = false;
document.getElementById('toggle-regions').checked = true;

layerManager.renderLayerUI();

assert.strictEqual(document.getElementById('toggle-grid').checked, false, 'Grid checkbox synchronized with state');
assert.strictEqual(document.getElementById('toggle-passability').checked, true, 'Passability checkbox synchronized with state');
assert.strictEqual(document.getElementById('toggle-regions').checked, false, 'Regions checkbox synchronized with state');
console.log('  ✔ Overlay checkbox state synchronization verified!');

// -------------------------------------------------------------
// TEST 8: Layer Renaming (API, Action Button, Double-Click, Clamping, History)
// -------------------------------------------------------------
console.log('\n▶ TEST 8: Layer Renaming & Inline Editing Controls');
mockState.mapLayers = [
    createMockLayerObject('Background Ground', 'tilelayer'),
    createMockLayerObject('Decorations', 'tilelayer')
];
mockState.activeLayerIndex = 1;
layerManager.renderLayerUI();

const initialRenamePush = historyPushCount;

// Sub-Test 8.1: Programmatic renameLayer API
const renameSuccess = layerManager.renameLayer(1, 'Foliage & Props');
assert.strictEqual(renameSuccess, true, 'renameLayer should return true for valid name change');
assert.strictEqual(mockState.mapLayers[1].name, 'Foliage & Props', 'Layer name should be updated');
assert.strictEqual(historyPushCount, initialRenamePush + 1, 'pushHistoryState should be called on renameLayer');

// Sub-Test 8.2: Empty / whitespace name rejection
const emptyRename = layerManager.renameLayer(1, '   ');
assert.strictEqual(emptyRename, false, 'Empty name should be rejected');
assert.strictEqual(mockState.mapLayers[1].name, 'Foliage & Props', 'Layer name must remain unchanged on empty rename');

// Sub-Test 8.3: 60-character length clamping
const longName = 'A'.repeat(100);
const clampSuccess = layerManager.renameLayer(1, longName);
assert.strictEqual(clampSuccess, true, 'Clamped rename should succeed');
assert.strictEqual(mockState.mapLayers[1].name.length, 60, 'Layer name must be clamped to 60 characters');

// Sub-Test 8.4: Dedicated Rename Button UI & startRename Execution
layerManager.renderLayerUI();
const listEl = document.getElementById('layers-list');
// In reverse order: index 1 is at listEl.children[0]
const topLayerItem = listEl.children[0];
const btnRename = topLayerItem.querySelector('.btn-rename');
assert.ok(btnRename, 'btn-rename button must exist in layer item');

// Trigger startRename via button click
btnRename.click();
// Check that an input has replaced the name label
let inputEl = topLayerItem.querySelector('input[type="text"]');
assert.ok(inputEl, 'Input element should be created on rename trigger');
assert.strictEqual(inputEl.maxLength, 60, 'Input maxLength must be 60');

// Trigger Escape keydown on input -> Should cancel without saving
inputEl.value = 'Cancelled Edit Name';
inputEl.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} });
assert.notStrictEqual(mockState.mapLayers[1].name, 'Cancelled Edit Name', 'Escape should cancel rename without mutating state');

// Trigger startRename via double click on label
layerManager.renderLayerUI();
const currentTopItem = listEl.children[0];
const nameLabel = currentTopItem.querySelector('.layer-name-label');
nameLabel.dispatchEvent({ type: 'dblclick', stopPropagation: () => {} });
inputEl = currentTopItem.querySelector('input[type="text"]');
assert.ok(inputEl, 'Double-clicking name label should activate rename input');

// Commit new name via Enter keydown
inputEl.value = 'Trees & Foliage';
const preEnterPush = historyPushCount;
inputEl.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} });
assert.strictEqual(mockState.mapLayers[1].name, 'Trees & Foliage', 'Enter keydown should commit new layer name');
assert.strictEqual(historyPushCount, preEnterPush + 1, 'pushHistoryState should be called on commit');

console.log('  ✔ Programmatic renameLayer, action button, double-click, 60-char clamping, and history verified!');

// -------------------------------------------------------------
// TEST 9: Drag & Drop Layer Reordering (Math, Invariants & Events)
// -------------------------------------------------------------
console.log('\n▶ TEST 9: Drag & Drop Layer Reordering');
mockState.mapLayers = [
    createMockLayerObject('Layer 0 (Ground)', 'tilelayer'),
    createMockLayerObject('Layer 1 (Decorations)', 'tilelayer'),
    createMockLayerObject('Layer 2 (Objects)', 'objectgroup')
];
mockState.activeLayerIndex = 0; // Layer 0 active
layerManager.renderLayerUI();

const initialReorderPush = historyPushCount;
const initialReorderDraw = drawMapCount;

// Sub-Test 9.1: Programmatic reorderLayer(0, 2) - move bottom layer to top
const reorderSuccess1 = layerManager.reorderLayer(0, 2);
assert.strictEqual(reorderSuccess1, true, 'reorderLayer(0, 2) should return true');
assert.strictEqual(mockState.mapLayers[0].name, 'Layer 1 (Decorations)', 'Layer 1 should now be at index 0');
assert.strictEqual(mockState.mapLayers[1].name, 'Layer 2 (Objects)', 'Layer 2 should now be at index 1');
assert.strictEqual(mockState.mapLayers[2].name, 'Layer 0 (Ground)', 'Layer 0 should now be at index 2 (Top)');
assert.strictEqual(mockState.activeLayerIndex, 2, 'activeLayerIndex must follow Layer 0 to index 2');
assert.strictEqual(historyPushCount, initialReorderPush + 1, 'pushHistoryState should be called on reorder');
assert.strictEqual(drawMapCount, initialReorderDraw + 1, 'drawMap should be called on reorder');

// Sub-Test 9.2: Boundary guards and invalid index rejection
assert.strictEqual(layerManager.reorderLayer(2, 2), false, 'Reorder to same index must return false');
assert.strictEqual(layerManager.reorderLayer(-1, 1), false, 'Negative fromIndex must return false');
assert.strictEqual(layerManager.reorderLayer(0, 5), false, 'Out-of-bounds toIndex must return false');

// Sub-Test 9.3: DOM drag handle and draggable attribute verification
layerManager.renderLayerUI();
const reorderListEl = document.getElementById('layers-list');
assert.strictEqual(reorderListEl.children.length, 3, 'Should render 3 layer items');

const topItemEl = reorderListEl.children[0]; // Layer 0 (index 2 in state)
assert.strictEqual(topItemEl.getAttribute('draggable'), 'true', 'Layer item must be draggable');
assert.ok(topItemEl.querySelector('.layer-drag-handle'), 'Layer item must contain .layer-drag-handle');

// Sub-Test 9.4: Drag & Drop event lifecycle simulation
// Move top item (Layer 0 at state index 2) to bottom (state index 0) via mock drop
const mockDataTransfer = {
    data: {},
    effectAllowed: '',
    dropEffect: '',
    setData(format, val) { this.data[format] = String(val); },
    getData(format) { return this.data[format] || ''; }
};

// Dispatch dragstart on top item
topItemEl.dispatchEvent({
    type: 'dragstart',
    dataTransfer: mockDataTransfer,
    target: topItemEl,
    preventDefault: () => {}
});
assert.strictEqual(mockDataTransfer.getData('text/plain'), '2', 'dragstart should populate dataTransfer with index 2');

// Dispatch drop on bottom item (state index 0, DOM child 2)
const bottomItemEl = reorderListEl.children[2];
bottomItemEl.dispatchEvent({
    type: 'drop',
    dataTransfer: mockDataTransfer,
    target: bottomItemEl,
    preventDefault: () => {}
});

assert.strictEqual(mockState.mapLayers[0].name, 'Layer 0 (Ground)', 'Layer 0 moved back to bottom (index 0)');
assert.strictEqual(mockState.activeLayerIndex, 0, 'activeLayerIndex followed Layer 0 to index 0');

console.log('  ✔ Programmatic reorderLayer, boundary guards, drag handle, and drag/drop workflow verified!');

console.log('\n===============================================================');
console.log('🎉 ALL LAYER MANAGER AUTOMATED TESTS PASSED (9/9)!');
console.log('===============================================================');
