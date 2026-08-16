import json

with open(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\test\alpha_map.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("=== DEEP VERIFICATION OF ALPHA_MAP.JSON ===")

# 1. Map root metrics
print("\n[MAP METADATA]")
print(f"Dimensions: {data['width']}x{data['height']}, Tile size: {data['tilewidth']}x{data['tileheight']}")
print(f"Orientation: {data.get('orientation')}, Render order: {data.get('renderorder')}")
print(f"Tiled Version: {data.get('tiledversion')}, Map Version: {data.get('version')}")
print(f"Next Layer ID: {data.get('nextlayerid')}, Next Object ID: {data.get('nextobjectid')}")
print(f"Infinite: {data.get('infinite')}, Compression Level: {data.get('compressionlevel')}")

# 2. Layers analysis
tilelayers = [l for l in data['layers'] if l['type'] == 'tilelayer']
objectgroups = [l for l in data['layers'] if l['type'] == 'objectgroup']

print(f"\n[LAYERS]")
print(f"Total Layers: {len(data['layers'])}")
print(f"Tile Layers ({len(tilelayers)}): {[l['name'] for l in tilelayers]}")
print(f"Object Groups ({len(objectgroups)}): {[l['name'] for l in objectgroups]}")

total_objects = sum(len(l.get('objects', [])) for l in objectgroups)
print(f"Total Objects in Object Groups: {total_objects}")

# Object details breakdown
obj_props_count = 0
obj_with_gid = 0
obj_types_count = 0
for l in objectgroups:
    for o in l.get('objects', []):
        if 'gid' in o: obj_with_gid += 1
        if 'properties' in o: obj_props_count += len(o['properties'])
        if o.get('type'): obj_types_count += 1

print(f"  - Objects with GID (tile instances): {obj_with_gid} / {total_objects}")
print(f"  - Total custom properties on objects: {obj_props_count}")
print(f"  - Objects with custom Type/Class: {obj_types_count}")

# 3. Tilesets analysis
print(f"\n[TILESETS]")
print(f"Total Tilesets: {len(data['tilesets'])}")
embedded_image_ts = []
collection_ts = []
external_ts = []
special_attr_ts = []

total_wangsets = 0
total_wangtiles = 0
total_prob_tiles = 0
total_tile_props = 0

for ts in data['tilesets']:
    name = ts.get('name')
    if 'source' in ts:
        external_ts.append(name)
    elif ts.get('columns') == 0 or any('image' in t for t in ts.get('tiles', [])):
        collection_ts.append(name)
    else:
        embedded_image_ts.append(name)
        
    w_list = ts.get('wangsets', [])
    total_wangsets += len(w_list)
    for w in w_list:
        total_wangtiles += len(w.get('wangtiles', []))
        
    for t in ts.get('tiles', []):
        if 'probability' in t: total_prob_tiles += 1
        if 'properties' in t: total_tile_props += len(t['properties'])
        
    attrs = []
    if 'objectalignment' in ts: attrs.append(f"objectalignment={ts['objectalignment']}")
    if 'fillmode' in ts: attrs.append(f"fillmode={ts['fillmode']}")
    if 'tilerendersize' in ts: attrs.append(f"tilerendersize={ts['tilerendersize']}")
    if 'grid' in ts: attrs.append("grid")
    if ts.get('image', '').startswith('qrc:'): attrs.append("qrc_image")
    if attrs:
        special_attr_ts.append(f"{name}: {', '.join(attrs)}")

print(f"Standard Image Sheet Tilesets ({len(embedded_image_ts)}): {embedded_image_ts}")
print(f"Collection of Images Tilesets ({len(collection_ts)}): {collection_ts}")
print(f"External .tsx Tilesets ({len(external_ts)}): {external_ts}")
print(f"Special Attributes / Formats: {special_attr_ts}")
print(f"Total Tiled Wangsets (Terrain Sets): {total_wangsets} across tilesets (containing {total_wangtiles} wangtile mappings)")
print(f"Total Tiles with Probability settings: {total_prob_tiles}")
print(f"Total Tile Custom Properties: {total_tile_props}")

