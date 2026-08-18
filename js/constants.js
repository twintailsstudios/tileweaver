/**
 * @fileoverview TileWeaver - Engine Constants & Autotile Mode Slot Definitions
 * @subsystem Core State & Bootstrapper / Constants & Slot Definitions
 * @frameBudget 0.0ms (Static lookup tables and immutable matrix definitions)
 * @coordinateSpace ScreenPX -> CanvasDPR -> ViewportPanZoom -> GridTileXY
 * @stateInvariants Enforces MAX_HISTORY=50 ceiling and DEFAULT_* bounds for state store initialization
 * @historyTracked Read-only baseline; defines undo/redo history stack depth
 * @exportCompatibility Full Native JSON v3.3 and Tiled TMJ 1.10+ autotile bitmask schemas
 * -------------------------------------------------------------------
 * This module defines central immutable parameters for the editor and
 * authoritative slot mapping schemas for all supported autotile modes:
 *
 * 1. `dualgrid`: 16 4-corner binary vertex bitmasks (0..15).
 * 2. `overlay_dualgrid`: 15 transparent overlay dual-grid slots.
 * 3. `cliff_vstretch`: 28 vertical cliffside composite surface & wall slots.
 * 4. `9slice`: Basic 3x3 outer terrain box (9 slots).
 * 5. `wall_9x3`: 16 cardinal wall and fence slots (bitmasks 0..15).
 * 6. `16tile`: Single 1x1 paths, 1-tile wide roads, crossroads, turns & dead-ends (16 slots).
 * 7. `25tile`: Extended 9-slice + 45° diagonal ramps + inner concave corners (19 slots).
 * 8. `47tile`: RPG Maker A2 full terrain set with inner corner cutouts (13 slots).
 */

(function() {
    'use strict';

    // Universal root resolver supporting Browser (window), Web Worker (self), and Node.js (global/globalThis)
    const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : (typeof globalThis !== 'undefined' ? globalThis : {}));
    root.TileWeaver = root.TileWeaver || {};
    root.TileWeaver = root.TileWeaver; // Backward-compatibility alias

    /**
     * Pre-allocated frozen empty array for zero-allocation fallback queries.
     * @type {ReadonlyArray<never>}
     */
    const FROZEN_EMPTY_ARRAY = Object.freeze([]);

    /**
     * Recursively freezes an object and its nested properties to guarantee complete immutability.
     * @template T
     * @param {T} obj
     * @returns {Readonly<T>}
     */
    function deepFreeze(obj) {
        if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }
        Object.freeze(obj);
        const props = Object.getOwnPropertyNames(obj);
        for (let i = 0; i < props.length; i++) {
            const val = obj[props[i]];
            if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
                deepFreeze(val);
            }
        }
        return obj;
    }

    let appReleaseVersion = '3.3.1';
    if (typeof require !== 'undefined') {
        try {
            const pkg = require('../package.json');
            if (pkg && pkg.version) {
                appReleaseVersion = String(pkg.version);
            }
        } catch (e) {
            // Standalone or browser fallback
        }
    }

    const constantsObj = {
        /** Authoritative application release version */
        APP_VERSION: appReleaseVersion,

        /** Backward compatibility alias for APP_VERSION */
        VERSION: appReleaseVersion,

        /** Maximum snapshots stored in the undo/redo history stack (caps heap memory) */
        MAX_HISTORY: 50,

        /** Default tile size in pixels (32x32px) */
        DEFAULT_TILE_SIZE: 32,

        /** Default map width in tiles (30 tiles) */
        DEFAULT_MAP_WIDTH: 30,

        /** Default map height in tiles (20 tiles) */
        DEFAULT_MAP_HEIGHT: 20,

        /**
         * Authoritative 6x3 Artist Dual-Grid Matrix Layout.
         * Maps (Row 0..2, Col 0..5) on a 6x3 tileset footprint to dual-grid bitmask keys.
         * Position (1,5) and (2,5) are null (reserved variation/padding slots).
         */
        DUALGRID_6X3_MATRIX: [
            ['grid_7',  'grid_3',  'grid_11', 'grid_8',  'grid_4',  'grid_15'], // Row 0 (6 tiles)
            ['grid_5',  'grid_0',  'grid_10', 'grid_2',  'grid_1',  null],      // Row 1 (5 tiles + reserved)
            ['grid_13', 'grid_12', 'grid_14', 'grid_6',  'grid_9',  null]       // Row 2 (5 tiles + reserved)
        ],

        /**
         * Authoritative 7x6 Combined Cliffside Matrix Layout.
         * Rows 0..2 (7x3): Cliff Top Ground Surface (Standard 6x3 Dual-Grid layout + padding).
         * Rows 3..4 (7x2): Cliff Side Wall Face & Base Footing Extension.
         * Row 5 (7x1): Alternative Wall-Top Edge Extensions (swapped when Cliff Wall exists above).
         */
        CLIFF_7X6_MATRIX: [
            ['grid_8',  'grid_12', 'grid_4',  'grid_7',  'grid_11', 'grid_0',          null],             // Row 0: Outer TL (8), Top Edge (12), Outer TR (4), Inner BR Cutout (7), Inner BL Cutout (11), Alternate Fill (0)
            ['grid_10', 'grid_15', 'grid_5',  'grid_13', 'grid_14', 'cliff_drop_side', null],             // Row 1: Left Edge (10), Solid Cliff Top Fill (15), Right Edge (5), Inner TR Cutout (13), Inner TL Cutout (14), Side Drop
            ['grid_2',  'grid_3',  'grid_1',  'grid_9',  'grid_6',  'cliff_top_cap',   null],             // Row 2: Outer BL (2), Lip Rim Edge (3), Outer BR (1), Diag TL+BR (9), Diag TR+BL (6), Pillar Cap
            ['cliff_face_l',   'cliff_face_mid',  'cliff_face_r',   'cliff_face_v1',       'cliff_face_v2',       'cliff_side_l', 'cliff_side_r'],  // Row 3: Cliff Side Wall Face & Upper Joins (3,5) & (3,6)
            ['cliff_base_bl',  'cliff_base_shadow','cliff_base_br', 'cliff_blend_l',       'cliff_blend_r',       'cliff_side_l2', 'cliff_side_r2'], // Row 4: Cliff Base Footing & Lower Joins (4,5) & (4,6)
            ['cliff_top_alt_tl','cliff_top_alt_top','cliff_top_alt_tr','cliff_top_alt_inner_br','cliff_top_alt_inner_bl','cliff_top_alt_bl','cliff_top_alt_br'] // Row 5: Alt Wall-Top Edges (5,0)..(5,6)
        ],
        /** Backward compatibility alias for 7x5 matrix */
        CLIFF_7X5_MATRIX: null,

        /**
         * Authoritative 9x3 Cardinal Wall Matrix Layout.
         * Row 0: [ null, 'cornerTL', 'cornerTR', null, 'capN', null, null, 'tNorth', null ]
         * Row 1: [ 'post', 'cornerBL', 'cornerBR', 'capW', 'cross', 'capE', 'tWest', null, 'tEast' ]
         * Row 2: [ 'pipeH', 'pipeV', null, null, 'capS', null, null, 'tSouth', null ]
         */
        WALL_9X3_MATRIX: [
            [null, 'cornerTL', 'cornerTR', null, 'capN',  null, null, 'tNorth', null],
            ['post', 'cornerBL', 'cornerBR', 'capW', 'cross', 'capE', 'tWest', null, 'tEast'],
            ['pipeH', 'pipeV',   null,       null, 'capS',  null, null, 'tSouth', null]
        ],

        /**
         * Authoritative slot schemas for the interactive Autotile Wizard and Bitmask Engine.
         * Used to render interactive slot mapping buttons and match bitmask keys.
         */
        MODE_SLOTS: {
            // Standardized Cliffside System (6x3 Ground Top + 6x2 Wall Extension + 7th Column Extensions)
            'cliff_vstretch': [
                // Rows 0..2: Cliff Top Ground Surface (Standard Dual-Grid Layout)
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,0)', anatomicalBadge: 'Outer TL Corner', mirrorKey: 'grid_4', key: 'grid_8', corners: [1, 0, 0, 0], quadrants: { tl: 3, tr: 3, bl: 3, br: 1 }, label: '(0,0) [Material 1 Name] - Outer TL Corner', tagLabel: 'Outer TL Crnr', desc: 'Used as the top left corner of the [Material 1 Name] plateau when 3 of the 4 quadrants are touching [Material 3 Name] tiles.', icon: 'ph-arrow-up-left', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,1)', anatomicalBadge: 'Top Edge', mirrorKey: null, key: 'grid_12', corners: [0, 0, 1, 1], quadrants: { tl: 3, tr: 3, bl: 1, br: 1 }, label: '(0,1) [Material 1 Name] - Top Straight Edge', tagLabel: 'Top Edge', desc: 'Straight top edge of the elevated [Material 1 Name] plateau when top half touches [Material 3 Name] and bottom half is [Material 1 Name].', icon: 'ph-arrow-up', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,2)', anatomicalBadge: 'Outer TR Corner', mirrorKey: 'grid_8', key: 'grid_4', corners: [0, 1, 0, 0], quadrants: { tl: 3, tr: 3, bl: 1, br: 3 }, label: '(0,2) [Material 1 Name] - Outer TR Corner', tagLabel: 'Outer TR Crnr', desc: 'Used as the top right corner of the [Material 1 Name] plateau when 3 of the 4 quadrants are touching [Material 3 Name] tiles.', icon: 'ph-arrow-up-right', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,3)', anatomicalBadge: 'Inner BR Cutout', mirrorKey: 'grid_11', key: 'grid_7', corners: [1, 1, 1, 0], quadrants: { tl: 1, tr: 1, bl: 1, br: 3 }, label: '(0,3) [Material 1 Name] - Inner BR Cutout', tagLabel: 'Inner BR Cut', desc: '[Material 1 Name] plateau fill on top and left, with a single [Material 3 Name] cutout in the Bottom-Right quadrant.', icon: 'ph-intersect', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,4)', anatomicalBadge: 'Inner BL Cutout', mirrorKey: 'grid_7', key: 'grid_11', corners: [1, 1, 0, 1], quadrants: { tl: 1, tr: 1, bl: 3, br: 1 }, label: '(0,4) [Material 1 Name] - Inner BL Cutout', tagLabel: 'Inner BL Cut', desc: '[Material 1 Name] plateau fill on top and right, with a single [Material 3 Name] cutout in the Bottom-Left quadrant.', icon: 'ph-intersect', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 0)', tier: 'top', gridCoordStr: '(0,5)', anatomicalBadge: 'Alternate Surface', mirrorKey: null, key: 'grid_0', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 3, bl: 3, br: 3 }, label: '(0,5) [Material 3 Name] - Solid Ground Fill', tagLabel: 'Solid Ground', desc: '100% solid [Material 3 Name] base ground surface tile with no elevated cliff top.', icon: 'ph-square', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface' } },

                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,0)', anatomicalBadge: 'Left Edge', mirrorKey: 'grid_5', key: 'grid_10', corners: [0, 1, 0, 1], quadrants: { tl: 3, tr: 1, bl: 3, br: 1 }, label: '(1,0) [Material 1 Name] - Left Straight Edge', tagLabel: 'Left Edge', desc: 'Straight left edge of the elevated [Material 1 Name] plateau when left half touches [Material 3 Name] and right half is [Material 1 Name].', icon: 'ph-arrow-left', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,1)', anatomicalBadge: 'Solid Top Fill', mirrorKey: null, key: 'grid_15', corners: [1, 1, 1, 1], quadrants: { tl: 1, tr: 1, bl: 1, br: 1 }, label: '(1,1) [Material 1 Name] - Solid Top Fill', tagLabel: 'Solid Top Fill', desc: '100% solid interior fill tile for the elevated [Material 1 Name] plateau surface.', icon: 'ph-square', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (100% Solid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,2)', anatomicalBadge: 'Right Edge', mirrorKey: 'grid_10', key: 'grid_5', corners: [1, 0, 1, 0], quadrants: { tl: 1, tr: 3, bl: 1, br: 3 }, label: '(1,2) [Material 1 Name] - Right Straight Edge', tagLabel: 'Right Edge', desc: 'Straight right edge of the elevated [Material 1 Name] plateau when right half touches [Material 3 Name] and left half is [Material 1 Name].', icon: 'ph-arrow-right', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,3)', anatomicalBadge: 'Inner TR Cutout', mirrorKey: 'grid_14', key: 'grid_13', corners: [1, 0, 1, 1], quadrants: { tl: 1, tr: 3, bl: 1, br: 1 }, label: '(1,3) [Material 1 Name] - Inner TR Cutout', tagLabel: 'Inner TR Cut', desc: '[Material 1 Name] plateau fill on left and bottom, with a single [Material 3 Name] cutout in the Top-Right quadrant.', icon: 'ph-intersect', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,4)', anatomicalBadge: 'Inner TL Cutout', mirrorKey: 'grid_13', key: 'grid_14', corners: [0, 1, 1, 1], quadrants: { tl: 3, tr: 1, bl: 1, br: 1 }, label: '(1,4) [Material 1 Name] - Inner TL Cutout', tagLabel: 'Inner TL Cut', desc: '[Material 1 Name] plateau fill on right and bottom, with a single [Material 3 Name] cutout in the Top-Left quadrant.', icon: 'ph-intersect', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 1)', tier: 'top', gridCoordStr: '(1,5)', anatomicalBadge: 'Side Drop Left', mirrorKey: 'cliff_top_cap', key: 'cliff_drop_side', corners: [1, 0, 1, 0], quadrants: { tl: 1, tr: 3, bl: 2, br: 3 }, label: '(1,5) [Material 2 Name] - Left Wall Side Drop', tagLabel: 'Left Side Drop', desc: 'Exposed left-side profile where [Material 1 Name] plateau drops to [Material 2 Name] wall on the left.', icon: 'ph-rows', composition: { topMat: 'topGround', bottomMat: 'cliffWall', desc: 'Top: Top Ground · Bottom: Left Cliff Wall Drop' } },

                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,0)', anatomicalBadge: 'Outer BL Corner', mirrorKey: 'grid_1', key: 'grid_2', corners: [0, 0, 1, 0], quadrants: { tl: 3, tr: 1, bl: 3, br: 3 }, label: '(2,0) [Material 1 Name] - Outer BL Corner', tagLabel: 'Outer BL Crnr', desc: 'Outer Bottom-Left corner of top ground surface before transition to [Material 2 Name] wall.', icon: 'ph-arrow-down-left', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,1)', anatomicalBadge: 'Lip Rim Edge', mirrorKey: null, key: 'grid_3', corners: [1, 1, 0, 0], quadrants: { tl: 1, tr: 1, bl: 2, br: 2 }, label: '(2,1) [Material 1 Name] - Lip Rim Overhang', tagLabel: 'Lip Rim Edge', desc: 'Horizontal lip rim overhang where the [Material 1 Name] plateau overhangs the vertical [Material 2 Name] cliff wall below.', icon: 'ph-arrow-down', composition: { topMat: 'topGround', bottomMat: 'cliffWall', desc: 'Top: Top Ground · Bottom: Cliff Wall Overhang' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,2)', anatomicalBadge: 'Outer BR Corner', mirrorKey: 'grid_2', key: 'grid_1', corners: [0, 0, 0, 1], quadrants: { tl: 1, tr: 3, bl: 3, br: 3 }, label: '(2,2) [Material 1 Name] - Outer BR Corner', tagLabel: 'Outer BR Crnr', desc: 'Outer Bottom-Right corner of top ground surface before transition to [Material 2 Name] wall.', icon: 'ph-arrow-down-right', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,3)', anatomicalBadge: 'Diag TL+BR Join', mirrorKey: 'grid_6', key: 'grid_9', corners: [1, 0, 0, 1], quadrants: { tl: 1, tr: 3, bl: 3, br: 1 }, label: '(2,3) [Material 1 Name] - Diag TL+BR Join', tagLabel: 'Diag TL+BR', desc: 'Diagonal join connecting Top-Left & Bottom-Right [Material 1 Name] quadrants.', icon: 'ph-arrows-down-up', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,4)', anatomicalBadge: 'Diag TR+BL Join', mirrorKey: 'grid_9', key: 'grid_6', corners: [0, 1, 1, 0], quadrants: { tl: 3, tr: 1, bl: 1, br: 3 }, label: '(2,4) [Material 1 Name] - Diag TR+BL Join', tagLabel: 'Diag TR+BL', desc: 'Diagonal join connecting Top-Right & Bottom-Left [Material 1 Name] quadrants.', icon: 'ph-arrows-down-up', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top Ground Surface (Dual-Grid)' } },
                { category: '🏔️ [Cliff Top Ground] Dual-Grid Surface (Row 2)', tier: 'top', gridCoordStr: '(2,5)', anatomicalBadge: 'Side Drop Right', mirrorKey: 'cliff_drop_side', key: 'cliff_top_cap', corners: [0, 1, 0, 1], quadrants: { tl: 3, tr: 1, bl: 3, br: 2 }, label: '(2,5) [Material 2 Name] - Right Wall Side Drop', tagLabel: 'Right Side Drop', desc: 'Exposed right-side profile where [Material 1 Name] plateau drops to [Material 2 Name] wall on the right.', icon: 'ph-circle', composition: { topMat: 'topGround', bottomMat: 'cliffWall', desc: 'Top: Top Ground · Bottom: Right Cliff Wall Drop' } },

                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,0)', anatomicalBadge: 'Left Wall Face', mirrorKey: 'cliff_face_r', key: 'cliff_face_l', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 2, bl: 3, br: 2 }, label: '(3,0) [Material 2 Name] - Left Wall Face Edge', tagLabel: 'Left Wall Edge', desc: 'Left vertical border profile of the repeating [Material 2 Name] cliff face wall.', icon: 'ph-arrow-left', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Top: Cliff Wall Face · Bottom: Cliff Wall Face' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,1)', anatomicalBadge: 'Front Wall Face', mirrorKey: null, key: 'cliff_face_mid', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 2, bl: 2, br: 2 }, label: '(3,1) [Material 2 Name] - Mid Front Wall Face', tagLabel: 'Mid Wall Face', desc: 'Primary repeating front [Material 2 Name] cliff face wall tile. Repeats vertically for taller cliffs.', icon: 'ph-walls', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Top: Cliff Wall Face · Bottom: Cliff Wall Face (100% Solid Rock)' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,2)', anatomicalBadge: 'Right Wall Face', mirrorKey: 'cliff_face_l', key: 'cliff_face_r', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 3, bl: 2, br: 3 }, label: '(3,2) [Material 2 Name] - Right Wall Face Edge', tagLabel: 'Right Wall Edge', desc: 'Right vertical border profile of the repeating [Material 2 Name] cliff face wall.', icon: 'ph-arrow-right', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Top: Cliff Wall Face · Bottom: Cliff Wall Face' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,3)', anatomicalBadge: 'Left Drop Wall 1', mirrorKey: 'cliff_face_v2', key: 'cliff_face_v1', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 3, bl: 2, br: 3 }, label: '(3,3) [Material 2 Name] - Left Drop Extension 1', tagLabel: 'Left Drop Ext 1', desc: 'Left side wall face extension directly below the Left Side Drop tile.', icon: 'ph-sparkle', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Top: Cliff Wall Face · Bottom: Left Drop Wall' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,4)', anatomicalBadge: 'Right Drop Wall 1', mirrorKey: 'cliff_face_v1', key: 'cliff_face_v2', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 2, bl: 3, br: 2 }, label: '(3,4) [Material 2 Name] - Right Drop Extension 1', tagLabel: 'Right Drop Ext 1', desc: 'Right side wall face extension directly below the Right Side Drop tile.', icon: 'ph-sparkle', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Top: Cliff Wall Face · Bottom: Right Drop Wall' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,5)', anatomicalBadge: 'Wall Edge Join Left', mirrorKey: 'cliff_side_r', key: 'cliff_side_l', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 2, bl: 3, br: 2 }, label: '(3,5) [Material 2 Name] - Left Wall Edge Join', tagLabel: 'Left Wall Join', desc: 'Left side edge wall join tile used when cliff walls exist to the left of top plateau edges.', icon: 'ph-arrow-left', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Left Cliff Wall Join (3,5)' } },
                { category: '🧱 [Cliff Side Wall] Vertical Face & Base (Row 3)', tier: 'mid', gridCoordStr: '(3,6)', anatomicalBadge: 'Upper Right Join', mirrorKey: 'cliff_side_l', key: 'cliff_side_r', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 2, bl: 3, br: 3 }, label: '(3,6) [Material 2 Name] - Upper Right Cliff Wall Join', tagLabel: 'Upper Right Join', desc: 'Right side edge wall join tile used when cliff walls exist to the right of top plateau edges.', icon: 'ph-arrow-right', composition: { topMat: 'cliffWall', bottomMat: 'cliffWall', desc: 'Upper Right Cliff Wall Join (3,6)' } },

                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,0)', anatomicalBadge: 'Outer Base BL', mirrorKey: 'cliff_base_br', key: 'cliff_base_bl', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 3, bl: 3, br: 3 }, label: '(4,0) [Material 3 Name] - Outer BL Base Footing', tagLabel: 'Outer BL Base', desc: 'Outer bottom-left corner where [Material 2 Name] wall transitions to [Material 3 Name] ground shadow.', icon: 'ph-arrow-down-left', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Top: Cliff Wall Face · Bottom: Lower Ground' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,1)', anatomicalBadge: 'Base Shadow Footing', mirrorKey: null, key: 'cliff_base_shadow', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 2, bl: 3, br: 3 }, label: '(4,1) [Material 3 Name] - Bottom Base Shadow Join', tagLabel: 'Base Shadow Join', desc: 'Bottom ground join where vertical [Material 2 Name] wall casts shadow on [Material 3 Name] ground.', icon: 'ph-line-segments', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Top: Cliff Wall Face · Bottom: Lower Ground Shadow' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,2)', anatomicalBadge: 'Outer Base BR', mirrorKey: 'cliff_base_bl', key: 'cliff_base_br', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 2, bl: 3, br: 3 }, label: '(4,2) [Material 3 Name] - Outer BR Base Footing', tagLabel: 'Outer BR Base', desc: 'Outer bottom-right corner where [Material 2 Name] wall transitions to [Material 3 Name] ground shadow.', icon: 'ph-arrow-down-right', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Top: Cliff Wall Face · Bottom: Lower Ground' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,3)', anatomicalBadge: 'Left Drop Base 2', mirrorKey: 'cliff_blend_r', key: 'cliff_blend_l', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 3, bl: 3, br: 3 }, label: '(4,3) [Material 3 Name] - Left Drop Base Footing', tagLabel: 'Left Drop Base', desc: 'Left side wall base footing extension directly 2 rows below the Left Side Drop tile.', icon: 'ph-gradient', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Top: Left Drop Wall · Bottom: Lower Ground' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,4)', anatomicalBadge: 'Right Drop Base 2', mirrorKey: 'cliff_blend_l', key: 'cliff_blend_r', corners: [0, 0, 0, 0], quadrants: { tl: 3, tr: 2, bl: 3, br: 3 }, label: '(4,4) [Material 3 Name] - Right Drop Base Footing', tagLabel: 'Right Drop Base', desc: 'Right side wall base footing extension directly 2 rows below the Right Side Drop tile.', icon: 'ph-gradient', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Top: Right Drop Wall · Bottom: Lower Ground' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,5)', anatomicalBadge: 'Lower Left Join', mirrorKey: 'cliff_side_r2', key: 'cliff_side_l2', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 2, bl: 2, br: 3 }, label: '(4,5) [Material 2 Name] - Lower Left Cliff Wall Join', tagLabel: 'Lower Left Join', desc: 'Left side edge join tile used for complex inner corner transitions at base level.', icon: 'ph-arrow-up-left', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Lower Left Cliff Wall Join (4,5)' } },
                { category: '🌿 [Cliff Base Footing] Ground Shadow Join (Row 4)', tier: 'base', gridCoordStr: '(4,6)', anatomicalBadge: 'Left Above Join', mirrorKey: 'cliff_side_l2', key: 'cliff_side_r2', corners: [0, 0, 0, 0], quadrants: { tl: 2, tr: 3, bl: 3, br: 3 }, label: '(4,6) [Material 2 Name] - Left Wall Above Join', tagLabel: 'Left Above Join', desc: 'Left side edge join tile used for complex inner corner transitions at base level.', icon: 'ph-arrow-up-left', composition: { topMat: 'cliffWall', bottomMat: 'lowerGround', desc: 'Left Edge Join (Right Above) (4,6)' } },

                // Row 5: Alternative Wall-Top Edge Extensions (Material 2 Cliff Wall Above)
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,0)', anatomicalBadge: 'Alt Outer TL Corner', mirrorKey: 'cliff_top_alt_tr', key: 'cliff_top_alt_tl', corners: [1, 0, 0, 0], quadrants: { tl: 3, tr: 3, bl: 3, br: 1 }, label: '(5,0) [Material 1 Name] - Alt Outer TL Corner', tagLabel: 'Alt TL Crnr', desc: 'Alternative Outer TL Corner used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-arrow-up-left', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,1)', anatomicalBadge: 'Alt Top Edge', mirrorKey: null, key: 'cliff_top_alt_top', corners: [0, 0, 1, 1], quadrants: { tl: 3, tr: 3, bl: 1, br: 1 }, label: '(5,1) [Material 1 Name] - Alt Top Straight Edge', tagLabel: 'Alt Top Edge', desc: 'Alternative Top Straight Edge used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-arrow-up', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,2)', anatomicalBadge: 'Alt Outer TR Corner', mirrorKey: 'cliff_top_alt_tl', key: 'cliff_top_alt_tr', corners: [0, 1, 0, 0], quadrants: { tl: 3, tr: 3, bl: 1, br: 3 }, label: '(5,2) [Material 1 Name] - Alt Outer TR Corner', tagLabel: 'Alt TR Crnr', desc: 'Alternative Outer TR Corner used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-arrow-up-right', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,3)', anatomicalBadge: 'Alt Inner BR Cutout', mirrorKey: 'cliff_top_alt_inner_bl', key: 'cliff_top_alt_inner_br', corners: [1, 1, 1, 0], quadrants: { tl: 1, tr: 1, bl: 1, br: 3 }, label: '(5,3) [Material 1 Name] - Alt Inner BR Cutout', tagLabel: 'Alt BR Cut', desc: 'Alternative Inner BR Cutout used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-intersect', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,4)', anatomicalBadge: 'Alt Inner BL Cutout', mirrorKey: 'cliff_top_alt_inner_br', key: 'cliff_top_alt_inner_bl', corners: [1, 1, 0, 1], quadrants: { tl: 1, tr: 1, bl: 3, br: 1 }, label: '(5,4) [Material 1 Name] - Alt Inner BL Cutout', tagLabel: 'Alt BL Cut', desc: 'Alternative Inner BL Cutout used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-intersect', composition: { topMat: 'topGround', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,5)', anatomicalBadge: 'Alt Outer BL Corner', mirrorKey: 'cliff_top_alt_br', key: 'cliff_top_alt_bl', corners: [0, 0, 1, 0], quadrants: { tl: 3, tr: 1, bl: 3, br: 3 }, label: '(5,5) [Material 1 Name] - Alt Outer BL Corner', tagLabel: 'Alt BL Crnr', desc: 'Alternative Outer BL Corner used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-arrow-down-left', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } },
                { category: '🧗 [Cliff Wall-Top Alt] Elevated Edge Alternatives (Row 5)', tier: 'top_alt', gridCoordStr: '(5,6)', anatomicalBadge: 'Alt Outer BR Corner', mirrorKey: 'cliff_top_alt_bl', key: 'cliff_top_alt_br', corners: [0, 0, 0, 1], quadrants: { tl: 1, tr: 3, bl: 3, br: 3 }, label: '(5,6) [Material 1 Name] - Alt Outer BR Corner', tagLabel: 'Alt BR Crnr', desc: 'Alternative Outer BR Corner used when [Material 2 Name] cliff wall exists directly above this tile.', icon: 'ph-arrow-down-right', composition: { topMat: 'cliffWall', bottomMat: 'topGround', desc: 'Top: Cliff Wall Above · Bottom: Top Ground' } }
            ],
            // Layered Transparent Overlay Dual-Grid (15-Tile Set for 46-Tile 4-Material Systems)
            'overlay_dualgrid': [
                // Row 0 of 6x3 Sprite Sheet: Inverted Top & Outer Corners
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_7', corners: [1, 1, 1, 0], label: '(0,0) 0111 · Inner Cutout (BR Hole)', desc: 'Mostly Solid Overlay, with transparent hole in Bottom-Right.', icon: 'ph-intersect' },
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_3', corners: [1, 1, 0, 0], label: '(0,1) 0011 · Top Edge Overlay', desc: 'Top half is Overlay, Bottom half is transparent.', icon: 'ph-arrow-up' },
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_11', corners: [1, 1, 0, 1], label: '(0,2) 1011 · Inner Cutout (BL Hole)', desc: 'Mostly Solid Overlay, with transparent hole in Bottom-Left.', icon: 'ph-intersect' },
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_8', corners: [0, 0, 0, 1], label: '(0,3) 1000 · Outer Corner (BR)', desc: 'Bottom-Right corner overlay shape on transparent background.', icon: 'ph-arrow-down-right' },
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_4', corners: [0, 0, 1, 0], label: '(0,4) 0100 · Outer Corner (BL)', desc: 'Bottom-Left corner overlay shape on transparent background.', icon: 'ph-arrow-down-left' },
                { category: '🎨 15-Tile Transparent Overlay (Row 0)', key: 'grid_15', corners: [1, 1, 1, 1], label: '(0,5) 1111 · Solid Fill Overlay', desc: '100% solid fill tile of this overlay material.', icon: 'ph-square' },

                // Row 1 of 6x3 Sprite Sheet: Edges & Corners
                { category: '🎨 15-Tile Transparent Overlay (Row 1)', key: 'grid_5', corners: [1, 0, 1, 0], label: '(1,0) 0101 · Left Edge Overlay', desc: 'Left half is Overlay, Right half is transparent.', icon: 'ph-arrow-left' },
                { category: '🎨 15-Tile Transparent Overlay (Row 1)', key: 'grid_10', corners: [0, 1, 0, 1], label: '(1,2) 1010 · Right Edge Overlay', desc: 'Right half is Overlay, Left half is transparent.', icon: 'ph-arrow-right' },
                { category: '🎨 15-Tile Transparent Overlay (Row 1)', key: 'grid_2', corners: [0, 1, 0, 0], label: '(1,3) 0010 · Outer Corner (TR)', desc: 'Top-Right corner overlay shape on transparent background.', icon: 'ph-arrow-up-right' },
                { category: '🎨 15-Tile Transparent Overlay (Row 1)', key: 'grid_1', corners: [1, 0, 0, 0], label: '(1,4) 0001 · Outer Corner (TL)', desc: 'Top-Left corner overlay shape on transparent background.', icon: 'ph-arrow-up-left' },

                // Row 2 of 6x3 Sprite Sheet: Bottom & Diagonals
                { category: '🎨 15-Tile Transparent Overlay (Row 2)', key: 'grid_13', corners: [1, 0, 1, 1], label: '(2,0) 1101 · Inner Cutout (TR Hole)', desc: 'Mostly Solid Overlay, with transparent hole in Top-Right.', icon: 'ph-intersect' },
                { category: '🎨 15-Tile Transparent Overlay (Row 2)', key: 'grid_12', corners: [0, 0, 1, 1], label: '(2,1) 1100 · Bottom Edge Overlay', desc: 'Bottom half is Overlay, Top half is transparent.', icon: 'ph-arrow-down' },
                { category: '🎨 15-Tile Transparent Overlay (Row 2)', key: 'grid_14', corners: [0, 1, 1, 1], label: '(2,2) 1110 · Inner Cutout (TL Hole)', desc: 'Mostly Solid Overlay, with transparent hole in Top-Left.', icon: 'ph-intersect' },
                { category: '🎨 15-Tile Transparent Overlay (Row 2)', key: 'grid_6', corners: [0, 1, 1, 0], label: '(2,3) 0110 · Diagonal (TR + BL)', desc: 'Top-Right & Bottom-Left corners overlay on transparent background.', icon: 'ph-intersect' },
                { category: '🎨 15-Tile Transparent Overlay (Row 2)', key: 'grid_9', corners: [1, 0, 0, 1], label: '(2,4) 1001 · Diagonal (TL + BR)', desc: 'Top-Left & Bottom-Right corners overlay on transparent background.', icon: 'ph-intersect' }
            ],

            // Dual-Grid Engine (16 4-Corner States arranged in 6x3 Artist Visual Layout, Book-Reading Order)
            'dualgrid': [
                // Row 0 of 6x3 Sprite Sheet: Inverted Top & Outer Corners
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_7', corners: [1, 1, 1, 0], label: '(0,0) 0111 · Inner Cutout (Grass in BR)', desc: 'Mostly Dirt, with Grass cutout in Bottom-Right. Select a tile of Dirt with a Grass cutout in BR.', icon: 'ph-intersect' },
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_3', corners: [1, 1, 0, 0], label: '(0,1) 0011 · Top Edge (Dirt on Top)', desc: 'Top half is Dirt, Bottom half is Grass. Select a tile with Dirt on the top half.', icon: 'ph-arrow-up' },
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_11', corners: [1, 1, 0, 1], label: '(0,2) 1011 · Inner Cutout (Grass in BL)', desc: 'Mostly Dirt, with Grass cutout in Bottom-Left. Select a tile of Dirt with a Grass cutout in BL.', icon: 'ph-intersect' },
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_8', corners: [0, 0, 0, 1], label: '(0,3) 1000 · Outer Corner (BR Dirt)', desc: 'Bottom-Right corner is Dirt. Select a tile with Dirt in the Bottom-Right corner only.', icon: 'ph-arrow-down-right' },
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_4', corners: [0, 0, 1, 0], label: '(0,4) 0100 · Outer Corner (BL Dirt)', desc: 'Bottom-Left corner is Dirt. Select a tile with Dirt in the Bottom-Left corner only.', icon: 'ph-arrow-down-left' },
                { category: '🏁 Row 0: Inverted Top & Outer Corners', key: 'grid_15', corners: [1, 1, 1, 1], label: '(0,5) 1111 · Solid Overlay (Dirt)', desc: 'All 4 corners are Overlay (Dirt). Select a 100% solid Dirt tile with no grass.', icon: 'ph-square' },

                // Row 1 of 6x3 Sprite Sheet: Inverted Middle & Outer Corners
                { category: '🏁 Row 1: Inverted Middle & Outer Corners', key: 'grid_5', corners: [1, 0, 1, 0], label: '(1,0) 0101 · Left Edge (Dirt on Left)', desc: 'Left half is Dirt, Right half is Grass. Select a tile with Dirt on the left half.', icon: 'ph-arrow-left' },
                { category: '🏁 Row 1: Inverted Middle & Outer Corners', key: 'grid_0', corners: [0, 0, 0, 0], label: '(1,1) 0000 · Solid Base (Grass)', desc: 'All 4 corners are Base (Grass). Select a 100% solid Grass tile with no dirt.', icon: 'ph-square' },
                { category: '🏁 Row 1: Inverted Middle & Outer Corners', key: 'grid_10', corners: [0, 1, 0, 1], label: '(1,2) 1010 · Right Edge (Dirt on Right)', desc: 'Right half is Dirt, Left half is Grass. Select a tile with Dirt on the right half.', icon: 'ph-arrow-right' },
                { category: '🏁 Row 1: Inverted Middle & Outer Corners', key: 'grid_2', corners: [0, 1, 0, 0], label: '(1,3) 0010 · Outer Corner (TR Dirt)', desc: 'Top-Right corner is Dirt. Select a tile with Dirt in the Top-Right corner only.', icon: 'ph-arrow-up-right' },
                { category: '🏁 Row 1: Inverted Middle & Outer Corners', key: 'grid_1', corners: [1, 0, 0, 0], label: '(1,4) 0001 · Outer Corner (TL Dirt)', desc: 'Top-Left corner is Dirt. Select a tile with Dirt in the Top-Left corner only.', icon: 'ph-arrow-up-left' },

                // Row 2 of 6x3 Sprite Sheet: Inverted Bottom & Diagonal Pairs
                { category: '🏁 Row 2: Inverted Bottom & Diagonal Pairs', key: 'grid_13', corners: [1, 0, 1, 1], label: '(2,0) 1101 · Inner Cutout (Grass in TR)', desc: 'Mostly Dirt, with Grass cutout in Top-Right. Select a tile of Dirt with a Grass cutout in TR.', icon: 'ph-intersect' },
                { category: '🏁 Row 2: Inverted Bottom & Diagonal Pairs', key: 'grid_12', corners: [0, 0, 1, 1], label: '(2,1) 1100 · Bottom Edge (Dirt on Bottom)', desc: 'Bottom half is Dirt, Top half is Grass. Select a tile with Dirt on the bottom half.', icon: 'ph-arrow-down' },
                { category: '🏁 Row 2: Inverted Bottom & Diagonal Pairs', key: 'grid_14', corners: [0, 1, 1, 1], label: '(2,2) 1110 · Inner Cutout (Grass in TL)', desc: 'Mostly Dirt, with Grass cutout in Top-Left. Select a tile of Dirt with a Grass cutout in TL.', icon: 'ph-intersect' },
                { category: '🏁 Row 2: Inverted Bottom & Diagonal Pairs', key: 'grid_6', corners: [0, 1, 1, 0], label: '(2,3) 0110 · Diagonal (TR + BL Dirt)', desc: 'Top-Right & Bottom-Left are Dirt. Select a tile with Dirt in TR and BL corners.', icon: 'ph-intersect' },
                { category: '🏁 Row 2: Inverted Bottom & Diagonal Pairs', key: 'grid_9', corners: [1, 0, 0, 1], label: '(2,4) 1001 · Diagonal (TL + BR Dirt)', desc: 'Top-Left & Bottom-Right are Dirt. Select a tile with Dirt in TL and BR corners.', icon: 'ph-intersect' }
            ],

            // 9-Slice Basic Mode (3x3 outer block)
            '9slice': [
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'topLeft', label: '↖ Top-Left', desc: 'Outer top-left border corner of grass/terrain box.', icon: 'ph-arrow-up-left' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'top', label: '↑ Top Edge', desc: 'Top straight border edge of terrain block.', icon: 'ph-arrow-up' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'topRight', label: '↗ Top-Right', desc: 'Outer top-right border corner of terrain box.', icon: 'ph-arrow-up-right' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'left', label: '← Left Edge', desc: 'Left straight border edge of terrain block.', icon: 'ph-arrow-left' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'center', label: '🟩 Center Fill', desc: 'Solid interior center fill tile surrounded on all sides.', icon: 'ph-square' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'right', label: '→ Right Edge', desc: 'Right straight border edge of terrain block.', icon: 'ph-arrow-right' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'bottomLeft', label: '↙ Bottom-Left', desc: 'Outer bottom-left border corner of terrain box.', icon: 'ph-arrow-down-left' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'bottom', label: '↓ Bottom Edge', desc: 'Bottom straight border edge of terrain block.', icon: 'ph-arrow-down' },
                { category: '🏞️ 3x3 Outer Terrain Box', key: 'bottomRight', label: '↘ Bottom-Right', desc: 'Outer bottom-right border corner of terrain box.', icon: 'ph-arrow-down-right' }
            ],

            // 16-Tile Cardinal Wall & Fence Mode (9x3 Matrix Layout)
            'wall_9x3': [
                // Group 1: Isolated Post & Straight Walls
                { category: '🧱 [Walls & Straight Runs] Cardinal Segments', key: 'post', gridCoordStr: '(1,0)', anatomicalBadge: 'Pillar Post', label: '(1,0) post · Isolated Pillar', tagLabel: 'Post', desc: 'Standalone 1x1 wall post or column with 0 connected neighbors.', icon: 'ph-circle', bitmask: 0 },
                { category: '🧱 [Walls & Straight Runs] Cardinal Segments', key: 'pipeH', gridCoordStr: '(2,0)', anatomicalBadge: 'Horiz Wall', label: '(2,0) pipeH · Horiz Wall (━)', tagLabel: 'Horiz Wall', desc: 'Horizontal straight wall or fence running Left to Right (East + West).', icon: 'ph-minus', bitmask: 10 },
                { category: '🧱 [Walls & Straight Runs] Cardinal Segments', key: 'pipeV', gridCoordStr: '(2,1)', anatomicalBadge: 'Vert Wall', label: '(2,1) pipeV · Vert Wall (┃)', tagLabel: 'Vert Wall', desc: 'Vertical straight wall or fence running Up to Down (North + South).', icon: 'ph-line-vertical', bitmask: 5 },

                // Group 2: 90° Wall Corners
                { category: '↪️ [Corners] 90° Wall Bends', key: 'cornerTL', gridCoordStr: '(0,1)', anatomicalBadge: 'Top-Left Corner', label: '(0,1) cornerTL · Top-Left Corner (┌)', tagLabel: 'Corner TL', desc: '90° wall corner connecting South and East.', icon: 'ph-corners-out', bitmask: 6 },
                { category: '↪️ [Corners] 90° Wall Bends', key: 'cornerTR', gridCoordStr: '(0,2)', anatomicalBadge: 'Top-Right Corner', label: '(0,2) cornerTR · Top-Right Corner (┐)', tagLabel: 'Corner TR', desc: '90° wall corner connecting South and West.', icon: 'ph-corners-out', bitmask: 12 },
                { category: '↪️ [Corners] 90° Wall Bends', key: 'cornerBL', gridCoordStr: '(1,1)', anatomicalBadge: 'Bottom-Left Corner', label: '(1,1) cornerBL · Bottom-Left Corner (└)', tagLabel: 'Corner BL', desc: '90° wall corner connecting North and East.', icon: 'ph-corners-out', bitmask: 3 },
                { category: '↪️ [Corners] 90° Wall Bends', key: 'cornerBR', gridCoordStr: '(1,2)', anatomicalBadge: 'Bottom-Right Corner', label: '(1,2) cornerBR · Bottom-Right Corner (┘)', tagLabel: 'Corner BR', desc: '90° wall corner connecting North and West.', icon: 'ph-corners-out', bitmask: 9 },

                // Group 3: Wall End Caps (Dead Ends)
                { category: '🛑 [End Caps] Wall Terminations', key: 'capN', gridCoordStr: '(0,4)', anatomicalBadge: 'End Cap Top', label: '(0,4) capN · End Cap Top (╵)', tagLabel: 'Cap Top', desc: 'Wall ending at the top / connected South to North.', icon: 'ph-arrow-line-up', bitmask: 1 },
                { category: '🛑 [End Caps] Wall Terminations', key: 'capS', gridCoordStr: '(2,4)', anatomicalBadge: 'End Cap Bottom', label: '(2,4) capS · End Cap Bottom (╷)', tagLabel: 'Cap Bottom', desc: 'Wall ending at the bottom / connected North to South.', icon: 'ph-arrow-line-down', bitmask: 4 },
                { category: '🛑 [End Caps] Wall Terminations', key: 'capW', gridCoordStr: '(1,3)', anatomicalBadge: 'End Cap Left', label: '(1,3) capW · End Cap Left (╴)', tagLabel: 'Cap Left', desc: 'Wall ending on the left / connected East to West.', icon: 'ph-arrow-line-left', bitmask: 8 },
                { category: '🛑 [End Caps] Wall Terminations', key: 'capE', gridCoordStr: '(1,5)', anatomicalBadge: 'End Cap Right', label: '(1,5) capE · End Cap Right (╶)', tagLabel: 'Cap Right', desc: 'Wall ending on the right / connected West to East.', icon: 'ph-arrow-line-right', bitmask: 2 },

                // Group 4: 3-Way T-Junctions & 4-Way Crossroads
                { category: '🔀 [Intersections] T-Forks & Crossroad', key: 'tNorth', gridCoordStr: '(0,7)', anatomicalBadge: 'T-North (┴)', label: '(0,7) tNorth · 3-Way Fork Up (┴)', tagLabel: 'T-North', desc: 'T-junction connecting paths going Up, Left, and Right (North + East + West).', icon: 'ph-tree-structure', bitmask: 11 },
                { category: '🔀 [Intersections] T-Forks & Crossroad', key: 'tSouth', gridCoordStr: '(2,7)', anatomicalBadge: 'T-South (┬)', label: '(2,7) tSouth · 3-Way Fork Down (┬)', tagLabel: 'T-South', desc: 'T-junction connecting paths going Down, Left, and Right (South + East + West).', icon: 'ph-tree-structure', bitmask: 14 },
                { category: '🔀 [Intersections] T-Forks & Crossroad', key: 'tEast', gridCoordStr: '(1,8)', anatomicalBadge: 'T-East (├)', label: '(1,8) tEast · 3-Way Fork Right (├)', tagLabel: 'T-East', desc: 'T-junction connecting paths going Right, Up, and Down (North + South + East).', icon: 'ph-tree-structure', bitmask: 7 },
                { category: '🔀 [Intersections] T-Forks & Crossroad', key: 'tWest', gridCoordStr: '(1,6)', anatomicalBadge: 'T-West (┤)', label: '(1,6) tWest · 3-Way Fork Left (┤)', tagLabel: 'T-West', desc: 'T-junction connecting paths going Left, Up, and Down (North + South + West).', icon: 'ph-tree-structure', bitmask: 13 },
                { category: '🔀 [Intersections] T-Forks & Crossroad', key: 'cross', gridCoordStr: '(1,4)', anatomicalBadge: 'Crossroad (┼)', label: '(1,4) cross · 4-Way Crossroad (┼)', tagLabel: 'Cross 4-Way', desc: 'Crossroad intersecting in all 4 directions (North, South, East, West).', icon: 'ph-plus', bitmask: 15 }
            ],

            // 16-Tile Corridor & Path Mode (4-neighbor cardinal bitmask 0..15)
            '16tile': [
                { category: '🏝️ Single Paths & Bridges', key: 'post', label: '🏝️ Single Island / Post', desc: 'Standalone 1x1 tile surrounded by empty space on all 4 sides.', icon: 'ph-circle' },
                { category: '🏝️ Single Paths & Bridges', key: 'pipeH', label: '↔️ Horiz Path', desc: '1-tile wide road, bridge, or river running Left to Right.', icon: 'ph-minus' },
                { category: '🏝️ Single Paths & Bridges', key: 'pipeV', label: '↕️ Vert Path', desc: '1-tile wide path or ladder running Up to Down.', icon: 'ph-line-vertical' },
                { category: '🏝️ Single Paths & Bridges', key: 'cross', label: '┼ 4-Way Crossroad', desc: 'Crossroad intersecting in all 4 directions (North, South, East, West).', icon: 'ph-plus' },
                { category: '🏝️ Single Paths & Bridges', key: 'solid', label: '🟩 Solid Center', desc: 'Middle terrain fill tile surrounded by neighbors on all sides.', icon: 'ph-square' },

                { category: '🛑 Path Endings (Dead-Ends)', key: 'capN', label: '⬆️ End Cap (Top)', desc: '1-tile wide path or fence ending at the top border.', icon: 'ph-arrow-line-up' },
                { category: '🛑 Path Endings (Dead-Ends)', key: 'capS', label: '⬇️ End Cap (Bottom)', desc: '1-tile wide path or fence ending at the bottom border.', icon: 'ph-arrow-line-down' },
                { category: '🛑 Path Endings (Dead-Ends)', key: 'capW', label: '⬅️ End Cap (Left)', desc: '1-tile wide path or fence ending at the left border.', icon: 'ph-arrow-line-left' },
                { category: '🛑 Path Endings (Dead-Ends)', key: 'capE', label: '➡️ End Cap (Right)', desc: '1-tile wide path or fence ending at the right border.', icon: 'ph-arrow-line-right' },

                { category: '↪️ Corners & Path Turns', key: 'cornerTL', label: '┌ Turn (Top-Left)', desc: '90° path turn corner connecting Top and Left.', icon: 'ph-corners-out' },
                { category: '↪️ Corners & Path Turns', key: 'cornerTR', label: '┐ Turn (Top-Right)', desc: '90° path turn corner connecting Top and Right.', icon: 'ph-corners-out' },
                { category: '↪️ Corners & Path Turns', key: 'cornerBL', label: '└ Turn (Bottom-Left)', desc: '90° path turn corner connecting Bottom and Left.', icon: 'ph-corners-out' },
                { category: '↪️ Corners & Path Turns', key: 'cornerBR', label: '┘ Turn (Bottom-Right)', desc: '90° path turn corner connecting Bottom and Right.', icon: 'ph-corners-out' },

                { category: '🔀 3-Way Forks (T-Junctions)', key: 'tNorth', label: '┴ 3-Way Fork (Up)', desc: 'T-junction connecting paths going Up, Left, and Right.', icon: 'ph-tree-structure' },
                { category: '🔀 3-Way Forks (T-Junctions)', key: 'tSouth', label: '┬ 3-Way Fork (Down)', desc: 'T-junction connecting paths going Down, Left, and Right.', icon: 'ph-tree-structure' },
                { category: '🔀 3-Way Forks (T-Junctions)', key: 'tEast', label: '├ 3-Way Fork (Right)', desc: 'T-junction connecting paths going Right, Up, and Down.', icon: 'ph-tree-structure' },
                { category: '🔀 3-Way Forks (T-Junctions)', key: 'tWest', label: '┤ 3-Way Fork (Left)', desc: 'T-junction connecting paths going Left, Up, and Down.', icon: 'ph-tree-structure' }
            ],

            // 25-Tile Diagonal Slopes Mode (Extended 5x5)
            '25tile': [
                { category: '🏞️ 9-Slice Terrain Block', key: 'topLeft', label: '↖ Top-Left Outer', desc: 'Outer top-left border corner.', icon: 'ph-arrow-up-left' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'top', label: '↑ Top Edge', desc: 'Top straight border edge.', icon: 'ph-arrow-up' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'topRight', label: '↗ Top-Right Outer', desc: 'Outer top-right border corner.', icon: 'ph-arrow-up-right' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'left', label: '← Left Edge', desc: 'Left straight border edge.', icon: 'ph-arrow-left' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'center', label: '🟩 Solid Center Fill', desc: 'Solid interior center fill tile.', icon: 'ph-square' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'right', label: '→ Right Edge', desc: 'Right straight border edge.', icon: 'ph-arrow-right' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'bottomLeft', label: '↙ Bottom-Left Outer', desc: 'Outer bottom-left border corner.', icon: 'ph-arrow-down-left' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'bottom', label: '↓ Bottom Edge', desc: 'Bottom straight border edge.', icon: 'ph-arrow-down' },
                { category: '🏞️ 9-Slice Terrain Block', key: 'bottomRight', label: '↘ Bottom-Right Outer', desc: 'Outer bottom-right border corner.', icon: 'ph-arrow-down-right' },

                { category: '📐 45° Diagonal Slope Ramps', key: 'slopeNW', label: '📐 45° Ramp (Top-Left)', desc: 'Angled hillside slope facing North-West (Top-Left).', icon: 'ph-path' },
                { category: '📐 45° Diagonal Slope Ramps', key: 'slopeNE', label: '📐 45° Ramp (Top-Right)', desc: 'Angled hillside slope facing North-East (Top-Right).', icon: 'ph-path' },
                { category: '📐 45° Diagonal Slope Ramps', key: 'slopeSW', label: '📐 45° Ramp (Bottom-Left)', desc: 'Angled hillside slope facing South-West (Bottom-Left).', icon: 'ph-path' },
                { category: '📐 45° Diagonal Slope Ramps', key: 'slopeSE', label: '📐 45° Ramp (Bottom-Right)', desc: 'Angled hillside slope facing South-East (Bottom-Right).', icon: 'ph-path' },

                { category: '🧩 Inside Corners (Concave Cutouts)', key: 'innerTL', label: '🧩 Inside Corner (TL)', desc: 'L-shaped interior corner cutout facing Top-Left.', icon: 'ph-intersect' },
                { category: '🧩 Inside Corners (Concave Cutouts)', key: 'innerTR', label: '🧩 Inside Corner (TR)', desc: 'L-shaped interior corner cutout facing Top-Right.', icon: 'ph-intersect' },
                { category: '🧩 Inside Corners (Concave Cutouts)', key: 'innerBL', label: '🧩 Inside Corner (BL)', desc: 'L-shaped interior corner cutout facing Bottom-Left.', icon: 'ph-intersect' },
                { category: '🧩 Inside Corners (Concave Cutouts)', key: 'innerBR', label: '🧩 Inside Corner (BR)', desc: 'L-shaped interior corner cutout facing Bottom-Right.', icon: 'ph-intersect' },
                { category: '🧩 Inside Corners (Concave Cutouts)', key: 'iso', label: '🏝️ Single Island', desc: 'Standalone 1x1 island tile.', icon: 'ph-circle' }
            ],

            // 47-Tile Full Inner-Corner Mode (RPG Maker style terrain)
            '47tile': [
                { category: '🏞️ Outer Terrain Boundaries', key: 'topLeft', label: '↖ Top-Left Outer', desc: 'Outer top-left border corner.', icon: 'ph-arrow-up-left' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'top', label: '↑ Top Edge', desc: 'Top border edge.', icon: 'ph-arrow-up' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'topRight', label: '↗ Top-Right Outer', desc: 'Outer top-right border corner.', icon: 'ph-arrow-up-right' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'left', label: '← Left Edge', desc: 'Left border edge.', icon: 'ph-arrow-left' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'center', label: '🟩 Center Fill', desc: 'Solid interior center fill tile.', icon: 'ph-square' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'right', label: '→ Right Edge', desc: 'Right border edge.', icon: 'ph-arrow-right' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'bottomLeft', label: '↙ Bottom-Left Outer', desc: 'Outer bottom-left border corner.', icon: 'ph-arrow-down-left' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'bottom', label: '↓ Bottom Edge', desc: 'Bottom border edge.', icon: 'ph-arrow-down' },
                { category: '🏞️ Outer Terrain Boundaries', key: 'bottomRight', label: '↘ Bottom-Right Outer', desc: 'Outer bottom-right border corner.', icon: 'ph-arrow-down-right' },
                { category: '🧩 Inner Corner Concave Cutouts', key: 'innerTL', label: '🧩 Inner TL Corner', desc: 'Interior corner cutout turning Top-Left.', icon: 'ph-intersect' },
                { category: '🧩 Inner Corner Concave Cutouts', key: 'innerTR', label: '🧩 Inner TR Corner', desc: 'Interior corner cutout turning Top-Right.', icon: 'ph-intersect' },
                { category: '🧩 Inner Corner Concave Cutouts', key: 'innerBL', label: '🧩 Inner BL Corner', desc: 'Interior corner cutout turning Bottom-Left.', icon: 'ph-intersect' },
                { category: '🧩 Inner Corner Concave Cutouts', key: 'innerBR', label: '🧩 Inner BR Corner', desc: 'Interior corner cutout turning Bottom-Right.', icon: 'ph-intersect' }
            ]

        },

        /**
         * Retrieves slot definition array for a given autotile mode.
         * @param {string} modeKey
         * @returns {ReadonlyArray<Object>}
         */
        getModeSlots: function(modeKey) {
            if (!modeKey || typeof modeKey !== 'string') return FROZEN_EMPTY_ARRAY;
            return (constantsObj.MODE_SLOTS && constantsObj.MODE_SLOTS[modeKey]) ? constantsObj.MODE_SLOTS[modeKey] : FROZEN_EMPTY_ARRAY;
        },

        /**
         * Retrieves artist 2D sprite sheet layout matrix for a given mode or preset.
         * @param {string} modeKey
         * @returns {ReadonlyArray<ReadonlyArray<string|null>>|null}
         */
        getMatrix: function(modeKey) {
            switch (modeKey) {
                case 'dualgrid':
                case 'overlay_dualgrid':
                    return constantsObj.DUALGRID_6X3_MATRIX;
                case 'cliff_vstretch':
                    return constantsObj.CLIFF_7X6_MATRIX;
                case 'wall_9x3':
                    return constantsObj.WALL_9X3_MATRIX;
                default:
                    return null;
            }
        },

        /**
         * Retrieves a single slot descriptor by mode and slot key.
         * @param {string} modeKey
         * @param {string} slotKey
         * @returns {Object|null}
         */
        getSlotByKey: function(modeKey, slotKey) {
            if (!modeKey || !slotKey) return null;
            const slots = constantsObj.MODE_SLOTS ? constantsObj.MODE_SLOTS[modeKey] : null;
            if (!slots) return null;
            for (let i = 0; i < slots.length; i++) {
                if (slots[i].key === slotKey) return slots[i];
            }
            return null;
        },

        /**
         * Deep freeze utility method exported for engine-wide immutability enforcement.
         */
        deepFreeze: deepFreeze
    };

    // Deeply freeze the complete constants dictionary and export to namespace
    root.TileWeaver.constants = deepFreeze(constantsObj);
    root.TileWeaver.constants = root.TileWeaver.constants;

    // CommonJS module export interop for headless Node.js testing environments
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.TileWeaver.constants;
    }
})();
