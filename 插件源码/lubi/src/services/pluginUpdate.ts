import { requestUrl } from "obsidian";

export const RELEASES_URL = "https://github.com/wilsoncslearn/obsidian_task_kanban/releases";
const RELEASE_API = "https://api.github.com/repos/wilsoncslearn/obsidian_task_kanban/releases/latest";

function versionParts(version: string): number[] {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error("版本号格式无法识别，请到版本发布页手动查看");
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("版本号超出支持范围");
  return parts;
}

export const UPDATE_FILES = ["main.js", "styles.css", "manifest.json"] as const;
export type UpdateFile = typeof UPDATE_FILES[number];
export type ReleaseAsset = { name: UpdateFile; size: number; digest: string; url: string };
export type PluginRelease = { version: string; tag: string; newer: boolean; url: string; assets: ReleaseAsset[]; installError?: string };
export type UpdateResult = PluginRelease | null;

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a), right = versionParts(b);
  const index = left.findIndex((part, i) => part !== right[i]);
  return index < 0 ? 0 : Math.sign(left[index] - right[index]);
}

export function releaseAssets(tag: string, raw: unknown): ReleaseAsset[] {
  versionParts(tag);
  if (!Array.isArray(raw)) throw new Error("发布附件缺失，请使用手动下载");
  return UPDATE_FILES.map((name) => {
    const matches = raw.filter((asset) => asset?.name === name);
    if (matches.length !== 1) throw new Error(`发布附件 ${name} 缺失或重复`);
    const asset = matches[0];
    const url = `${RELEASES_URL}/download/${encodeURIComponent(tag)}/${name}`;
    const limit = name === "manifest.json" ? 32768 : name === "main.js" ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
    if (asset.browser_download_url !== url || asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size < (name === "styles.css" ? 0 : 1) || asset.size > limit || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) {
      throw new Error(`发布附件 ${name} 的地址、大小或 SHA-256 校验信息无效`);
    }
    return { name, size: asset.size, digest: asset.digest, url };
  });
}

export async function updateRequest(url: string, timeout = 15000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      requestUrl({ url, method: "GET", headers: { Accept: "application/vnd.github+json" }, throw: false }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("请求超时，请稍后重试")), timeout); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** User-triggered, public release metadata only; never sends settings or writes Vault files. */
export async function checkPluginUpdate(currentVersion: string): Promise<UpdateResult> {
  versionParts(currentVersion);
  const response = await updateRequest(RELEASE_API);
  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) throw new Error("GitHub 请求受限，请稍后重试或打开版本发布页");
  if (response.status !== 200) throw new Error(`检查失败（HTTP ${response.status}），请稍后重试`);
  const release = response.json;
  if (!release || typeof release.tag_name !== "string" || release.draft !== false || release.prerelease !== false) throw new Error("发布信息无效，请到版本发布页手动查看");
  const version = versionParts(release.tag_name).join(".");
  let assets: ReleaseAsset[] = [], installError: string | undefined;
  try { assets = releaseAssets(release.tag_name, release.assets); }
  catch (error) { installError = (error as Error).message; }
  return { version, tag: release.tag_name, newer: compareVersions(version, currentVersion) > 0,
    url: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`, assets, installError };
}
