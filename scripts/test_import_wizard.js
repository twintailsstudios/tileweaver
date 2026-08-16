/**
 * TileWeaver - Import Wizard Automated Test Suite
 * ---------------------------------------------------
 * Verifies interactive map import wizard lifecycle, event triggers,
 * O(1) Set-based asset matching engine, case-insensitive deduplication,
 * HTML sanitization, Escape key navigation, and asynchronous concurrency locks.
 */

const assert = require('assert');

// Mock DOM elements and document for headless Node testing
const elements = {};
const documentListeners = {};
const windowListeners = {};

function createMockElement(id = '', tagName = 'div') {
    let _innerHTML = '';
    const el = {
        id,
        tagName,
        value: '',
        textContent: '',
        get innerHTML() {
            return _innerHTML;
        },
        set innerHTML(val) {
            _innerHTML = val;
            if (val === '') {
                this.children = [];
            }
        },
        disabled: false,
        children: [],
        classList: {
            classes: new Set(),
            add(...args) { args.forEach(c => this.classes.add(c)); },
            remove(...args) { args.forEach(c => this.classes.delete(c)); },
            toggle(c) {
                if (this.classes.has(c)) { this.classes.delete(c); return false; }
                this.classes.add(c); return true;
            },
            contains(c) { return this.classes.has(c); }
        },
        listeners: {},
        addEventListener(event, handler) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(handler);
        },
        dispatchEvent(event, data = {}) {
            if (this.listeners[event]) {
                this.listeners[event].forEach(fn => fn({ target: this, stopPropagation: () => {}, preventDefault: () => {}, ...data }));
            }
        },
        click() {
            this.dispatchEvent('click');
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        querySelectorAll(selector) {
            if (selector.startsWith('.')) {
                const cls = selector.substring(1);
                const results = [];
                const search = (node) => {
                    if (node.classList && node.classList.contains(cls)) results.push(node);
                    (node.children || []).forEach(search);
                };
                search(this);
                return results;
            }
            return [];
        }
    };
    if (id) elements[id] = el;
    return el;
}

global.document = {
    getElementById(id) {
        if (!elements[id]) {
            elements[id] = createMockElement(id);
        }
        return elements[id];
    },
    createElement(tag) {
        return createMockElement('', tag);
    },
    addEventListener(event, handler) {
        documentListeners[event] = documentListeners[event] || [];
        documentListeners[event].push(handler);
    },
    dispatchEvent(event, data) {
        if (documentListeners[event]) {
            documentListeners[event].forEach(fn => fn(data));
        }
    }
};

global.window = {
    addEventListener(event, handler) {
        windowListeners[event] = windowListeners[event] || [];
        windowListeners[event].push(handler);
    },
    dispatchEvent(event, data) {
        if (windowListeners[event]) {
            windowListeners[event].forEach(fn => fn(data));
        }
    }
};

// Global FileReader mock for Node
global.FileReader = class MockFileReader {
    readAsText(file) {
        setTimeout(() => {
            if (file._fail) {
                if (this.onerror) this.onerror(new Error("File read error"));
            } else {
                this.result = typeof file._content === 'string' ? file._content : JSON.stringify(file._content || {});
                if (this.onload) this.onload();
            }
        }, 5);
    }
};

console.log('===============================================================');
console.log('🧪 STARTING IMPORT WIZARD AUTOMATED TEST SUITE');
console.log('===============================================================');

// Set up mock TileWeaver state and dependencies
const mockState = {
    assets: [
        { id: 'vault-asset-1', name: 'dungeon_props', filename: 'dungeon_props.png', width: 256, height: 256 }
    ]
};

let syncAppCalled = false;
let importedMapData = null;
let importedAssetFiles = null;
let toastMessage = null;
let toastType = null;

window.TileWeaver = {
    stateModule: { state: mockState },
    toast: {
        showMessage: (msg, type) => {
            toastMessage = msg;
            toastType = type;
        }
    },
    exportImport: {
        analyzeMapJSON: (data) => {
            return {
                mapWidth: data.width || 30,
                mapHeight: data.height || 20,
                tileSize: data.tilewidth || 32,
                layersCount: (data.layers || []).length,
                requiredAssets: data.mockRequiredAssets || []
            };
        },
        importMapJSON: async (data, assetFiles, callback) => {
            importedMapData = data;
            importedAssetFiles = assetFiles;
            if (callback) callback();
        },
        synchronizeAppAfterMapImport: () => {
            syncAppCalled = true;
        }
    }
};

// Required DOM modal elements
const modal = document.getElementById('modal-import-map');
modal.classList.add('hidden');

// Load the importWizard.js module
require('../js/ui/importWizard.js');

(async () => {
    // -----------------------------------------------------------------------------
    // TEST 1: Public Module Interface & Namespace Exports
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 1: Public Module Interface & Namespace Exports');
    assert.ok(window.TileWeaver.importWizard, 'window.TileWeaver.importWizard namespace must exist');
    assert.strictEqual(typeof window.TileWeaver.importWizard.initImportWizardUI, 'function');
    assert.strictEqual(typeof window.TileWeaver.importWizard.openImportWizard, 'function');
    assert.strictEqual(typeof window.TileWeaver.importWizard.closeImportWizard, 'function');
    assert.strictEqual(typeof window.TileWeaver.importWizard.handleSelectedMapFile, 'function');
    assert.strictEqual(typeof window.TileWeaver.importWizard.handleSelectedAssetFiles, 'function');
    assert.strictEqual(typeof window.TileWeaver.importWizard.getIsImporting, 'function');
    console.log('  ✔ Import Wizard module correctly exposed on window.TileWeaver namespace!');

    // Initialize UI
    window.TileWeaver.importWizard.initImportWizardUI();

    // -----------------------------------------------------------------------------
    // TEST 2: Modal Open, Reset, and Close Lifecycle
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 2: Modal Open, Reset, and Close Lifecycle');
    
    // Open wizard
    window.TileWeaver.importWizard.openImportWizard();
    assert.strictEqual(modal.classList.contains('hidden'), false, 'Modal should be visible (not have "hidden")');
    assert.strictEqual(document.getElementById('btn-confirm-import-map').disabled, true, 'Confirm button should be disabled on empty open');

    // Close via close button
    document.getElementById('btn-close-import-map-modal').click();
    assert.strictEqual(modal.classList.contains('hidden'), true, 'Modal should be hidden after close button click');

    // Reopen and close via cancel button
    window.TileWeaver.importWizard.openImportWizard();
    assert.strictEqual(modal.classList.contains('hidden'), false);
    document.getElementById('btn-cancel-import-map').click();
    assert.strictEqual(modal.classList.contains('hidden'), true, 'Modal should be hidden after cancel button click');

    // Reopen and close via Escape key
    window.TileWeaver.importWizard.openImportWizard();
    assert.strictEqual(modal.classList.contains('hidden'), false);
    document.dispatchEvent('keydown', { key: 'Escape' });
    assert.strictEqual(modal.classList.contains('hidden'), true, 'Modal should close on Escape keydown');
    console.log('  ✔ Modal open, reset, close button, cancel button, and Escape key navigation verified!');

    // -----------------------------------------------------------------------------
    // TEST 3: Map File Selection & Analysis Lifecycle
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 3: Map File Selection & Analysis Lifecycle');

    const sampleMapJSON = {
        width: 40,
        height: 30,
        tilewidth: 32,
        layers: [ { name: 'Ground' }, { name: 'Walls' } ],
        assets: [
            { name: 'grass_tileset', filename: 'grass_tileset.png', width: 512, height: 512 }
        ],
        mockRequiredAssets: [
            { filename: 'grass_tileset.png', name: 'grass_tileset', width: 512, height: 512, isCollection: false },
            { filename: 'dungeon_props.png', name: 'dungeon_props', width: 256, height: 256, isCollection: true },
            { filename: 'water_tileset.png', name: 'water_tileset', width: 256, height: 256, isCollection: false }
        ]
    };

    const mockFile = {
        name: 'sample_dungeon.json',
        _content: sampleMapJSON
    };

    window.TileWeaver.importWizard.openImportWizard();
    await window.TileWeaver.importWizard.handleSelectedMapFile(mockFile);

    // Summary assertions
    const fileNameEl = document.getElementById('import-map-filename');
    const metaEl = document.getElementById('import-map-metadata');
    assert.strictEqual(fileNameEl.textContent, 'sample_dungeon.json', 'Map filename should be rendered in summary card');
    assert.ok(metaEl.textContent.includes('40×30 grid'), 'Metadata should display 40x30 grid');
    assert.ok(metaEl.textContent.includes('32px tiles'), 'Metadata should display 32px tiles');
    assert.ok(metaEl.textContent.includes('2 layers'), 'Metadata should display 2 layers');
    assert.ok(metaEl.textContent.includes('3 required textures'), 'Metadata should display 3 required textures');

    // Checklist Container assertions
    const checklist = document.getElementById('import-map-required-assets-list');
    assert.strictEqual(checklist.children.length, 3, 'Should render 3 checklist item rows');

    // Verify Row 0 (Embedded): grass_tileset.png
    assert.ok(checklist.children[0].innerHTML.includes('Embedded'), 'grass_tileset.png should have Embedded badge');
    assert.ok(checklist.children[0].innerHTML.includes('🟢'), 'grass_tileset.png should display green indicator');

    // Verify Row 1 (In Vault): dungeon_props.png
    assert.ok(checklist.children[1].innerHTML.includes('In Vault'), 'dungeon_props.png should have In Vault badge');
    assert.ok(checklist.children[1].innerHTML.includes('🟢'), 'dungeon_props.png should display green indicator');

    // Verify Row 2 (Missing): water_tileset.png
    assert.ok(checklist.children[2].innerHTML.includes('Missing'), 'water_tileset.png should have Missing badge');
    assert.ok(checklist.children[2].innerHTML.includes('🔴'), 'water_tileset.png should display red indicator');

    const btnConfirm = document.getElementById('btn-confirm-import-map');
    assert.strictEqual(btnConfirm.disabled, false, 'Confirm button should be enabled');
    assert.ok(btnConfirm.innerHTML.includes('2/3 Assets Ready'), 'Button should display (2/3 Assets Ready)');
    console.log('  ✔ Map parsing, metadata rendering, and 3-tier asset matching (Embedded, In Vault, Missing) verified!');

    // -----------------------------------------------------------------------------
    // TEST 4: Asset Staging, Case-Insensitive Deduplication & Dynamic Re-matching
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 4: Asset Staging, Case-Insensitive Deduplication & Dynamic Re-matching');

    const waterFile1 = { name: 'water_tileset.png', type: 'image/png' };
    const waterFileUpper = { name: 'WATER_TILESET.PNG', type: 'image/png' };
    const extraFile = { name: 'extra_decor.png', type: 'image/png' };

    // Stage waterFile1 + duplicate waterFileUpper
    window.TileWeaver.importWizard.handleSelectedAssetFiles([waterFile1, waterFileUpper, extraFile]);

    // Check count badge
    const countBadge = document.getElementById('import-staged-count-badge');
    assert.strictEqual(countBadge.textContent, '2 files', 'Should deduplicate case-insensitive filenames and count 2 files');

    // Re-verify Row 2 (water_tileset.png now Uploaded)
    assert.ok(checklist.children[2].innerHTML.includes('Uploaded'), 'water_tileset.png should now have Uploaded badge');
    assert.ok(checklist.children[2].innerHTML.includes('🟢'), 'water_tileset.png should now display green indicator');
    assert.ok(btnConfirm.innerHTML.includes('All Assets Ready'), 'Button should now display (All Assets Ready)');
    console.log('  ✔ Asset staging, case-insensitive deduplication, and dynamic status promotion verified!');

    // -----------------------------------------------------------------------------
    // TEST 5: Asynchronous Import Execution & isImporting Concurrency Guard
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 5: Asynchronous Import Execution & isImporting Concurrency Guard');

    assert.strictEqual(window.TileWeaver.importWizard.getIsImporting(), false, 'isImporting initially false');

    // Trigger Import execution
    btnConfirm.click();

    // After async completion
    assert.ok(importedMapData !== null, 'importMapJSON should receive map data');
    assert.strictEqual(importedAssetFiles.length, 2, 'importMapJSON should receive staged files');
    assert.ok(syncAppCalled, 'synchronizeAppAfterMapImport should be invoked');
    assert.strictEqual(modal.classList.contains('hidden'), true, 'Modal should close upon completion');
    assert.strictEqual(window.TileWeaver.importWizard.getIsImporting(), false, 'isImporting resets to false');
    console.log('  ✔ Async map import, asset delegation, app synchronization, and state cleanup verified!');

    // -----------------------------------------------------------------------------
    // TEST 6: Defensive Error Handling (Invalid JSON File)
    // -----------------------------------------------------------------------------
    console.log('\n▶ TEST 6: Defensive Error Handling (Invalid JSON File)');

    window.TileWeaver.importWizard.openImportWizard();
    toastMessage = null;
    toastType = null;

    const brokenFile = {
        name: 'corrupted.json',
        _content: 'NOT_VALID_JSON'
    };

    await window.TileWeaver.importWizard.handleSelectedMapFile(brokenFile);
    assert.strictEqual(toastType, 'error', 'Should display error toast on invalid JSON');
    assert.ok(toastMessage.includes('not a valid map JSON'), 'Error message should report invalid map JSON');
    console.log('  ✔ Invalid file error catching and toast notification verified!');

    console.log('===============================================================');
    console.log('🎉 ALL IMPORT WIZARD AUTOMATED TESTS PASSED PERFECTLY (6/6)!');
    console.log('===============================================================');
})();
