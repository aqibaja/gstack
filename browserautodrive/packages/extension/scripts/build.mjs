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

function createSolidPng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const row = Buffer.alloc(1 + size * 4);
  row[0] = 0;
  for (let pixel = 0; pixel < size; pixel += 1) {
    const offset = 1 + pixel * 4;
    row[offset] = rgba[0];
    row[offset + 1] = rgba[1];
    row[offset + 2] = rgba[2];
    row[offset + 3] = rgba[3];
  }

  const rawImage = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = deflateSync(rawImage);

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

  const palette = {
    16: [15, 23, 42, 255],
    48: [37, 99, 235, 255],
    128: [14, 165, 233, 255],
  };

  for (const [size, color] of Object.entries(palette)) {
    const png = createSolidPng(Number(size), color);
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
