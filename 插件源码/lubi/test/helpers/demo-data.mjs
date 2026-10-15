// 演示数据：用于 README / 教学手册截图与布局回归（test/helpers/preview.mjs）。
// 纯合成、可复现（固定随机种子），不含任何真实个人记录。
// 用法：const { journals, tasks } = demoData(new Date());

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dur = (min) => (min % 60 === 0 ? `${min / 60}h` : min > 90 && (min % 30 === 0) ? `${min / 60}h` : `${min}min`);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STUDY_AM = ["线性代数 第 4 章", "英语精读", "算法题 × 3", "概率论习题", "论文精读", "单词复习"];
const STUDY_PM = ["读《原则》", "整理笔记", "编程练习", "网课：机器学习", "写读书笔记", "错题整理"];
const SPORT = ["跑步 5 公里", "健身", "游泳", "羽毛球", "瑜伽"];
const EVENING = [["学习", "复盘今天"], ["日常", "家务"], ["学习", "阅读"], ["日常", "和朋友视频"], ["学习", "背单词"]];
const LUNCH_SPEND = [22, 25, 28, 32, 35, 18];

/** 生成 today 之前约 120 天的日记（越近越完整），外加今天到 nowMin 为止的记录 */
export function demoData(today = new Date(), nowMin = today.getHours() * 60 + today.getMinutes()) {
  const r = rng(20260926);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const jitter = (base, span = 20) => base + Math.round(((r() - 0.5) * span) / 5) * 5;
  const journals = new Map();
  const line = (s, e, cat, title, extra = "") => `${hm(s)}–${hm(e)} ${cat} · ${title} [时长:: ${dur(e - s)}]${extra}`;

  for (let back = 120; back >= 1; back--) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    // 越早的日子越容易漏记：模拟逐渐养成习惯
    const skip = back > 60 ? 0.45 : back > 21 ? 0.2 : 0.04;
    if (r() < skip) continue;
    const sparse = back > 60 && r() < 0.5; // 早期很多天只记了几条
    const recs = [];
    const wake = jitter(430, 40);
    recs.push(line(jitter(5, 10), wake, "睡眠", "睡觉"));
    const bf = wake + jitter(20, 10);
    recs.push(line(bf, bf + 25, "饮食", "早饭"));
    const am = Math.max(bf + 40, jitter(510, 20));
    const amEnd = am + (sparse ? 60 : jitter(180, 60));
    recs.push(line(am, amEnd, "学习", pick(STUDY_AM)));
    if (!sparse && r() < 0.15) recs.push(line(am + 60, am + 90, "日常", "接电话"));
    const lunch = jitter(725, 20);
    recs.push(line(lunch, lunch + 40, "饮食", "午饭"));
    if (r() < 0.8) recs.push(`${hm(lunch + 5)} 财务 · 午饭 [金额:: ${pick(LUNCH_SPEND)}] [类别:: 餐饮]`);
    if (!sparse) {
      const pm = jitter(840, 30);
      recs.push(line(pm, pm + jitter(150, 60), "学习", pick(STUDY_PM)));
      if (r() < 0.6) { const sp = jitter(1050, 30); recs.push(line(sp, sp + jitter(55, 20), "运动", pick(SPORT))); }
      const dn = jitter(1120, 20);
      recs.push(line(dn, dn + 35, "饮食", "晚饭"));
      if (r() < 0.25) recs.push(`${hm(dn + 50)} 财务 · ${pick(["地铁", "打车", "买书", "水果", "咖啡"])} [金额:: ${Math.round(8 + r() * 60)}] [类别:: ${pick(["交通", "教育提升", "餐饮", "休闲娱乐"])}]`);
      const [ec, et] = pick(EVENING);
      const ev = jitter(1180, 20);
      recs.push(line(ev, ev + jitter(90, 40), ec, et));
      recs.push(line(1335, 1360, "日常", "洗漱"));
    }
    journals.set(iso(d), recs);
  }

  // 今天：留出 11:00–12:00 的空白用来演示「补记空白」
  const T = iso(today);
  const todayRecs = [
    [10, 435, "睡眠", "睡觉"],
    [455, 480, "饮食", "早饭"],
    [510, 660, "学习", "线性代数 第 4 章", " [任务:: demo-la] [备注:: 完成 4.1–4.3]"],
    [570, 600, "日常", "接电话"],
    [725, 765, "饮食", "午饭"],
    // 在任务页勾选完成时按计划自动记下的一条：「待确认」（虚线 + 徽标）
    [790, 820, "学习", "单词复习", " [任务:: demo-vocab] [待确认:: 按计划]"],
    [800, 890, "学习", "读《原则》"],
    [900, 915, "日常", "收拾桌面"],
  ].filter(([, e]) => e <= nowMin).map(([s, e, c, t, x = ""]) => line(s, e, c, t, x));
  if (nowMin >= 730) todayRecs.push(`12:10 财务 · 午饭 [金额:: 28] [类别:: 餐饮]`);
  journals.set(T, todayRecs);

  const day = (off) => { const d = new Date(today); d.setDate(d.getDate() + off); return iso(d); };
  const dow = (today.getDay() + 6) % 7; // 0 = 周一
  const task = (o) => ({ parent: null, status: "todo", blocked: false, date: "", start: "", estimate: 0, repeat: { kind: "none", days: [] }, doneDates: [], startDate: "", endDate: "", notes: "", order: 0, category: "学习", ...o });
  const tasks = [
    // 今天
    task({ id: "demo-la", title: "线性代数 第 4 章", date: T, start: "08:30", estimate: 150, status: "doing", order: 0, parent: "demo-p1" }),
    task({ id: "demo-run", title: "跑步 5 公里", category: "运动", start: "18:00", estimate: 45, repeat: { kind: "weekly", days: [1, 3, 6] }, order: 1 }),
    task({ id: "demo-notes", title: "整理本周笔记", date: T, estimate: 30, order: 2 }),
    // 每日页「计划」列：已过点未记（标橙）+ 稍后的计划；已勾选完成（记录待确认）
    task({ id: "demo-mail", title: "回复导师邮件", category: "日常", date: T, start: "13:45", estimate: 15, order: 2.1 }),
    task({ id: "demo-listen", title: "英语听力", date: T, start: "16:00", estimate: 60, order: 2.2 }),
    task({ id: "demo-vocab", title: "单词复习", date: T, start: "13:10", estimate: 30, status: "done", order: 2.3 }),
    // 项目 1：期末复习
    task({ id: "demo-p1", title: "期末复习", startDate: day(-dow - 7), endDate: day(14), order: 3 }),
    task({ id: "demo-p1a", title: "高数 · 极限与导数", parent: "demo-p1", date: day(-dow), start: "09:00", estimate: 120, status: "done", order: 0 }),
    task({ id: "demo-p1b", title: "概率论 第 1–3 章", parent: "demo-p1", date: day(1), start: "09:00", estimate: 180, order: 2 }),
    task({ id: "demo-p1c", title: "英语作文 2 篇", parent: "demo-p1", date: day(1), start: "14:00", estimate: 120, order: 3 }),
    task({ id: "demo-p1d", title: "错题回顾", parent: "demo-p1", date: day(1), start: "19:30", estimate: 150, order: 4 }),
    task({ id: "demo-p1e", title: "模拟考", parent: "demo-p1", date: day(6), start: "09:00", estimate: 180, order: 5 }),
    // 项目 2：读完《原则》
    task({ id: "demo-p2", title: "读完《原则》", category: "学习", order: 4 }),
    task({ id: "demo-p2a", title: "第一部分", parent: "demo-p2", date: day(-dow + 1), estimate: 90, status: "done", order: 0 }),
    task({ id: "demo-p2b", title: "第二部分", parent: "demo-p2", date: day(-dow + 3), start: "20:00", estimate: 90, status: "done", order: 1 }),
    task({ id: "demo-p2c", title: "第三部分 + 读书笔记", parent: "demo-p2", date: day(3), estimate: 120, order: 2 }),
    // 本周已完成的日程
    task({ id: "demo-w1", title: "论文精读", date: day(-dow + 1), start: "14:00", estimate: 120, status: "done", order: 5 }),
    task({ id: "demo-w2", title: "组会汇报", category: "日常", date: day(-dow + 2), start: "10:00", estimate: 60, status: "done", order: 6 }),
    task({ id: "demo-w3", title: "网课：机器学习", date: day(-dow + 4), start: "15:00", estimate: 90, status: "done", order: 7 }),
    // 未安排
    task({ id: "demo-milk", title: "买牛奶", category: "日常", order: 8 }),
    task({ id: "demo-doctor", title: "预约体检", category: "日常", order: 9 }),
  ];
  return { journals, tasks, today: T };
}

/** 把演示数据写进 mock vault */
export function seedVault(vault, data) {
  const doc = (date, recs) => `---\ndate: ${date}\n---\n\n# ${date}\n\n## 记录\n${recs.map((x) => "- " + x).join("\n")}\n`;
  for (const [date, recs] of data.journals) vault.files.set(`日记/${date}.md`, doc(date, recs));
  vault.files.set("任务/任务数据.json", JSON.stringify({ version: 14, tasks: data.tasks }));
}
