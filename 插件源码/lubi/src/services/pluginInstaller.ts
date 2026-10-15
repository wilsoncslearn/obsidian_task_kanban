import { App, FileSystemAdapter, Platform, PluginManifest, requireApiVersion } from "obsidian";
import { compareVersions, PluginRelease, releaseAssets, UPDATE_FILES, updateRequest } from "./pluginUpdate";

let installing = false;

export function canInstallPluginUpdate(app: App): boolean {
  return Platform.isDesktopApp && app.vault.adapter instanceof FileSystemAdapter;
}

/** Optional desktop path. No Node modules are loaded on mobile; user data is never touched. */
export async function installPluginUpdate(app: App, running: PluginManifest, release: PluginRelease, progress: (text: string) => void): Promise<string> {
  if (!canInstallPluginUpdate(app)) throw new Error("一键安装仅支持桌面本地 Vault，请使用版本发布页手动下载");
  if (installing) throw new Error("已有更新正在安装");
  installing = true;
  try {
    // Obsidian loads CommonJS through a function wrapper: use its local require,
    // not browser dynamic import("node:..."). These calls stay in the desktop branch.
    const fs = (require("node:fs") as typeof import("node:fs")).promises;
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const hash = (bytes: Uint8Array) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    const inside = (parent: string, child: string) => {
      const relative = path.relative(parent, child);
      return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
    };
    const vaultRoot = await fs.realpath((app.vault.adapter as FileSystemAdapter).getBasePath());
    const expected = path.resolve(vaultRoot, app.vault.configDir, "plugins", "lubi");
    if (running.id !== "lubi" || !running.dir || path.resolve(vaultRoot, running.dir) !== expected || !inside(vaultRoot, expected)) throw new Error("插件安装路径不符合预期，已拒绝更新");
    const pluginDir = await fs.realpath(expected);
    if (pluginDir !== expected || !inside(vaultRoot, pluginDir)) throw new Error("不支持符号链接插件目录，已拒绝更新");
    if (compareVersions(release.version, running.version) <= 0) throw new Error("不能安装相同或更低版本");
    // Revalidate even when called directly, not only through the settings check.
    if (compareVersions(release.tag, release.version) !== 0 || release.installError) throw new Error("发布版本或附件信息无效");
    const assets = releaseAssets(release.tag, release.assets.map((a) => ({ ...a, state: "uploaded", browser_download_url: a.url })));
    const original = new Map<string, Buffer>(), downloaded = new Map<string, Buffer>();
    for (const name of UPDATE_FILES) {
      const file = path.join(pluginDir, name), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`不支持特殊插件文件 ${name}`);
      original.set(name, await fs.readFile(file));
    }
    const diskManifest = JSON.parse(original.get("manifest.json")!.toString("utf8"));
    if (diskManifest.id !== "lubi" || diskManifest.version !== running.version) throw new Error("磁盘插件版本与运行版本不同，请先重启 Obsidian");
    const stage = path.join(pluginDir, ".lubi-update");
    try { await fs.mkdir(stage); } catch { throw new Error("无法创建更新暂存目录；可能有未完成更新，请检查 .lubi-update 后手动恢复"); }
    let backup = "", keepStage = false;
    const changed: string[] = [];
    try {
      for (const asset of assets) {
        progress(`正在下载并校验 ${asset.name}…`);
        const response = await updateRequest(asset.url, 60000);
        if (response.status !== 200) throw new Error(`下载 ${asset.name} 失败（HTTP ${response.status}）`);
        const bytes = Buffer.from(response.arrayBuffer);
        if (bytes.length !== asset.size || hash(bytes) !== asset.digest) throw new Error(`${asset.name} 大小或 SHA-256 校验失败`);
        // Fail closed on non-UTF-8 release files; never execute downloaded code during validation.
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        downloaded.set(asset.name, bytes);
      }
      const manifest = JSON.parse(downloaded.get("manifest.json")!.toString("utf8"));
      if (manifest.id !== "lubi" || manifest.version !== release.version || typeof manifest.minAppVersion !== "string" || typeof manifest.isDesktopOnly !== "boolean") throw new Error("发布 manifest 与插件 ID 或版本不匹配");
      compareVersions(manifest.minAppVersion, manifest.minAppVersion);
      if (!requireApiVersion(manifest.minAppVersion)) throw new Error(`新版需要 Obsidian ≥ ${manifest.minAppVersion}，请先升级 Obsidian`);
      progress("正在备份旧插件文件…");
      const backupRoot = path.resolve(os.tmpdir(), "Lubi-plugin-backups");
      if (backupRoot === vaultRoot || inside(vaultRoot, backupRoot)) throw new Error("备份目录位于 Vault 内，已拒绝安装");
      await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
      const actualBackupRoot = await fs.realpath(backupRoot);
      if (actualBackupRoot === vaultRoot || inside(vaultRoot, actualBackupRoot)) throw new Error("备份真实路径位于 Vault 内，已拒绝安装");
      backup = await fs.mkdtemp(path.join(actualBackupRoot, "lubi-"));
      for (const name of UPDATE_FILES) {
        await fs.writeFile(path.join(backup, name), original.get(name)!, { flag: "wx", mode: 0o600 });
        if (hash(await fs.readFile(path.join(backup, name))) !== hash(original.get(name)!)) throw new Error(`备份 ${name} 校验失败`);
        await fs.writeFile(path.join(stage, name), downloaded.get(name)!, { flag: "wx" });
      }
      const recovery = { pluginDir, backup, oldVersion: running.version, newVersion: release.version, files: UPDATE_FILES };
      await fs.writeFile(path.join(backup, "recovery.json"), JSON.stringify(recovery, null, 2), { flag: "wx", mode: 0o600 });
      await fs.writeFile(path.join(stage, "recovery.json"), JSON.stringify(recovery), { flag: "wx" });
      progress("正在安装更新；请勿关闭 Obsidian…");
      // All originals must still match after downloads and backup; manifest is installed last.
      for (const name of UPDATE_FILES) if (hash(await fs.readFile(path.join(pluginDir, name))) !== hash(original.get(name)!)) throw new Error(`插件文件 ${name} 被外部修改，已取消安装`);
      for (const name of UPDATE_FILES) {
        const target = path.join(pluginDir, name);
        if (hash(await fs.readFile(target)) !== hash(original.get(name)!)) throw new Error(`插件文件 ${name} 被外部修改，已停止安装`);
        changed.push(name); // Reconcile even an ambiguous rename failure during rollback.
        await fs.rename(path.join(stage, name), target);
      }
      for (const name of UPDATE_FILES) if (hash(await fs.readFile(path.join(pluginDir, name))) !== hash(downloaded.get(name)!)) throw new Error(`安装后 ${name} 校验失败`);
      return backup;
    } catch (error) {
      const failures: string[] = [];
      for (const name of [...changed].reverse()) {
        try {
          const target = path.join(pluginDir, name), current = hash(await fs.readFile(target));
          if (current === hash(original.get(name)!)) continue;
          if (current !== hash(downloaded.get(name)!)) throw new Error("出现外部修改，未覆盖");
          const saved = await fs.readFile(path.join(backup, name));
          if (hash(saved) !== hash(original.get(name)!)) throw new Error("备份校验失败");
          const restore = path.join(stage, `restore-${name}`);
          await fs.writeFile(restore, saved, { flag: "wx" });
          await fs.rename(restore, target);
          if (hash(await fs.readFile(target)) !== hash(original.get(name)!)) throw new Error("回滚校验失败");
        } catch (rollbackError) { failures.push(`${name}：${(rollbackError as Error).message}`); }
      }
      keepStage = failures.length > 0;
      const outcome = failures.length ? `回滚未完成（${failures.join("；")}），请勿重启，先从备份恢复：${backup}` : changed.length ? `已恢复旧版本。备份：${backup}` : `未替换插件文件${backup ? `。备份：${backup}` : ""}`;
      throw new Error(`更新失败：${(error as Error).message}。${outcome}`);
    } finally {
      if (!keepStage) {
        // Only remove our known files, never recursively delete an unchecked tree.
        for (const name of [...UPDATE_FILES, "recovery.json", ...UPDATE_FILES.map((n) => `restore-${n}`)]) {
          try { await fs.unlink(path.join(stage, name)); } catch { /* Missing/still-held files keep the lock visible for manual recovery. */ }
        }
        try { await fs.rmdir(stage); } catch { /* Do not touch unexpected files. */ }
      }
    }
  } finally { installing = false; }
}
