// 全部为合成夹具。测试只在内存 Vault 写入，不读取/更改用户的日记、任务或迁移备份。
export const DATE = "2026-09-24";
export const TASK_ID = "427a21a1-a226-442f-8a9d-e7775e8e0b0d";
export const legacyJournal = `---
date: 2026-09-24
---

# 2026-09-24

<div class="journal-card"><div class="journal-title">三明治定理习题 <span class="journal-hashtag">#学习</span></div>[时长:: 6.25h] [任务:: ${TASK_ID}]<div class="journal-right">01:10</div></div>
<!-- daily-task-log:start -->
临时旧任务视图
<!-- daily-task-log:end -->
`;
export const oldJournal13 = `---
date: 2026-09-13
---

# 2026-09-13

<div class="journal-card"><div class="journal-title">旧格式校验 <span class="journal-hashtag">#学习</span></div>[时长:: 45min]<div class="journal-right">09:00</div></div>
`;
export const abnormalDay = `---
date: 2026-09-21
---

# 2026-09-21

## 记录
- 06:00–13:00 学习 · 待校对旧时长 [时长:: 103h]
`;
export const legacyTasks = {
  version: 13,
  categories: [{ id: "learning", name: "学习" }, { id: "daily", name: "日常" }],
  tasks: [
    { id: "project-a", title: "学习三明治定理", categoryId: "learning", status: "pending" },
    { id: "project-b", title: "学习微积分", categoryId: "learning", status: "pending" },
    { id: "project-c", title: "生活", categoryId: "daily", status: "pending" },
  ],
  subtasks: [
    { id: TASK_ID, taskId: "project-a", parentId: "project-a", title: "三明治定理习题", status: "done", startDate: DATE, startTime: "01:10", endTime: "03:10", estimate: 120 },
    { id: "read-material", taskId: "project-a", parentId: "project-a", title: "阅读材料", startDate: DATE, status: "pending" },
    { id: "limit", taskId: "project-b", parentId: "project-b", title: "学习极限", startDate: "2026-09-23", status: "pending" },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `inbox-${i}`, taskId: "project-c", parentId: "project-c", title: `待安排事项 ${i + 1}`, status: "pending" })),
  ],
};
export const fixtureVault = {
  "日记/2026-09-24.md": legacyJournal,
  "日记/2026-09-13.md": oldJournal13,
  "日记/2026-09-21.md": abnormalDay,
  "任务/任务数据.json": JSON.stringify(legacyTasks),
};
