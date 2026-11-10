"""生成 Edge 商店的推广图（440x280 小图、1400x560 大图），中英各一套。"""

import os
from PIL import Image, ImageDraw, ImageFont

OUT = "assets"
os.makedirs(OUT, exist_ok=True)

BG = (77, 107, 254)
BG_DARK = (58, 86, 220)
WHITE = (255, 255, 255)

EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
EN_REG = r"C:\Windows\Fonts\segoeui.ttf"
ZH_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
ZH_REG = r"C:\Windows\Fonts\msyh.ttc"


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_icon(img, box):
    """在 box=(x, y, size) 处画图标：白气泡 + 蓝线 + 加号。"""
    x, y, size = box
    d = ImageDraw.Draw(img)
    s = size / 180.0
    d.rounded_rectangle([x, y, x + size, y + size], radius=40 * s, fill=WHITE)

    bx0, by0, bx1, by1 = x + 26 * s, y + 38 * s, x + 118 * s, y + 100 * s
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=14 * s, fill=BG)
    d.polygon(
        [
            (x + 44 * s, by1 - 4 * s),
            (x + 44 * s, by1 + 20 * s),
            (x + 66 * s, by1),
        ],
        fill=BG,
    )
    for x1, x2, yy in [(38, 104, 52), (38, 92, 66), (38, 78, 80)]:
        d.rounded_rectangle(
            [x + x1 * s, y + yy * s, x + x2 * s, y + (yy + 6) * s],
            radius=3 * s,
            fill=WHITE,
        )
    # 加号
    cx, cy = x + 142 * s, y + 132 * s
    d.rounded_rectangle([cx - 4 * s, cy - 18 * s, cx + 4 * s, cy + 18 * s], radius=3 * s, fill=BG)
    d.rounded_rectangle([cx - 18 * s, cy - 4 * s, cx + 18 * s, cy + 4 * s], radius=3 * s, fill=BG)


def make_tile(width, height, title, subtitle, title_font, sub_font, path):
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    # 右上角一块深色装饰，避免整块纯色
    d.polygon([(width, 0), (width, height), (width - height * 0.55, height)], fill=BG_DARK)
    icon_size = int(height * 0.52)
    draw_icon(img, (int(width * 0.07), (height - icon_size) // 2, icon_size))

    text_x = int(width * 0.07) + icon_size + int(width * 0.045)
    avail = width - text_x - int(width * 0.06)

    def fit(text, fnt, minimum):
        """按可用宽度自动缩字号，避免文字被裁掉。"""
        size = fnt.size
        while size > minimum:
            f = font(fnt.path, size)
            box = d.textbbox((0, 0), text, font=f)
            if box[2] - box[0] <= avail:
                return f
            size -= 1
        return font(fnt.path, minimum)

    title_font = fit(title, title_font, max(16, title_font.size // 2))
    sub_font = fit(subtitle, sub_font, max(12, sub_font.size // 2))

    tb = d.textbbox((0, 0), title, font=title_font)
    sb = d.textbbox((0, 0), subtitle, font=sub_font)
    block_h = (tb[3] - tb[1]) + int(height * 0.06) + (sb[3] - sb[1])
    top = (height - block_h) // 2 - tb[1]
    d.text((text_x, top), title, font=title_font, fill=WHITE)
    d.text((text_x, top + tb[3] - tb[1] + int(height * 0.06) - sb[1]), subtitle, font=sub_font, fill=WHITE)
    img.save(path)
    print(path, img.size)


variants = [
    ("en", "DSH Chat Migration", "Export DeepSeek chats as JSON", EN_BOLD, EN_REG),
    ("zh", "DSH 对话迁移", "把 DeepSeek 对话导出为 JSON", ZH_BOLD, ZH_REG),
]

for key, title, sub, tf, sf in variants:
    make_tile(440, 280, title, sub, font(tf, 30), font(sf, 18), f"{OUT}/tile-small-{key}.png")
    make_tile(1400, 560, title, sub, font(tf, 92), font(sf, 44), f"{OUT}/tile-large-{key}.png")
