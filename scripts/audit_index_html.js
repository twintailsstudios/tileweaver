const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// 1. Check Duplicate IDs
const idRegex = /id="([^"]+)"/g;
const ids = {};
const duplicates = [];
let match;
while ((match = idRegex.exec(html)) !== null) {
    const id = match[1];
    if (ids[id]) {
        duplicates.push({ id, count: ids[id] + 1 });
    }
    ids[id] = (ids[id] || 0) + 1;
}

// 2. Check Canvases
const canvasRegex = /<canvas([^>]*)>/g;
const canvases = [];
while ((match = canvasRegex.exec(html)) !== null) {
    canvases.push(match[0]);
}

// 3. Check Script tags
const scriptRegex = /<script\s+src="([^"]+)"/g;
const scripts = [];
while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1]);
}

console.log('=== INDEX.HTML STRUCTURAL AUDIT RESULTS ===');
console.log('Total DOM IDs:', Object.keys(ids).length);
console.log('Duplicate IDs:', duplicates.length === 0 ? 'None (0 duplicates)' : JSON.stringify(duplicates, null, 2));
console.log('Total Canvases:', canvases.length);
console.log('Total Script Tags:', scripts.length);
console.log('Modular App Scripts:', scripts.filter(s => s.startsWith('js/')).length);
