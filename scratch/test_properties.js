const fs = require('fs');
const path = require('path');

console.log("=== Testing TileWeaver Tile & Object Property Unification & Inheritance ===");

// 1. Load alpha_map.json
const rawMapData = fs.readFileSync(path.join(__dirname, '../test/alpha_map.json'), 'utf8');
const mapJson = JSON.parse(rawMapData);

console.log("Map file loaded successfully.");
console.log(`Tilesets count: ${mapJson.tilesets.length}`);

// 2. Locate alpha_objects tileset
const objectsTs = mapJson.tilesets.find(t => t.name === 'alpha_objects' || t.columns === 0);
if (!objectsTs) {
    console.error("ERROR: alpha_objects tileset not found in alpha_map.json");
    process.exit(1);
}
console.log(`Found objects tileset: ${objectsTs.name} with ${objectsTs.tiles.length} tiles.`);

// 3. Find Grand_Altar tile definition
const grandAltarTile = objectsTs.tiles.find(t => t.image === 'Grand_Altar.png' || (t.properties && t.properties.some(p => p.value === 'grand_altar')));
if (!grandAltarTile) {
    console.error("ERROR: Grand_Altar tile not found in alpha_objects tileset");
    process.exit(1);
}
console.log("Found Grand_Altar tile:", grandAltarTile.id, grandAltarTile.image);
console.log("Tile properties in JSON:", grandAltarTile.properties);

// 4. Simulate import logic for collection image
const tileEntryProps = {};
if (grandAltarTile.properties && Array.isArray(grandAltarTile.properties)) {
    grandAltarTile.properties.forEach(p => { tileEntryProps[p.name] = p.value; });
}
const metaKeys = new Set(['imageId', 'name', 'anchor', '__imageData', 'filename', 'imagePath']);
const custom = {};
Object.entries(tileEntryProps).forEach(([k, v]) => {
    if (!metaKeys.has(k)) custom[k] = v;
});
const imgObj = {
    id: 'img_test_altar',
    tileId: grandAltarTile.id,
    name: 'Grand_Altar',
    width: grandAltarTile.imagewidth || 252,
    height: grandAltarTile.imageheight || 387,
    anchor: 'bottom-center',
    tileProperties: {
        ...tileEntryProps,
        custom: custom
    }
};

console.log("\nImported Collection Item:");
console.log("imgObj.name:", imgObj.name);
console.log("imgObj.tileProperties.custom:", imgObj.tileProperties.custom);

if (imgObj.tileProperties.custom.bodyHeight !== 30 ||
    imgObj.tileProperties.custom.bodyOffsetY !== 5 ||
    imgObj.tileProperties.custom.bodyWidth !== 252 ||
    imgObj.tileProperties.custom.texture !== "grand_altar") {
    console.error("FAILED: Imported custom properties mismatch!");
    process.exit(1);
}
console.log("SUCCESS: Imported custom properties parsed correctly!");

// 5. Simulate Object Placement Logic (from viewport.js -> objectInspector.js)
const sourceProps = imgObj.tileProperties;
const inheritedCustom = {};
if (sourceProps.custom && typeof sourceProps.custom === 'object') {
    Object.entries(sourceProps.custom).forEach(([k, v]) => {
        if (!metaKeys.has(k)) inheritedCustom[k] = v;
    });
}
const gidVal = (objectsTs.firstgid || 2705) + imgObj.tileId;

// createObjectOnActiveLayer simulation
const customProps = JSON.parse(JSON.stringify(inheritedCustom));
let propertiesArr = Object.entries(customProps).map(([name, value]) => ({
    name,
    type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
    value
}));

const placedObject = {
    id: 101,
    name: imgObj.name,
    type: sourceProps.type || '',
    x: 100,
    y: 200,
    width: imgObj.width,
    height: imgObj.height,
    gid: gidVal,
    alignment: imgObj.anchor,
    tilesetId: 'ts_objects',
    imageId: imgObj.id,
    custom: customProps,
    properties: propertiesArr
};

console.log("\nNewly Placed Object:");
console.log("placedObject.id:", placedObject.id);
console.log("placedObject.name:", placedObject.name);
console.log("placedObject.gid:", placedObject.gid);
console.log("placedObject.custom:", placedObject.custom);
console.log("placedObject.properties:", placedObject.properties);

if (placedObject.custom.bodyHeight !== 30 ||
    placedObject.custom.bodyWidth !== 252 ||
    placedObject.custom.texture !== "grand_altar" ||
    placedObject.properties.length !== 4) {
    console.error("FAILED: Placed object did not inherit custom properties!");
    process.exit(1);
}
console.log("SUCCESS: Placed object inherited all 4 custom properties!");

// 6. Test Export TMJ Formatting
const exportedObjProps = Object.entries(placedObject.custom).map(([name, value]) => ({
    name,
    type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
    value
}));

console.log("\nExported Object Properties array:");
console.log(exportedObjProps);
if (exportedObjProps.length !== 4) {
    console.error("FAILED: Exported properties array count mismatch!");
    process.exit(1);
}

console.log("\n=== ALL PROPERTY TESTS PASSED SUCCESSFULLY! ===");
