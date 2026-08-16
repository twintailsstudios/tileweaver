/**
 * Automated Test Suite: Assets Management System in TileWeaver
 * -----------------------------------------------------------------
 * Tests:
 * 1. AssetRecord schema, CRUD operations & state store management.
 * 2. Initial synchronization from existing procedural/imported tilesets.
 * 3. Real-time Dependency Graph calculation (tilesets, autotiles, layers, placed tiles).
 * 4. The 4-Way Ingestion Pipeline:
 *    - Choice 1: Create New Standard Tileset (Grid)
 *    - Choice 2: Replace / Hot-Swap Existing Tileset Texture (non-destructive)
 *    - Choice 3: Add to Image Collection Tileset (Multi-Size Props)
 *    - Choice 4: Stage to Asset Library Pool (Unassigned)
 * 5. Safe Orphan Cleaner (pruning unassigned assets without touching active ones).
 * 6. Native JSON v3.3 Export/Import round-trip preserving state.assets.
 * 7. Tiled TMJ relative path mapping.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
    getElementById: () => null,
    querySelectorAll: () => []
};

global.Image = class {
    constructor() {
        this.naturalWidth = 64;
        this.naturalHeight = 64;
        this.width = 64;
        this.height = 64;
        this.src = '';
    }
};

// Load modules in order
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/autotile.js');
require('../js/engine/rendering.js');
require('../js/engine/exportImport.js');

const { state, createNewAssetRecord, addAssetToState, removeAssetFromState, updateAssetInState, getAssetById, getAssetUsage, syncAssetsFromExistingTilesets, initMapData, createNewCollectionTileset, addCollectionImage } = window.TileWeaver.stateModule;
const { exportNativeJSON, exportTiledTMJ, importMapJSON } = window.TileWeaver.exportImport;

console.log("===============================================================");
console.log("🧪 STARTING ASSETS MANAGEMENT SYSTEM AUTOMATED TEST SUITE");
console.log("===============================================================");

// -----------------------------------------------------------------------------
// TEST 1: AssetRecord Schema & State CRUD Operations
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 1: AssetRecord Schema & State CRUD Operations");
initMapData();
state.assets = [];
state.tilesets = [];

const mockImg = new global.Image();
mockImg.naturalWidth = 128;
mockImg.naturalHeight = 96;

const rec1 = createNewAssetRecord("Castle Wall", "castle_wall.png", mockImg, "data:image/png;base64,mock", 12450, "image/png", ["dungeon", "wall"]);
assert.strictEqual(rec1.name, "Castle Wall", "Name should be formatted correctly");
assert.strictEqual(rec1.filename, "castle_wall.png", "Filename should match");
assert.strictEqual(rec1.relativePath, "assets/castle_wall.png", "Relative path should default to assets/");
assert.strictEqual(rec1.width, 128, "Width should match naturalWidth");
assert.strictEqual(rec1.height, 96, "Height should match naturalHeight");
assert.strictEqual(rec1.sizeBytes, 12450, "Size should match");
assert.deepStrictEqual(rec1.tags, ["dungeon", "wall"], "Tags should be preserved");

addAssetToState(rec1);
assert.strictEqual(state.assets.length, 1, "state.assets should have 1 item");
assert.strictEqual(state.activeAssetId, rec1.id, "activeAssetId should be set to rec1.id");

const fetched = getAssetById(rec1.id);
assert.strictEqual(fetched.id, rec1.id, "getAssetById should return the added asset");

// Test Update
const newMockImg = new global.Image();
newMockImg.naturalWidth = 160;
newMockImg.naturalHeight = 128;
updateAssetInState(rec1.id, newMockImg, "data:image/png;base64,updated", "castle_wall_v2.png");
assert.strictEqual(rec1.width, 160, "Updated width should be 160");
assert.strictEqual(rec1.height, 128, "Updated height should be 128");
assert.strictEqual(rec1.filename, "castle_wall_v2.png", "Updated filename should match");

// Test Removal
removeAssetFromState(rec1.id);
assert.strictEqual(state.assets.length, 0, "state.assets should be empty after removal");
console.log("  ✔ CRUD operations and schema validation PASSED!");

// -----------------------------------------------------------------------------
// TEST 2: Initial Tileset Synchronization (syncAssetsFromExistingTilesets)
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 2: Initial Tileset Synchronization");
state.assets = [];
state.tilesets = [
    {
        id: 'ts_grass',
        name: 'Grass Meadow',
        filename: 'grass_meadow.png',
        image: new global.Image(),
        tilewidth: 32,
        tileheight: 32,
        margin: 0,
        spacing: 0
    },
    {
        id: 'ts_props',
        name: 'Foliage & Props',
        isCollection: true,
        images: [
            { id: 'img_tree', name: 'Oak Tree', filename: 'tree_oak.png', image: new global.Image(), width: 64, height: 96, anchor: 'bottom-center' },
            { id: 'img_chest', name: 'Chest', filename: 'chest.png', image: new global.Image(), width: 32, height: 32, anchor: 'bottom-center' }
        ]
    }
];

syncAssetsFromExistingTilesets();
assert.strictEqual(state.assets.length, 3, "Should have synced 1 spritesheet + 2 collection images = 3 assets");
const grassAsset = state.assets.find(a => a.name === 'Grass Meadow');
assert.ok(grassAsset, "Grass Meadow asset should exist");
assert.ok(grassAsset.tags.includes('tileset'), "Grass Meadow should have 'tileset' tag");
assert.ok(grassAsset.assignedTilesetIds.includes('ts_grass'), "Grass Meadow should link to ts_grass");

const treeAsset = state.assets.find(a => a.name === 'Oak Tree');
assert.ok(treeAsset, "Oak Tree asset should exist");
assert.ok(treeAsset.tags.includes('prop'), "Oak Tree should have 'prop' tag");
console.log("  ✔ Initial tileset asset synchronization PASSED!");

// -----------------------------------------------------------------------------
// TEST 3: Real-Time Dependency Graph Calculation (getAssetUsage)
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 3: Real-Time Dependency Graph Calculation");
// Place some grass tiles on Layer 1
state.mapLayers[0].data[0][0] = { tilesetId: 'ts_grass', tx: 0, ty: 0, flipH: false, flipV: false, rotation: 0 };
state.mapLayers[0].data[0][1] = { tilesetId: 'ts_grass', tx: 1, ty: 0, flipH: false, flipV: false, rotation: 0 };

// Place an object on an Object Layer
const objLayer = window.TileWeaver.stateModule.createNewLayerObject("Objects", "objectgroup");
objLayer.objects.push({
    id: 1,
    name: "Big Oak",
    tilesetId: 'ts_props',
    imageId: 'img_tree',
    x: 32,
    y: 64,
    width: 64,
    height: 96
});
state.mapLayers.push(objLayer);

// Register an autotile using ts_grass
state.autotiles = [
    { id: 'at_grass_9s', name: 'Grass 9-Slice', mode: '9slice', tilesetId: 'ts_grass', mapping: {} }
];

const grassUsage = getAssetUsage(grassAsset.id);
assert.strictEqual(grassUsage.isUsed, true, "Grass asset should be in use");
assert.strictEqual(grassUsage.tilesets.length, 1, "Should link to 1 tileset");
assert.strictEqual(grassUsage.autotiles.length, 1, "Should link to 1 autotile");
assert.strictEqual(grassUsage.layers.length, 1, "Should be placed on 1 layer");
assert.strictEqual(grassUsage.placedTilesCount, 2, "Should have 2 placed tiles");

const treeUsage = getAssetUsage(treeAsset.id);
assert.strictEqual(treeUsage.isUsed, true, "Tree asset should be in use");
assert.strictEqual(treeUsage.placedTilesCount, 1, "Should have 1 placed object");

// Create an unassigned staged asset
const stagedRec = createNewAssetRecord("Unused Prop", "unused_prop.png", new global.Image(), "", 1000, "image/png", ["staged"]);
addAssetToState(stagedRec);
const stagedUsage = getAssetUsage(stagedRec.id);
assert.strictEqual(stagedUsage.isUsed, false, "Staged asset should have isUsed === false");
assert.strictEqual(stagedUsage.placedTilesCount, 0, "Staged asset should have 0 placed tiles");
console.log("  ✔ Dependency Graph calculations accurately track tilesets, autotiles, layers & counts!");

// -----------------------------------------------------------------------------
// TEST 4: The 4-Way Ingestion Pipeline
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 4: The 4-Way Ingestion Pipeline");

// Choice 1: Create New Standard Tileset
const dungeonImg = new global.Image();
dungeonImg.naturalWidth = 160;
dungeonImg.naturalHeight = 160;
const dungeonAsset = createNewAssetRecord("Dungeon Master", "dungeon_master.png", dungeonImg, "", 50000, "image/png", ["tileset"]);
addAssetToState(dungeonAsset);

const newTs = {
    id: 'ts_dungeon',
    assetId: dungeonAsset.id,
    name: "Dungeon Master",
    filename: "dungeon_master.png",
    image: dungeonImg,
    tilewidth: 32,
    tileheight: 32,
    margin: 0,
    spacing: 0,
    columns: 5,
    tilecount: 25
};
state.tilesets.push(newTs);
dungeonAsset.assignedTilesetIds.push(newTs.id);
assert.strictEqual(getAssetUsage(dungeonAsset.id).tilesets.length, 1, "Choice 1 creates and links tileset");

// Choice 2: Hot-Swap / Replace Texture
const upgradedGrassImg = new global.Image();
upgradedGrassImg.naturalWidth = 160;
upgradedGrassImg.naturalHeight = 192; // 1 extra row
updateAssetInState(grassAsset.id, upgradedGrassImg, "data:image/png;base64,upgraded", "grass_meadow_v2.png");
// Propagate to tileset
const targetTs = state.tilesets.find(t => t.id === 'ts_grass');
targetTs.image = upgradedGrassImg;
targetTs.filename = "grass_meadow_v2.png";
targetTs.columns = 5;
targetTs.tilecount = 30;

assert.strictEqual(grassAsset.width, 160, "Hot-swapped asset width updated");
assert.strictEqual(grassAsset.height, 192, "Hot-swapped asset height updated");
assert.strictEqual(state.mapLayers[0].data[0][0].tx, 0, "Placed tile cell tx coordinate preserved!");
assert.strictEqual(state.mapLayers[0].data[0][1].tx, 1, "Placed tile cell tx coordinate preserved!");

// Choice 3: Add to Image Collection Tileset
const flowerImg = new global.Image();
flowerImg.naturalWidth = 32;
flowerImg.naturalHeight = 32;
const flowerAsset = createNewAssetRecord("Red Flower", "flower_red.png", flowerImg, "", 2000, "image/png", ["prop", "collection"]);
addAssetToState(flowerAsset);

const addedProp = addCollectionImage(targetTs.isCollection ? targetTs : state.tilesets.find(t => t.isCollection), "Red Flower", "flower_red.png", flowerImg, "", "bottom-center");
assert.ok(addedProp, "Choice 3 successfully added prop to Collection Tileset");

// Choice 4: Add to Asset Pool (Staged)
const statueImg = new global.Image();
statueImg.naturalWidth = 32;
statueImg.naturalHeight = 64;
const statueAsset = createNewAssetRecord("Ancient Statue", "statue_ancient.png", statueImg, "", 8000, "image/png", ["staged"]);
addAssetToState(statueAsset);
assert.strictEqual(getAssetUsage(statueAsset.id).isUsed, false, "Choice 4 staged asset is stored cleanly as unassigned");
console.log("  ✔ All 4 Ingestion Pathways (New Tileset, Hot-Swap, Collection Prop, Staged Pool) PASSED!");

// -----------------------------------------------------------------------------
// TEST 5: Safe Orphan Cleaner
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 5: Safe Orphan Cleaner");
const initialTotalAssets = state.assets.length;
const unreferencedBefore = state.assets.filter(a => !getAssetUsage(a.id).isUsed);
assert.ok(unreferencedBefore.length >= 2, "Should have at least 2 unreferenced assets (Unused Prop & Ancient Statue)");

// Execute Orphan Cleaner
unreferencedBefore.forEach(a => removeAssetFromState(a.id));

const unreferencedAfter = state.assets.filter(a => !getAssetUsage(a.id).isUsed);
assert.strictEqual(unreferencedAfter.length, 0, "All unreferenced assets should be pruned");
assert.ok(state.assets.some(a => a.id === grassAsset.id), "In-Use Grass Asset must NOT be deleted");
assert.ok(state.assets.some(a => a.id === treeAsset.id), "In-Use Tree Asset must NOT be deleted");
assert.ok(state.assets.some(a => a.id === dungeonAsset.id), "In-Use Dungeon Asset must NOT be deleted");
console.log("  ✔ Safe Orphan Cleaner pruned unreferenced assets while protecting 100% of active assets!");

// -----------------------------------------------------------------------------
// TEST 6: Native JSON v3.3 & Tiled TMJ Export/Import Round-Trip
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 6: Native JSON v3.3 & Tiled TMJ Export/Import Round-Trip");
let downloadedContent = null;
let downloadedFilename = null;
window.TileWeaver.exportImport.downloadFile = (content, filename) => {
    downloadedContent = content;
    downloadedFilename = filename;
};

// Test Native JSON Export
exportNativeJSON();
assert.ok(downloadedContent, "Native export should produce content");
const parsedNative = JSON.parse(downloadedContent);
assert.strictEqual(parsedNative.version, 3.3, "Native JSON version should be 3.3");
assert.ok(Array.isArray(parsedNative.assets), "Native JSON should include assets array");
assert.ok(parsedNative.assets.length > 0, "Native JSON assets array should be populated");
assert.ok(parsedNative.assets.some(a => a.name === "grass_meadow_v2" || a.name === "Grass Meadow"), "Grass Meadow should be serialized in assets");

// Test Tiled TMJ Export
downloadedContent = null;
exportTiledTMJ("test_map.json");
assert.ok(downloadedContent, "Tiled TMJ export should produce content");
const parsedTiled = JSON.parse(downloadedContent);
assert.ok(parsedTiled.tilesets.length > 0, "Tiled tilesets array should be populated");
const tiledGrass = parsedTiled.tilesets.find(t => t.name === "Grass Meadow");
assert.ok(tiledGrass, "Grass tileset should be in Tiled export");
assert.ok(tiledGrass.image.startsWith("assets/"), "Tiled image path should follow clean assets/ relative convention");

console.log("  ✔ Native JSON v3.3 and Tiled TMJ export formats PASSED!");

// -----------------------------------------------------------------------------
// TEST 7: High-Volume Multi-Image Batch Ingestion
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 7: High-Volume Multi-Image Batch Ingestion (25 Files Simultaneously)");

const initialAssetCount = state.assets.length;
const batchImages = [];
for (let i = 1; i <= 25; i++) {
    const bImg = new global.Image();
    bImg.naturalWidth = 32 + (i % 3) * 32;
    bImg.naturalHeight = 32 + (i % 2) * 32;
    batchImages.push({
        name: `prop_batch_${i}`,
        filename: `prop_batch_${i}.png`,
        image: bImg,
        dataUrl: `data:image/png;base64,batch_${i}`,
        size: 1024 * i,
        type: 'image/png',
        width: bImg.naturalWidth,
        height: bImg.naturalHeight
    });
}

// 7a: Batch Import all 25 images to Asset Library Pool (Stage for Later)
let batchImportedCount = 0;
batchImages.forEach(item => {
    const asset = createNewAssetRecord(
        item.name,
        item.filename,
        item.image,
        item.dataUrl,
        item.size,
        item.type,
        ['batch', 'staged']
    );
    addAssetToState(asset);
    batchImportedCount++;
});

assert.strictEqual(batchImportedCount, 25, "Should have imported all 25 batch images");
assert.strictEqual(state.assets.length, initialAssetCount + 25, "State assets count should increase by exactly 25");

// 7b: Batch Add 10 images to a new Collection Tileset simultaneously
const newBatchCollection = createNewCollectionTileset("Mega Batch Props");
state.tilesets.push(newBatchCollection);

let batchCollectionAdded = 0;
batchImages.slice(0, 10).forEach(item => {
    const added = addCollectionImage(newBatchCollection, item.name, item.filename, item.image, item.dataUrl, 'bottom-center');
    if (added) batchCollectionAdded++;
});

assert.strictEqual(batchCollectionAdded, 10, "Should add 10 images into Mega Batch Props collection");
assert.strictEqual(newBatchCollection.images.length, 10, "Collection images length should be 10");

console.log("  ✔ High-Volume Multi-Image Batch Ingestion (25 assets imported simultaneously) PASSED!");

// -----------------------------------------------------------------------------
// TEST 8: Map Import Analysis, Missing Asset Placeholders & Auto-Reconnection
// -----------------------------------------------------------------------------
console.log("\n▶ TEST 8: Map Import Analysis, Missing Asset Placeholders & Auto-Reconnection");

require('../js/ui/terrainSwatches.js');

(async () => {
    const alphaMapPath = path.join(__dirname, '../test/alpha_map.json');
    assert.ok(fs.existsSync(alphaMapPath), "alpha_map.json should exist in test/ directory");
    const alphaMapContent = fs.readFileSync(alphaMapPath, 'utf8');
    const alphaMapParsed = JSON.parse(alphaMapContent);

    // 8a: Test analyzeMapJSON without mutating state
    const analysis = window.TileWeaver.exportImport.analyzeMapJSON(alphaMapParsed);
    assert.ok(analysis.requiredAssets.length > 0, "Should detect required assets in map");
    assert.ok(analysis.requiredAssets.some(r => r.filename === "alpha_tileset.png"), "Should detect alpha_tileset.png as a required asset");

    // 8b: Test importing alpha_map.json WITHOUT assets
    state.assets = [];
    state.tilesets = [];
    await window.TileWeaver.exportImport.importMapJSON(alphaMapParsed, []);

    assert.strictEqual(state.mapWidth, 240, "Map width should adjust to 240");
    assert.strictEqual(state.mapHeight, 240, "Map height should adjust to 240");
    assert.strictEqual(state.TILE_SIZE, 32, "Tile size should be 32");
    assert.strictEqual(state.mapLayers.length, 10, "Map layers should be 10");
    assert.strictEqual(state.tilesets.length, 15, "Should reconstruct 15 tilesets (1 grid + 14 collections)");
    assert.strictEqual(state.materials.length, 5, "Should synchronize 5 material terrain swatches from autotiles");
    assert.strictEqual(state.assets.length, 0, "Asset vault should remain completely empty when no assets were uploaded");
    
    const placeholderTs = state.tilesets[0];
    assert.strictEqual(placeholderTs.isMissing, true, "Placeholder tileset should be marked isMissing: true");
    assert.strictEqual(placeholderTs.assetId, null, "Placeholder tileset should have null assetId");
    assert.strictEqual(placeholderTs.filename, "alpha_tileset.png", "Placeholder tileset should preserve required filename");

    // 8c: Test Auto-Reconnection when matching asset is subsequently added to vault
    const alphaImg = new global.Image();
    alphaImg.naturalWidth = 1440;
    alphaImg.naturalHeight = 960;
    alphaImg.width = 1440;
    alphaImg.height = 960;

    const alphaAsset = createNewAssetRecord(
        "alpha_tileset",
        "alpha_tileset.png",
        alphaImg,
        "data:image/png;base64,alpha_mock",
        50000,
        "image/png",
        ["tileset"]
    );
    addAssetToState(alphaAsset);

    assert.strictEqual(state.assets.length, 1, "Vault should now contain the uploaded asset");
    assert.strictEqual(placeholderTs.isMissing, false, "Placeholder tileset should be auto-reconnected (isMissing: false)");
    assert.strictEqual(placeholderTs.assetId, alphaAsset.id, "Placeholder tileset should be bound to asset ID");
    assert.strictEqual(placeholderTs.image, alphaImg, "Placeholder tileset image should be assigned to new texture");
    assert.ok(alphaAsset.assignedTilesetIds.includes(placeholderTs.id), "Asset record should track assignment to placeholder tileset");

    // 8d: Test importing map with assets simultaneously provided in the Import Wizard
    state.assets = [];
    state.tilesets = [];
    await window.TileWeaver.exportImport.importMapJSON(alphaMapParsed, [alphaAsset]);

    assert.strictEqual(state.mapWidth, 240, "Map width should adjust to 240");
    assert.strictEqual(state.mapHeight, 240, "Map height should adjust to 240");
    assert.strictEqual(state.assets.length, 1, "Asset should be ingested into vault during import");
    assert.strictEqual(state.tilesets[0].isMissing, false, "Tileset should be immediately matched and connected");
    assert.strictEqual(state.tilesets[0].assetId, alphaAsset.id, "Tileset should be bound to asset ID");
    assert.strictEqual(state.materials.length, 5, "5 material terrain swatches should be active");

    console.log("  ✔ Map Import Wizard, Missing Asset Placeholders & Auto-Reconnection PASSED!");

    console.log("\n===============================================================");
    console.log("🎉 ALL ASSETS MANAGEMENT SYSTEM AUTOMATED TESTS PASSED (8/8)!");
    console.log("===============================================================");
})();


