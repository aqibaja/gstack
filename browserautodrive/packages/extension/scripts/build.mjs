import { build, context } from "esbuild";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const packageRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(packageRoot, "dist");
const isWatchMode = process.argv.includes("--watch");

const entryPoints = [
  {
    entry: path.join(packageRoot, "background/service-worker.ts"),
    outdir: path.join(distRoot, "background"),
    format: "esm",
  },
  {
    entry: path.join(packageRoot, "content/preview.ts"),
    outdir: path.join(distRoot, "content"),
    format: "iife",
  },
  {
    entry: path.join(packageRoot, "content/dom-observer.ts"),
    outdir: path.join(distRoot, "content"),
    format: "iife",
  },
  {
    entry: path.join(packageRoot, "content/action-executor.ts"),
    outdir: path.join(distRoot, "content"),
    format: "iife",
  },
];

const staticFiles = [
  "manifest.json",
  "content/preview.css",
  "options/options.html",
  "options/options.css",
  "options/options.js",
];

const manifestPath = path.join(packageRoot, "manifest.json");

function log(message) {
  console.log(`[extension-build] ${message}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyStaticAssets() {
  for (const relativePath of staticFiles) {
    const sourcePath = path.join(packageRoot, relativePath);
    const destinationPath = path.join(distRoot, relativePath);

    ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(from, to, t) {
  return [
    Math.round(lerp(from[0], to[0], t)),
    Math.round(lerp(from[1], to[1], t)),
    Math.round(lerp(from[2], to[2], t)),
    Math.round(lerp(from[3], to[3], t)),
  ];
}

function createImage(size) {
  return Buffer.alloc(size * size * 4);
}

function blendPixel(pixels, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const offset = (y * size + x) * 4;
  const srcAlpha = clamp((rgba[3] ?? 255) / 255, 0, 1);
  const dstAlpha = pixels[offset + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);

  if (outAlpha === 0) {
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 0;
    return;
  }

  const srcWeight = srcAlpha / outAlpha;
  const dstWeight = (dstAlpha * (1 - srcAlpha)) / outAlpha;

  pixels[offset] = Math.round(rgba[0] * srcWeight + pixels[offset] * dstWeight);
  pixels[offset + 1] = Math.round(rgba[1] * srcWeight + pixels[offset + 1] * dstWeight);
  pixels[offset + 2] = Math.round(rgba[2] * srcWeight + pixels[offset + 2] * dstWeight);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function fillCircle(pixels, size, centerX, centerY, radius, rgba) {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(size - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(size - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        blendPixel(pixels, size, x, y, rgba);
      }
    }
  }
}

function pointInRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  const innerLeft = left + radius;
  const innerRight = right - radius;
  const innerTop = top + radius;
  const innerBottom = bottom - radius;

  if (x >= innerLeft && x < innerRight && y >= top && y < bottom) {
    return true;
  }

  if (x >= left && x < right && y >= innerTop && y < innerBottom) {
    return true;
  }

  const cornerX = x < innerLeft ? innerLeft : innerRight;
  const cornerY = y < innerTop ? innerTop : innerBottom;
  const dx = x + 0.5 - cornerX;
  const dy = y + 0.5 - cornerY;

  return dx * dx + dy * dy <= radius * radius;
}

function fillRoundedRect(pixels, size, left, top, width, height, radius, rgba) {
  const minX = Math.max(0, Math.floor(left));
  const maxX = Math.min(size - 1, Math.ceil(left + width) - 1);
  const minY = Math.max(0, Math.floor(top));
  const maxY = Math.min(size - 1, Math.ceil(top + height) - 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInRoundedRect(x, y, left, top, width, height, radius)) {
        blendPixel(pixels, size, x, y, rgba);
      }
    }
  }
}

function drawLine(pixels, size, x0, y0, x1, y1, thickness, rgba) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
  const radius = thickness / 2;

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    fillCircle(pixels, size, lerp(x0, x1, t), lerp(y0, y1, t), radius, rgba);
  }
}

function drawBrandIcon(size) {
  const pixels = createImage(size);
  const slate = [15, 23, 42, 255];
  const deepSlate = [30, 41, 59, 255];
  const amber = [249, 115, 22, 255];
  const gold = [251, 191, 36, 255];
  const ivory = [255, 247, 237, 255];
  const border = [251, 146, 60, 255];
  const shadow = [15, 23, 42, 72];
  const panel = [248, 250, 252, 255];
  const rail = [30, 41, 59, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = size === 1 ? 0 : x / (size - 1);
      const ny = size === 1 ? 0 : y / (size - 1);
      const diagonal = clamp((nx * 0.7 + ny * 0.9) / 1.6, 0, 1);
      let color = lerpColor(slate, deepSlate, diagonal);
      const glow = Math.max(0, 1 - Math.hypot(nx - 0.18, ny - 0.18) * 2.5);
      color = lerpColor(color, amber, glow * 0.34);
      const highlight = Math.max(0, 1 - Math.hypot(nx - 0.78, ny - 0.26) * 2.8);
      color = lerpColor(color, gold, highlight * 0.18);
      blendPixel(pixels, size, x, y, color);
    }
  }

  const margin = size * 0.16;
  const panelX = margin;
  const panelY = size * 0.2;
  const panelW = size - margin * 2;
  const panelH = size * 0.56;
  const radius = Math.max(2, Math.round(size * 0.13));

  fillRoundedRect(pixels, size, panelX + size * 0.02, panelY + size * 0.03, panelW, panelH, radius, shadow);
  fillRoundedRect(pixels, size, panelX, panelY, panelW, panelH, radius, border);
  fillRoundedRect(pixels, size, panelX + size * 0.02, panelY + size * 0.02, panelW - size * 0.04, panelH - size * 0.04, Math.max(1, radius - 1), panel);

  const railH = Math.max(2, Math.round(size * 0.12));
  fillRoundedRect(pixels, size, panelX + size * 0.03, panelY + size * 0.04, panelW - size * 0.06, railH, Math.max(1, Math.round(railH / 2)), rail);

  const dotY = panelY + size * 0.1;
  const dotR = Math.max(1, size * 0.02);
  fillCircle(pixels, size, panelX + size * 0.08, dotY, dotR, [251, 146, 60, 255]);
  fillCircle(pixels, size, panelX + size * 0.13, dotY, dotR, [251, 191, 36, 255]);
  fillCircle(pixels, size, panelX + size * 0.18, dotY, dotR, [248, 250, 252, 255]);

  const arrowStartX = panelX + panelW * 0.28;
  const arrowStartY = panelY + panelH * 0.72;
  const arrowEndX = panelX + panelW * 0.74;
  const arrowEndY = panelY + panelH * 0.32;
  const thickness = Math.max(2, size * 0.09);
  drawLine(pixels, size, arrowStartX, arrowStartY, arrowEndX, arrowEndY, thickness, gold);
  drawLine(pixels, size, arrowEndX, arrowEndY, arrowEndX - size * 0.13, arrowEndY - size * 0.02, thickness, gold);
  drawLine(pixels, size, arrowEndX, arrowEndY, arrowEndX - size * 0.02, arrowEndY + size * 0.13, thickness, gold);

  return pixels;
}

function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    pixels.copy(row, 1, y * size * 4, (y + 1) * size * 4);
    rows.push(row);
  }

  const idat = deflateSync(Buffer.concat(rows));

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function stageIcons() {
  const iconsDir = path.join(distRoot, "icons");
  ensureDir(iconsDir);

  for (const size of [16, 48, 128]) {
    const pixels = drawBrandIcon(size);
    const png = encodePng(size, pixels);
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  }
}

function verifyManifestOutputs() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const requiredPaths = new Set(["manifest.json"]);

  if (manifest.background?.service_worker) {
    requiredPaths.add(manifest.background.service_worker);
  }

  for (const contentScript of manifest.content_scripts || []) {
    for (const scriptPath of contentScript.js || []) {
      requiredPaths.add(scriptPath);
    }
    for (const cssPath of contentScript.css || []) {
      requiredPaths.add(cssPath);
    }
  }

  for (const iconPath of Object.values(manifest.icons || {})) {
    requiredPaths.add(iconPath);
  }

  for (const iconPath of Object.values(manifest.action?.default_icon || {})) {
    requiredPaths.add(iconPath);
  }

  const missing = Array.from(requiredPaths).filter((relativePath) => {
    return !fs.existsSync(path.join(distRoot, relativePath));
  });

  if (missing.length > 0) {
    throw new Error(`Missing extension artifacts:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
}

async function rebuildStaticAssets() {
  copyStaticAssets();
  stageIcons();
  verifyManifestOutputs();
  log("static assets staged");
}

async function bundleAll() {
  await Promise.all(
    entryPoints.map(({ entry, outdir, format }) =>
      build({
        absWorkingDir: packageRoot,
        bundle: true,
        entryPoints: [entry],
        format,
        logLevel: "silent",
        outdir,
        platform: "browser",
        sourcemap: true,
        target: ["chrome120"],
      })
    )
  );
}

async function runBuild() {
  removeDir(distRoot);
  ensureDir(distRoot);
  await bundleAll();
  await rebuildStaticAssets();
  log(`build complete at ${distRoot}`);
}

function watchStaticPaths(onChange) {
  const watchTargets = [
    packageRoot,
    path.join(packageRoot, "popup"),
    path.join(packageRoot, "content"),
  ];

  const watchers = watchTargets.map((target) =>
    fs.watch(target, (eventType, filename) => {
      if (!filename) return;
      if (!staticFiles.some((file) => file === filename || file.endsWith(`/${filename}`))) return;
      log(`static change detected (${eventType}: ${filename})`);
      onChange().catch((error) => {
        console.error(`[extension-build] static rebuild failed\n${error.stack || error.message}`);
      });
    })
  );

  return () => watchers.forEach((watcher) => watcher.close());
}

async function runWatch() {
  removeDir(distRoot);
  ensureDir(distRoot);

  const contexts = await Promise.all(
    entryPoints.map(({ entry, outdir, format }) =>
      context({
        absWorkingDir: packageRoot,
        bundle: true,
        entryPoints: [entry],
        format,
        logLevel: "silent",
        outdir,
        platform: "browser",
        sourcemap: true,
        target: ["chrome120"],
        plugins: [
          {
            name: "extension-rebuild-logger",
            setup(buildContext) {
              buildContext.onEnd(async (result) => {
                if (result.errors.length > 0) {
                  console.error("[extension-build] bundle failed");
                  for (const error of result.errors) {
                    console.error(error.text);
                  }
                  return;
                }

                try {
                  await rebuildStaticAssets();
                  log("rebuild complete, reload the unpacked extension");
                } catch (error) {
                  console.error(`[extension-build] verification failed\n${error.stack || error.message}`);
                }
              });
            },
          },
        ],
      })
    )
  );

  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  await rebuildStaticAssets();
  log("watch mode active");

  const closeStaticWatchers = watchStaticPaths(rebuildStaticAssets);
  const shutdown = async () => {
    closeStaticWatchers();
    await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  if (isWatchMode) {
    await runWatch();
  } else {
    await runBuild();
  }
} catch (error) {
  console.error(`[extension-build] ${error.stack || error.message}`);
  if (!isWatchMode) {
    process.exit(1);
  }
}
