/**
 * @fileoverview Synchronizes the authoritative project version from package.json
 * across all codebase files (index.html, js/constants.js, social asset generator).
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const pkgPath = path.join(ROOT_DIR, 'package.json');

if (!fs.existsSync(pkgPath)) {
    console.error('❌ package.json not found at:', pkgPath);
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '3.3.0';
const versionTag = version.startsWith('v') ? version : `v${version}`;

console.log(`🔄 Synchronizing TileWeaver project version: ${version} (${versionTag})...`);

// 1. Synchronize js/constants.js
const constantsPath = path.join(ROOT_DIR, 'js', 'constants.js');
if (fs.existsSync(constantsPath)) {
    let content = fs.readFileSync(constantsPath, 'utf8');
    content = content.replace(/let appReleaseVersion = '[^']*';/, `let appReleaseVersion = '${version}';`);
    fs.writeFileSync(constantsPath, content, 'utf8');
    console.log(`  ✔ Synchronized js/constants.js (APP_VERSION = '${version}')`);
}

// 2. Synchronize index.html
const indexPath = path.join(ROOT_DIR, 'index.html');
if (fs.existsSync(indexPath)) {
    let content = fs.readFileSync(indexPath, 'utf8');
    // Top comment
    content = content.replace(/TILEWEAVER\s+v[0-9.]+/i, `TILEWEAVER ${versionTag}`);
    // JSON-LD softwareVersion
    content = content.replace(/"softwareVersion":\s*"[^"]*"/g, `"softwareVersion": "${version}"`);
    // Header version badge
    content = content.replace(/(<span\s+id="app-header-version"[^>]*>)([^<]*)(<\/span>)/g, `$1${versionTag}$3`);
    fs.writeFileSync(indexPath, content, 'utf8');
    console.log(`  ✔ Synchronized index.html (header badge & schema = '${versionTag}')`);
}

console.log(`✨ Version synchronization complete: ${versionTag}\n`);
