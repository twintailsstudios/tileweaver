import json

with open(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json', 'r', encoding='utf-8') as f:
    map_data = json.load(f)

print("=== 1. MAP LEVEL PROPERTIES & KEYS ===")
print("Map Keys:", list(map_data.keys()))
if 'properties' in map_data:
    print("Map Custom Properties:", map_data['properties'])
else:
    print("Map Custom Properties: None")

print("\n=== 2. ALL LAYERS IN MAP ===")
for idx, l in enumerate(map_data.get('layers', [])):
    print(f"\n--- Layer #{idx+1} ---")
    print("  Basic info:", {k: v for k, v in l.items() if k not in ['data', 'objects', 'layers']})
    print("  Type:", l.get('type'))
    print("  Name:", l.get('name'))
    if 'properties' in l:
        print("  Properties:", l['properties'])
    if l.get('type') == 'group':
        print("  Sublayers count:", len(l.get('layers', [])))
        for sub_idx, sub in enumerate(l.get('layers', [])):
            print(f"    Sublayer #{sub_idx+1}: name='{sub.get('name')}', type='{sub.get('type')}', keys={list(sub.keys())}")
            if 'properties' in sub:
                print("      Properties:", sub['properties'])
            if sub.get('type') == 'objectgroup':
                print(f"      Objects count: {len(sub.get('objects', []))}")
                for obj in sub.get('objects', [])[:3]:
                    print("        Sample Obj:", obj)
            elif sub.get('type') == 'tilelayer':
                print(f"      Data length: {len(sub.get('data', []))}")
            elif sub.get('type') == 'imagelayer':
                print(f"      Image:", sub.get('image'))
    elif l.get('type') == 'objectgroup':
        objs = l.get('objects', [])
        print(f"  Objects count: {len(objs)}")
        # Categorize objects
        obj_types = {}
        for obj in objs:
            # check type / class / shape
            shape = 'rectangle'
            if 'polygon' in obj: shape = 'polygon'
            elif 'polyline' in obj: shape = 'polyline'
            elif 'ellipse' in obj: shape = 'ellipse'
            elif 'point' in obj: shape = 'point'
            elif 'text' in obj: shape = 'text'
            elif 'gid' in obj: shape = 'tile_object'
            
            ot = (shape, obj.get('type') or obj.get('class') or '(no type)')
            obj_types[ot] = obj_types.get(ot, 0) + 1
        print("  Object breakdown (shape, type/class):")
        for k, v in obj_types.items():
            print(f"    - {k}: {v}")
        print("  Sample 5 Objects:")
        for obj in objs[:5]:
            print("   ", obj)
    elif l.get('type') == 'imagelayer':
        print("  Image file:", l.get('image'))
    elif l.get('type') == 'tilelayer':
        print("  Tilelayer width/height:", l.get('width'), l.get('height'))
        print("  Data array length:", len(l.get('data', [])))

print("\n=== 3. ALL TILESETS IN MAP ===")
print("Tilesets Count:", len(map_data.get('tilesets', [])))
for idx, ts in enumerate(map_data.get('tilesets', [])):
    print(f"\n--- Tileset #{idx+1} ({ts.get('name')}) ---")
    print("  Keys:", list(ts.keys()))
    if 'source' in ts:
        print("  EXTERNAL TILESET source:", ts['source'])
    else:
        print("  EMBEDDED TILESET: image=", ts.get('image'), "tilecount=", ts.get('tilecount'), "columns=", ts.get('columns'))
    if 'properties' in ts:
        print("  Tileset Custom Properties:", ts['properties'])
    if 'wangsets' in ts:
        print(f"  Wangsets Count: {len(ts['wangsets'])}")
        for w in ts['wangsets']:
            print(f"    Wangset '{w.get('name')}': type={w.get('type')}, colors={len(w.get('colors', []))}, wangtiles count={len(w.get('wangtiles', []))}")
            if 'properties' in w:
                print("      Wangset Properties:", w['properties'])
            if w.get('colors'):
                for col in w['colors']:
                    print("      Color:", col)
    if 'tiles' in ts:
        print(f"  Tile Defs Count: {len(ts['tiles'])}")
        # Check special features in tile defs
        has_objectgroup = [t for t in ts['tiles'] if 'objectgroup' in t]
        has_animation = [t for t in ts['tiles'] if 'animation' in t]
        has_properties = [t for t in ts['tiles'] if 'properties' in t]
        has_type = [t for t in ts['tiles'] if 'type' in t or 'class' in t]
        has_image = [t for t in ts['tiles'] if 'image' in t]
        has_probability = [t for t in ts['tiles'] if 'probability' in t]
        print(f"    - Tile Collision (objectgroup): {len(has_objectgroup)}")
        print(f"    - Animated Tiles (animation): {len(has_animation)}")
        print(f"    - Tile Properties: {len(has_properties)}")
        print(f"    - Tile Type/Class: {len(has_type)}")
        print(f"    - Image Tiles (Collection of Images): {len(has_image)}")
        print(f"    - Tile Probability: {len(has_probability)}")
        
        if has_objectgroup:
            print("    Sample Tile Collision (objectgroup):", has_objectgroup[0])
        if has_animation:
            print("    Sample Animated Tile:", has_animation[0])
        if has_probability:
            print("    Sample Probability Tile:", has_probability[0])
