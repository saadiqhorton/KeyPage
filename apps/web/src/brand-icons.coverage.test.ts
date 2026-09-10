import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(webRoot, "public");
const indexHtmlPath = path.join(webRoot, "index.html");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]);

const requiredAssets = [
  { name: "favicon.svg", minBytes: 200, magic: Buffer.from("<svg") },
  { name: "favicon.ico", minBytes: 200, magic: ICO_MAGIC },
  { name: "favicon-16x16.png", minBytes: 80, magic: PNG_MAGIC },
  { name: "favicon-32x32.png", minBytes: 80, magic: PNG_MAGIC },
  { name: "apple-touch-icon.png", minBytes: 200, magic: PNG_MAGIC },
  { name: "icon-192.png", minBytes: 200, magic: PNG_MAGIC },
  { name: "icon-512.png", minBytes: 400, magic: PNG_MAGIC },
  { name: "site.webmanifest", minBytes: 80, magic: Buffer.from("{") },
] as const;

describe("branded KeyPage icons", () => {
  it("wires favicon, apple-touch, and manifest in index.html", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");

    assert.match(html, /<meta name="theme-color" content="#07080a" \/>/);
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="48x48" \/>/);
    assert.match(
      html,
      /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/,
    );
    assert.match(
      html,
      /<link rel="icon" href="\/favicon-32x32\.png" type="image\/png" sizes="32x32" \/>/,
    );
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);
    assert.match(html, /<link rel="manifest" href="\/site\.webmanifest" \/>/);
  });

  it("ships non-empty public icon assets with expected headers", () => {
    for (const asset of requiredAssets) {
      const filePath = path.join(publicDir, asset.name);
      const data = fs.readFileSync(filePath);
      assert.ok(data.length >= asset.minBytes, `${asset.name} is too small (${data.length})`);
      assert.ok(
        data.subarray(0, asset.magic.length).equals(asset.magic),
        `${asset.name} has unexpected header`,
      );
    }
  });

  it("keeps the SVG mark on the KeyPage palette", () => {
    const svg = fs.readFileSync(path.join(publicDir, "favicon.svg"), "utf8");
    assert.match(svg, /#0e1014/);
    assert.match(svg, /#c8a24a/);
    assert.match(svg, /aria-label="KeyPage"/);
  });

  it("points the web manifest at the raster icons", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(publicDir, "site.webmanifest"), "utf8"),
    ) as {
      name?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string }>;
      theme_color?: string;
      background_color?: string;
    };

    assert.equal(manifest.name, "KeyPage");
    assert.equal(manifest.theme_color, "#07080a");
    assert.equal(manifest.background_color, "#07080a");
    assert.deepEqual(
      (manifest.icons ?? []).map((icon) => icon.src),
      ["/icon-192.png", "/icon-512.png"],
    );
    for (const icon of manifest.icons ?? []) {
      assert.ok(icon.src && fs.existsSync(path.join(publicDir, path.basename(icon.src))));
    }
  });
});
