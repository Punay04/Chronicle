import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const packages = [
  ["@img/sharp-darwin-x64", "0.33.5"],
  ["@img/sharp-libvips-darwin-x64", "1.0.4"],
  ["@ffmpeg-installer/darwin-x64", "4.1.0"],
];
const staging = mkdtempSync(path.join(os.tmpdir(), "chronicle-native-"));

try {
  for (const [name, version] of packages) {
    const destination = path.resolve("node_modules", ...name.split("/"));
    if (existsSync(path.join(destination, "package.json"))) continue;

    console.log(`[native] staging ${name}@${version}`);
    const result = JSON.parse(
      execFileSync(
        "npm",
        ["pack", `${name}@${version}`, "--json", "--pack-destination", staging],
        { encoding: "utf8" }
      )
    );
    const tarball = path.join(staging, result[0].filename);
    mkdirSync(destination, { recursive: true });
    execFileSync(
      "tar",
      ["-xzf", tarball, "--strip-components", "1", "-C", destination],
      { stdio: "inherit" }
    );
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
