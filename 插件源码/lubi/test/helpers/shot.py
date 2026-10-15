import asyncio, sys, pathlib
from playwright.async_api import async_playwright
# 用法：python3 test/helpers/shot.py            -> preview/*.png（1400x900 浅色）+ preview/dark/*.png + preview/narrow/*.png（720 宽）
base = pathlib.Path(__file__).resolve().parent.parent.parent / "preview"
NAMES = ["today", "review", "review-year", "tasks", "modal", "modal-new", "modal-task"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for sub, src, w in [("", "", 1400), ("dark", "dark", 1400), ("narrow", "", 720)]:
            out = base / sub
            out.mkdir(parents=True, exist_ok=True)
            pg = await b.new_page(viewport={"width": w, "height": 900}, device_scale_factor=1)
            for name in NAMES:
                f = base / src / f"{name}.html"
                if not f.exists():
                    continue
                await pg.goto(f"file://{f}")
                await pg.wait_for_timeout(250)
                await pg.screenshot(path=str(out / f"{name}.png"))
                if name == "today":
                    await pg.evaluate("(() => { const s = document.querySelector('.lubi-timeline-scroll'); s.scrollTop = 0; })()")
                    await pg.hover(".lubi-gap") if await pg.query_selector(".lubi-gap") else None
                    await pg.wait_for_timeout(150)
                    await pg.screenshot(path=str(out / "today-top.png"))
            await pg.close()
        await b.close()
asyncio.run(main())
