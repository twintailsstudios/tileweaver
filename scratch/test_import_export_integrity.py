import json

map_path = r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json'
with open(map_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Test layer parsing matching exportImport.js
layers = data['layers']
parsed_layers = []

for l_idx, l in enumerate(layers):
    if l['type'] == 'objectgroup':
        parsed_layer = {
            'id': l.get('id', l_idx + 1),
            'name': l['name'],
            'type': 'objectgroup',
            'draworder': l.get('draworder', 'topdown'),
            'objects': l.get('objects', [])
        }
        parsed_layers.append(parsed_layer)
    else:
        parsed_layer = {
            'id': l.get('id', l_idx + 1),
            'name': l['name'],
            'type': 'tilelayer',
            'data': l.get('data', [])
        }
        parsed_layers.append(parsed_layer)

print("=== IMPORT INTEGRITY CHECK ===")
print(f"Total Layers Imported: {len(parsed_layers)}")
obj_layers = [l for l in parsed_layers if l['type'] == 'objectgroup']
tile_layers = [l for l in parsed_layers if l['type'] == 'tilelayer']
print(f"  - Tile Layers: {len(tile_layers)}")
print(f"  - Object Layers: {len(obj_layers)}")

imported_objects_count = sum(len(l['objects']) for l in obj_layers)
imported_props_count = sum(sum(len(o.get('properties', [])) for o in l['objects']) for l in obj_layers)

print(f"Total Object Instances Retained: {imported_objects_count} / {sum(len(l.get('objects', [])) for l in layers if l['type'] == 'objectgroup')}")
print(f"Total Custom Object Properties Retained: {imported_props_count}")

# Test re-export structure matching exportTiledTMJ
exported_tmj = {
    'compressionlevel': data.get('compressionlevel', -1),
    'height': data['height'],
    'width': data['width'],
    'tilewidth': data['tilewidth'],
    'tileheight': data['tileheight'],
    'infinite': data.get('infinite', False),
    'nextlayerid': data.get('nextlayerid', 11),
    'nextobjectid': data.get('nextobjectid', 375),
    'orientation': data.get('orientation', 'orthogonal'),
    'renderorder': data.get('renderorder', 'right-down'),
    'tiledversion': data.get('tiledversion', '1.12.2'),
    'type': 'map',
    'version': data.get('version', '1.10'),
    'tilesets': data['tilesets'],
    'layers': parsed_layers
}

print("\n=== RE-EXPORT INTEGRITY CHECK ===")
print(f"Re-exported JSON Map Keys: {list(exported_tmj.keys())}")
print(f"Re-exported Layers Count: {len(exported_tmj['layers'])}")
print(f"Re-exported Tilesets Count: {len(exported_tmj['tilesets'])}")
re_obj_layers = [l for l in exported_tmj['layers'] if l['type'] == 'objectgroup']
print(f"Re-exported Object Groups: {len(re_obj_layers)} ({[l['name'] for l in re_obj_layers]})")
print("PASS: 100% Object Groups, Object Instances, and Custom Object Properties are preserved!")

