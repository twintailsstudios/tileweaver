const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

function generateDefaultTileset() {
    const canvas = createCanvas(160, 160);
    const ctx = canvas.getContext('2d');
    
    const dark = '#15803d';
    const light = '#4ade80';
    const detail = '#22c55e';

    // 1. Grass 3x3 Outer Block (0,0 to 2,2)
    ctx.fillStyle = dark; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 8, 24, 24);
    ctx.fillStyle = dark; ctx.fillRect(32, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(32, 8, 32, 24);
    ctx.fillStyle = dark; ctx.fillRect(64, 0, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 8, 24, 24);
    ctx.fillStyle = dark; ctx.fillRect(0, 32, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 32, 24, 32);
    ctx.fillStyle = light; ctx.fillRect(32, 32, 32, 32); ctx.fillStyle = detail; ctx.fillRect(36, 36, 4, 4); ctx.fillRect(52, 44, 4, 4);
    ctx.fillStyle = dark; ctx.fillRect(64, 32, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 32, 24, 32);
    ctx.fillStyle = dark; ctx.fillRect(0, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(8, 64, 24, 24);
    ctx.fillStyle = dark; ctx.fillRect(32, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(32, 64, 32, 24);
    ctx.fillStyle = dark; ctx.fillRect(64, 64, 32, 32); ctx.fillStyle = light; ctx.fillRect(64, 64, 24, 24);

    // 2. Inner Corners (Cols 3..4, Rows 0..1)
    ctx.fillStyle = light; ctx.fillRect(96, 0, 32, 32); ctx.fillStyle = dark; ctx.fillRect(96, 0, 8, 8);
    ctx.fillStyle = light; ctx.fillRect(128, 0, 32, 32); ctx.fillStyle = dark; ctx.fillRect(152, 0, 8, 8);
    ctx.fillStyle = light; ctx.fillRect(96, 32, 32, 32); ctx.fillStyle = dark; ctx.fillRect(96, 56, 8, 8);
    ctx.fillStyle = light; ctx.fillRect(128, 32, 32, 32); ctx.fillStyle = dark; ctx.fillRect(152, 56, 8, 8);

    // 3. 45-Degree Diagonal Slopes (Cols 3..4, Rows 2..3)
    ctx.fillStyle = light; ctx.fillRect(96, 64, 32, 32); ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(96, 64); ctx.lineTo(128, 64); ctx.lineTo(96, 96); ctx.closePath(); ctx.fill();

    ctx.fillStyle = light; ctx.fillRect(128, 64, 32, 32); ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(128, 64); ctx.lineTo(160, 64); ctx.lineTo(160, 96); ctx.closePath(); ctx.fill();

    ctx.fillStyle = light; ctx.fillRect(96, 96, 32, 32); ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(96, 96); ctx.lineTo(96, 128); ctx.lineTo(128, 128); ctx.closePath(); ctx.fill();

    ctx.fillStyle = light; ctx.fillRect(128, 96, 32, 32); ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(160, 96); ctx.lineTo(160, 128); ctx.lineTo(128, 128); ctx.closePath(); ctx.fill();

    // 4. Animated Water Frames (Row 3, Cols 0..2)
    ctx.fillStyle = '#1d4ed8'; ctx.fillRect(0, 96, 32, 32); ctx.fillStyle = '#60a5fa'; ctx.fillRect(4, 8, 12, 2);
    ctx.fillStyle = '#2563eb'; ctx.fillRect(32, 96, 32, 32); ctx.fillStyle = '#93c5fd'; ctx.fillRect(10, 14, 12, 2);
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(64, 96, 32, 32); ctx.fillStyle = '#bfdbfe'; ctx.fillRect(6, 20, 12, 2);

    return canvas.toBuffer('image/png');
}

function generateDirtPathTileset() {
    const canvas = createCanvas(160, 160);
    const ctx = canvas.getContext('2d');
    
    const grassBg = '#15803d';
    const dirtDark = '#78350f';
    const dirtFill = '#d97706';
    const dirtDetail = '#b45309';

    ctx.fillStyle = grassBg; ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#22c55e';
    for (let i = 0; i < 40; i++) {
        ctx.fillRect((i * 19) % 155, (i * 29) % 155, 2, 2);
    }

    function drawDirtTile(tx, ty, drawFn) {
        ctx.save();
        ctx.translate(tx * 32, ty * 32);
        drawFn(ctx, dirtDark, dirtFill, dirtDetail);
        ctx.restore();
    }

    drawDirtTile(0, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 8, 24, 24); c.fillStyle = f; c.fillRect(10, 10, 22, 22); });
    drawDirtTile(1, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 8, 32, 24); c.fillStyle = f; c.fillRect(0, 10, 32, 22); });
    drawDirtTile(2, 0, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 8, 24, 24); c.fillStyle = f; c.fillRect(0, 10, 22, 22); });
    drawDirtTile(0, 1, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 0, 24, 32); c.fillStyle = f; c.fillRect(10, 0, 22, 32); });
    drawDirtTile(1, 1, (c, d, f, dt) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = dt; c.fillRect(6, 6, 4, 4); c.fillRect(20, 18, 4, 4); });
    drawDirtTile(2, 1, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 24, 32); c.fillStyle = f; c.fillRect(0, 0, 22, 32); });
    drawDirtTile(0, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(8, 0, 24, 24); c.fillStyle = f; c.fillRect(10, 0, 22, 22); });
    drawDirtTile(1, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 32, 24); c.fillStyle = f; c.fillRect(0, 0, 32, 22); });
    drawDirtTile(2, 2, (c, d, f) => { c.fillStyle = d; c.fillRect(0, 0, 24, 24); c.fillStyle = f; c.fillRect(0, 0, 22, 22); });

    drawDirtTile(3, 0, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(0, 0, 8, 8); c.fillStyle = d; c.fillRect(0, 7, 8, 2); c.fillRect(7, 0, 2, 8); });
    drawDirtTile(4, 0, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(24, 0, 8, 8); c.fillStyle = d; c.fillRect(24, 7, 8, 2); c.fillRect(24, 0, 2, 8); });
    drawDirtTile(3, 1, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(0, 24, 8, 8); c.fillStyle = d; c.fillRect(0, 24, 8, 2); c.fillRect(7, 24, 2, 8); });
    drawDirtTile(4, 1, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.fillRect(24, 24, 8, 8); c.fillStyle = d; c.fillRect(24, 24, 8, 2); c.fillRect(24, 24, 2, 8); });

    drawDirtTile(3, 2, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 0); c.lineTo(0, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 0); c.lineTo(0, 32); c.stroke(); });
    drawDirtTile(4, 2, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 0); c.lineTo(32, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 32); c.stroke(); });
    drawDirtTile(3, 3, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 32); c.lineTo(32, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 32); c.stroke(); });
    drawDirtTile(4, 3, (c, d, f) => { c.fillStyle = f; c.fillRect(0, 0, 32, 32); c.fillStyle = grassBg; c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 32); c.lineTo(0, 32); c.closePath(); c.fill(); c.strokeStyle = d; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 0); c.lineTo(0, 32); c.stroke(); });

    ctx.fillStyle = '#92400e'; ctx.fillRect(0, 96, 32, 32);
    ctx.fillStyle = '#78350f'; ctx.fillRect(32, 96, 32, 32);
    ctx.fillStyle = '#451a03'; ctx.fillRect(64, 96, 32, 32);

    return canvas.toBuffer('image/png');
}

function generateDualGridDirtTileset() {
    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext('2d');

    const grassBg = '#15803d';
    const grassDetail = '#22c55e';
    const dirtDark = '#78350f';
    const dirtFill = '#d97706';
    const dirtDetail = '#b45309';

    ctx.fillStyle = grassBg; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = grassDetail;
    for (let i = 0; i < 90; i++) {
        ctx.fillRect((i * 17) % 125, (i * 23) % 125, 2, 2);
    }

    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            const mask = r * 4 + c;
            const ox = c * 32;
            const oy = r * 32;

            const vTL = (mask & 1) !== 0;
            const vTR = (mask & 2) !== 0;
            const vBL = (mask & 4) !== 0;
            const vBR = (mask & 8) !== 0;

            if (vTL) { ctx.fillStyle = dirtDark; ctx.fillRect(ox, oy, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox, oy, 16, 16); }
            if (vTR) { ctx.fillStyle = dirtDark; ctx.fillRect(ox + 14, oy, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox + 16, oy, 16, 16); }
            if (vBL) { ctx.fillStyle = dirtDark; ctx.fillRect(ox, oy + 14, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox, oy + 16, 16, 16); }
            if (vBR) { ctx.fillStyle = dirtDark; ctx.fillRect(ox + 14, oy + 14, 18, 18); ctx.fillStyle = dirtFill; ctx.fillRect(ox + 16, oy + 16, 16, 16); }

            if (vTL && vTR && vBL && vBR) {
                ctx.fillStyle = dirtDetail;
                ctx.fillRect(ox + 6, oy + 6, 4, 4);
                ctx.fillRect(ox + 20, oy + 18, 4, 4);
                ctx.fillRect(ox + 12, oy + 24, 3, 3);
            }
        }
    }

    return canvas.toBuffer('image/png');
}

fs.writeFileSync(path.join(assetsDir, 'grass_meadow.png'), generateDefaultTileset());
console.log('Saved assets/grass_meadow.png');

fs.writeFileSync(path.join(assetsDir, 'dirt_path.png'), generateDirtPathTileset());
console.log('Saved assets/dirt_path.png');

fs.writeFileSync(path.join(assetsDir, 'dualgrid_dirt.png'), generateDualGridDirtTileset());
console.log('Saved assets/dualgrid_dirt.png');
