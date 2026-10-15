# 生成 README 与教学手册截图（演示数据，无真实记录）。
# 用法（在 插件源码/lubi 下）：
#   npm run build                                    # 类型检查与生产包 main.js
#   TZ=Asia/Shanghai node test/helpers/preview-manual.mjs    # 渲染静态预览页到 preview/manual/
#   pip install playwright pillow && python -m playwright install chromium
#   TZ=Asia/Shanghai python scripts/screenshots.py
# 字体默认 Noto Sans CJK，可用 LUBI_FONT / LUBI_FONT_BOLD / LUBI_FONT_INDEX 指定
# （Windows：LUBI_FONT=C:/Windows/Fonts/msyh.ttc LUBI_FONT_BOLD=C:/Windows/Fonts/msyhbd.ttc LUBI_FONT_INDEX=0）。
import os, json
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import asyncio, pathlib, io
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]          # 插件源码/lubi
B = ROOT / "preview" / "manual"                              # node test/helpers/preview-manual.mjs 的输出
MAN = ROOT.parents[1] / "附件" / "lubi手册"                   # 教学手册配图
RD = ROOT.parents[1] / "docs" / "images"                     # README 配图
MAN.mkdir(parents=True, exist_ok=True); RD.mkdir(parents=True, exist_ok=True)
def save(png, path, q=84):
    Image.open(io.BytesIO(png)).convert("RGB").save(path, "WEBP", quality=q, method=6)
SCROLL = "(()=>{const s=document.querySelector('.lubi-timeline-scroll'); if(s) s.scrollTop=7*56-8; const w=document.querySelector('.lubi-week-body'); if(w) w.scrollTop=8*56-6;})()"
async def hover_big(pg):
    gaps = await pg.query_selector_all(".lubi-gap")
    if not gaps: raise RuntimeError("Synthetic screenshot requires a real gap")
    best = gaps[0]  # bring the first qualifying gap into view
    await best.scroll_into_view_if_needed()
    await best.hover()
    await pg.wait_for_timeout(150)
    return best
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**({"executable_path": os.environ["LUBI_BROWSER"]} if os.environ.get("LUBI_BROWSER") else {}))
        async def page(w, h, scale):
            return await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
        async def go(pg, n, dark=False):
            await pg.goto((B / ("dark" if dark else "") / f"{n}.html").as_uri()); await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(250); await pg.evaluate(SCROLL)
        # ---------- 教学手册（1x） ----------
        pg = await page(1400, 900, 1)
        await go(pg, "empty"); save(await pg.screenshot(clip={"x":0,"y":0,"width":1400,"height":560}), MAN/"01-首次打开.webp")
        await go(pg, "today"); save(await pg.screenshot(), MAN/"02-每日页.webp")
        save(await pg.screenshot(clip={"x":0,"y":0,"width":1400,"height":64}), MAN/"00-顶栏.webp")
        await hover_big(pg); await pg.wait_for_timeout(150)
        box = await (await pg.query_selector(".lubi-timeline-wrap")).bounding_box()
        save(await pg.screenshot(clip={"x":box["x"],"y":box["y"],"width":box["width"],"height":min(box["height"],520)}), MAN/"03-补记空白.webp")
        await pg.set_viewport_size({"width": 1400, "height": 1600})
        for n, name in [("modal-quick","04-一行快速记录"),("modal","05-编辑记录"),("modal-task","09-编辑任务"),("modal-keys","10-快捷键")]:
            await go(pg, n); save(await (await pg.query_selector(".modal")).screenshot(), MAN/f"{name}.webp")
        await pg.set_viewport_size({"width": 1400, "height": 900})
        await go(pg, "review"); save(await pg.screenshot(), MAN/"06-回顾页.webp")
        await go(pg, "review-year"); save(await (await pg.query_selector(".lubi-heat-card")).screenshot(), MAN/"07-年热力图.webp")
        await go(pg, "tasks"); save(await pg.screenshot(), MAN/"08-任务页.webp")
        await go(pg, "projects-gantt"); save(await pg.screenshot(), MAN/"11-项目甘特图.webp")
        await pg.close()
        # ---------- README（2x） ----------
        pg = await page(1400, 900, 2)
        for n, out, dark in [("today","today-light",False),("today","today-dark",True),("review","review-week",False),("tasks","tasks-week",False),("review","review-week-dark",True),("tasks","tasks-week-dark",True)]:
            await go(pg, n, dark); save(await pg.screenshot(), RD/f"{out}.webp", 80)
        await go(pg, "review-year"); save(await (await pg.query_selector(".lubi-heat-card")).screenshot(), RD/"year-heatmap.webp", 82)
        await pg.set_viewport_size({"width": 1400, "height": 1600})
        await go(pg, "modal-quick"); save(await (await pg.query_selector(".modal")).screenshot(), RD/"quick-entry.webp", 84)
        await go(pg, "modal-new"); save(await (await pg.query_selector(".modal")).screenshot(), RD/"task-form.webp", 84)
        await go(pg, "modal-keys"); save(await (await pg.query_selector(".modal")).screenshot(), RD/"shortcuts.webp", 84)
        await go(pg, "estimate-comparison"); await (await pg.query_selector(".modal")).screenshot(path=str(RD/"estimate-comparison.png"))
        await pg.set_viewport_size({"width": 1400, "height": 900})
        await go(pg, "projects-gantt"); save(await pg.screenshot(), RD/"projects-gantt.webp", 84)
        await go(pg, "today"); await hover_big(pg); await pg.wait_for_timeout(150)
        box = await (await pg.query_selector(".lubi-timeline-wrap")).bounding_box()
        save(await pg.screenshot(clip={"x":box["x"],"y":box["y"],"width":box["width"],"height":min(box["height"],520)}), RD/"gap-fill.webp", 82)
        # hero 原图（PNG，供合成）
        await go(pg, "today"); (RD/"_hero-light.png").write_bytes(await pg.screenshot())
        await go(pg, "today", True); (RD/"_hero-dark.png").write_bytes(await pg.screenshot())
        await pg.close()
        # 窄栏
        pg = await page(720, 900, 2)
        await go(pg, "today"); save(await pg.screenshot(), RD/"narrow-today.webp", 80)
        await pg.close(); await b.close()
def hero():
    W, H = 1280, 640
    bg = Image.new("RGB", (W, H), "#f4f2fb")
    d = ImageDraw.Draw(bg)
    for y in range(H):  # 竖向渐变
        t = y / H
        c = tuple(int(a + (b - a) * t) for a, b in zip((246, 244, 255), (232, 236, 250)))
        d.line([(0, y), (W, y)], fill=c)
    font = os.environ.get("LUBI_FONT_BOLD", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")
    reg = os.environ.get("LUBI_FONT", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
    FI = int(os.environ.get("LUBI_FONT_INDEX", "2"))  # Noto CJK .ttc 里 index 2 = SC；Windows 微软雅黑用 0
    F = lambda p, s, i=FI: ImageFont.truetype(p, s, index=i)
    def card(path, w):
        im = Image.open(path).convert("RGB")
        h = int(im.height * w / im.width); im = im.resize((w, h), Image.LANCZOS)
        mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w, h], 18, fill=255)
        return im, mask
    def place(im, mask, x, y):
        sh = Image.new("RGBA", (im.width + 80, im.height + 80), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([40, 52, 40 + im.width, 52 + im.height], 18, fill=(40, 30, 90, 70))
        sh = sh.filter(ImageFilter.GaussianBlur(18))
        bg.paste(sh, (x - 40, y - 40), sh); bg.paste(im, (x, y), mask)
    dark, dm = card(str(RD) + "/_hero-dark.png", 700); place(dark, dm, 560, 190)
    light, lm = card(str(RD) + "/_hero-light.png", 700); place(light, lm, 470, 96)
    d = ImageDraw.Draw(bg)
    d.text((64, 150), "Lubi", font=F(font, 92), fill="#2a2150")
    d.text((68, 268), "柳比歇夫时间记录", font=F(font, 34), fill="#3b3170")
    d.text((68, 318), "Obsidian 插件", font=F(reg, 24), fill="#6a6490")
    y = 392
    for t in ["记一条 · 时间轴与一行快速记录", "看一眼 · 周 / 月 / 年回顾与热力图", "排一下 · 日历、甘特图与独立项目"]:
        d.ellipse([70, y + 11, 80, y + 21], fill="#5b45c9"); d.text((94, y), t, font=F(reg, 22), fill="#3b3a4a"); y += 42
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    pill = f"v{version} · Markdown 记录 / JSON 任务 · MIT"
    tw = d.textlength(pill, font=F(reg, 19))
    d.rounded_rectangle([68, 540, 68 + tw + 40, 580], 20, fill="#5b45c9")
    d.text((88, 547), pill, font=F(reg, 19), fill="white")
    bg.save(str(RD) + "/social-preview.png", optimize=True)
    bg.save(str(RD) + "/hero.webp", "WEBP", quality=88, method=6)

if __name__ == "__main__":
    asyncio.run(main())
    hero()
    for f in RD.glob("_hero-*.png"): f.unlink()

