const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname, '..', 'scripts');
const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));

for (const file of files) {
    const filePath = path.join(scriptsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove any accidental standalone lines: window.TileWeaver.xyz = window.TileWeaver.xyz;
    content = content.replace(/\s*window\.TileWeaver\.\w+\s*=\s*window\.TileWeaver\.\w+;/g, '');

    // Ensure global setup aliases TileWeaver to TileWeaver
    if (content.includes('global.window.TileWeaver = global.window.TileWeaver || {};') && !content.includes('global.window.TileWeaver = global.window.TileWeaver;')) {
        content = content.replace(
            'global.window.TileWeaver = global.window.TileWeaver || {};',
            'global.window.TileWeaver = global.window.TileWeaver || {};\nglobal.window.TileWeaver = global.window.TileWeaver;'
        );
    }
    if (content.includes('window.TileWeaver = window.TileWeaver || {};') && !content.includes('window.TileWeaver = window.TileWeaver;')) {
        content = content.replace(
            'window.TileWeaver = window.TileWeaver || {};',
            'window.TileWeaver = window.TileWeaver || {};\nwindow.TileWeaver = window.TileWeaver;'
        );
    }

    fs.writeFileSync(filePath, content, 'utf8');
}

console.log('Scripts cleaned up.');
