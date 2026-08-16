/**
 * TileWeaver - Constants & Slot Definitions Automated Test Suite
 * -------------------------------------------------------------------
 * Validates immutable engine constants, deep freeze immutability,
 * artist sprite sheet matrix dimensions, 8 autotile mode slot schemas,
 * zero-allocation query helpers, and universal CommonJS / browser exports.
 */

const assert = require('assert');
const path = require('path');

console.log('===============================================================');
console.log('🧪 STARTING ENGINE CONSTANTS & SLOT DEFINITIONS TEST SUITE');
console.log('===============================================================\n');

// 1. Initialize Mock Window & Require Constants Module
global.window = global.window || {};
const constants = require('../js/constants.js');

// ▶ TEST 1: Public Module Interface & Universal Isomorphic Bootstrapping
console.log('▶ TEST 1: Public Module Interface & Universal Isomorphic Bootstrapping');
assert(constants !== null && typeof constants === 'object', 'Constants module must export an object');
assert(global.window.TileWeaver && global.window.TileWeaver.constants, 'window.TileWeaver.constants namespace must be populated');
assert.strictEqual(constants, global.window.TileWeaver.constants, 'CommonJS export and window namespace must reference identical object');
assert(typeof constants.getModeSlots === 'function', 'getModeSlots helper function must be exported');
assert(typeof constants.getMatrix === 'function', 'getMatrix helper function must be exported');
assert(typeof constants.getSlotByKey === 'function', 'getSlotByKey helper function must be exported');
assert(typeof constants.deepFreeze === 'function', 'deepFreeze utility must be exported');
console.log('  ✔ Universal isomorphic bootstrapping & exports verified cleanly!\n');

// ▶ TEST 2: Core Engine Parameters & Invariant Bounds
console.log('▶ TEST 2: Core Engine Parameters & Invariant Bounds');
assert.strictEqual(constants.MAX_HISTORY, 50, 'MAX_HISTORY must equal 50');
assert.strictEqual(constants.DEFAULT_TILE_SIZE, 32, 'DEFAULT_TILE_SIZE must equal 32');
assert.strictEqual(constants.DEFAULT_MAP_WIDTH, 30, 'DEFAULT_MAP_WIDTH must equal 30');
assert.strictEqual(constants.DEFAULT_MAP_HEIGHT, 20, 'DEFAULT_MAP_HEIGHT must equal 20');
assert.strictEqual(constants.CLIFF_7X5_MATRIX, null, 'CLIFF_7X5_MATRIX must be null for backward compatibility');
console.log('  ✔ Engine invariants (MAX_HISTORY=50, DEFAULT_TILE_SIZE=32, DEFAULT_MAP=30x20) verified!\n');

// ▶ TEST 3: Deep Immutability (deepFreeze) Verification
console.log('▶ TEST 3: Deep Immutability (deepFreeze) Verification');
assert(Object.isFrozen(constants), 'Top-level constants dictionary must be frozen');
assert(Object.isFrozen(constants.DUALGRID_6X3_MATRIX), 'DUALGRID_6X3_MATRIX must be frozen');
assert(Object.isFrozen(constants.CLIFF_7X6_MATRIX), 'CLIFF_7X6_MATRIX must be frozen');
assert(Object.isFrozen(constants.WALL_9X3_MATRIX), 'WALL_9X3_MATRIX must be frozen');
assert(Object.isFrozen(constants.MODE_SLOTS), 'MODE_SLOTS dictionary must be frozen');
assert(Object.isFrozen(constants.MODE_SLOTS.dualgrid), 'MODE_SLOTS.dualgrid array must be frozen');
assert(Object.isFrozen(constants.MODE_SLOTS.dualgrid[0]), 'Individual slot objects must be recursively frozen');

assert.throws(() => {
    'use strict';
    constants.MAX_HISTORY = 100;
}, TypeError, 'Direct mutation of constants must throw TypeError in strict mode');

assert.throws(() => {
    'use strict';
    constants.DUALGRID_6X3_MATRIX[0][0] = 'corrupted';
}, TypeError, 'Direct mutation of nested matrix arrays must throw TypeError in strict mode');
console.log('  ✔ Recursive deepFreeze immutability & strict-mode mutation shields verified!\n');

// ▶ TEST 4: Artist Sprite Sheet Layout Matrix Dimensions & Null Guards
console.log('▶ TEST 4: Artist Sprite Sheet Layout Matrix Dimensions & Null Guards');
// DUALGRID_6X3_MATRIX (3 rows, 6 cols)
assert.strictEqual(constants.DUALGRID_6X3_MATRIX.length, 3, 'DUALGRID matrix must have 3 rows');
constants.DUALGRID_6X3_MATRIX.forEach((row, rIdx) => {
    assert.strictEqual(row.length, 6, `DUALGRID Row ${rIdx} must have 6 columns`);
});
assert.strictEqual(constants.DUALGRID_6X3_MATRIX[1][5], null, 'DUALGRID (1,5) must be null reserved slot');
assert.strictEqual(constants.DUALGRID_6X3_MATRIX[2][5], null, 'DUALGRID (2,5) must be null reserved slot');

// CLIFF_7X6_MATRIX (6 rows, 7 cols)
assert.strictEqual(constants.CLIFF_7X6_MATRIX.length, 6, 'CLIFF matrix must have 6 rows');
constants.CLIFF_7X6_MATRIX.forEach((row, rIdx) => {
    assert.strictEqual(row.length, 7, `CLIFF Row ${rIdx} must have 7 columns`);
});
assert.strictEqual(constants.CLIFF_7X6_MATRIX[0][6], null, 'CLIFF (0,6) must be null');
assert.strictEqual(constants.CLIFF_7X6_MATRIX[1][6], null, 'CLIFF (1,6) must be null');
assert.strictEqual(constants.CLIFF_7X6_MATRIX[2][6], null, 'CLIFF (2,6) must be null');

// WALL_9X3_MATRIX (3 rows, 9 cols)
assert.strictEqual(constants.WALL_9X3_MATRIX.length, 3, 'WALL matrix must have 3 rows');
let wallNonNullSlots = 0;
constants.WALL_9X3_MATRIX.forEach((row, rIdx) => {
    assert.strictEqual(row.length, 9, `WALL Row ${rIdx} must have 9 columns`);
    row.forEach(cell => {
        if (cell !== null) wallNonNullSlots++;
    });
});
assert.strictEqual(wallNonNullSlots, 16, 'WALL matrix must contain exactly 16 bitmask slots');
console.log('  ✔ 2D Sprite sheet layout matrices (6x3 Dual-Grid, 7x6 Cliff, 9x3 Wall) dimensions verified!\n');

// ▶ TEST 5: Autotile Slot Schemas Coverage & Key Schema Integrity
console.log('▶ TEST 5: Autotile Slot Schemas Coverage & Key Schema Integrity');
const expectedModes = [
    'cliff_vstretch',
    'overlay_dualgrid',
    'dualgrid',
    '9slice',
    'wall_9x3',
    '16tile',
    '25tile',
    '47tile'
];

expectedModes.forEach(modeKey => {
    assert(constants.MODE_SLOTS[modeKey] && Array.isArray(constants.MODE_SLOTS[modeKey]), `MODE_SLOTS must contain array for ${modeKey}`);
    assert(constants.MODE_SLOTS[modeKey].length > 0, `Mode ${modeKey} must have at least 1 slot`);
    constants.MODE_SLOTS[modeKey].forEach((slot, sIdx) => {
        assert(typeof slot.key === 'string' && slot.key.length > 0, `Mode ${modeKey} slot ${sIdx} must have string key`);
        assert(typeof slot.label === 'string', `Mode ${modeKey} slot ${slot.key} must have label`);
        assert(typeof slot.category === 'string', `Mode ${modeKey} slot ${slot.key} must have category`);
    });
});
console.log(`  ✔ All ${expectedModes.length} autotile mode schemas validated with complete key coverage!\n`);

// ▶ TEST 6: Zero-Allocation Query Helpers & Fallback Resilience
console.log('▶ TEST 6: Zero-Allocation Query Helpers & Fallback Resilience');
// getModeSlots
const dualGridSlots = constants.getModeSlots('dualgrid');
assert.strictEqual(dualGridSlots.length, 16, 'getModeSlots(dualgrid) must return 16 slots');
const fallbackSlots = constants.getModeSlots('non_existent_mode');
assert(Array.isArray(fallbackSlots) && fallbackSlots.length === 0, 'getModeSlots on unknown mode must return empty array');
assert(Object.isFrozen(fallbackSlots), 'Fallback array must be frozen');

// getMatrix
assert.strictEqual(constants.getMatrix('dualgrid'), constants.DUALGRID_6X3_MATRIX, 'getMatrix(dualgrid) must return DUALGRID_6X3_MATRIX');
assert.strictEqual(constants.getMatrix('overlay_dualgrid'), constants.DUALGRID_6X3_MATRIX, 'getMatrix(overlay_dualgrid) must return DUALGRID_6X3_MATRIX');
assert.strictEqual(constants.getMatrix('cliff_vstretch'), constants.CLIFF_7X6_MATRIX, 'getMatrix(cliff_vstretch) must return CLIFF_7X6_MATRIX');
assert.strictEqual(constants.getMatrix('wall_9x3'), constants.WALL_9X3_MATRIX, 'getMatrix(wall_9x3) must return WALL_9X3_MATRIX');
assert.strictEqual(constants.getMatrix('invalid_mode'), null, 'getMatrix on unknown mode must return null');

// getSlotByKey
const solidSlot = constants.getSlotByKey('dualgrid', 'grid_15');
assert(solidSlot !== null, 'getSlotByKey(dualgrid, grid_15) must find slot');
assert.strictEqual(solidSlot.key, 'grid_15', 'Found slot must have matching key');
assert.deepStrictEqual(solidSlot.corners, [1, 1, 1, 1], 'Solid dualgrid slot must have [1,1,1,1] corners');

const missingSlot = constants.getSlotByKey('dualgrid', 'non_existent_key');
assert.strictEqual(missingSlot, null, 'getSlotByKey with missing key must return null');
assert.strictEqual(constants.getSlotByKey('missing_mode', 'grid_15'), null, 'getSlotByKey with missing mode must return null');
console.log('  ✔ Zero-allocation query helpers (getModeSlots, getMatrix, getSlotByKey) verified!\n');

console.log('===============================================================');
console.log('🎉 ALL CONSTANTS & SLOT DEFINITIONS TESTS PASSED (6/6)!');
console.log('===============================================================\n');
