const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Standard Replacements
    // 1. TileWeaver PRO / TileWeaver Pro -> TileWeaver
    content = content.replace(/TileWeaver\s+PRO/g, 'TileWeaver');
    content = content.replace(/TILEMAPPER\s+PRO/g, 'TILEWEAVER');
    content = content.replace(/TileWeaver\s+Pro/g, 'TileWeaver');
    content = content.replace(/TileWeaver_pro/g, 'tileweaver');

    // 2. TileWeaver -> TileWeaver
    content = content.replace(/TileWeaver/g, 'TileWeaver');
    content = content.replace(/TILEMAPPER/g, 'TILEWEAVER');
    content = content.replace(/tilemapper/g, 'tileweaver');

    // 3. Keep backward-compatibility alias in JS files if window.TileWeaver is initialized
    if (filePath.endsWith('.js') && filePath.includes(path.join('js', '')) && !filePath.includes('node_modules')) {
        // Ensure root.TileWeaver or window.TileWeaver alias is present if window.TileWeaver is initialized
        if (content.includes('window.TileWeaver = window.TileWeaver || {};') && !content.includes('window.TileWeaver = window.TileWeaver;')) {
            content = content.replace('window.TileWeaver = window.TileWeaver || {};', 'window.TileWeaver = window.TileWeaver || {};\n    window.TileWeaver = window.TileWeaver; // Backward-compatibility alias');
        }
        if (content.includes('root.TileWeaver = root.TileWeaver || {};') && !content.includes('root.TileWeaver = root.TileWeaver;')) {
            content = content.replace('root.TileWeaver = root.TileWeaver || {};', 'root.TileWeaver = root.TileWeaver || {};\n    root.TileWeaver = root.TileWeaver; // Backward-compatibility alias');
        }
        // Mirror export on TileWeaver namespace at end of module if exported on TileWeaver
        const match = content.match(/window\.TileWeaver\.(\w+)\s*=\s*\{/);
        if (match) {
            const sub = match[1];
            if (!content.includes(`window.TileWeaver.${sub} = window.TileWeaver.${sub};`)) {
                content = content.replace(
                    new RegExp(`(window\\.TileWeaver\\.${sub}\\s*=\\s*\\{[\\s\\S]*?\\};)`),
                    `$1\n    window.TileWeaver.${sub} = window.TileWeaver.${sub};`
                );
            }
        }
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
}

function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const f of files) {
        if (f === 'node_modules' || f === '.git' || f === 'assets' || f === 'sample' || f === 'rebrand_to_tileweaver.js') continue;
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else if (/\.(js|html|css|json|md|py)$/.test(f)) {
            replaceInFile(fullPath);
        }
    }
}

// Walk target directories
const rootDir = path.resolve(__dirname, '..');
walkDir(path.join(rootDir, 'js'));
walkDir(path.join(rootDir, 'scripts'));
walkDir(path.join(rootDir, 'scratch'));
walkDir(path.join(rootDir, '.agents'));

console.log('Migration script complete.');
