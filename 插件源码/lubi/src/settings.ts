import type { NameUse } from "./core/nameHistory";

export type CategoryKind = "time" | "money";

export interface CategoryDef {
  name: string;
  icon: string; // lucide icon name
  color: string; // css color (prefer Obsidian vars)
  kind: CategoryKind;
  /** 背景时间（如睡眠）：时间轴与图表中以低饱和斜纹降权显示 */
  rest?: boolean;
}

export interface LubiSettings {
  /** Local name recency only; no changes to task or journal schema. */
  nameUses?: NameUse[];
  focusTimer?: import("./core/productivity").TimerSession;
  journalFolder: string;
  taskFile: string;
  backupFolder: string;
  scheduleStartHour: number; // week schedule first hour
  scheduleEndHour: number; // week schedule last hour (exclusive)
  /** Legacy persisted field; completion no longer implicitly logs time. */
  promptLogOnComplete: boolean;
  onboardingDone: boolean;
  categories: CategoryDef[];
  expenseTypes: string[];
  /** 任务页每日负载条的可用小时数 */
  dailyCapacityHours: number;
  /** 默认色板版本：2 = v1.4 避开强调色的色板 */
  paletteVersion: number;
  /** AI 任务解析：OpenAI 兼容的 chat completions 地址 */
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  /** Name of the AI key in Obsidian's keychain (SecretStorage). Only the name is saved; the key stays in the keychain. */
  aiKeySecret: string;
  /** Set once a startup scan finds no legacy journal cards; later startups skip the scan. */
  legacyScanDone: boolean;
}

// v1.4 色板：分类色只给数据用，避开 Obsidian 默认强调色（紫）；睡眠为「背景时间」用石板灰蓝 + 斜纹降权。
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { name: "学习", icon: "book-open", color: "var(--color-blue)", kind: "time" },
  { name: "运动", icon: "dumbbell", color: "var(--color-green)", kind: "time" },
  { name: "睡眠", icon: "moon", color: "#6b7a99", kind: "time", rest: true },
  { name: "饮食", icon: "utensils", color: "var(--color-orange)", kind: "time" },
  { name: "日常", icon: "coffee", color: "#a0856b", kind: "time" },
  { name: "财务", icon: "wallet", color: "var(--color-yellow)", kind: "money" },
];

/** v1.3 及以前的默认色：迁移时只替换仍保持旧默认值的分类，用户自定义过的颜色不动。 */
export const LEGACY_DEFAULT_COLORS: Record<string, string> = {
  睡眠: "var(--color-purple)",
  日常: "var(--color-base-60)",
};

export function migratePalette(settings: LubiSettings): boolean {
  if ((settings.paletteVersion || 1) >= 2) return false;
  let changed = false;
  for (const c of settings.categories) {
    const def = DEFAULT_CATEGORIES.find((d) => d.name === c.name);
    if (!def) continue;
    if (LEGACY_DEFAULT_COLORS[c.name] && c.color === LEGACY_DEFAULT_COLORS[c.name]) {
      c.color = def.color;
      changed = true;
    }
    if (def.rest && c.rest === undefined) {
      c.rest = true;
      changed = true;
    }
  }
  settings.paletteVersion = 2;
  void changed;
  return true;
}

export const DEFAULT_SETTINGS: LubiSettings = {
  journalFolder: "日记",
  taskFile: "任务/任务数据.json",
  backupFolder: "备份",
  scheduleStartHour: 6,
  scheduleEndHour: 24,
  promptLogOnComplete: false,
  onboardingDone: false,
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  expenseTypes: ["餐饮", "居住", "交通", "服饰个护", "休闲娱乐", "医疗保健", "教育提升", "其他"],
  dailyCapacityHours: 8,
  paletteVersion: 2,
  aiEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
  aiModel: "qwen2.5:7b",
  aiApiKey: "",
  aiKeySecret: "",
  legacyScanDone: false,
};

export function categoryOf(settings: LubiSettings, name: string): CategoryDef {
  return (
    settings.categories.find((c) => c.name === name) || {
      name,
      icon: "tag",
      color: "var(--color-base-50)",
      kind: "time",
    }
  );
}

export function timeCategories(settings: LubiSettings): CategoryDef[] {
  return settings.categories.filter((c) => c.kind === "time");
}
