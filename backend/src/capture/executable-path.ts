import fs from "fs";
import path from "path";

/**
 * Native package executables are unpacked by electron-builder, while their
 * JavaScript launchers still resolve paths relative to app.asar.
 */
export function resolvePackagedExecutable(executablePath: string): string {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!executablePath.includes(asarSegment)) return executablePath;

  const unpackedPath = executablePath.replace(
    asarSegment,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  return fs.existsSync(unpackedPath) ? unpackedPath : executablePath;
}
