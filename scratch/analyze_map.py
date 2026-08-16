import json
import os

map_path = r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json'

with open(map_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print("==========================================")
print(" MAP METADATA ")
print("==========================================")
for k, v in data.items():
    if k not in ['layers', 'tilesets']:
        print(f"  {k}: {repr(v)}")

print("\n==========================================")
print(" LAYERS BREAKDOWN ")
print("==========================================")
print(f"Total layers: {len(data.get('layers', []))}")

def inspect_layer(layer, depth=0):
    indent = "  " * depth
    l_type = layer.get('type')
    l_name = layer.get('name')
    l_id = layer.get('id')
    print(f"{indent}- Layer ID: {l_id}, Name: '{l_name}', Type: '{l_type}'")
    
    # Print layer properties
    props = layer.get('properties', [])
    if props:
        print(f"{indent}  Properties ({len(props)}): {props}")
    
    # Layer specific attributes
    other_attrs = {k: v for k, v in layer.items() if k not in ['data', 'objects', 'layers', 'name', 'type', 'id', 'properties']}
    if other_attrs:
        print(f"{indent}  Other attributes: {other_attrs}")
        
    if l_type == 'group':
        sub_layers = layer.get('layers', [])
        print(f"{indent}  Group contains {len(sub_layers)} sub-layers:")
        for sub in sub_layers:
            inspect_layer(sub, depth + 1)
            
    elif l_type == 'objectgroup':
        objs = layer.get('objects', [])
        print(f"{indent}  Object count: {len(objs)}")
        shapes = {}
        for o in objs:
            stype = 'rectangle'
            if 'polygon' in o: stype = 'polygon'
            elif 'polyline' in o: stype = 'polyline'
            elif 'ellipse' in o: stype = 'ellipse'
            elif 'point' in o: stype = 'point'
            elif 'text' in o: stype = 'text'
            elif 'gid' in o: stype = 'tile_object'
            shapes[stype] = shapes.get(stype, 0) + 1
        print(f"{indent}  Object shape counts: {shapes}")
        
        # Check object properties & rotation/flip/etc.
        has_rotation = any(o.get('rotation', 0) != 0 for o in objs)
        has_text = any('text' in o for o in objs)
        has_gid = any('gid' in o for o in objs)
        has_props = any('properties' in o for o in objs)
        print(f"{indent}  Has Rotations: {has_rotation}, Has Text: {has_text}, Has Tile Objects (gid): {has_gid}, Has Object Props: {has_props}")
        
        for o in objs[:5]:
            print(f"{indent}    Sample Obj: id={o.get('id')}, name='{o.get('name')}', type='{o.get('type')}', shape={[k for k in ['polygon','polyline','ellipse','point','text','gid'] if k in o] or ['rect']}")

    elif l_type == 'imagelayer':
        print(f"{indent}  Image layer image: {layer.get('image')}, repeatx: {layer.get('repeatx')}, repeaty: {layer.get('repeaty')}")

    elif l_type == 'tilelayer':
        tile_data = layer.get('data', [])
        # Check if tile data has flipped tiles or large GIDs
        # In Tiled GID bitmasks: 0x80000000 (flip horizontal), 0x40000000 (flip vertical), 0x20000000 (flip anti-diagonal)
        flipped_count = 0
        if isinstance(tile_data, list):
            for gid in tile_data:
                if isinstance(gid, int) and (gid & 0xE0000000) != 0:
                    flipped_count += 1
            print(f"{indent}  Tile count: {len(tile_data)}, Flipped tiles count: {flipped_count}")

for idx, layer in enumerate(data.get('layers', [])):
    inspect_layer(layer, 0)

print("\n==========================================")
print(" TILESETS BREAKDOWN ")
print("==========================================")
print(f"Total tilesets: {len(data.get('tilesets', []))}")
for idx, ts in enumerate(data.get('tilesets', [])):
    print(f"\n--- Tileset #{idx+1} ---")
    for k, v in ts.items():
        if k not in ['tiles', 'wangsets']:
            print(f"  {k}: {repr(v)}")
    
    tiles = ts.get('tiles', [])
    if tiles:
        print(f"  Tile definitions count: {len(tiles)}")
        # Check features in tile defs
        tile_keys = set()
        has_anim = False
        has_collision = False
        has_tile_props = False
        has_type = False
        for t in tiles:
            tile_keys.update(t.keys())
            if 'animation' in t: has_anim = True
            if 'objectgroup' in t: has_collision = True
            if 'properties' in t: has_tile_props = True
            if 'type' in t: has_type = True
        print(f"  Tile features present: {tile_keys}")
        print(f"  -> Animations: {has_anim}, Collision (objectgroup): {has_collision}, Tile Props: {has_tile_props}, Tile Type: {has_type}")
        
        # sample some tiles
        for t in tiles[:3]:
            print(f"    Sample Tile {t.get('id')}: {t}")

    wangsets = ts.get('wangsets', [])
    if wangsets:
        print(f"  Wangsets count: {len(wangsets)}")
        for w in wangsets:
            print(f"    Wangset '{w.get('name')}': type={w.get('type')}, colors={len(w.get('colors', []))}, wangtiles={len(w.get('wangtiles', []))}")
