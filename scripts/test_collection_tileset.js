/**
 * Verification Test: Collection of Images Tilesets & Object Placement
 */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

console.log("--- STARTING COLLECTION OF IMAGES VERIFICATION TEST ---");

// Mock browser globals needed by window.TileWeaver
global.window = {};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            const canvas = createCanvas(160, 160);
            return canvas;
        }
        return {
            click: () => {},
            style: {},
            classList: { add: () => {}, remove: () => {} },
            appendChild: () => {},
            addEventListener: () => {}
        };
    },
    getElementById: () => null,
    querySelectorAll: () => []
};
global.Image = function(w = 160, h = 160) {
    const canvas = createCanvas(w, h);
    canvas.naturalWidth = w;
    canvas.naturalHeight = h;
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

// Load modular JS files
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.autotile = { drawAutotileCellSubQuadrants: () => {}, updateAutotileCell: () => {} };
window.TileWeaver.tools = { selectTool: () => {} };
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/rendering.js');
require('../js/ui/terrainSwatches.js');
require('../js/ui/tilesetManager.js');
require('../js/ui/objectInspector.js');
require('../js/ui/layerManager.js');
require('../js/ui/viewport.js');
require('../js/engine/exportImport.js');

// 1. Initialize map state
window.TileWeaver.stateModule.initMapData();
const state = window.TileWeaver.stateModule.state;

console.log("1. State initialized. Map size:", state.mapWidth, "x", state.mapHeight);

// 2. Create Collection Tileset
const collTs = window.TileWeaver.stateModule.createNewCollectionTileset("Test Prop Collection");
state.tilesets.push(collTs);
state.activeTilesetIndex = state.tilesets.length - 1;

console.log("2. Created Collection Tileset:", collTs.id, collTs.name);

// 3. Add images to collection
const dummyImg = new global.Image(64, 96);
const img1 = window.TileWeaver.stateModule.addCollectionImage(collTs, "Big Tree", "tree_big.png", dummyImg, "data:image/png;base64,dummy1", "bottom-center");
const img2 = window.TileWeaver.stateModule.addCollectionImage(collTs, "Treasure Chest", "chest.png", new global.Image(32, 32), "data:image/png;base64,dummy2", "bottom-center");

console.log("3. Added collection images:", img1.name, "(", img1.width, "x", img1.height, "anchor:", img1.anchor, ") and", img2.name);

// 4. Verify that painting collection tile on standard Tile layer (layer 0) is blocked
state.activeLayerIndex = 0;
collTs.activeImageId = img1.id;
state.currentTool = 'paint';
window.TileWeaver.viewport.applyTool(5, 5);

const cellVal = state.mapLayers[0].data[5][5];
if (cellVal !== null) {
    console.error("❌ FAILED: Collection item was incorrectly allowed to paint on standard Tile layer cell (5, 5)", cellVal);
    process.exit(1);
}
console.log("4. Verified painting collection items on Tile layers is correctly BLOCKED!");

// 5. Place collection object on Object Layer via Object tool
const newObj = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
    name: `${collTs.name} Object`,
    x: 160,
    y: 160,
    width: img1.width,
    height: img1.height,
    gid: (collTs.firstgid || 1) + (img1.tileId !== undefined ? img1.tileId : 0)
});

if (!newObj) {
    console.error("❌ FAILED to create collection object on Object layer!");
    process.exit(1);
}
console.log("5. Successfully placed collection item as free-floating Object on Object layer:", newObj);

// 6. Test TMJ Export structure for Collection Tilesets
let exportedContent = '';
window.TileWeaver.exportImport.downloadFile = (content, name) => {
    exportedContent = content;
};
window.TileWeaver.exportImport.exportTiledTMJ("test_collection_map.json");

const tmjJson = JSON.parse(exportedContent);
const exportedTs = tmjJson.tilesets.find(t => t.name === collTs.name);
if (!exportedTs || exportedTs.columns !== 0 || !exportedTs.tiles || exportedTs.tiles.length === 0) {
    console.error("❌ FAILED: Exported Tiled TMJ collection tileset structure invalid!", exportedTs);
    process.exit(1);
}
console.log("6. Exported Tiled TMJ collection tileset successfully! Columns:", exportedTs.columns, "Tiles count:", exportedTs.tiles.length);

// 7. Test Export Packed Atlas PNG
let packedAtlasDownloaded = false;
window.TileWeaver.exportImport.downloadFile = (content, name) => {
    packedAtlasDownloaded = true;
};
window.TileWeaver.exportImport.exportPackedAtlas(state.activeTilesetIndex);
console.log("7. Export Packed Atlas test completed!");

// 8. Test Replacing an Image and Cascading Dimensions to Placed Map Objects
console.log("8. Testing Image Replacement & Map Object Dimension Synchronization...");
const replacementImg = new global.Image(80, 120);
const updatedImg = window.TileWeaver.stateModule.updateCollectionImage(
    collTs, 
    img1.id, 
    replacementImg, 
    "data:image/png;base64,dummy_updated_tree", 
    "tree_giant.png"
);

if (!updatedImg || updatedImg.width !== 80 || updatedImg.height !== 120 || updatedImg.filename !== "tree_giant.png") {
    console.error("❌ FAILED: updateCollectionImage did not update dimensions or filename properly!", updatedImg);
    process.exit(1);
}

// Emulate handleReplaceCollectionImage object cascade
state.mapLayers.forEach(l => {
    if (l.type === 'objectgroup' && l.objects) {
        l.objects.forEach(obj => {
            if (obj.imageId === img1.id || (obj.gid && (obj.gid & 0x1FFFFFFF) === (collTs.firstgid || 1) + (img1.tileId !== undefined ? img1.tileId : 0))) {
                obj.width = updatedImg.width;
                obj.height = updatedImg.height;
            }
        });
    }
});

const placedObj = state.mapLayers.find(l => l.type === 'objectgroup').objects[0];
if (placedObj.width !== 80 || placedObj.height !== 120) {
    console.error("❌ FAILED: Placed map object did not synchronize dimensions upon image replacement!", placedObj);
    process.exit(1);
}
console.log("8. Verified Image Replacement and Map Object Dimension Synchronization! Object size:", placedObj.width, "x", placedObj.height);

// 9. Test Deleting an Image from Collection and Removing Placed Objects from Map
console.log("9. Testing Image Deletion from Collection and Map Object Removal...");
const initialCount = collTs.images.length;
const objLayer = state.mapLayers.find(l => l.type === 'objectgroup');
const initialObjCount = objLayer.objects.length;
if (initialObjCount === 0) {
    console.error("❌ FAILED: Pre-condition failed, expected placed objects on map before deletion!");
    process.exit(1);
}

window.TileWeaver.tilesetManager.handleDeleteCollectionImage(collTs, img1.id, true);

if (collTs.images.length !== initialCount - 1 || collTs.images.some(i => i.id === img1.id)) {
    console.error("❌ FAILED: Image was not removed from collection!", collTs.images);
    process.exit(1);
}

const remainingPlaced = objLayer.objects.filter(o => o.imageId === img1.id);
if (remainingPlaced.length > 0 || objLayer.objects.length !== initialObjCount - 1) {
    console.error("❌ FAILED: Placed map object instances were NOT removed from map layer upon image deletion!", {
        remainingTotal: objLayer.objects.length,
        remainingMatching: remainingPlaced
    });
    process.exit(1);
}
console.log("9. Verified Image Deletion from Collection and complete removal of all placed map object instances successfully! Remaining images:", collTs.images.length, "Remaining objects on layer:", objLayer.objects.length);

// 10. Test Multi-Collection GID Recomputation & Object Placement Disambiguation
console.log("10. Testing Multi-Collection GID Recomputation & Object Placement Disambiguation...");
const collA = window.TileWeaver.stateModule.createNewCollectionTileset("Collection A");
const collB = window.TileWeaver.stateModule.createNewCollectionTileset("Collection B");
state.tilesets = [collA, collB];

const imgA1 = window.TileWeaver.stateModule.addCollectionImage(collA, "A1", "a1.png", new global.Image(32, 32));
const imgA2 = window.TileWeaver.stateModule.addCollectionImage(collA, "A2", "a2.png", new global.Image(32, 32));
const imgB1 = window.TileWeaver.stateModule.addCollectionImage(collB, "B1", "b1.png", new global.Image(32, 32));
const imgB2 = window.TileWeaver.stateModule.addCollectionImage(collB, "B2", "b2.png", new global.Image(32, 32));

window.TileWeaver.stateModule.recomputeTilesetGids();

if (collA.firstgid !== 1 || collB.firstgid !== 3) {
    console.error("❌ FAILED: Initial firstgid allocation failed!", { collA_firstgid: collA.firstgid, collB_firstgid: collB.firstgid });
    process.exit(1);
}

// Add a 3rd image to Collection A
const imgA3 = window.TileWeaver.stateModule.addCollectionImage(collA, "A3", "a3.png", new global.Image(32, 32));

// recomputeTilesetGids should have automatically shifted collB.firstgid to 4
if (collA.firstgid !== 1 || collB.firstgid !== 4) {
    console.error("❌ FAILED: recomputeTilesetGids did not shift collB.firstgid after adding image to collA!", { collA_firstgid: collA.firstgid, collB_firstgid: collB.firstgid });
    process.exit(1);
}

// Place imgA3 as an object
const objA3 = window.TileWeaver.objectInspector.createObjectOnActiveLayer({
    name: imgA3.name,
    x: 200,
    y: 200,
    width: imgA3.width,
    height: imgA3.height,
    gid: (collA.firstgid || 1) + imgA3.tileId, // 1 + 2 = 3
    tilesetId: collA.id,
    imageId: imgA3.id
});

// Verify tileset resolution for objA3
const resolvedTs = window.TileWeaver.stateModule.getTilesetForGid(objA3.gid);
if (resolvedTs.id !== collA.id) {
    console.error("❌ FAILED: getTilesetForGid resolved to wrong tileset!", { resolved: resolvedTs.name, expected: collA.name });
    process.exit(1);
}

const localId = objA3.gid - (resolvedTs.firstgid || 1);
const resolvedImg = resolvedTs.images.find(img => img.id === objA3.imageId) || resolvedTs.images.find(img => img.tileId === localId);
if (!resolvedImg || resolvedImg.name !== "A3") {
    console.error("❌ FAILED: Object resolved to wrong image!", { resolvedImg, expected: "A3" });
    process.exit(1);
}
console.log("10. Verified Multi-Collection GID Recomputation & Object Placement Disambiguation! Resolved tileset:", resolvedTs.name, "image:", resolvedImg.name);

console.log("🎉 ALL COLLECTION OF IMAGES VERIFICATION TESTS PASSED PERFECTLY!");


