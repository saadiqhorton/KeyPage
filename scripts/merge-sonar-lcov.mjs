import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_FILE = /\.test\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;

export function rewriteSfPath(sf, packageRoot) {
  let path = sf.trim();
  if (path.startsWith("file://")) {
    path = fileURLToPath(path);
  }
  path = path.replaceAll("\\", "/");
  if (path.startsWith("./")) {
    path = path.slice(2);
  }

  const needle = `/${packageRoot}/`;
  const absoluteIndex = path.indexOf(needle);
  if (absoluteIndex !== -1) {
    return path.slice(absoluteIndex + 1);
  }
  if (path === packageRoot || path.startsWith(`${packageRoot}/`)) {
    return path;
  }
  return `${packageRoot}/${path}`;
}

export function isCoverageSource(path) {
  return !TEST_FILE.test(path);
}

export function mergeLcovReports(reports) {
  const records = [];
  for (const { packageRoot, lcov } of reports) {
    const chunks = lcov.replaceAll("\r\n", "\n").split(/\nend_of_record\n?/);
    for (const chunk of chunks) {
      if (!chunk.trim()) {
        continue;
      }
      const lines = chunk.split("\n");
      const sfIndex = lines.findIndex((line) => line.startsWith("SF:"));
      if (sfIndex === -1) {
        continue;
      }
      const rewritten = rewriteSfPath(lines[sfIndex].slice(3), packageRoot);
      if (!isCoverageSource(rewritten)) {
        continue;
      }
      lines[sfIndex] = `SF:${rewritten}`;
      records.push(`${lines.filter((line) => line.length > 0).join("\n")}\nend_of_record`);
    }
  }
  return records.length === 0 ? "" : `${records.join("\n")}\n`;
}

function parseArgs(argv) {
  let outPath = "";
  const inputs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outPath = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    const split = arg.indexOf(":");
    if (split <= 0) {
      throw new Error(`expected packageRoot:lcovPath, got ${arg}`);
    }
    inputs.push({ packageRoot: arg.slice(0, split), lcovPath: arg.slice(split + 1) });
  }
  if (!outPath) {
    throw new Error("missing --out path");
  }
  return { outPath, inputs };
}

export function mergeLcovFiles(outPath, inputs) {
  const reports = inputs.flatMap(({ packageRoot, lcovPath }) => {
    if (!existsSync(lcovPath)) {
      return [];
    }
    return [{ packageRoot, lcov: readFileSync(lcovPath, "utf8") }];
  });
  const merged = mergeLcovReports(reports);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, merged);
  return merged;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { outPath, inputs } = parseArgs(process.argv.slice(2));
  mergeLcovFiles(outPath, inputs);
}
