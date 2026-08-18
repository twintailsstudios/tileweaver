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
        return { click: () => {}, style: {}, addEventListener: () => {}, classList: { contains: () => false, add: () => {}, remove: () => {} } };
    },
    getElementById: () => null,
    querySelectorAll: () => []
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
require('../js/ui/objectInspector.js');
require('../js/ui/tilesetManager.js');

const { state, recomputeTilesetGids, createNewCollectionTileset, addCollectionImage } = window.TileWeaver.stateModule;
const { exportTiledTMJ, importMapJSON } = window.TileWeaver.exportImport;
const { handleDeleteTileset } = window.TileWeaver.tilesetManager;

async function runScrambleFixTest() {
    console.log('===============================================================');
    console.log('🧪 RUNNING TILESET DELETION & OBJECT SCRAMBLE REGRESSION TEST');
    console.log('===============================================================');

    // 1. Setup Initial Map State
    state.mapWidth = 10;
    state.mapHeight = 10;
    state.TILE_SIZE = 32;

    const grassImg = await loadImage(fs.readFileSync('./assets/grass_meadow.png'));
    const dirtImg = await loadImage(fs.readFileSync('./assets/dirt_path.png'));

    const tsGrass = {
        id: 'ts_grass',
        name: 'Grass Meadow',
        filename: 'grass_meadow.png',
        image: grassImg,
        margin: 0,
        spacing: 0,
        tilewidth: 32,
        tileheight: 32,
        columns: 5,
        tilecount: 25,
        firstgid: 1
    };

    const collProps = createNewCollectionTileset('World Props');
    collProps.id = 'ts_props';
    const imgTree = addCollectionImage(collProps, 'Tree', 'tree.png', new global.Image(64, 96));
    const imgChest = addCollectionImage(collProps, 'Chest', 'chest.png', new global.Image(32, 32));
    const imgRock = addCollectionImage(collProps, 'Rock', 'rock.png', new global.Image(32, 32));

    const tsDirt = {
        id: 'ts_dirt',
        name: 'Dirt Path',
        filename: 'dirt_path.png',
        image: dirtImg,
        margin: 0,
        spacing: 0,
        tilewidth: 32,
        tileheight: 32,
        columns: 5,
        tilecount: 25,
        firstgid: 1
    };

    state.tilesets = [tsGrass, collProps, tsDirt];
    state.activeTilesetIndex = 0;
    recomputeTilesetGids();

    console.log('▶ STEP 1: Initial FirstGID allocations:');
    console.log(`  - Grass firstgid: ${tsGrass.firstgid} (count: 25)`);
    console.log(`  - Props firstgid: ${collProps.firstgid} (count: 3)`);
    console.log(`  - Dirt firstgid:  ${tsDirt.firstgid} (count: 25)`);

    if (tsGrass.firstgid !== 1 || collProps.firstgid !== 26 || tsDirt.firstgid !== 29) {
        throw new Error(`Unexpected initial firstgids: Grass=${tsGrass.firstgid}, Props=${collProps.firstgid}, Dirt=${tsDirt.firstgid}`);
    }

    // 2. Create Object Layer and place 3 objects (one from each tileset)
    const objLayer = window.TileWeaver.stateModule.createNewLayerObject('Entities', 'objectgroup');
    state.mapLayers = [objLayer];
    state.activeLayerIndex = 0;

    // Object 1: Grass tile (tx=2, ty=1 -> localTileId=7)
    const objGrass = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
        name: 'Grass Decor',
        x: 32,
        y: 32,
        width: 32,
        height: 32,
        tilesetId: tsGrass.id,
        tx: 2,
        ty: 1,
        localTileId: 7,
        gid: tsGrass.firstgid + 7 // 1 + 7 = 8
    });

    // Object 2: Chest collection item (tileId=1)
    const objChest = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
        name: 'Treasure Chest',
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        tilesetId: collProps.id,
        imageId: imgChest.id,
        localTileId: imgChest.tileId,
        gid: collProps.firstgid + imgChest.tileId // 26 + 1 = 27
    });

    // Object 3: Dirt tile (tx=3, ty=2 -> localTileId=13)
    const objDirt = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
        name: 'Dirt Patch',
        x: 200,
        y: 200,
        width: 32,
        height: 32,
        tilesetId: tsDirt.id,
        tx: 3,
        ty: 2,
        localTileId: 13,
        gid: tsDirt.firstgid + 13 // 29 + 13 = 42
    });

    console.log(`▶ STEP 2: Placed 3 objects on layer. Total objects: ${objLayer.objects.length}`);
    if (objLayer.objects.length !== 3) {
        throw new Error(`Expected 3 objects, got ${objLayer.objects.length}`);
    }

    // 3. Delete the first tileset (ts_grass at index 0)
    console.log('▶ STEP 3: Deleting first tileset (Grass Meadow)...');
    state.activeTilesetIndex = 0;
    handleDeleteTileset();

    console.log(`  - Remaining tilesets count: ${state.tilesets.length}`);
    console.log(`  - Props new firstgid: ${collProps.firstgid}`);
    console.log(`  - Dirt new firstgid:  ${tsDirt.firstgid}`);
    console.log(`  - Remaining objects on layer: ${objLayer.objects.length}`);

    // Verify Tileset A was deleted and its objects pruned
    if (state.tilesets.length !== 2) {
        throw new Error(`Expected 2 tilesets remaining, got ${state.tilesets.length}`);
    }
    if (collProps.firstgid !== 1 || tsDirt.firstgid !== 4) {
        throw new Error(`Shifted firstgids incorrect: Props=${collProps.firstgid}, Dirt=${tsDirt.firstgid}`);
    }
    if (objLayer.objects.length !== 2) {
        throw new Error(`Expected 2 remaining objects after pruning deleted tileset objects, got ${objLayer.objects.length}`);
    }

    // Verify remaining objects have synchronized GIDs and unaltered intrinsic coordinates
    const remainingChest = objLayer.objects.find(o => o.name === 'Treasure Chest');
    const remainingDirt = objLayer.objects.find(o => o.name === 'Dirt Patch');

    if (!remainingChest || !remainingDirt) {
        throw new Error('Could not find remaining chest or dirt objects!');
    }

    console.log(`  - Chest synced GID: ${remainingChest.gid} (expected 2)`);
    console.log(`  - Dirt synced GID:  ${remainingDirt.gid} (expected 17)`);

    if (remainingChest.gid !== 2) {
        throw new Error(`Chest GID not synchronized! Expected 2, got ${remainingChest.gid}`);
    }
    if (remainingDirt.gid !== 17) {
        throw new Error(`Dirt GID not synchronized! Expected 17 (firstgid 4 + localId 13), got ${remainingDirt.gid}`);
    }
    if (remainingDirt.tx !== 3 || remainingDirt.ty !== 2) {
        throw new Error(`Dirt coordinates corrupted! tx=${remainingDirt.tx}, ty=${remainingDirt.ty}`);
    }

    // 4. Export Map to TMJ JSON
    console.log('▶ STEP 4: Exporting modified map to Tiled TMJ format...');
    let exportedJsonStr = '';
    window.TileWeaver.exportImport.downloadFile = (content) => {
        exportedJsonStr = content;
    };
    exportTiledTMJ('scramble_test.json');

    const tmjParsed = JSON.parse(exportedJsonStr);
    console.log(`  - Exported tileset count: ${tmjParsed.tilesets.length}`);
    console.log(`  - Exported layers count: ${tmjParsed.layers.length}`);
    console.log(`  - Exported objects count: ${tmjParsed.layers[0].objects.length}`);

    const exportedChest = tmjParsed.layers[0].objects.find(o => o.name === 'Treasure Chest');
    const exportedDirt = tmjParsed.layers[0].objects.find(o => o.name === 'Dirt Patch');

    if (exportedChest.gid !== 2) {
        throw new Error(`Exported TMJ chest GID mismatch: expected 2, got ${exportedChest.gid}`);
    }
    if (exportedDirt.gid !== 17) {
        throw new Error(`Exported TMJ dirt GID mismatch: expected 17, got ${exportedDirt.gid}`);
    }

    // 5. Re-import Exported Map to verify clean round-trip
    console.log('▶ STEP 5: Re-importing exported TMJ to verify zero scrambling on round-trip...');
    state.tilesets = [];
    state.mapLayers = [];

    const mockFile = { name: 'scramble_test.json' };
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

    console.log(`  - Re-imported tilesets: ${state.tilesets.length}`);
    console.log(`  - Re-imported layer objects: ${state.mapLayers[0].objects.length}`);

    const importedChest = state.mapLayers[0].objects.find(o => o.name === 'Treasure Chest');
    const importedDirt = state.mapLayers[0].objects.find(o => o.name === 'Dirt Patch');

    if (!importedChest || !importedDirt) {
        throw new Error('Re-imported objects missing!');
    }
    if (importedChest.tilesetId !== collProps.id) {
        throw new Error(`Re-imported chest tilesetId mismatch: expected ${collProps.id}, got ${importedChest.tilesetId}`);
    }
    if (importedDirt.tilesetId !== tsDirt.id || importedDirt.tx !== 3 || importedDirt.ty !== 2) {
        throw new Error(`Re-imported dirt patch mismatch: tilesetId=${importedDirt.tilesetId}, tx=${importedDirt.tx}, ty=${importedDirt.ty}`);
    }

    console.log('===============================================================');
    console.log('🎉 ALL TILESET DELETION & OBJECT SCRAMBLE TESTS PASSED (100%)!');
    console.log('===============================================================');
}

runScrambleFixTest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
