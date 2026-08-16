/**
 * @fileoverview Production build script for TileWeaver.
 * Assembles a clean, optimized 'dist' directory containing only client-facing web assets.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('🚀 Starting TileWeaver production build...');

// 1. Generate Favicons and Social Assets
console.log('🎨 Generating branding and web assets...');
try {
    execSync('node scripts/generate_web_assets.js', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (err) {
    console.warn('⚠️ Non-fatal warning during asset generation:', err.message);
}

// 2. Clean & Recreate dist/ directory
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 3. Copy Root Web Files
const rootFiles = [
    'index.html',
    '404.html',
    '_headers',
    'robots.txt',
    'sitemap.xml',
    'site.webmanifest',
    'favicon.ico'
];

rootFiles.forEach(file => {
    const src = path.join(ROOT_DIR, file);
    const dest = path.join(DIST_DIR, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`  ✔ Copied ${file}`);
    } else {
        console.warn(`  ⚠️ Missing root file: ${file}`);
    }
});

// 4. Recursively Copy Static Directories
const staticDirs = ['assets', 'css', 'js', 'sample'];

function copyDirRecursive(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        // Skip OS files
        if (entry.name === 'desktop.ini' || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') {
            continue;
        }

        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

staticDirs.forEach(dir => {
    const src = path.join(ROOT_DIR, dir);
    const dest = path.join(DIST_DIR, dir);
    if (fs.existsSync(src)) {
        copyDirRecursive(src, dest);
        console.log(`  ✔ Copied directory: ${dir}/`);
    }
});

// 5. Ensure legacy _redirects is purged if present from cache
const legacyRedirects = path.join(DIST_DIR, '_redirects');
if (fs.existsSync(legacyRedirects)) {
    fs.unlinkSync(legacyRedirects);
}

// 6. Audit dist size and file count
let totalFiles = 0;
function countFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            countFiles(fullPath);
        } else {
            totalFiles++;
        }
    }
}
countFiles(DIST_DIR);

console.log(`✨ Build complete! Bundled ${totalFiles} production web assets into 'dist/'.`);
