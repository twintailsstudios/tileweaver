/**
 * Verification Test: Unified Add Tileset Button & Type Selection Modal Dialog
 */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

console.log("--- STARTING UNIFIED ADD TILESET & MODAL VERIFICATION TEST ---");

async function runTests() {
    // 1. Static HTML DOM validation test
    const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    const requiredElementIds = [
        'btn-add-tileset-dock',
        'btn-add-tileset-popout',
        'modal-add-tileset',
        'btn-close-add-tileset-modal',
        'btn-option-normal-tileset',
        'btn-option-collection-tileset',
        'modal-upload-normal-input',
        'modal-upload-collection-input',
        'btn-create-empty-collection-link',
        'btn-cancel-add-tileset'
    ];

    requiredElementIds.forEach(id => {
        if (!htmlContent.includes(`id="${id}"`)) {
            throw new Error(`Required DOM Element #${id} missing from index.html!`);
        }
    });
    console.log("✅ 1. All Unified Add Tileset UI elements verified in index.html!");

    // Verify old duplicate buttons are cleanly replaced
    if (htmlContent.includes('id="btn-create-collection-dock"') || htmlContent.includes('id="btn-create-collection-popout"')) {
        throw new Error("Old duplicate Collection buttons still present in inspector headers!");
    }
    if (htmlContent.includes('id="input-upload-tileset-dock"') || htmlContent.includes('id="input-upload-tileset-popout"')) {
        throw new Error("Old standalone PNG upload labels still present in inspector headers!");
    }
    console.log("✅ 2. Inspector headers cleanly unified without legacy button clutter!");

    // 2. Functional Mock DOM & JavaScript Logic Testing
    const domElements = {};
    function createMockElement(id) {
        const el = {
            id,
            dataset: {},
            classList: {
                _classes: new Set(['hidden']),
                add: function(...cls) { cls.forEach(c => this._classes.add(c)); },
                remove: function(...cls) { cls.forEach(c => this._classes.delete(c)); },
                contains: function(c) { return this._classes.has(c); }
            },
            style: {},
            value: '',
            innerHTML: '',
            textContent: '',
            children: [],
            appendChild: function(c) { this.children.push(c); },
            querySelector: function() {
                return createMockElement('sub_' + Math.random());
            },
            querySelectorAll: function() {
                return [];
            },
            addEventListener: function(event, handler) {
                this._listeners = this._listeners || {};
                this._listeners[event] = this._listeners[event] || [];
                this._listeners[event].push(handler);
            },
            click: function() {
                if (this._listeners && this._listeners['click']) {
                    this._listeners['click'].forEach(h => h({ target: this }));
                }
            },
            triggerChange: function(files) {
                if (this._listeners && this._listeners['change']) {
                    this._listeners['change'].forEach(h => h({ target: { files, value: '' } }));
                }
            }
        };
        domElements[id] = el;
        return el;
    }

    requiredElementIds.forEach(id => createMockElement(id));
    ['tileset-select', 'popout-tileset-select', 'dock-tileset-select', 'dock-collection-grid', 'popout-collection-grid', 'collection-images-grid'].forEach(id => createMockElement(id));

    ['map-canvas', 'tileset-canvas', 'dock-tileset-canvas', 'popout-tileset-canvas'].forEach(id => {
        const canvas = createCanvas(160, 160);
        canvas.id = id;
        canvas.dataset = {};
        canvas.classList = { add: () => {}, remove: () => {}, contains: () => false };
        canvas.style = {};
        canvas.addEventListener = () => {};
        domElements[id] = canvas;
    });

    global.window = {
        addEventListener: () => {},
        removeEventListener: () => {}
    };

    global.document = {
        createElement: (tag) => {
            if (tag === 'canvas') {
                const c = createCanvas(160, 160);
                c.dataset = {};
                return c;
            }
            return createMockElement('elem_' + Math.random());
        },
        getElementById: (id) => domElements[id] || null,
        querySelectorAll: () => []
    };

    global.Image = function(w = 160, h = 160) {
        const canvas = createCanvas(w, h);
        canvas.naturalWidth = w;
        canvas.naturalHeight = h;
        canvas.dataset = {};
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

    // FileReader Mock with proper instance binding
    global.FileReader = function() {
        this.onload = null;
        this.readAsDataURL = function(file) {
            const self = this;
            setTimeout(() => {
                if (self.onload) {
                    self.onload({ target: { result: 'data:image/png;base64,mockImageContent' } });
                }
            }, 2);
        };
    };

    window.TileWeaver = window.TileWeaver || {};
    window.TileWeaver.autotile = { drawAutotileCellSubQuadrants: () => {}, updateAutotileCell: () => {} };
    window.TileWeaver.tools = { selectTool: () => {} };
    window.TileWeaver.history = { pushHistoryState: () => {} };

    require('../js/constants.js');
    require('../js/state.js');
    require('../js/utils/toast.js');
    require('../js/engine/rendering.js');
    require('../js/ui/tilesetManager.js');

    const { state, initMapData } = window.TileWeaver.stateModule;
    initMapData(30, 20);

    const { openAddTilesetModal, closeAddTilesetModal, initTilesetsUI } = window.TileWeaver.tilesetManager;
    initTilesetsUI();

    // Allow initial default procedural tilesets to finish async loading
    await new Promise(r => setTimeout(r, 60));

    // 3. Test Modal Open / Close Logic
    const modal = domElements['modal-add-tileset'];
    if (!modal.classList.contains('hidden')) {
        throw new Error("Modal should be hidden by default");
    }

    openAddTilesetModal();
    if (modal.classList.contains('hidden')) {
        throw new Error("openAddTilesetModal failed to show modal!");
    }
    console.log("✅ 3. openAddTilesetModal successfully unhides dialog!");

    closeAddTilesetModal();
    if (!modal.classList.contains('hidden')) {
        throw new Error("closeAddTilesetModal failed to hide modal!");
    }
    console.log("✅ 4. closeAddTilesetModal successfully hides dialog!");

    // 4. Test Normal Tileset Flow via Unified Modal Input
    const initialTilesetCount = state.tilesets.length;
    const mockNormalFile = {
        name: 'dungeon_bricks.png',
        type: 'image/png'
    };

    // Simulate clicking normal option and file selection
    domElements['btn-option-normal-tileset'].click();
    domElements['modal-upload-normal-input'].triggerChange([mockNormalFile]);

    // Wait for FileReader & Image.onload
    await new Promise(r => setTimeout(r, 50));

    if (state.tilesets.length !== initialTilesetCount + 1) {
        throw new Error(`Expected tileset count ${initialTilesetCount + 1}, got ${state.tilesets.length}`);
    }
    const addedTs = state.tilesets[state.tilesets.length - 1];
    if (addedTs.name !== 'dungeon_bricks' || addedTs.isCollection) {
        throw new Error(`Newly added standard tileset incorrect: ${JSON.stringify(addedTs)}`);
    }
    console.log(`✅ 5. Standard Spritesheet Tileset successfully created: '${addedTs.name}' with firstgid ${addedTs.firstgid}!`);

    // 5. Test Collection Tileset Multi-Image Batch Upload Flow via Unified Modal Input
    const collTilesetCount = state.tilesets.length;
    const mockCollFiles = [
        { name: 'oak_tree.png', type: 'image/png' },
        { name: 'treasure_chest.png', type: 'image/png' }
    ];

    domElements['btn-option-collection-tileset'].click();
    domElements['modal-upload-collection-input'].triggerChange(mockCollFiles);

    // Wait for batch FileReader & Image.onload
    await new Promise(r => setTimeout(r, 60));

    if (state.tilesets.length !== collTilesetCount + 1) {
        throw new Error(`Expected collection tileset count ${collTilesetCount + 1}, got ${state.tilesets.length}`);
    }
    const addedColl = state.tilesets[state.tilesets.length - 1];
    if (!addedColl.isCollection) {
        throw new Error(`Expected collection tileset, got standard tileset`);
    }
    if (addedColl.images.length !== 2) {
        throw new Error(`Expected 2 images in collection, got ${addedColl.images.length}`);
    }
    console.log(`✅ 6. Collection Tileset successfully created: '${addedColl.name}' with ${addedColl.images.length} images!`);

    // 6. Test Empty Collection Link
    const emptyCount = state.tilesets.length;
    domElements['btn-create-empty-collection-link'].click();
    if (state.tilesets.length !== emptyCount + 1) {
        throw new Error("Empty collection link failed to create tileset");
    }
    const emptyColl = state.tilesets[state.tilesets.length - 1];
    if (!emptyColl.isCollection || emptyColl.images.length !== 0) {
        throw new Error("Expected empty collection tileset");
    }
    console.log(`✅ 7. Empty Collection Tileset successfully created: '${emptyColl.name}'!`);

    // 7. Test Pop-Out Modal Open / Close
    const popoutModal = domElements['modal-tileset-popout'] || createMockElement('modal-tileset-popout');
    domElements['btn-dock-popout'] = domElements['btn-dock-popout'] || createMockElement('btn-dock-popout');
    domElements['btn-close-popout'] = domElements['btn-close-popout'] || createMockElement('btn-close-popout');
    
    const { openTilesetPopout, closeTilesetPopout } = window.TileWeaver.tilesetManager;
    openTilesetPopout();
    if (popoutModal.classList.contains('hidden')) {
        throw new Error("openTilesetPopout failed to unhide pop-out modal!");
    }
    if (!state.isTilesetPopoutOpen) {
        throw new Error("state.isTilesetPopoutOpen should be true!");
    }
    console.log("✅ 8. openTilesetPopout successfully unhides pop-out modal!");

    closeTilesetPopout();
    if (!popoutModal.classList.contains('hidden')) {
        throw new Error("closeTilesetPopout failed to hide pop-out modal!");
    }
    if (state.isTilesetPopoutOpen) {
        throw new Error("state.isTilesetPopoutOpen should be false!");
    }
    console.log("✅ 9. closeTilesetPopout successfully hides pop-out modal!");

    // 8. Validate HTML tag structure
    const stack = [];
    const lines = htmlContent.split('\n');
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype']);

    lines.forEach((line, lineIdx) => {
        const tagRegex = /<\/?([a-zA-Z0-9\-]+)(?:\s+[^>]*)?>/g;
        let match;
        while ((match = tagRegex.exec(line)) !== null) {
            const fullTag = match[0];
            const tagName = match[1].toLowerCase();
            
            if (fullTag.startsWith('<!--') || fullTag.endsWith('-->')) continue;
            if (voidTags.has(tagName)) continue;
            if (fullTag.endsWith('/>')) continue;
            
            if (fullTag.startsWith('</')) {
                if (stack.length === 0) {
                    throw new Error(`Extra closing tag </${tagName}> at line ${lineIdx + 1}`);
                }
                const last = stack.pop();
                if (last.tagName !== tagName) {
                    throw new Error(`Mismatched tag: expected </${last.tagName}> (opened line ${last.lineIdx + 1}), found </${tagName}> at line ${lineIdx + 1}`);
                }
            } else {
                stack.push({ tagName, lineIdx, line: line.trim() });
            }
        }
    });
    if (stack.length > 0) {
        throw new Error(`Unclosed HTML tags detected: ${stack.map(s => s.tagName).join(', ')}`);
    }
    console.log("✅ 10. HTML document structure and modal hierarchy 100% verified!");

    console.log("🎉 ALL UNIFIED ADD TILESET & MODAL TESTS PASSED PERFECTLY!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
