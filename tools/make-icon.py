"""生成 180x180 的市场卡片图标（GitHub 托管的位图，SVG 不被接受）。"""

from PIL import Image, ImageDraw

SIZE = 180
SCALE = 4  # 先按 4 倍画再缩小，边缘更干净

img = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景：圆角方块
d.rounded_rectangle(
    [0, 0, SIZE * SCALE - 1, SIZE * SCALE - 1],
    radius=40 * SCALE,
    fill=(77, 107, 254, 255),
)

# 对话气泡（白色）
bubble = [34 * SCALE, 44 * SCALE, 116 * SCALE, 104 * SCALE]
d.rounded_rectangle(bubble, radius=14 * SCALE, fill=(255, 255, 255, 255))

# 气泡尾巴
d.polygon(
    [
        (52 * SCALE, 102 * SCALE),
        (52 * SCALE, 124 * SCALE),
        (72 * SCALE, 104 * SCALE),
    ],
    fill=(255, 255, 255, 255),
)

# 三条文本线（蓝色）
for i, (x1, x2, y) in enumerate(
    [(46, 104, 58), (46, 92, 72), (46, 78, 86)]
):
    d.rounded_rectangle(
        [x1 * SCALE, y * SCALE, x2 * SCALE, (y + 6) * SCALE],
        radius=3 * SCALE,
        fill=(77, 107, 254, 255),
    )

# 导入箭头（右下角）
d.line(
    [(126 * SCALE, 132 * SCALE), (154 * SCALE, 132 * SCALE)],
    fill=(255, 255, 255, 255),
    width=7 * SCALE,
)
d.line(
    [(141 * SCALE, 114 * SCALE), (141 * SCALE, 150 * SCALE)],
    fill=(255, 255, 255, 255),
    width=7 * SCALE,
)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save("assets/icon-180.png")
print("assets/icon-180.png", img.size)

# Edge 商店要求扩展 logo 最小 128x128、推荐 300x300，且必须是位图
img.resize((300, 300), Image.LANCZOS).save("assets/icon-300.png")
print("assets/icon-300.png", (300, 300))
