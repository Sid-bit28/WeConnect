import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const densities = [
  { name: 'mipmap-mdpi', size: 48, fgSize: 108 },
  { name: 'mipmap-hdpi', size: 72, fgSize: 162 },
  { name: 'mipmap-xhdpi', size: 96, fgSize: 216 },
  { name: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
  { name: 'mipmap-xxxhdpi', size: 192, fgSize: 432 }
];

const svgPath = path.resolve('public/logo.svg');
const resDir = path.resolve('android/app/src/main/res');

async function generate() {
  const svgBuffer = fs.readFileSync(svgPath);

  for (const { name, size, fgSize } of densities) {
    const targetDir = path.join(resDir, name);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 1. ic_launcher.png (square with rounded corners / background #090B10)
    const logoSize = Math.round(size * 0.72);
    const logoPng = await sharp(svgBuffer)
      .resize(logoSize, logoSize)
      .toBuffer();

    const cornerRadius = Math.round(size * 0.2);
    const bgSvg = Buffer.from(`
      <svg width="${size}" height="${size}">
        <rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#090B10" />
      </svg>
    `);

    await sharp(bgSvg)
      .composite([{
        input: logoPng,
        gravity: 'centre'
      }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher.png'));

    // 2. ic_launcher_round.png (circle with background #090B10)
    const roundBgSvg = Buffer.from(`
      <svg width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#090B10" />
      </svg>
    `);

    await sharp(roundBgSvg)
      .composite([{
        input: logoPng,
        gravity: 'centre'
      }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher_round.png'));

    // 3. ic_launcher_foreground.png (transparent background, logo centered within safe zone ~58%)
    const fgLogoSize = Math.round(fgSize * 0.58);
    const fgLogoPng = await sharp(svgBuffer)
      .resize(fgLogoSize, fgLogoSize)
      .toBuffer();

    await sharp({
      create: {
        width: fgSize,
        height: fgSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{
        input: fgLogoPng,
        gravity: 'centre'
      }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

    console.log(`Generated icons for ${name} (${size}x${size}, fg ${fgSize}x${fgSize})`);
  }

  // Update ic_launcher_background.xml
  const bgXmlPath = path.join(resDir, 'values/ic_launcher_background.xml');
  fs.writeFileSync(bgXmlPath, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#090B10</color>
</resources>
`);
  console.log('Updated ic_launcher_background.xml to #090B10');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
