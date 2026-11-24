from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
HTML = HERE / "telegram-cards.html"
OUT = PROJECT / "public" / "evidence"
OUT.mkdir(parents=True, exist_ok=True)

def launch_browser(p):
    for options in ({}, {"executable_path": "/usr/bin/chromium", "args": ["--no-sandbox"]}, {"channel": "chrome"}):
        try:
            return p.chromium.launch(**options)
        except Exception:
            continue
    raise RuntimeError("No headless Chromium available")

with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={"width": 600, "height": 1200}, device_scale_factor=2)
    page.set_content(HTML.read_text(encoding="utf-8"), wait_until="load")
    for case_id in range(1, 4):
        element = page.locator(f"#case-{case_id:02d}")
        target = OUT / f"case-{case_id:02d}-evidence.png"
        element.screenshot(path=str(target), animations="disabled")
        print(f"Rendered {target} ({target.stat().st_size} bytes)")
    browser.close()
