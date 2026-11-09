// Generates the raster icon set from the SVG sources in public/brand.
// Run with: npm run icons   (requires the `sharp` dev dependency)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const brand = join(root, "public", "brand");
const icons = join(root, "public", "icons");
const appDir = join(root, "src", "app");
await mkdir(icons, { recursive: true });

const mark = await readFile(join(brand, "logo-mark.svg"));
const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

// Standard sizes
for (const size of [16, 32, 48, 192, 512]) await writeFile(join(icons, `icon-${size}.png`), await png(mark, size));
await writeFile(join(appDir, "apple-icon.png"), await png(mark, 180));

// Maskable icon: full-bleed background with the mark inside the 80% safe zone.
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1f5fd6"/><g transform="translate(9.6 9.6) scale(0.7)"><g stroke="#fff" stroke-width="4.5" stroke-linecap="round"><path d="M18 18 L46 46 M46 18 L18 46"/></g><g fill="#fff"><circle cx="18" cy="18" r="5.5"/><circle cx="46" cy="18" r="5.5"/><circle cx="18" cy="46" r="5.5"/><circle cx="46" cy="46" r="5.5"/></g><circle cx="32" cy="32" r="7" fill="#ffc83d"/></g></svg>`);
await writeFile(join(icons, "icon-maskable-512.png"), await png(maskable, 512));

// favicon.ico: a multi-size ICO that embeds PNG images (supported by all current browsers).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(mark, s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] % 256, 0); // width
  e.writeUInt8(sizes[i] % 256, 1); // height
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
await writeFile(join(appDir, "favicon.ico"), Buffer.concat([header, ...entries, ...images]));

// Social preview (Open Graph) image
const og = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f6f8fa"/>
  <rect x="0" y="0" width="1200" height="10" fill="#1f5fd6"/>
  <g transform="translate(96 150) scale(3.2)">
    <rect width="64" height="64" rx="14" fill="#1f5fd6"/>
    <g stroke="#fff" stroke-width="4.5" stroke-linecap="round"><path d="M18 18 L46 46 M46 18 L18 46"/></g>
    <g fill="#fff"><circle cx="18" cy="18" r="5.5"/><circle cx="46" cy="18" r="5.5"/><circle cx="18" cy="46" r="5.5"/><circle cx="46" cy="46" r="5.5"/></g>
    <circle cx="32" cy="32" r="7" fill="#ffc83d"/>
  </g>
  <text x="340" y="262" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="84" font-weight="700" fill="#1f2328">Codebase<tspan fill="#1f5fd6">X</tspan>plorer</text>
  <text x="340" y="332" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="36" fill="#59636e">Understand any codebase. Navigate with confidence.</text>
  <text x="96" y="520" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="30" fill="#59636e">Architecture graphs · dependencies · impact analysis · grounded AI answers</text>
</svg>`);
await writeFile(join(brand, "og-image.png"), await sharp(og).png({ compressionLevel: 9 }).toBuffer());

console.log("Icons written to public/icons, public/brand/og-image.png, src/app/apple-icon.png and src/app/favicon.ico");
