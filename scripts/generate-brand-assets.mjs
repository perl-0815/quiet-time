import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Optional authoring tool. The generated files are committed; builds do not run
// Chromium or need fonts. For matching typography, regenerate on macOS.
const root = fileURLToPath(new URL("../", import.meta.url));
const icons = path.join(root, "public/icons");
await mkdir(icons, { recursive: true });

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#f8f7f4"/>
  <circle cx="16" cy="16" r="10.7" fill="none" stroke="#596551" stroke-width="2.1"/>
  <path d="M16 9v7l5 3" fill="none" stroke="#596551" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
await writeFile(path.join(icons, "favicon.svg"), favicon);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; margin: 0; }
      body { background: #f8f7f4; color: #353d32; -webkit-font-smoothing: antialiased; }
      main { width: 1200px; height: 630px; position: relative; overflow: hidden; }
      .frame { position: absolute; inset: 28px; border: 1px solid #dfe2d7; }
      .text { position: absolute; left: 100px; top: 215px; }
      h1 { font-family: Georgia, "Times New Roman", serif; font-size: 104px; line-height: 1.15; font-weight: 400; letter-spacing: -.045em; margin: 0 0 24px; }
      p { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; font-size: 28px; line-height: 1.9; letter-spacing: .055em; font-weight: 300; margin: 0; color: #697160; }
      .dial { position: absolute; left: 756px; top: 140px; width: 350px; height: 350px; }
    </style></head><body><main>
      <div class="frame"></div>
      <div class="text"><h1>QuietTime</h1><p>デトックス時間</p></div>
      <svg class="dial" viewBox="0 0 350 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="175" cy="175" r="166" fill="#f0f2eb"/>
        <circle cx="175" cy="175" r="141" fill="none" stroke="#74826a" stroke-width="3"/>
        <g stroke="#bcc5b4" stroke-width="2.5" stroke-linecap="round">
          <path d="M175 46v9 M304 175h-9 M175 304v-9 M46 175h9"/>
        </g>
        <path d="M175 96v79l66 38" fill="none" stroke="#74826a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="175" cy="175" r="5" fill="#74826a"/>
      </svg>
    </main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "src/app/opengraph-image.png") });
  await writeFile(
    path.join(root, "src/app/opengraph-image.alt.txt"),
    "QuietTime — デトックス時間。淡い背景に時計のシンボル。\n",
  );

  // ICO embeds three real raster sizes so small browser tabs use an appropriate
  // drawing rather than downscaling the padded PWA home-screen icon.
  const sizes = [16, 32, 48];
  const images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><head><style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style></head><body>${favicon}</body></html>`);
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(path.join(icons, `favicon-${size}.png`), png);
    images.push(png);
  }
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  for (let i = 0; i < images.length; i++) {
    const entry = 6 + 16 * i;
    directory.writeUInt8(sizes[i], entry);
    directory.writeUInt8(sizes[i], entry + 1);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[i].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  }
  await writeFile(path.join(root, "src/app/favicon.ico"), Buffer.concat([directory, ...images]));
  console.log("Generated OG image (1200×630), favicon SVG/PNG, and ICO (16/32/48).");
} finally {
  await browser.close();
}
