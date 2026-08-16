import json

with open(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json', 'r', encoding='utf-8') as f:
    map_data = json.load(f)

report = []

report.append("==========================================")
report.append(" MAP LEVEL COMPARISON ")
report.append("==========================================")
for k, v in map_data.items():
    if k not in ['layers', 'tilesets']:
        report.append(f"Root key '{k}': {repr(v)}")

report.append("\n==========================================")
report.append(" LAYERS COMPARISON ")
report.append("==========================================")
for idx, l in enumerate(map_data.get('layers', [])):
    report.append(f"\nLayer #{idx+1}: name='{l.get('name')}', type='{l.get('type')}', id={l.get('id')}")
    report.append(f"  Keys present: {list(l.keys())}")
    if 'properties' in l:
        report.append(f"  Custom Layer Properties: {l['properties']}")
    if l.get('type') == 'objectgroup':
        objs = l.get('objects', [])
        report.append(f"  Object Group draworder: {l.get('draworder')}")
        report.append(f"  Object Count: {len(objs)}")
        # Check object details
        sample_objs = objs[:3]
        for s_idx, obj in enumerate(sample_objs):
            report.append(f"  Sample Object #{s_idx+1}: {obj}")

report.append("\n==========================================")
report.append(" TILESETS COMPARISON ")
report.append("==========================================")
for idx, ts in enumerate(map_data.get('tilesets', [])):
    report.append(f"\nTileset #{idx+1}: name='{ts.get('name')}', firstgid={ts.get('firstgid')}")
    report.append(f"  Keys: {list(ts.keys())}")
    if 'source' in ts:
        report.append(f"  EXTERNAL TILESET REFERENCES '.tsx': {ts['source']}")
    if 'fillmode' in ts:
        report.append(f"  fillmode: {ts['fillmode']}")
    if 'tilerendersize' in ts:
        report.append(f"  tilerendersize: {ts['tilerendersize']}")
    if 'objectalignment' in ts:
        report.append(f"  objectalignment: {ts['objectalignment']}")
    if ts.get('image', '').startswith('qrc:'):
        report.append(f"  Qt Resource URI image: {ts['image']}")
    if 'grid' in ts:
        report.append(f"  grid: {ts['grid']}")
    
    tiles = ts.get('tiles', [])
    if tiles:
        sample_tiles = tiles[:2]
        report.append(f"  Tile defs sample: {sample_tiles}")

with open(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\scratch\comparison_raw.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(report))

print("Raw comparison saved.")
