/**
 * @fileoverview Generates production favicons, PWA icons, and Open Graph social preview banner.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ROOT_DIR = path.join(__dirname, '..');

if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Draws the branded TileWeaver icon onto a canvas of given dimension.
 */
function drawTileWeaverIcon(ctx, size) {
    const scale = size / 512;
    ctx.save();
    ctx.scale(scale, scale);

    // Background Rounded Rect
    const bgGrad = ctx.createLinearGradient(0, 0, 512, 512);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#1e293b');

    ctx.fillStyle = bgGrad;
    roundRect(ctx, 0, 0, 512, 512, 112);
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6;
    roundRect(ctx, 3, 3, 506, 506, 110);
    ctx.stroke();

    // Map Trifold
    ctx.save();
    ctx.translate(48, 56);

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 12;

    // Left Fold
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.moveTo(40, 110);
    ctx.lineTo(140, 60);
    ctx.lineTo(140, 320);
    ctx.lineTo(40, 370);
    ctx.closePath();
    ctx.fill();

    // Center Fold
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(140, 60);
    ctx.lineTo(276, 110);
    ctx.lineTo(276, 370);
    ctx.lineTo(140, 320);
    ctx.closePath();
    ctx.fill();

    // Right Fold
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(276, 110);
    ctx.lineTo(376, 60);
    ctx.lineTo(376, 320);
    ctx.lineTo(276, 370);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = 'transparent';

    // Isometric Diamonds
    drawDiamond(ctx, 208, 145, 40, 20, '#38bdf8');
    drawDiamond(ctx, 168, 185, 40, 20, '#60a5fa');
    drawDiamond(ctx, 248, 185, 40, 20, '#818cf8');
    drawDiamond(ctx, 208, 225, 40, 20, '#a855f7');

    // Contour / Weave line
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 8;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(60, 200);
    ctx.quadraticCurveTo(140, 180, 208, 205);
    ctx.quadraticCurveTo(280, 230, 356, 230);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center Pin Node
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(208, 205, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
    ctx.restore();
}

function drawDiamond(ctx, cx, cy, rx, ry, fill) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.lineTo(cx + rx, cy);
    ctx.lineTo(cx, cy + ry);
    ctx.lineTo(cx - rx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Generates Open Graph banner (1200x630)
 */
function generateOGBanner() {
    const canvas = createCanvas(1200, 630);
    const ctx = canvas.getContext('2d');

    // Background Gradient
    const grad = ctx.createLinearGradient(0, 0, 1200, 630);
    grad.addColorStop(0, '#0b0f19');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1200, 630);

    // Decorative Dual-Grid Pattern Background
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < 1200; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 630);
        ctx.stroke();
    }
    for (let y = 0; y < 630; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1200, y);
        ctx.stroke();
    }

    // Glow Circles
    const glow1 = ctx.createRadialGradient(250, 315, 10, 250, 315, 300);
    glow1.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
    glow1.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, 600, 630);

    const glow2 = ctx.createRadialGradient(950, 315, 10, 950, 315, 300);
    glow2.addColorStop(0, 'rgba(147, 51, 234, 0.2)');
    glow2.addColorStop(1, 'rgba(147, 51, 234, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(600, 0, 600, 630);

    // Draw Icon on the Left
    ctx.save();
    ctx.translate(90, 165);
    drawTileWeaverIcon(ctx, 300);
    ctx.restore();

    // Typography
    ctx.save();
    ctx.translate(440, 180);

    // Pill Badge
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0, 0, 330, 34, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('DUAL-GRID AUTOTILING & LEVEL EDITOR', 14, 22);

    // Main Heading
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('TileWeaver', 0, 90);

    // Version Tag
    ctx.fillStyle = '#94a3b8';
    ctx.font = '32px sans-serif';
    ctx.fillText('v3.3', 315, 90);

    // Subtitle / Tagline
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '22px sans-serif';
    ctx.fillText('Professional Web RPG Map & Autotile Level Editor', 0, 136);

    // Feature Badges
    const badges = [
        '✨ Dual-Grid Autotiling',
        '🎮 Godot & Unity Export',
        '⚡ 60 FPS Canvas 2D',
        '📦 100% Client-Side'
    ];
    let badgeY = 190;
    badges.forEach((b, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx = col * 260;
        const by = badgeY + row * 44;

        ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, 240, 34, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '14px sans-serif';
        ctx.fillText(b, bx + 14, by + 22);
    });

    // Domain Footer
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('www.tileweaver.net', 0, 325);

    ctx.restore();

    // Save OG Image
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(ASSETS_DIR, 'tileweaver-og.png'), buf);
    console.log('✔ Generated: assets/tileweaver-og.png (1200x630)');
}

/**
 * Main execution
 */
function main() {
    const sizes = [
        { name: 'favicon-16x16.png', size: 16, targetDir: ASSETS_DIR },
        { name: 'favicon-32x32.png', size: 32, targetDir: ASSETS_DIR },
        { name: 'apple-touch-icon.png', size: 180, targetDir: ASSETS_DIR },
        { name: 'android-chrome-192x192.png', size: 192, targetDir: ASSETS_DIR },
        { name: 'android-chrome-512x512.png', size: 512, targetDir: ASSETS_DIR },
        { name: 'favicon.ico', size: 32, targetDir: ROOT_DIR }
    ];

    sizes.forEach(item => {
        const canvas = createCanvas(item.size, item.size);
        const ctx = canvas.getContext('2d');
        drawTileWeaverIcon(ctx, item.size);
        const buf = canvas.toBuffer('image/png');
        const outPath = path.join(item.targetDir, item.name);
        fs.writeFileSync(outPath, buf);
        console.log(`✔ Generated: ${path.relative(ROOT_DIR, outPath)} (${item.size}x${item.size})`);
    });

    generateOGBanner();
    console.log('🎉 All production web assets generated cleanly!');
}

main();
