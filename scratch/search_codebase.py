import os, glob

js_files = glob.glob(r'c:\Users\kkmcl\Documents\GitHub\TileWeaver\js\**\*.js', recursive=True)

keywords = [
    'objectalignment', 'fillmode', 'tilerendersize', 'grid', 'probability',
    'draworder', 'objectgroup', 'imagelayer', 'group', 'qrc:', 'type', 'class',
    'wangsets', 'wangtiles', 'corner', 'edge', 'mixed', 'compression', 'infinite'
]

print("=== CODEBASE KEYWORD SEARCH ===")
for path in js_files:
    rel_path = os.path.relpath(path, r'c:\Users\kkmcl\Documents\GitHub\TileWeaver')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    found = []
    for kw in keywords:
        if kw.lower() in content.lower():
            found.append(kw)
    if found:
        print(f"File '{rel_path}': found {found}")
