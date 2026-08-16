/**
 * @fileoverview TileWeaver - Live Contextual Tile & Object Properties Right Side Panel Module
 * @subsystem Modals, Wizards & Material Studio / Live Properties Inspector
 * @frameBudget Off-tick DOM & Canvas updates (< 0.2ms per inspection event)
 * @coordinateSpace ScreenPX -> GridCell(col, row) -> SourcePixel(srcX, srcY) -> MiniPreview(64x64px)
 * @stateInvariants Single-source-of-truth in window.TileWeaver.state; synchronous object & tileset properties sync
 * @historyTracked UI state changes integrated with history snapshots; non-destructive custom properties CRUD
 * @exportCompatibility Native JSON v3.3 specification & Tiled TMJ 1.10+ typed property arrays
 * ---------------------------------------------------------------------------------------------------------------
 * Provides a live, real-time, non-modal inspector side panel for tile & object attributes:
 * 1. Live 64x64 pixel-art tile preview (`#live-prop-preview-canvas`).
 * 2. Tile naming & terrain category dropdown.
 * 3. Interactive Collision Passability Pill Buttons (Passable, Solid, Overhang).
 * 4. Speed multiplier & gameplay flags (isLadder, isDamage, isBush).
 * 5. Dynamic Custom Key-Value Attributes Table with live CRUD & TMJ schema sync.
 * 6. Collapsible right sidebar drawer navigation with responsive canvas resize triggers.
 */

(function() {
    'use strict';

    window.TileWeaver = window.TileWeaver || {};

    const { state } = window.TileWeaver.stateModule;
    const { showMessage } = window.TileWeaver.toast;
    const { drawTileset, drawMap } = window.TileWeaver.rendering;

    let activePropCol = 0;
    let activePropRow = 0;
    let activeImageIndex = 0;

    /**
     * Static Set of reserved collection item metadata keys excluded from custom attributes table.
     * Frozen to eliminate per-call heap micro-allocations.
     * @constant {Readonly<Set<string>>}
     */
    const COLLECTION_META_KEYS = Object.freeze(new Set([
        'imageId', 'name', 'anchor', '__imageData', 'filename', 'imagePath', 'type', 'class', 'custom'
    ]));

    /**
     * Static Set of reserved standard grid tile properties excluded from custom attributes table.
     * Frozen to eliminate per-call heap micro-allocations.
     * @constant {Readonly<Set<string>>}
     */
    const TILE_KNOWN_KEYS = Object.freeze(new Set([
        'name', 'terrainType', 'passable', 'speedMult', 'isLadder', 'isDamage', 'isBush', 'custom'
    ]));

    /**
     * Returns a fresh default tile properties object.
     * @returns {{name: string, terrainType: string, passable: string, speedMult: number, isLadder: boolean, isDamage: boolean, isBush: boolean, custom: Object}}
     */
    function getDefaultTileProperties() {
        return {
            name: '',
            terrainType: 'Meadow',
            passable: 'passable',
            speedMult: 1.0,
            isLadder: false,
            isDamage: false,
            isBush: false,
            custom: {}
        };
    }

    /**
     * Returns active tile, collection image, or Object Group object property reference.
     * Resolves the polymorphic target (Placed Scene Object -> Collection Item Template -> Grid Tile).
     * 
     * @returns {Object|null} Property reference descriptor or null if no target is active
     */
    function getActivePropRef() {
        const activeLayer = state.mapLayers[state.activeLayerIndex];
        
        // 1. Placed Scene Object Target
        if (activeLayer && activeLayer.type === 'objectgroup' && state.selectedObjectId && activeLayer.objects && activeLayer.objects.length > 0) {
            const obj = activeLayer.objects.find(o => o.id === state.selectedObjectId);
            if (obj) {
                if (!obj.custom) obj.custom = {};
                if (Array.isArray(obj.properties)) {
                    obj.properties.forEach(p => {
                        if (p && p.name && obj.custom[p.name] === undefined) {
                            obj.custom[p.name] = p.value;
                        }
                    });
                }
                return {
                    isObject: true,
                    isPlacedObject: true,
                    obj: obj,
                    props: {
                        name: obj.name || '',
                        type: obj.type || obj.class || '',
                        custom: obj.custom
                    },
                    key: 'obj_' + obj.id
                };
            }
        }

        const ts = state.tilesets[state.activeTilesetIndex];
        if (!ts) return null;

        // 2. Collection Tileset Item Template Target
        if (ts.isCollection && ts.images && ts.images.length > 0) {
            const imgObj = ts.images[activeImageIndex] || ts.images[0];
            if (!imgObj) return null;

            if (!imgObj.tileProperties) imgObj.tileProperties = {};
            const p = imgObj.tileProperties;
            if (!p.custom) p.custom = {};

            // OPTIMIZATION: Use frozen COLLECTION_META_KEYS constant instead of allocating a Set per call
            Object.keys(p).forEach(k => {
                if (!COLLECTION_META_KEYS.has(k) && p[k] !== undefined && p.custom[k] === undefined) {
                    p.custom[k] = p[k];
                }
            });

            return {
                isCollection: true,
                isObjectTemplate: true,
                imgObj: imgObj,
                props: {
                    name: imgObj.name || p.name || '',
                    type: imgObj.type || p.type || p.class || '',
                    anchor: imgObj.anchor || 'bottom-center',
                    custom: p.custom
                },
                key: imgObj.id
            };
        } else if (ts.image) {
            // 3. Standard Grid Tileset Tile Target
            if (!ts.tileProperties) ts.tileProperties = {};
            const rawKey = `${activePropCol}_${activePropRow}`;
            const tileKey = `tile_${activePropCol}_${activePropRow}`;

            let p = ts.tileProperties[rawKey] || ts.tileProperties[tileKey];
            if (!p) {
                p = getDefaultTileProperties();
            }

            if (!p.custom) p.custom = {};

            // OPTIMIZATION: Use frozen TILE_KNOWN_KEYS constant instead of allocating a Set per call
            Object.keys(p).forEach(k => {
                if (!TILE_KNOWN_KEYS.has(k) && p[k] !== undefined && p.custom[k] === undefined) {
                    p.custom[k] = p[k];
                }
            });

            // INVARIANT: Maintain both rawKey and tileKey formats for universal format interoperability
            ts.tileProperties[rawKey] = p;
            ts.tileProperties[tileKey] = p;

            return {
                isCollection: false,
                props: p,
                key: rawKey,
                tileKey: tileKey
            };
        }
        return null;
    }

    /**
     * Toggles right inspector panel collapse state.
     * Updates DOM classes, caret icons, and triggers a canvas redraw.
     */
    function toggleRightSidebarCollapse() {
        state.isRightInspectorCollapsed = !state.isRightInspectorCollapsed;
        const panel = document.getElementById('right-inspector-panel');
        const icon = document.getElementById('right-sidebar-toggle-icon');
        const btn = document.getElementById('btn-toggle-right-sidebar');
        const body = document.getElementById('right-inspector-body');

        if (!panel) return;
        if (state.isRightInspectorCollapsed) {
            panel.classList.add('right-sidebar-collapsed');
            if (body) body.classList.add('hidden');
            if (icon) icon.className = 'ph ph-caret-left';
            if (btn) btn.title = 'Expand Live Properties Inspector';
        } else {
            panel.classList.remove('right-sidebar-collapsed');
            if (body) body.classList.remove('hidden');
            if (icon) icon.className = 'ph ph-caret-right';
            if (btn) btn.title = 'Collapse Live Properties Inspector';
            renderLiveTilePropertiesForm();
        }

        if (window.TileWeaver.rendering && window.TileWeaver.rendering.drawMap) {
            window.TileWeaver.rendering.drawMap();
        }
    }

    /**
     * Binds right sidebar panel event listeners for navigation, form inputs, and custom properties.
     */
    function initTilePropertiesUI() {
        // Toggle Collapse button
        document.getElementById('btn-toggle-right-sidebar')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRightSidebarCollapse();
        });

        // Clicking collapsed header bar expands the inspector
        document.getElementById('right-inspector-header')?.addEventListener('click', (e) => {
            if (state.isRightInspectorCollapsed && !e.target.closest('button, input, select, textarea, label')) {
                toggleRightSidebarCollapse();
            }
        });

        // Previous tile/object button
        document.getElementById('btn-live-prop-prev')?.addEventListener('click', () => {
            const activeLayer = state.mapLayers[state.activeLayerIndex];
            if (activeLayer && activeLayer.type === 'objectgroup' && state.selectedObjectId && activeLayer.objects && activeLayer.objects.length > 0) {
                const currentIdx = activeLayer.objects.findIndex(o => o.id === state.selectedObjectId);
                if (currentIdx > 0) {
                    state.selectedObjectId = activeLayer.objects[currentIdx - 1].id;
                    renderLiveTilePropertiesForm();
                    drawMap();
                }
                return;
            }

            const ts = state.tilesets[state.activeTilesetIndex];
            if (!ts) return;

            if (ts.isCollection && ts.images && ts.images.length > 0) {
                if (activeImageIndex > 0) {
                    activeImageIndex--;
                    ts.activeImageId = ts.images[activeImageIndex].id;
                    if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderCollectionGallery) {
                        window.TileWeaver.tilesetManager.renderCollectionGallery(ts);
                    }
                }
            } else if (ts.image) {
                const spacing = ts.spacing || 0;
                const margin = ts.margin || 0;
                const cols = Math.floor((ts.image.width - margin) / (state.TILE_SIZE + spacing));

                if (activePropCol > 0) activePropCol--;
                else if (activePropRow > 0) { activePropRow--; activePropCol = cols - 1; }
            }
            renderLiveTilePropertiesForm();
        });

        // Next tile/object button
        document.getElementById('btn-live-prop-next')?.addEventListener('click', () => {
            const activeLayer = state.mapLayers[state.activeLayerIndex];
            if (activeLayer && activeLayer.type === 'objectgroup' && state.selectedObjectId && activeLayer.objects && activeLayer.objects.length > 0) {
                const currentIdx = activeLayer.objects.findIndex(o => o.id === state.selectedObjectId);
                if (currentIdx >= 0 && currentIdx < activeLayer.objects.length - 1) {
                    state.selectedObjectId = activeLayer.objects[currentIdx + 1].id;
                    renderLiveTilePropertiesForm();
                    drawMap();
                }
                return;
            }

            const ts = state.tilesets[state.activeTilesetIndex];
            if (!ts) return;

            if (ts.isCollection && ts.images && ts.images.length > 0) {
                if (activeImageIndex < ts.images.length - 1) {
                    activeImageIndex++;
                    ts.activeImageId = ts.images[activeImageIndex].id;
                    if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderCollectionGallery) {
                        window.TileWeaver.tilesetManager.renderCollectionGallery(ts);
                    }
                }
            } else if (ts.image) {
                const spacing = ts.spacing || 0;
                const margin = ts.margin || 0;
                const cols = Math.floor((ts.image.width - margin) / (state.TILE_SIZE + spacing));
                const rows = Math.floor((ts.image.height - margin) / (state.TILE_SIZE + spacing));

                if (activePropCol < cols - 1) activePropCol++;
                else if (activePropRow < rows - 1) { activePropRow++; activePropCol = 0; }
            }
            renderLiveTilePropertiesForm();
        });

        // Form change listeners
        ['live-prop-name', 'live-prop-object-type', 'live-prop-terrain-type', 'live-prop-speed-mult', 'live-prop-chk-ladder', 'live-prop-chk-damage', 'live-prop-chk-bush'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', saveCurrentTileProperties);
            document.getElementById(id)?.addEventListener('change', saveCurrentTileProperties);
        });

        // Collision Passability Pill Toggles
        document.getElementById('btn-pass-passable')?.addEventListener('click', () => {
            setPassableState('passable');
        });
        document.getElementById('btn-pass-solid')?.addEventListener('click', () => {
            setPassableState('solid');
        });
        document.getElementById('btn-pass-overhang')?.addEventListener('click', () => {
            setPassableState('overhang');
        });

        // Add custom property button
        document.getElementById('btn-add-live-custom-prop')?.addEventListener('click', () => {
            const ref = getActivePropRef();
            if (!ref) return;

            if (!ref.props.custom) ref.props.custom = {};
            const custom = ref.props.custom;
            const propCount = Object.keys(custom).length + 1;
            custom[`property_${propCount}`] = 'value';

            saveCurrentTileProperties();
            renderCustomPropsRows(custom);
        });
    }

    /**
     * Sets passability state ('passable', 'solid', 'overhang').
     * @param {'passable'|'solid'|'overhang'} mode - Collision passability mode
     */
    function setPassableState(mode) {
        const ref = getActivePropRef();
        if (!ref || ref.isObject || ref.isObjectTemplate) return;
        ref.props.passable = mode;
        saveCurrentTileProperties();
        updatePassabilityPills(mode);
    }

    /**
     * Updates UI styling for passability pill toggle buttons.
     * @param {'passable'|'solid'|'overhang'} mode - Active passability mode
     */
    function updatePassabilityPills(mode) {
        const btnP = document.getElementById('btn-pass-passable');
        const btnS = document.getElementById('btn-pass-solid');
        const btnO = document.getElementById('btn-pass-overhang');

        if (btnP) {
            btnP.className = `py-1 px-1.5 rounded text-[11px] font-semibold border transition-all text-center ${
                mode === 'passable' ? 'border-emerald-500 bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-500/50' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-emerald-500'
            }`;
        }
        if (btnS) {
            btnS.className = `py-1 px-1.5 rounded text-[11px] font-semibold border transition-all text-center ${
                mode === 'solid' ? 'border-red-500 bg-red-950/80 text-red-300 ring-1 ring-red-500/50' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-red-500'
            }`;
        }
        if (btnO) {
            btnO.className = `py-1 px-1.5 rounded text-[11px] font-semibold border transition-all text-center ${
                mode === 'overhang' ? 'border-amber-500 bg-amber-950/80 text-amber-300 ring-1 ring-amber-500/50' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-amber-500'
            }`;
        }
    }

    /**
     * Syncs live tile selection coordinates and updates right panel UI.
     * @param {number} [col] - Selected tile column
     * @param {number} [row] - Selected tile row
     */
    function updateLiveTilePropertiesPanel(col, row) {
        const ts = state.tilesets[state.activeTilesetIndex];
        if (ts && ts.isCollection && ts.images && ts.images.length > 0) {
            const idx = ts.images.findIndex(img => img.id === ts.activeImageId);
            if (idx >= 0) activeImageIndex = idx;
        } else {
            if (col !== undefined && col >= 0) activePropCol = col;
            else if (state.selectedStamp) activePropCol = state.selectedStamp.col;

            if (row !== undefined && row >= 0) activePropRow = row;
            else if (state.selectedStamp) activePropRow = state.selectedStamp.row;
        }

        renderLiveTilePropertiesForm();
    }

    /**
     * Compatibility modal trigger that ensures the right sidebar inspector dock is open.
     */
    function openTilesetPropertiesModal() {
        if (state.isRightInspectorCollapsed) {
            toggleRightSidebarCollapse();
        }
        updateLiveTilePropertiesPanel();
    }

    /**
     * Compatibility modal close handler (no-op for live non-modal dock).
     */
    function closeTilePropsModal() {
        // No-op for non-modal live panel
    }

    /**
     * Draws an HTMLImageElement scaled proportionally to fit within 64x64 preview canvas.
     * 
     * @param {CanvasRenderingContext2D} ctx - 2D canvas rendering context
     * @param {HTMLImageElement|HTMLCanvasElement} imgEl - Source image element
     * @param {number} [origW] - Original source width
     * @param {number} [origH] - Original source height
     */
    function drawImageScaledToFit(ctx, imgEl, origW, origH) {
        if (!imgEl) return;
        const w = origW || imgEl.naturalWidth || imgEl.width || 32;
        const h = origH || imgEl.naturalHeight || imgEl.height || 32;
        if (w <= 0 || h <= 0) return;
        
        const scale = Math.min(64 / w, 64 / h);
        const drawW = Math.max(1, Math.round(w * scale));
        const drawH = Math.max(1, Math.round(h * scale));
        
        // OPTIMIZATION: Zero-blur integer coordinate snapping for crisp 64x64 pixel art previews
        const drawX = Math.round((64 - drawW) / 2);
        const drawY = Math.round((64 - drawH) / 2);
        
        ctx.drawImage(imgEl, 0, 0, w, h, drawX, drawY, drawW, drawH);
    }

    /**
     * Populates live inspector form inputs with current tile/object's property attributes.
     */
    function renderLiveTilePropertiesForm() {
        const ref = getActivePropRef();
        if (!ref) return;

        const props = ref.props;
        const previewCanvas = document.getElementById('live-prop-preview-canvas');
        const titleEl = document.getElementById('right-inspector-title');
        const iconEl = document.getElementById('right-inspector-icon');
        const objClassSection = document.getElementById('prop-section-object-class');
        const tileTerrainSection = document.getElementById('prop-section-tile-terrain');
        const tileMovementSection = document.getElementById('prop-section-tile-movement');
        const replaceBadge = document.getElementById('btn-live-prop-replace-badge');
        const collActions = document.getElementById('live-prop-coll-actions');

        if (ref.isPlacedObject) {
            const obj = ref.obj;
            if (titleEl) titleEl.textContent = 'Object Properties';
            if (iconEl) iconEl.className = 'ph ph-bounding-box text-blue-400';

            objClassSection?.classList.remove('hidden');
            tileTerrainSection?.classList.add('hidden');
            tileMovementSection?.classList.add('hidden');
            replaceBadge?.classList.add('hidden');
            collActions?.classList.add('hidden');

            const coordsBadge = document.getElementById('live-prop-coords-badge');
            const pixelBadge = document.getElementById('live-prop-pixel-badge');
            if (coordsBadge) coordsBadge.textContent = `Object ID #${obj.id} (${obj.name || obj.type || 'Object'})`;
            if (pixelBadge) pixelBadge.textContent = `${obj.width || 32}x${obj.height || 32}px @ (${obj.x}, ${obj.y})`;

            if (previewCanvas) {
                const ctx = previewCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, 64, 64);

                let renderedImage = false;

                // 1. GID-based Tile Object (placed tileset/collection prop)
                if (obj.gid && obj.gid > 0) {
                    const rawGid = obj.gid >>> 0;
                    const gid = rawGid & 0x1FFFFFFF;
                    let matchedTs = (obj.tilesetId && state.tilesets) 
                        ? state.tilesets.find(t => t.id === obj.tilesetId) 
                        : null;
                    if (!matchedTs) {
                        matchedTs = window.TileWeaver.stateModule ? window.TileWeaver.stateModule.getTilesetForGid(obj.gid) : state.tilesets[0];
                    }

                    if (matchedTs) {
                        const localId = gid - (matchedTs.firstgid || 1);
                        if (matchedTs.isCollection && matchedTs.images) {
                            const imgObj = (obj.imageId ? matchedTs.images.find(img => img.id === obj.imageId) : null) ||
                                           matchedTs.images.find(img => img.tileId === localId) ||
                                           matchedTs.images.find(img => img.id === localId) ||
                                           matchedTs.images[localId] ||
                                           matchedTs.images[0];
                            if (imgObj && imgObj.image && (imgObj.image.naturalWidth || imgObj.image.width)) {
                                drawImageScaledToFit(ctx, imgObj.image, imgObj.width, imgObj.height);
                                renderedImage = true;
                            } else if (imgObj && imgObj.dataUrl) {
                                const tmp = new Image();
                                const targetImageId = imgObj.id;
                                tmp.onload = () => {
                                    imgObj.image = tmp;
                                    const curRef = getActivePropRef();
                                    if (curRef && curRef.isPlacedObject && curRef.obj && curRef.obj.id === obj.id) {
                                        ctx.imageSmoothingEnabled = false;
                                        ctx.clearRect(0, 0, 64, 64);
                                        drawImageScaledToFit(ctx, tmp, tmp.width, tmp.height);
                                    }
                                };
                                tmp.src = imgObj.dataUrl;
                                renderedImage = true;
                            }
                        } else if (matchedTs.image && matchedTs.image.width > 0) {
                            const tsCols = matchedTs.columns || Math.floor((matchedTs.image.width - (matchedTs.margin || 0)) / (state.TILE_SIZE + (matchedTs.spacing || 0)));
                            const margin = matchedTs.margin || 0;
                            const spacing = matchedTs.spacing || 0;
                            const tx = localId % (tsCols > 0 ? tsCols : 1);
                            const ty = Math.floor(localId / (tsCols > 0 ? tsCols : 1));
                            const srcX = margin + tx * (state.TILE_SIZE + spacing);
                            const srcY = margin + ty * (state.TILE_SIZE + spacing);
                            ctx.drawImage(matchedTs.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 64, 64);
                            renderedImage = true;
                        }
                    }
                }

                // 2. Direct Tileset ID / Image ID reference
                if (!renderedImage && obj.tilesetId) {
                    const ts = state.tilesets.find(t => t.id === obj.tilesetId);
                    if (ts) {
                        if (ts.isCollection && ts.images) {
                            const imgObj = ts.images.find(img => img.id === obj.imageId) || ts.images[0];
                            if (imgObj && imgObj.image && (imgObj.image.naturalWidth || imgObj.image.width)) {
                                drawImageScaledToFit(ctx, imgObj.image, imgObj.width, imgObj.height);
                                renderedImage = true;
                            }
                        } else if (ts.image && ts.image.width > 0) {
                            const margin = ts.margin || 0;
                            const spacing = ts.spacing || 0;
                            const srcX = margin + (obj.tx || 0) * (state.TILE_SIZE + spacing);
                            const srcY = margin + (obj.ty || 0) * (state.TILE_SIZE + spacing);
                            ctx.drawImage(ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 64, 64);
                            renderedImage = true;
                        }
                    }
                }

                // 3. Fallback for non-image shape/trigger objects
                if (!renderedImage) {
                    ctx.fillStyle = '#38bdf8';
                    ctx.fillRect(12, 12, 40, 40);
                    ctx.strokeStyle = '#0284c7';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(12, 12, 40, 40);
                }
            }

            // Render dedicated Object Transform Fields panel (X, Y, W, H, text content, Delete button)
            const inspectorBody = document.getElementById('right-inspector-body');
            if (inspectorBody && window.TileWeaver.objectInspector && window.TileWeaver.objectInspector.renderObjectTransformFields) {
                window.TileWeaver.objectInspector.renderObjectTransformFields(inspectorBody, obj);
            }
        } else if (ref.isObjectTemplate) {
            // Collection Tileset Item Template
            if (titleEl) titleEl.textContent = 'Object Template Properties';
            if (iconEl) iconEl.className = 'ph ph-shapes text-cyan-400';

            objClassSection?.classList.remove('hidden');
            tileTerrainSection?.classList.add('hidden');
            tileMovementSection?.classList.add('hidden');
            replaceBadge?.classList.remove('hidden');
            collActions?.classList.remove('hidden');
            document.getElementById('object-inspector-transform')?.remove();

            const ts = state.tilesets[state.activeTilesetIndex];
            const imgObj = ref.imgObj;
            if (previewCanvas && imgObj) {
                const ctx = previewCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, 64, 64);

                const imgEl = imgObj.image;
                if (imgEl && (imgEl.naturalWidth || imgEl.width)) {
                    drawImageScaledToFit(ctx, imgEl, imgObj.width, imgObj.height);
                } else if (imgObj.dataUrl) {
                    const tmp = new Image();
                    const targetImageId = imgObj.id;
                    tmp.onload = () => {
                        // OPTIMIZATION: Cache Image instance on object for instant future synchronous rendering
                        imgObj.image = tmp;
                        const curRef = getActivePropRef();
                        if (curRef && curRef.isObjectTemplate && curRef.imgObj && curRef.imgObj.id === targetImageId) {
                            ctx.imageSmoothingEnabled = false;
                            ctx.clearRect(0, 0, 64, 64);
                            drawImageScaledToFit(ctx, tmp, imgObj.width || tmp.width, imgObj.height || tmp.height);
                        }
                    };
                    tmp.src = imgObj.dataUrl;
                }
            }

            const coordsBadge = document.getElementById('live-prop-coords-badge');
            const pixelBadge = document.getElementById('live-prop-pixel-badge');
            if (coordsBadge) coordsBadge.textContent = `Template (${activeImageIndex + 1}/${ts ? ts.images.length : 1}): ${imgObj.name}`;
            if (pixelBadge) pixelBadge.textContent = `${imgObj.width}x${imgObj.height}px`;
        } else {
            // Standard Grid Tileset Tile
            if (titleEl) titleEl.textContent = 'Tile Properties';
            if (iconEl) iconEl.className = 'ph ph-sliders text-indigo-400';

            objClassSection?.classList.add('hidden');
            tileTerrainSection?.classList.remove('hidden');
            tileMovementSection?.classList.remove('hidden');
            replaceBadge?.classList.add('hidden');
            collActions?.classList.add('hidden');
            document.getElementById('object-inspector-transform')?.remove();

            const ts = state.tilesets[state.activeTilesetIndex];
            if (previewCanvas && ts && ts.image) {
                const ctx = previewCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, 64, 64);
                const margin = ts.margin || 0;
                const spacing = ts.spacing || 0;
                const srcX = margin + activePropCol * (state.TILE_SIZE + spacing);
                const srcY = margin + activePropRow * (state.TILE_SIZE + spacing);
                ctx.drawImage(ts.image, srcX, srcY, state.TILE_SIZE, state.TILE_SIZE, 0, 0, 64, 64);
            }

            const coordsBadge = document.getElementById('live-prop-coords-badge');
            const pixelBadge = document.getElementById('live-prop-pixel-badge');
            if (coordsBadge) coordsBadge.textContent = `Col ${activePropCol}, Row ${activePropRow}`;
            if (pixelBadge) pixelBadge.textContent = `${state.TILE_SIZE}x${state.TILE_SIZE}px`;
        }

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

        setVal('live-prop-name', props.name || '');
        setVal('live-prop-object-type', props.type || '');

        if (!ref.isPlacedObject && !ref.isObjectTemplate) {
            setVal('live-prop-terrain-type', props.terrainType || 'Meadow');
            setVal('live-prop-speed-mult', props.speedMult !== undefined ? props.speedMult : 1.0);
            setChk('live-prop-chk-ladder', props.isLadder);
            setChk('live-prop-chk-damage', props.isDamage);
            setChk('live-prop-chk-bush', props.isBush);
            updatePassabilityPills(props.passable || 'passable');
        }

        renderCustomPropsRows(props.custom || {});
    }

    /**
     * Saves current form inputs into active tileset or object's property storage.
     * Synchronizes `obj.properties` array for Tiled TMJ export compatibility.
     */
    function saveCurrentTileProperties() {
        const ts = state.tilesets[state.activeTilesetIndex];
        const ref = getActivePropRef();
        if (!ref) return;

        const getVal = (id) => document.getElementById(id)?.value;
        const getChk = (id) => document.getElementById(id)?.checked;

        const newName = getVal('live-prop-name') || '';

        if (ref.isPlacedObject && ref.obj) {
            ref.obj.name = newName;
            ref.obj.type = getVal('live-prop-object-type') || '';
            ref.obj.custom = ref.props.custom || {};
            ref.obj.properties = Object.entries(ref.obj.custom).map(([name, value]) => ({
                name,
                type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
                value
            }));
            drawMap();
        } else if (ref.isObjectTemplate && ref.imgObj) {
            ref.imgObj.name = newName;
            ref.imgObj.type = getVal('live-prop-object-type') || '';
            if (!ref.imgObj.tileProperties) ref.imgObj.tileProperties = {};
            ref.imgObj.tileProperties.name = newName;
            ref.imgObj.tileProperties.type = ref.imgObj.type;
            ref.imgObj.tileProperties.custom = ref.props.custom || {};
            if (ts) {
                if (!ts.tileProperties) ts.tileProperties = {};
                ts.tileProperties[ref.key] = ref.imgObj.tileProperties;
            }
            if (window.TileWeaver.tilesetManager && window.TileWeaver.tilesetManager.renderCollectionGallery) {
                window.TileWeaver.tilesetManager.renderCollectionGallery(ts);
            }
        } else if (!ref.isCollection && ts) {
            const props = ref.props;
            props.name = newName;
            props.terrainType = getVal('live-prop-terrain-type') || 'Meadow';
            props.speedMult = parseFloat(getVal('live-prop-speed-mult')) || 1.0;
            props.isLadder = !!getChk('live-prop-chk-ladder');
            props.isDamage = !!getChk('live-prop-chk-damage');
            props.isBush = !!getChk('live-prop-chk-bush');

            if (!ts.tileProperties) ts.tileProperties = {};
            ts.tileProperties[ref.key] = props;
            if (ref.tileKey) ts.tileProperties[ref.tileKey] = props;
        }
    }

    /**
     * Renders custom key-value property rows in the attribute table.
     * @param {Object<string, *>} customObj - Custom key-value dictionary
     */
    function renderCustomPropsRows(customObj) {
        const container = document.getElementById('live-custom-props-container');
        if (!container) return;
        container.innerHTML = '';

        const keys = Object.keys(customObj);
        if (keys.length === 0) {
            container.innerHTML = '<span class="text-[11px] text-slate-500 italic p-1">No custom attributes added yet. Click "+ Add Key" above.</span>';
            return;
        }

        keys.forEach(k => {
            const row = document.createElement('div');
            row.className = "flex items-center gap-1.5 text-xs bg-slate-950 p-1 rounded border border-slate-800";
            row.innerHTML = `
                <input type="text" value="${k}" class="key-input flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none">
                <span class="text-slate-500">:</span>
                <input type="text" value="${customObj[k]}" class="val-input flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-indigo-300 font-mono focus:outline-none">
                <button class="btn-del-prop p-1 text-slate-400 hover:text-red-400 transition-colors"><i class="ph ph-x"></i></button>
            `;

            const keyInput = row.querySelector('.key-input');
            const valInput = row.querySelector('.val-input');

            keyInput.addEventListener('change', (e) => {
                const newKey = e.target.value.trim();
                if (newKey && newKey !== k) {
                    const val = customObj[k];
                    delete customObj[k];
                    customObj[newKey] = val;
                    saveCurrentTileProperties();
                    renderCustomPropsRows(customObj);
                }
            });

            valInput.addEventListener('change', (e) => {
                let val = e.target.value;
                if (!isNaN(val) && val.trim() !== '') {
                    val = Number(val);
                } else if (val.toLowerCase() === 'true') {
                    val = true;
                } else if (val.toLowerCase() === 'false') {
                    val = false;
                }
                customObj[k] = val;
                saveCurrentTileProperties();
            });

            row.querySelector('.btn-del-prop').addEventListener('click', () => {
                delete customObj[k];
                saveCurrentTileProperties();
                renderCustomPropsRows(customObj);
            });

            container.appendChild(row);
        });
    }

    /**
     * Ensures the right inspector panel is expanded and visible.
     */
    function ensureInspectorOpen() {
        if (state.isRightInspectorCollapsed) {
            toggleRightSidebarCollapse();
        }
    }

    // Expose live tile properties inspector on window.TileWeaver namespace
    window.TileWeaver.tileProperties = {
        initTilePropertiesUI,
        toggleRightSidebarCollapse,
        ensureInspectorOpen,
        openTilesetPropertiesModal,
        closeTilePropsModal,
        renderTilePropertiesForm: renderLiveTilePropertiesForm,
        saveCurrentTileProperties,
        updateLiveTilePropertiesPanel
    };
})();
