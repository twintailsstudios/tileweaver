const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Mock browser globals
global.window = {};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return createCanvas(160, 160);
        }
        return { click: () => {}, style: {}, appendChild: () => {}, removeChild: () => {} };
    },
    getElementById: () => null,
    body: { appendChild: () => {}, removeChild: () => {} }
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

// Load modular dependencies
window.TileWeaver = window.TileWeaver || {};
window.TileWeaver.autotile = { drawAutotileCellSubQuadrants: () => {} };
require('../js/constants.js');
require('../js/state.js');
require('../js/utils/toast.js');
require('../js/utils/history.js');
require('../js/engine/rendering.js');
require('../js/ui/terrainSwatches.js');
require('../js/engine/exportImport.js');
const extruderModule = require('../js/engine/extruder.js');

const { extrudeTilesetCanvas, applyExtrusionToTileset, cloneAsExtrudedTileset } = extruderModule;
const { state } = window.TileWeaver.stateModule;
const { exportTiledTMJ } = window.TileWeaver.exportImport;

function getColorAt(ctx, x, y) {
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    return `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]})`;
}

async function runExtruderTests() {
    console.log('--- STARTING TILESET EXTRUSION VERIFICATION TEST ---');

    // 1. Create a 2x2 test tileset image (64x64px, each tile 32x32px)
    // Tile (0,0): Red with yellow top-left pixel (0,0) and blue bottom-right pixel (31,31)
    // Tile (1,0): Green
    // Tile (0,1): Blue
    // Tile (1,1): Yellow
    const srcCanvas = createCanvas(64, 64);
    const srcCtx = srcCanvas.getContext('2d');

    // Tile 0,0: Red (#FF0000)
    srcCtx.fillStyle = '#ff0000';
    srcCtx.fillRect(0, 0, 32, 32);
    // Custom corner markers on Tile 0,0
    srcCtx.fillStyle = '#ffff00'; // Yellow top-left
    srcCtx.fillRect(0, 0, 1, 1);
    srcCtx.fillStyle = '#0000ff'; // Blue bottom-right
    srcCtx.fillRect(31, 31, 1, 1);

    // Tile 1,0: Green (#00FF00)
    srcCtx.fillStyle = '#00ff00';
    srcCtx.fillRect(32, 0, 32, 32);

    // Tile 0,1: Cyan (#00FFFF)
    srcCtx.fillStyle = '#00ffff';
    srcCtx.fillRect(0, 32, 32, 32);

    // Tile 1,1: Magenta (#FF00FF)
    srcCtx.fillStyle = '#ff00ff';
    srcCtx.fillRect(32, 32, 32, 32);

    console.log('1. Created 2x2 source test tileset (64x64px, 32x32px tiles)');

    // 2. Test 1px Extrusion
    const res1 = extrudeTilesetCanvas(srcCanvas, {
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
        extrude: 1,
        createCanvasFn: createCanvas
    });

    console.log(`2. Extrusion 1px result: Output ${res1.newWidth}x${res1.newHeight}px, newMargin=${res1.newMargin}, newSpacing=${res1.newSpacing}`);
    assert.strictEqual(res1.newMargin, 1, 'New margin should be 1');
    assert.strictEqual(res1.newSpacing, 2, 'New spacing should be 2');
    assert.strictEqual(res1.newWidth, 68, 'New width should be 68 (2*34)');
    assert.strictEqual(res1.newHeight, 68, 'New height should be 68 (2*34)');

    const ctx1 = res1.canvas.getContext('2d');

    // Check Tile 0,0 location: destX = 1, destY = 1. Tile spans x: [1..32], y: [1..32]
    // Top-left pixel of Tile 0,0 is at (1,1) -> should be yellow (#ffff00)
    const tlPixel = getColorAt(ctx1, 1, 1);
    assert.strictEqual(tlPixel, 'rgba(255,255,0,255)', 'Tile (0,0) top-left pixel should be yellow');

    // Extruded top-left corner at (0,0) -> should be duplicated yellow (#ffff00)
    const extCorner = getColorAt(ctx1, 0, 0);
    assert.strictEqual(extCorner, 'rgba(255,255,0,255)', 'Extruded (0,0) corner should match duplicated yellow pixel');

    // Extruded top border at (1,0) -> should match (1,1) yellow
    const extTop = getColorAt(ctx1, 1, 0);
    assert.strictEqual(extTop, 'rgba(255,255,0,255)', 'Extruded top border should match top row');

    // Extruded left border at (0,1) -> should match (1,1) yellow
    const extLeft = getColorAt(ctx1, 0, 1);
    assert.strictEqual(extLeft, 'rgba(255,255,0,255)', 'Extruded left border should match left column');

    // Bottom-right pixel of Tile 0,0 is at (32, 32) -> should be blue (#0000ff)
    const brPixel = getColorAt(ctx1, 32, 32);
    assert.strictEqual(brPixel, 'rgba(0,0,255,255)', 'Tile (0,0) bottom-right pixel should be blue');

    // Extruded bottom-right corner at (33, 33) -> should be duplicated blue (#0000ff)
    const extBrCorner = getColorAt(ctx1, 33, 33);
    assert.strictEqual(extBrCorner, 'rgba(0,0,255,255)', 'Extruded bottom-right corner should match duplicated blue');

    // Check Spacing between Tile 0,0 and Tile 1,0:
    // Tile 0,0 ends at x = 32.
    // Pixel x = 33 is Tile 0,0's extruded right border.
    // Pixel x = 34 is Tile 1,0's extruded left border (which is green #00ff00).
    // Tile 1,0 starts at x = 35.
    const tile0RightExtrude = getColorAt(ctx1, 33, 10);
    const tile1LeftExtrude = getColorAt(ctx1, 34, 10);
    const tile1Start = getColorAt(ctx1, 35, 10);
    assert.strictEqual(tile0RightExtrude, 'rgba(255,0,0,255)', 'Pixel 33 should be Tile 0 right extruded red border');
    assert.strictEqual(tile1LeftExtrude, 'rgba(0,255,0,255)', 'Pixel 34 should be Tile 1 left extruded green border');
    assert.strictEqual(tile1Start, 'rgba(0,255,0,255)', 'Pixel 35 should be Tile 1 green body');

    console.log('✅ 1px extrusion verified: edge borders and 4 corner pixels match perfectly!');

    // 3. Test 2px Extrusion
    const res2 = extrudeTilesetCanvas(srcCanvas, {
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
        extrude: 2,
        createCanvasFn: createCanvas
    });
    console.log(`3. Extrusion 2px result: Output ${res2.newWidth}x${res2.newHeight}px, newMargin=${res2.newMargin}, newSpacing=${res2.newSpacing}`);
    assert.strictEqual(res2.newMargin, 2, '2px extrude margin should be 2');
    assert.strictEqual(res2.newSpacing, 4, '2px extrude spacing should be 4 (2*2)');
    assert.strictEqual(res2.newWidth, 72, '2px extrude width should be 72 (2 * (32 + 4))');
    assert.strictEqual(res2.newHeight, 72, '2px extrude height should be 72');

    const ctx2 = res2.canvas.getContext('2d');
    // For 2px extrude, Tile 0,0 starts at (2,2)
    // Corners (0,0), (0,1), (1,0), (1,1) should all be yellow (#ffff00)
    assert.strictEqual(getColorAt(ctx2, 0, 0), 'rgba(255,255,0,255)', '2px corner (0,0)');
    assert.strictEqual(getColorAt(ctx2, 1, 0), 'rgba(255,255,0,255)', '2px corner (1,0)');
    assert.strictEqual(getColorAt(ctx2, 0, 1), 'rgba(255,255,0,255)', '2px corner (0,1)');
    assert.strictEqual(getColorAt(ctx2, 1, 1), 'rgba(255,255,0,255)', '2px corner (1,1)');
    assert.strictEqual(getColorAt(ctx2, 2, 2), 'rgba(255,255,0,255)', 'Tile (0,0) top-left at (2,2)');
    console.log('✅ 2px extrusion verified: 2x2 corner padding block matches!');

    // 4. Test In-Place Extrusion on state.tilesets
    state.tilesets = [{
        id: 'ts_test_1',
        name: 'Meadow Test',
        image: srcCanvas,
        margin: 0,
        spacing: 0,
        tilewidth: 32,
        tileheight: 32,
        tileProperties: { '0,0': { solid: true } }
    }];
    state.activeTilesetIndex = 0;

    // Apply 1px extrusion
    await applyExtrusionToTileset(0, { extrude: 1 });
    assert.strictEqual(state.tilesets[0].margin, 1, 'State tileset margin updated to 1');
    assert.strictEqual(state.tilesets[0].spacing, 2, 'State tileset spacing updated to 2');
    assert.strictEqual(state.tilesets[0].tileProperties['0,0'].solid, true, 'Tile properties preserved');
    console.log('✅ In-place state extrusion applied successfully!');

    // 5. Test Clone As Extruded
    await cloneAsExtrudedTileset(0, { extrude: 1 });
    assert.strictEqual(state.tilesets.length, 2, 'Cloned tileset added to state.tilesets');
    assert.strictEqual(state.tilesets[1].name, 'Meadow Test (Extruded)', 'Cloned tileset name');
    console.log('✅ Clone as extruded tileset verified!');

    // 6. Test Tiled TMJ Export of Extruded Tilesets
    let capturedTMJ = '';
    window.TileWeaver.exportImport.downloadFile = (content) => { capturedTMJ = content; };
    state.mapWidth = 2;
    state.mapHeight = 2;
    state.mapLayers = [{
        id: 'l1',
        name: 'Ground',
        type: 'tilelayer',
        visible: true,
        opacity: 1.0,
        data: [[{ tilesetId: 'ts_test_1', tx: 0, ty: 0 }], [null]]
    }];
    exportTiledTMJ('test_extruded_tmj.json');
    const parsedTMJ = JSON.parse(capturedTMJ);
    assert.strictEqual(parsedTMJ.tilesets[0].margin, 1, 'TMJ exported margin should be 1');
    assert.strictEqual(parsedTMJ.tilesets[0].spacing, 2, 'TMJ exported spacing should be 2');
    console.log('✅ Tiled TMJ export of extruded tileset verified: margin=1, spacing=2!');

    // 7. Test Tainted Canvas Simulation (CORS / file:// SecurityError resilience)
    console.log('7. Simulating tainted canvas SecurityError...');
    const taintedCanvas = createCanvas(64, 64);
    // Override toDataURL on this canvas and its factory to throw DOM SecurityError
    const originalCreateCanvas = createCanvas;
    const taintedCanvasFactory = (w, h) => {
        const c = originalCreateCanvas(w, h);
        c.toDataURL = () => {
            throw new Error("Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported.");
        };
        return c;
    };

    const taintedResult = extrudeTilesetCanvas(taintedCanvas, {
        tileWidth: 32,
        tileHeight: 32,
        margin: 0,
        spacing: 0,
        extrude: 1,
        createCanvasFn: taintedCanvasFactory
    });
    assert.strictEqual(taintedResult.dataUrl, '', 'Tainted canvas should safely result in empty dataUrl without throwing');
    assert.ok(taintedResult.canvas, 'Tainted canvas result should still contain valid canvas object');

    // Test applying extrusion with tainted canvas
    state.tilesets = [{
        id: 'ts_tainted',
        name: 'Tainted Sheet',
        image: taintedCanvas,
        margin: 0,
        spacing: 0,
        tilewidth: 32,
        tileheight: 32,
        tileProperties: {}
    }];
    state.activeTilesetIndex = 0;

    // Apply extrusion to tainted tileset
    await applyExtrusionToTileset(0, { extrude: 1, createCanvasFn: taintedCanvasFactory });
    assert.strictEqual(state.tilesets[0].margin, 1, 'Tainted tileset in-place margin updated');
    assert.strictEqual(state.tilesets[0].spacing, 2, 'Tainted tileset in-place spacing updated');
    assert.ok(state.tilesets[0].image, 'Tainted tileset image assigned fallback canvas directly');
    console.log('✅ Tainted canvas extrusion fallback verified successfully!');

    // 8. Test Map Canvas vs Tileset Canvas Coordinate Translation with Extruded Margin/Spacing
    console.log('8. Testing Map Canvas vs Tileset Canvas coordinate calculations...');
    const { getCanvasPixelCoordinates } = window.TileWeaver.rendering;
    
    // Create mock mapCanvas and tilesetCanvas
    const mockMapCanvas = {
        id: 'map-canvas',
        width: 640,
        height: 640,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 640 })
    };
    const mockTilesetCanvas = {
        id: 'dock-tileset-canvas',
        width: 136,
        height: 136,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 136, height: 136 })
    };

    // Active tileset has margin=1, spacing=2, tile size=32
    // Map Canvas: At mouse x=340, y=340 -> should be exact map col=10 (340/32=10.6), row=10
    const mapCoords = getCanvasPixelCoordinates(mockMapCanvas, { clientX: 340, clientY: 340 });
    assert.strictEqual(mapCoords.col, 10, 'Map canvas column must be 10 (not compressed by tileset margin/spacing)');
    assert.strictEqual(mapCoords.row, 10, 'Map canvas row must be 10 (not compressed by tileset margin/spacing)');

    // Tileset Canvas: At mouse x=35, y=35 -> (35 - 1 margin) / (32 + 2 spacing) = 34 / 34 = 1 -> tile (1,1)
    const tsCoords = getCanvasPixelCoordinates(mockTilesetCanvas, { clientX: 35, clientY: 35 });
    assert.strictEqual(tsCoords.col, 1, 'Tileset palette column should correctly account for margin and spacing');
    assert.strictEqual(tsCoords.row, 1, 'Tileset palette row should correctly account for margin and spacing');
    console.log('✅ Map Canvas vs Tileset Canvas coordinate separation verified successfully!');

    console.log('🎉 ALL TILESET EXTRUSION VERIFICATION TESTS PASSED PERFECTLY!');
}

runExtruderTests().catch(err => {
    console.error('❌ Extruder test failed:', err);
    process.exit(1);
});
