import json

map_path = r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json'
with open(map_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Let's simulate importMapJSON logic from js/engine/exportImport.js

state_mapWidth = data.get('width') or data.get('mapWidth')
state_mapHeight = data.get('height') or data.get('mapHeight')
state_TILE_SIZE = data.get('tilewidth') or data.get('tileSize') or 32

print(f"Imported Map Size: {state_mapWidth}x{state_mapHeight}, Tile Size: {state_TILE_SIZE}")

# 1. Map Properties
mapProps = {}
if 'properties' in data and isinstance(data['properties'], list):
    for p in data['properties']:
        mapProps[p['name']] = p['value']

print("Map custom properties parsed:", mapProps)

# 2. Tileset Restoration
loaded_tilesets = []
for i, rawTs in enumerate(data.get('tilesets', [])):
    tsProps = {}
    if 'properties' in rawTs and isinstance(rawTs['properties'], list):
        for p in rawTs['properties']:
            tsProps[p['name']] = p['value']
    
    tilesetId = tsProps.get('tilesetId') or rawTs.get('id') or f"ts_{i+1}"
    tsName = rawTs.get('name') or f"Tileset {i+1}"
    isCollection = tsProps.get('isCollection') or rawTs.get('columns') == 0 or any('image' in t for t in rawTs.get('tiles', []))
    
    loaded_tilesets.append({
        'id': tilesetId,
        'name': tsName,
        'firstgid': rawTs.get('firstgid', 1),
        'isCollection': isCollection,
        'raw_keys': list(rawTs.keys()),
        'objectalignment': rawTs.get('objectalignment'),
        'fillmode': rawTs.get('fillmode'),
        'tilerendersize': rawTs.get('tilerendersize'),
        'grid': rawTs.get('grid'),
        'wangsets': len(rawTs.get('wangsets', [])),
        'tiles_count': len(rawTs.get('tiles', []))
    })

print(f"\nTilesets imported ({len(loaded_tilesets)}):")
for ts in loaded_tilesets:
    print(f"  - [{ts['id']}] {ts['name']} (firstgid={ts['firstgid']}, isCollection={ts['isCollection']})")
    unhandled_ts_keys = [k for k in ts['raw_keys'] if k not in ['firstgid', 'name', 'tilewidth', 'tileheight', 'margin', 'spacing', 'columns', 'tilecount', 'image', 'imagewidth', 'imageheight', 'properties', 'tiles', 'wangsets']]
    if unhandled_ts_keys:
        print(f"    UNHANDLED TILESET KEYS: {unhandled_ts_keys}")

# 3. Layer Restoration
loaded_layers = []
unhandled_map_layers = []

for lIdx, l in enumerate(data.get('layers', [])):
    l_type = l.get('type')
    l_name = l.get('name')
    l_id = l.get('id')
    
    unhandled_layer_keys = [k for k in l.keys() if k not in ['id', 'name', 'type', 'visible', 'opacity', 'width', 'height', 'data', 'properties']]
    
    if l_type == 'objectgroup':
        objs = l.get('objects', [])
        loaded_layers.append({
            'name': l_name,
            'imported_as': 'tilelayer (RASTERIZED)',
            'original_type': 'objectgroup',
            'object_count': len(objs),
            'unhandled_keys': unhandled_layer_keys
        })
    elif l_type == 'tilelayer':
        loaded_layers.append({
            'name': l_name,
            'imported_as': 'tilelayer',
            'original_type': 'tilelayer',
            'unhandled_keys': unhandled_layer_keys
        })
    else:
        loaded_layers.append({
            'name': l_name,
            'imported_as': 'UNKNOWN / DROPPED OR FALLBACK',
            'original_type': l_type,
            'unhandled_keys': unhandled_layer_keys
        })

print(f"\nLayers imported ({len(loaded_layers)}):")
for l in loaded_layers:
    print(f"  - Layer '{l['name']}': type='{l['original_type']}' -> imported as '{l['imported_as']}'")
    if l['unhandled_keys']:
        print(f"    UNHANDLED LAYER KEYS: {l['unhandled_keys']}")

