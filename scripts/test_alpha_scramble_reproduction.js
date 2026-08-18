const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Mock browser globals
global.window = {};
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return createCanvas(160, 160);
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
        set: (v) => { _src = v; setTimeout(() => { if (canvas.onload) canvas.onload(); }, 1); }
    });
    return canvas;
};
global.Blob = function(c) { return c; };
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };

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

const { state, recomputeTilesetGids } = window.TileWeaver.stateModule;
const { exportTiledTMJ, importMapJSON } = window.TileWeaver.exportImport;
const { handleDeleteTileset } = window.TileWeaver.tilesetManager;

async function testAlpha() {
  const alphaRaw = fs.readFileSync('test/alpha_map.json', 'utf8');
  
  await new Promise((resolve) => {
    global.FileReader = function() {
      this.readAsText = function() {
        setTimeout(async () => {
          await this.onload({ target: { result: alphaRaw } });
          resolve();
        }, 10);
      };
    };
    importMapJSON({ name: 'alpha_map.json' }, () => {});
  });

  console.log('Imported tilesets count:', state.tilesets.length);
  state.tilesets.forEach((ts, idx) => {
    console.log(`  [${idx}] ${ts.name} (firstgid: ${ts.firstgid}, count: ${ts.images ? ts.images.length : ts.tilecount})`);
  });

  // Check state objects of interest before deleting AutoMap Rules
  console.log('\n--- Placed objects before tileset deletion ---');
  state.mapLayers.forEach(l => {
    if (l.type === 'objectgroup' && l.objects) {
      l.objects.forEach(o => {
        if ([144, 342, 343, 375].includes(o.id)) {
          console.log(`Obj ID: ${o.id}, name: '${o.name}', tilesetId: ${o.tilesetId}, imageId: ${o.imageId}, localTileId: ${o.localTileId}, gid: ${o.gid}`);
        }
      });
    }
  });

  // Find index of 'AutoMap Rules'
  const autoMapIdx = state.tilesets.findIndex(t => t.name === 'AutoMap Rules');
  console.log('\nAutoMap Rules index:', autoMapIdx);
  state.activeTilesetIndex = autoMapIdx;
  handleDeleteTileset();

  console.log('\n--- After deleting AutoMap Rules ---');
  state.tilesets.forEach((ts, idx) => {
    console.log(`  [${idx}] ${ts.name} (firstgid: ${ts.firstgid})`);
  });

  console.log('\n--- Placed objects after tileset deletion in state ---');
  state.mapLayers.forEach(l => {
    if (l.type === 'objectgroup' && l.objects) {
      l.objects.forEach(o => {
        if ([144, 342, 343, 375].includes(o.id)) {
          console.log(`Obj ID: ${o.id}, name: '${o.name}', tilesetId: ${o.tilesetId}, imageId: ${o.imageId}, localTileId: ${o.localTileId}, gid: ${o.gid}`);
        }
      });
    }
  });

  let exportedTMJ = '';
  window.TileWeaver.exportImport.downloadFile = (c) => { exportedTMJ = c; };
  exportTiledTMJ('test_fix.json');

  const parsedTMJ = JSON.parse(exportedTMJ);
  console.log('\n--- Exported TMJ tilesets ---');
  parsedTMJ.tilesets.forEach((ts, idx) => {
    console.log(`  [${idx}] ${ts.name} (firstgid: ${ts.firstgid}, tilecount: ${ts.tilecount})`);
  });

  console.log('\n--- Exported TMJ objects of interest ---');
  parsedTMJ.layers.forEach(l => {
    if (l.type === 'objectgroup' && l.objects) {
      l.objects.forEach(o => {
        if ([144, 342, 343, 375].includes(o.id)) {
          console.log(`Obj ID: ${o.id}, name: '${o.name}', GID: ${o.gid}`);
        }
      });
    }
  });

  // Now re-import the exported TMJ and check what objects resolve to!
  console.log('\n--- RE-IMPORTING EXPORTED TMJ ---');
  state.tilesets = [];
  state.mapLayers = [];
  await new Promise((resolve) => {
    global.FileReader = function() {
      this.readAsText = function() {
        setTimeout(async () => {
          await this.onload({ target: { result: exportedTMJ } });
          resolve();
        }, 10);
      };
    };
    importMapJSON({ name: 'test_fix.json' }, () => {});
  });

  console.log('\n--- Re-imported Objects of Interest ---');
  const alphaObjTs = state.tilesets.find(t => t.name === 'alpha_objects');
  state.mapLayers.forEach(l => {
    if (l.type === 'objectgroup' && l.objects) {
      l.objects.forEach(o => {
        if ([144, 342, 343, 375].includes(o.id)) {
          const imgObj = alphaObjTs && alphaObjTs.images ? alphaObjTs.images.find(img => img.id === o.imageId || img.tileId === o.localTileId) : null;
          console.log(`Obj ID: ${o.id}, name: '${o.name}', GID: ${o.gid}, localTileId: ${o.localTileId}, Resolved Image: ${imgObj ? (imgObj.filename || imgObj.name) : 'UNKNOWN'}`);
        }
      });
    }
  });
}

testAlpha().catch(console.error);
