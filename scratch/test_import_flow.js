const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Setup mock browser window environment for testing
global.window = {};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return {
                width: 32,
                height: 32,
                getContext: () => ({
                    drawImage: () => {},
                    fillRect: () => {},
                    strokeRect: () => {},
                    fillText: () => {},
                    clearRect: () => {},
                    getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) })
                }),
                toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            };
        }
        return {
            tagName: tag.toUpperCase(),
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            addEventListener: () => {},
            appendChild: () => {},
            setAttribute: () => {},
            removeAttribute: () => {}
        };
    },
    getElementById: (id) => ({
        id,
        value: '',
        innerHTML: '',
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        appendChild: () => {},
        addEventListener: () => {}
    }),
    querySelectorAll: () => []
};

global.Image = class {
    constructor() {
        this.naturalWidth = 1440;
        this.naturalHeight = 960;
        this.width = 1440;
        this.height = 960;
        this.src = '';
    }
};

require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/autotile.js');
require('../js/engine/rendering.js');
require('../js/engine/exportImport.js');
require('../js/ui/terrainSwatches.js');

const { state } = window.TileWeaver.stateModule;
const { importMapJSON } = window.TileWeaver.exportImport;

async function test() {
    const alphaMapPath = path.join(__dirname, '../test/alpha_map.json');
    const alphaMapContent = fs.readFileSync(alphaMapPath, 'utf8');
    const alphaMapParsed = JSON.parse(alphaMapContent);

    console.log("Importing alpha_map.json...");
    await importMapJSON(alphaMapParsed, []);

    console.log("Import result:");
    console.log("- mapWidth:", state.mapWidth);
    console.log("- mapHeight:", state.mapHeight);
    console.log("- TILE_SIZE:", state.TILE_SIZE);
    console.log("- tilesets count:", state.tilesets.length);
    if (state.tilesets.length > 0) {
        console.log("- tilesets[0]:", {
            id: state.tilesets[0].id,
            name: state.tilesets[0].name,
            filename: state.tilesets[0].filename,
            isMissing: state.tilesets[0].isMissing,
            columns: state.tilesets[0].columns,
            margin: state.tilesets[0].margin,
            spacing: state.tilesets[0].spacing
        });
    }
    console.log("- autotiles count:", state.autotiles.length);
    console.log("- mapLayers count:", state.mapLayers.length);

    // Sync terrain swatches
    window.TileWeaver.terrainSwatches.syncMaterialsFromAutotiles();
    console.log("- materials count after sync:", state.materials.length);
    state.materials.forEach(m => {
        console.log(`  * Material: ${m.name} (id: ${m.id}, tilesetId: ${m.tilesetId}, autotiles: ${m.autotileIds.length})`);
    });
}

test();
