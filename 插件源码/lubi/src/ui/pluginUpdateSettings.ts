import { App, PluginManifest, Setting } from "obsidian";
import { checkPluginUpdate, compareVersions, RELEASES_URL, UpdateResult } from "../services/pluginUpdate";
import { canInstallPluginUpdate, installPluginUpdate } from "../services/pluginInstaller";
import { ConfirmModal } from "./modals";

export type PluginUpdateState = { busy: boolean; confirming: boolean; status: string; release?: UpdateResult; installedVersion?: string; refresh?: () => void };

export function renderPluginUpdate(host: HTMLElement, app: App, manifest: PluginManifest, state: PluginUpdateState): void {
  const setting = new Setting(host).setName(`当前运行版本：${manifest.version}`)
    .setDesc("检查 GitHub 正式版本；桌面端确认后可一键安装，更新完成后重启 Obsidian 生效。");
  const status = host.createEl("p", { cls: "lubi-settings-note", attr: { role: "status", "aria-live": "polite", "data-lubi-update-status": "" } });
  const link = host.createEl("a", { text: "版本发布页", cls: "external-link", href: RELEASES_URL,
    attr: { target: "_blank", rel: "noopener noreferrer", "data-lubi-update-link": "" } });
  let check!: HTMLButtonElement, install!: HTMLButtonElement;
  const refresh = () => {
    status.setText(state.status);
    check.disabled = state.busy || state.confirming || !!state.installedVersion;
    check.setText(state.busy ? "处理中…" : "检查更新");
    const available = !!state.release?.newer && !state.release.installError && canInstallPluginUpdate(app) && !state.installedVersion;
    install.hidden = !available;
    install.disabled = state.busy || state.confirming;
    install.setText(state.busy ? "处理中…" : `更新至 ${state.release?.version ?? "新版"}`);
    link.href = state.release?.newer ? state.release.url : RELEASES_URL;
    link.setText(state.release?.newer ? `手动下载 ${state.release.version}` : "版本发布页");
  };
  const show = (text: string) => { state.status = text; state.refresh?.(); };
  const installConfirmed = async () => {
    const release = state.release;
    if (state.busy || state.installedVersion || !release?.newer) return;
    state.busy = true;
    state.refresh?.();
    try {
      const backup = await installPluginUpdate(app, manifest, release, show);
      state.installedVersion = release.version;
      show(`已安装 ${release.version}，当前仍运行 ${manifest.version}；请重启 Obsidian 生效。旧文件备份：${backup}。保留了 data.json、任务及日记。`);
    } catch (error) { show(error instanceof Error ? error.message : "更新失败，请检查备份后重试"); }
    finally { state.busy = false; state.refresh?.(); }
  };
  setting.addButton((button) => {
    check = button.buttonEl;
    check.setAttribute("data-lubi-update", "");
    button.onClick(async () => {
      if (state.busy || state.confirming || state.installedVersion) return;
      state.busy = true;
      state.release = undefined;
      show("正在检查 GitHub 正式版本…");
      try {
        const result = await checkPluginUpdate(manifest.version);
        state.release = result;
        if (!result) show("找不到公开的正式版本：发布仓库可能是私有的，或者还没有发布。源码提交不代表已发布更新。");
        else if (!result.newer) show(compareVersions(manifest.version, result.version) > 0
          ? `无需更新：本地 ${manifest.version} 比最新正式发布 ${result.version} 更新，不会降级。`
          : `无需更新：当前 ${manifest.version} 已是最新正式版本。`);
        else show(`发现新版本 ${result.version}。保留 data.json、任务和日记；安装前校验最低 Obsidian 版本要求和 SHA-256，旧文件备份到 Vault 外，失败时回滚。${result.installError ? ` ${result.installError}，请手动下载。` : !canInstallPluginUpdate(app) ? " 当前环境不支持一键安装，请手动下载。" : " 点击更新并确认即可安装，安装后重启生效。"}`);
      } catch (error) { show(`检查更新失败：${error instanceof Error ? error.message : "网络异常，请稍后重试"}`); }
      finally { state.busy = false; state.refresh?.(); }
    });
  });
  setting.addButton((button) => {
    install = button.buttonEl;
    install.setAttribute("data-lubi-install", "");
    button.onClick(() => {
      if (state.busy || state.confirming || state.installedVersion || !state.release?.newer || state.release.installError || !canInstallPluginUpdate(app)) return;
      state.confirming = true;
      state.refresh?.();
      const modal = new ConfirmModal(app, `更新 Lubi 至 ${state.release.version}`, "将从 GitHub 下载并校验发布附件，先在 Vault 外备份旧文件，再替换 main.js、styles.css、manifest.json。不会删除 data.json 或改写任务、日记。请暂停其他插件更新操作；安装后需重启 Obsidian 生效。是否继续？", () => void installConfirmed(), "确认更新", false);
      modal.onClose = () => { state.confirming = false; state.refresh?.(); };
      modal.open();
    });
  });
  state.refresh = refresh;
  refresh();
}
