import json

with open(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json', 'r', encoding='utf-8') as f:
    map_data = json.load(f)

print("=== ALL LAYERS DETAILED ===")
for idx, l in enumerate(map_data.get('layers', [])):
    l_type = l.get('type')
    l_name = l.get('name')
    l_id = l.get('id')
    l_props = l.get('properties', [])
    print(f"Layer {idx+1}: ID={l_id}, Name='{l_name}', Type='{l_type}', Visible={l.get('visible')}, Opacity={l.get('opacity')}")
    if l_props:
        print(f"   Properties: {l_props}")
    
    if l_type == 'tilelayer':
        print(f"   Grid size: {l.get('width')}x{l.get('height')}, x={l.get('x')}, y={l.get('y')}")
    elif l_type == 'objectgroup':
        objs = l.get('objects', [])
        print(f"   Object count: {len(objs)}, draworder={l.get('draworder')}")
        # summary of objects in this layer
        shapes = {}
        types = set()
        classes = set()
        for o in objs:
            s = 'rect'
            if 'polygon' in o: s = 'polygon'
            elif 'polyline' in o: s = 'polyline'
            elif 'ellipse' in o: s = 'ellipse'
            elif 'point' in o: s = 'point'
            elif 'text' in o: s = 'text'
            elif 'gid' in o: s = 'tile_object'
            shapes[s] = shapes.get(s, 0) + 1
            if 'type' in o: types.add(o['type'])
            if 'class' in o: classes.add(o['class'])
        print(f"   Shapes: {shapes}")
        print(f"   Types: {types}, Classes: {classes}")
    elif l_type == 'group':
        sublayers = l.get('layers', [])
        print(f"   Group sublayers count: {len(sublayers)}")
        for sub_idx, sub in enumerate(sublayers):
            print(f"     Sublayer {sub_idx+1}: ID={sub.get('id')}, Name='{sub.get('name')}', Type='{sub.get('type')}'")
    elif l_type == 'imagelayer':
        print(f"   Image path: '{l.get('image')}', repeatx={l.get('repeatx')}, repeaty={l.get('repeaty')}")
