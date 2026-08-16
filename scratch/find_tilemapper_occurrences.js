const fs = require('fs');
const path = require('path');

const rootDir = 'C:\\Users\\kkmcl\\Documents\\GitHub\\TileWeaver';
const summary = {};

function walk(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        if (file.name === 'node_modules' || file.name === '.git') continue;
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            walk(fullPath);
        } else {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const relPath = path.relative(rootDir, fullPath);
                const lines = content.split('\n');
                const matches = [];
                lines.forEach((line, idx) => {
                    if (/tile[_\-]?mapper|TileWeaver/i.test(line)) {
                        matches.push({ line: idx + 1, text: line.trim() });
                    }
                });
                if (matches.length > 0) {
                    summary[relPath] = matches;
                }
            } catch (e) {}
        }
    }
}

walk(rootDir);

for (const [file, matches] of Object.entries(summary)) {
    console.log(`=== ${file} (${matches.length} matches) ===`);
    matches.forEach(m => console.log(`  L${m.line}: ${m.text.substring(0, 120)}`));
}
