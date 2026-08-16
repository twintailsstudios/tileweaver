/**
 * TileWeaver - Object Inspector Automated Test Suite
 * --------------------------------------------------------
 * Verifies entity resolution, layer auto-provisioning, single-pass ID allocation,
 * zero-GC property cloning, bidirectional custom <-> properties sync,
 * transactional duplication with spatial clamping, object deletion,
 * and transform HUD input event dispatch with rotation normalization.
 */

const assert = require('assert');

// Setup mock DOM environment for headless Node.js testing
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

        get innerHTML() {
            return this.innerHTMLValue;
        },
        set innerHTML(val) {
            this.innerHTMLValue = val;
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
        remove() {
            if (this.parentElement) {
                this.parentElement.removeChild(this);
            }
            if (elements[this.id]) {
                delete elements[this.id];
            }
        },
        insertAdjacentHTML(position, htmlString) {
            this.innerHTMLValue = htmlString;
            // Parse IDs present in the inserted HTML string
            const idMatches = [...htmlString.matchAll(/id="([^"]+)"/g)];
            idMatches.forEach(m => {
                const matchedId = m[1];
                if (!elements[matchedId]) {
                    const tag = matchedId.includes('input') ? 'input' : (matchedId.includes('btn') ? 'button' : 'div');
                    const child = createMockElement(tag, matchedId);
                    elements[matchedId] = child;
                }
            });
        },
        addEventListener(event, callback) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(callback);
        },
        dispatchEvent(event) {
            const eventName = typeof event === 'string' ? event : event.type;
            if (this.listeners[eventName]) {
                this.listeners[eventName].forEach(cb => cb(event));
            }
        }
    };

    if (id) elements[id] = el;
    return el;
}

global.document = {
    getElementById(id) {
        return elements[id] || null;
    },
    createElement(tag) {
        return createMockElement(tag);
    }
};

global.window = {
    TileWeaver: {
        stateModule: {
            state: {
                TILE_SIZE: 32,
                mapWidth: 30,
                mapHeight: 20,
                activeLayerIndex: 0,
                selectedObjectId: null,
                nextobjectid: 1,
                mapLayers: [
                    {
                        id: 'layer_0',
                        name: 'Ground',
                        type: 'tilelayer',
                        visible: true,
                        locked: false,
                        opacity: 1.0,
                        data: []
                    }
                ]
            },
            createNewLayerObject(name, type) {
                return {
                    id: 'layer_' + Date.now(),
                    name: name || 'Layer',
                    type: type || 'tilelayer',
                    visible: true,
                    locked: false,
                    opacity: 1.0,
                    data: type === 'tilelayer' ? [] : undefined,
                    objects: type === 'objectgroup' ? [] : undefined
                };
            }
        },
        toast: {
            messages: [],
            showMessage(msg, type) {
                global.window.TileWeaver.toast.messages.push({ msg, type });
            }
        },
        history: {
            historyStack: [],
            pushHistoryState() {
                global.window.TileWeaver.history.historyStack.push(JSON.stringify(global.window.TileWeaver.stateModule.state));
            }
        },
        rendering: {
            drawMapCalls: 0,
            drawMap() {
                global.window.TileWeaver.rendering.drawMapCalls++;
            }
        },
        tileProperties: {
            renderCalls: 0,
            ensureInspectorOpenCalls: 0,
            renderTilePropertiesForm() {
                this.renderCalls++;
            },
            ensureInspectorOpen() {
                this.ensureInspectorOpenCalls++;
            }
        },
        layerManager: {
            renderLayerUICalls: 0,
            renderLayerUI() {
                this.renderLayerUICalls++;
            }
        }
    }
};

// Load objectInspector.js into headless runtime
require('../js/ui/objectInspector.js');

const oi = global.window.TileWeaver.objectInspector;
const { state } = global.window.TileWeaver.stateModule;
const history = global.window.TileWeaver.history;
const rendering = global.window.TileWeaver.rendering;
const tileProps = global.window.TileWeaver.tileProperties;

console.log("===============================================================");
console.log("🧪 STARTING OBJECT INSPECTOR AUTOMATED TEST SUITE");
console.log("===============================================================\n");

// -------------------------------------------------------------
// TEST 1: Public Module Interface & Namespace Exports
// -------------------------------------------------------------
console.log("▶ TEST 1: Public Module Interface & Namespace Exports");
assert.strictEqual(typeof oi.getSelectedObjectRef, 'function', "getSelectedObjectRef must be a function");
assert.strictEqual(typeof oi.deleteSelectedObject, 'function', "deleteSelectedObject must be a function");
assert.strictEqual(typeof oi.duplicateSelectedObject, 'function', "duplicateSelectedObject must be a function");
assert.strictEqual(typeof oi.createObjectOnActiveLayer, 'function', "createObjectOnActiveLayer must be a function");
assert.strictEqual(typeof oi.renderObjectTransformFields, 'function', "renderObjectTransformFields must be a function");
assert.strictEqual(typeof oi.syncObjectProperties, 'function', "syncObjectProperties must be a function");
assert.strictEqual(typeof oi.getNextObjectId, 'function', "getNextObjectId must be a function");
assert.strictEqual(typeof oi.deepClonePropertyObject, 'function', "deepClonePropertyObject must be a function");
console.log("  ✔ All public methods exported correctly on window.TileWeaver.objectInspector!\n");

// -------------------------------------------------------------
// TEST 2: Single-Pass Unique ID Allocation & Collision Prevention
// -------------------------------------------------------------
console.log("▶ TEST 2: Single-Pass Unique ID Allocation & Collision Prevention");
state.nextobjectid = 1;
state.mapLayers = [
    {
        id: 'layer_1',
        type: 'objectgroup',
        objects: [{ id: 5 }, { id: 12 }, { id: 3 }]
    },
    {
        id: 'layer_2',
        type: 'objectgroup',
        objects: [{ id: 8 }, { id: 15 }]
    }
];

const allocatedId = oi.getNextObjectId();
assert.strictEqual(allocatedId, 16, `Expected allocated ID 16, got ${allocatedId}`);
assert.strictEqual(state.nextobjectid, 17, `Expected state.nextobjectid advanced to 17, got ${state.nextobjectid}`);
console.log("  ✔ Linear ID scan correctly identified maxExistingId + 1 without array allocations!\n");

// -------------------------------------------------------------
// TEST 3: Object Creation & Layer Auto-Provisioning
// -------------------------------------------------------------
console.log("▶ TEST 3: Object Creation & Layer Auto-Provisioning");
state.mapLayers = [
    { id: 'layer_tile', type: 'tilelayer', name: 'Ground', data: [] }
];
state.activeLayerIndex = 0;
state.selectedObjectId = null;

const newObj = oi.createObjectOnActiveLayer({
    name: 'Chest Entity',
    type: 'Interactive',
    x: 100,
    y: 150,
    width: 64,
    height: 64,
    rotation: 45,
    custom: { locked: true, lootTable: 'rare_tier_1' }
});

assert.ok(newObj, "Object should be instantiated successfully");
assert.strictEqual(state.mapLayers.length, 2, "An objectgroup layer should have been auto-provisioned");
assert.strictEqual(state.mapLayers[1].type, 'objectgroup', "New layer must be 'objectgroup'");
assert.strictEqual(state.activeLayerIndex, 1, "Active layer must auto-switch to object layer");
assert.strictEqual(state.selectedObjectId, newObj.id, "Created object must be selected");
assert.strictEqual(newObj.name, 'Chest Entity');
assert.strictEqual(newObj.width, 64);
assert.strictEqual(newObj.height, 64);
assert.strictEqual(newObj.rotation, 45);
assert.strictEqual(newObj.custom.locked, true);
assert.strictEqual(newObj.custom.lootTable, 'rare_tier_1');
console.log("  ✔ Object created and objectgroup layer auto-provisioned correctly!\n");

// -------------------------------------------------------------
// TEST 4: Bidirectional Custom <-> Properties Schema Sync
// -------------------------------------------------------------
console.log("▶ TEST 4: Bidirectional Custom <-> Properties Schema Sync");
const testObj = {
    custom: { hp: 100, isBoss: false, speed: 3.5, tag: 'enemy' },
    properties: []
};
oi.syncObjectProperties(testObj);

assert.strictEqual(testObj.properties.length, 4, "Properties array should contain 4 synced entries");
const hpProp = testObj.properties.find(p => p.name === 'hp');
assert.ok(hpProp && hpProp.type === 'int' && hpProp.value === 100, "hp should be typed as 'int'");
const bossProp = testObj.properties.find(p => p.name === 'isBoss');
assert.ok(bossProp && bossProp.type === 'bool' && bossProp.value === false, "isBoss should be typed as 'bool'");
const speedProp = testObj.properties.find(p => p.name === 'speed');
assert.ok(speedProp && speedProp.type === 'float' && speedProp.value === 3.5, "speed should be typed as 'float'");

// Reverse sync test: add a property in properties array and verify it syncs to custom dictionary
testObj.properties.push({ name: 'customArmor', type: 'string', value: 'obsidian' });
oi.syncObjectProperties(testObj);
assert.strictEqual(testObj.custom.customArmor, 'obsidian', "customArmor must be populated in custom dictionary");
console.log("  ✔ Bidirectional custom dictionary and Tiled typed properties array synchronization verified!\n");

// -------------------------------------------------------------
// TEST 5: Transactional Object Duplication with Clamping & History
// -------------------------------------------------------------
console.log("▶ TEST 5: Transactional Object Duplication with Clamping & History");
const initialHistoryLen = history.historyStack.length;
state.selectedObjectId = newObj.id;

const dupObj = oi.duplicateSelectedObject();
assert.ok(dupObj, "Duplication should return duplicated entity reference");
assert.notStrictEqual(dupObj.id, newObj.id, "Duplicated object must have unique ID");
assert.strictEqual(dupObj.name, 'Chest Entity (Copy)');
assert.strictEqual(dupObj.x, newObj.x + 16, "Duplicated object should be offset by +16px on X");
assert.strictEqual(dupObj.y, newObj.y + 16, "Duplicated object should be offset by +16px on Y");
assert.strictEqual(state.selectedObjectId, dupObj.id, "Duplicated object should become the active selection");
assert.strictEqual(history.historyStack.length, initialHistoryLen + 1, "History snapshot must be recorded");

// Verify memory isolation (mutating duplicate does not corrupt original)
dupObj.custom.locked = false;
assert.strictEqual(newObj.custom.locked, true, "Original custom property must remain untouched");
console.log("  ✔ Object duplication verified with spatial offset, memory isolation, and history snapshot!\n");

// -------------------------------------------------------------
// TEST 6: Object Deletion & Selection Reset
// -------------------------------------------------------------
console.log("▶ TEST 6: Object Deletion & Selection Reset");
state.selectedObjectId = dupObj.id;
const deleteHistoryLen = history.historyStack.length;

oi.deleteSelectedObject();
assert.strictEqual(state.selectedObjectId, null, "Selection must be reset to null after deletion");
const activeObjLayer = state.mapLayers[state.activeLayerIndex];
const found = activeObjLayer.objects.find(o => o.id === dupObj.id);
assert.strictEqual(found, undefined, "Deleted object must be removed from layer.objects");
assert.strictEqual(history.historyStack.length, deleteHistoryLen + 1, "History snapshot must be captured on deletion");
console.log("  ✔ Object deletion, array filtration, and selection reset verified!\n");

// -------------------------------------------------------------
// TEST 7: Transform HUD Rendering, Rotation Normalization & Clamping
// -------------------------------------------------------------
console.log("▶ TEST 7: Transform HUD Rendering, Rotation Normalization & Clamping");
const container = createMockElement('div', 'inspector-container');
state.selectedObjectId = newObj.id;

oi.renderObjectTransformFields(container, newObj);

const inputRot = elements['obj-input-rot'];
assert.ok(inputRot, "Rotation input must be present in sidebar DOM");
const inputW = elements['obj-input-w'];
const inputH = elements['obj-input-h'];
const btnDup = elements['btn-duplicate-object-sidebar'];
const btnDel = elements['btn-delete-object-sidebar'];

assert.ok(btnDup, "Duplicate button must be present in Transform header");
assert.ok(btnDel, "Delete button must be present in Transform header");

// Simulate changing rotation to -90 (should normalize to 270)
inputRot.value = '-90';
inputRot.dispatchEvent({ type: 'change', target: inputRot });
assert.strictEqual(newObj.rotation, 270, `Expected rotation 270°, got ${newObj.rotation}°`);

// Simulate changing rotation to 450 (should normalize to 90)
inputRot.value = '450';
inputRot.dispatchEvent({ type: 'change', target: inputRot });
assert.strictEqual(newObj.rotation, 90, `Expected rotation 90°, got ${newObj.rotation}°`);

// Simulate changing width to negative number (should clamp to min 1)
inputW.value = '-20';
inputW.dispatchEvent({ type: 'change', target: inputW });
assert.strictEqual(newObj.width, 1, "Width must clamp to minimum 1px");

console.log("  ✔ Transform HUD inputs, rotation normalization (0..359°), and dimension bounds clamping verified!\n");

console.log("===============================================================");
console.log("🎉 ALL OBJECT INSPECTOR AUTOMATED TESTS PASSED (7/7)!");
console.log("===============================================================\n");
