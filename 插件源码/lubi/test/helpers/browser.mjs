// Find a Chromium-family browser for the layout tests.
// LUBI_BROWSER overrides the search; otherwise common Chrome / Edge / Chromium paths on Windows, Linux and macOS are tried.
import { existsSync } from "node:fs";

const candidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findBrowser() {
  return [process.env.LUBI_BROWSER, ...candidates].find((candidate) => candidate && existsSync(candidate));
}
