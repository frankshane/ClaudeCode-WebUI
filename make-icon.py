"""把 Chrome 截出来的 Claude logo 合成桌面图标风：米白圆角底 + 橘色 Logo。"""
from PIL import Image, ImageDraw

RAW = r'D:\ClaudeCode-WebUI\claude-logo-raw.png'
OUT_PNG = r'D:\ClaudeCode-WebUI\claude-icon.png'
OUT_ICO = r'D:\ClaudeCode-WebUI\claude-icon.ico'

SIZE = 512
BG = (240, 238, 230, 255)  # 米白，接近 Claude 官方图标底色
GLYPH = (217, 119, 87, 255)  # Claude 品牌橙 #D97757

raw = Image.open(RAW).convert('RGBA')

# 截图是透明底 + 橘色图形，直接用 alpha 通道当形状
alpha = raw.split()[3]
bbox = alpha.getbbox()
shape = alpha.crop(bbox) if bbox else alpha

bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(bg)
d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.225), fill=BG)

side = int(SIZE * 0.62)
glyph_layer = Image.new('RGBA', (side, side), (0, 0, 0, 0))
glyph_layer.putdata([(GLYPH[0], GLYPH[1], GLYPH[2], a) for a in shape.resize((side, side), Image.LANCZOS).getdata()])
bg.alpha_composite(glyph_layer, (int((SIZE - side) / 2), int((SIZE - side) / 2)))

bg.save(OUT_PNG)
bg.save(OUT_ICO, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('OK', OUT_PNG, OUT_ICO)
