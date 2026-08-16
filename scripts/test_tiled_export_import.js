const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Mock browser globals needed by window.TileWeaver
global.window = {};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            const canvas = createCanvas(160, 160);
            return canvas;
        }
        return { click: () => {}, style: {} };
    },
    getElementById: () => null
};
global.Image = function() {
    const canvas = createCanvas(160, 160);
    let _src = '';
    Object.defineProperty(canvas, 'src', {
        get: () => _src,
        set: (v) => {
            _src = v;
            setTimeout(() => { if (canvas.onload) canvas.onload(); }, 1);
        }
    });
    return canvas;
};
global.Blob = function(content) { return content; };
global.URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {}
};

// Load modular JS files in proper boot sequence
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.autotile = { drawAutotileCellSubQuadrants: () => {} };
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/rendering.js');
require('../js/ui/terrainSwatches.js');
require('../js/engine/exportImport.js');

const { state } = window.TileWeaver.stateModule;
const { exportTiledTMJ, importMapJSON } = window.TileWeaver.exportImport;

async function runTest() {
    console.log('--- STARTING TILED JSON EXPORT/IMPORT & ASSETS MATCHING TEST ---');

    // 1. Setup mock map state
    state.mapWidth = 4;
    state.mapHeight = 4;
    state.TILE_SIZE = 32;

    const grassImg = await loadImage(fs.readFileSync('./assets/grass_meadow.png'));
    const dirtImg = await loadImage(fs.readFileSync('./assets/dirt_path.png'));

    state.tilesets = [
        {
            id: 'ts_grass',
            name: 'Grass Meadow',
            filename: 'grass_meadow.png',
            image: grassImg,
            margin: 0,
            spacing: 0,
            tileProperties: {
                '0_0': { passability: 1, tag: 'grass' }
            }
        },
        {
            id: 'ts_dirt',
            name: 'Dirt Path',
            filename: 'dirt_path.png',
            image: dirtImg,
            margin: 0,
            spacing: 0,
            tileProperties: {
                '1_1': { passability: 2, tag: 'dirt_center' }
            }
        }
    ];

    state.autotiles = [
        {
            id: 'auto_1',
            name: 'Grass Meadow Terrain',
            mode: 'dualgrid',
            tilesetId: 'ts_grass',
            mat1Name: 'Grass Meadow',
            mat2Name: 'Dirt Ground',
            mapping: { grid_0: { tx: 0, ty: 0 }, grid_15: { tx: 1, ty: 1 } }
        }
    ];

    state.animatedTiles = [
        {
            id: 'anim_water',
            name: 'Water Anim',
            tilesetId: 'ts_grass',
            frames: [{ tx: 0, ty: 3 }, { tx: 1, ty: 3 }, { tx: 2, ty: 3 }],
            frameDurationMs: 250
        }
    ];

    state.passabilityGrid = [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 0, 0, 0],
        [1, 1, 1, 1]
    ];

    state.regionGrid = [
        [1, 1, 2, 2],
        [1, 1, 2, 2],
        [0, 0, 0, 0],
        [5, 5, 5, 5]
    ];

    // Layer 1
    const l1Data = [];
    for (let y = 0; y < 4; y++) {
        const row = [];
        for (let x = 0; x < 4; x++) {
            if (x === 0 && y === 0) {
                row.push({ tilesetId: 'ts_grass', tx: 0, ty: 0, flipH: true, flipV: false, rotation: 90 });
            } else if (x === 1 && y === 1) {
                row.push({ tilesetId: 'ts_dirt', tx: 1, ty: 1, flipH: false, flipV: true, rotation: 180 });
            } else {
                row.push(null);
            }
        }
        l1Data.push(row);
    }

    state.mapLayers = [
        {
            id: 'layer_1',
            name: 'Base Ground',
            visible: true,
            locked: false,
            opacity: 1.0,
            data: l1Data,
            terrainVertices: [
                [0, 0, 0, 0, 0],
                [0, 1, 1, 0, 0],
                [0, 1, 1, 0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0]
            ]
        }
    ];

    // Mock downloadFile to capture JSON export string
    let exportedJsonStr = '';
    window.TileWeaver.exportImport.downloadFile = (content, filename) => {
        exportedJsonStr = content;
    };

    // 2. Execute Export
    exportTiledTMJ('test_map.json');

    console.log('✅ Export complete. Validating exported Tiled JSON...');
    const parsed = JSON.parse(exportedJsonStr);

    if (parsed.version !== "1.10" || parsed.type !== "map") {
        throw new Error("Exported JSON is not valid Tiled v1.10 map");
    }
    if (parsed.tilesets.length !== 2) {
        throw new Error(`Expected 2 tilesets, got ${parsed.tilesets.length}`);
    }
    if (parsed.tilesets[0].image !== "assets/grass_meadow.png") {
        throw new Error(`Tileset image path mismatch: expected assets/grass_meadow.png, got ${parsed.tilesets[0].image}`);
    }
    if (parsed.tilesets[1].image !== "assets/dirt_path.png") {
        throw new Error(`Tileset image path mismatch: expected assets/dirt_path.png, got ${parsed.tilesets[1].image}`);
    }

    console.log('✅ Exported tilesets cleanly reference assets/ folder!');

    // 3. Clear State & Execute Import
    state.tilesets = [];
    state.mapLayers = [];
    state.autotiles = [];
    state.passabilityGrid = [];
    state.regionGrid = [];

    // Mock FileReader to feed exported JSON back into importMapJSON
    const mockFile = { name: 'test_map.json' };
    await new Promise((resolve, reject) => {
        global.FileReader = function() {
            this.readAsText = function() {
                const self = this;
                setTimeout(async () => {
                    try {
                        await self.onload({ target: { result: exportedJsonStr } });
                    } catch (err) {
                        reject(err);
                    }
                }, 10);
            };
        };

        importMapJSON(mockFile, () => {
            resolve();
        });
    });

    console.log('✅ Import complete. Verifying reconstructed state...');

    if (state.mapWidth !== 4 || state.mapHeight !== 4) {
        throw new Error(`Map dimensions mismatch: ${state.mapWidth}x${state.mapHeight}`);
    }
    if (state.tilesets.length !== 2) {
        throw new Error(`Reconstructed tileset count mismatch: expected 2, got ${state.tilesets.length}`);
    }
    if (state.tilesets[0].filename !== 'grass_meadow.png' || state.tilesets[1].filename !== 'dirt_path.png') {
        throw new Error(`Tileset filenames mismatch`);
    }

    function getTransformMatrix(rotation, flipH, flipV) {
        const rad = ((rotation || 0) * Math.PI) / 180;
        const cos = Math.round(Math.cos(rad));
        const sin = Math.round(Math.sin(rad));
        const sx = flipH ? -1 : 1;
        const sy = flipV ? -1 : 1;
        return [cos * sx, -sin * sy, sin * sx, cos * sy];
    }

    // Verify tile at (0,0): original matrix vs decoded matrix
    const tile00 = state.mapLayers[0].data[0][0];
    const origM00 = getTransformMatrix(90, true, false);
    const decM00 = getTransformMatrix(tile00.rotation, tile00.flipH, tile00.flipV);
    if (!tile00 || origM00.join(',') !== decM00.join(',')) {
        throw new Error(`Tile at (0,0) GID decoding mismatch: expected matrix ${origM00}, got ${decM00}`);
    }

    // Verify tile at (1,1): original matrix vs decoded matrix
    const tile11 = state.mapLayers[0].data[1][1];
    const origM11 = getTransformMatrix(180, false, true);
    const decM11 = getTransformMatrix(tile11.rotation, tile11.flipH, tile11.flipV);
    if (!tile11 || origM11.join(',') !== decM11.join(',')) {
        throw new Error(`Tile at (1,1) GID decoding mismatch: expected matrix ${origM11}, got ${decM11}`);
    }

    // Verify passability & region grids
    if (state.passabilityGrid[0][2] !== 2 || state.regionGrid[3][0] !== 5) {
        throw new Error(`Passability or Region grid mismatch!`);
    }

    // Verify autotiles & terrain vertices
    if (state.autotiles.length === 0 || state.mapLayers[0].terrainVertices[1][1] !== 1) {
        throw new Error(`Autotiles or terrainVertices mismatch!`);
    }

    // Verify Terrain Swatches & Tileset Settings
    if (!state.materials || state.materials.length === 0) {
        throw new Error(`Terrain Swatches (state.materials) failed to sync upon import!`);
    }
    console.log(`✅ Terrain Swatches UI successfully restored (${state.materials.length} swatches available)`);

    console.log('🎉 ALL TILED JSON EXPORT/IMPORT & ASSET MATCHING TESTS PASSED PERFECTLY!');
}

runTest().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
