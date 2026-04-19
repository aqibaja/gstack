const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const distRoot = path.join(packageRoot, "dist");

const staticFiles = [
  "manifest.json",
  "popup/popup.html",
  "popup/popup.css",
  "content/preview.css",
];

for (const relativePath of staticFiles) {
  const sourcePath = path.join(packageRoot, relativePath);
  const destinationPath = path.join(distRoot, relativePath);

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}
