"""Build resident animation sheets from the generated character art.

Inputs (one ChatGPT chat per character, see README.md):
  generated/<id>-turnaround.webp  front, back, side (facing right)
  generated/<id>-walk.webp        front step L/R, back step L/R, side stride A/B
  generated/<id>-poses.webp       seated (facing right), seated typing, phone

Outputs: public/assets/residents-v2/<id>/{idle_anim,run,sit,sit2,phone}.png on
the renderer's existing frame grid at 8 px per sprite unit:
  idle_anim, run  24 frames of 16 x 32 units: east 0-5, north 6-11, west 12-17, south 18-23
  phone           9 frames of 16 x 32 units facing south
  sit, sit2       12 frames of 32 x 32 units: east 0-5, west 6-11

Usage: python design/hive-remake-v1/characters/build_sheets.py [id ...]
"""
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "public/assets/residents-v2"
U = 8  # pixels per sprite unit
CAST = ["maple", "fern", "juniper", "bram", "clover", "ollie"]

STAND_HEIGHT = 22.5  # target standing height in units (feet at y=31.5)
MAX_WIDTH = 15.6  # a standing figure must fit the 16-unit frame
FEET_Y = 31.5
IDLE_BOB = [0, -1, -2, -2, -1, 0]  # output pixels
SIT_LEFT = 6.0  # seated body's back edge, matching the chair calibration
SIT_FEET = 31.0
TYPE_FEET = 25.0  # the typing pose keeps the earlier sheets' six-unit lift


def key_magenta(img: np.ndarray) -> np.ndarray:
    rgb = img[..., :3].astype(float)
    key = np.array([255.0, 0.0, 255.0])
    dist = np.linalg.norm(rgb - key, axis=-1)
    spill = np.clip((np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 60) / 80, 0, 1)
    alpha = np.clip((dist - 70) / 110, 0, 1) * (1 - spill * (dist < 230))
    a = np.maximum(alpha, 1e-3)[..., None]
    color = np.clip((rgb - (1 - a) * key) / a, 0, 255)
    out = np.zeros(img.shape[:2] + (4,), np.uint8)
    out[..., :3] = color.astype(np.uint8)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return out


def figures(path: Path, expected: int) -> list[np.ndarray]:
    """Cut the figures out of one generated image, left to right."""
    rgba = key_magenta(np.array(Image.open(path).convert("RGB")))
    solid = rgba[..., 3] > 96
    labels, count = ndimage.label(solid)
    sizes = ndimage.sum(solid, labels, range(1, count + 1))
    boxes = ndimage.find_objects(labels)
    # Each figure is one large connected shape; loose bits (a detached hand,
    # a curl, a phone glint) join the figure whose span contains them.
    big = [i for i, s in enumerate(sizes) if s > 0.05 * sizes.max()]
    if len(big) != expected:
        raise SystemExit(f"{path.name}: found {len(big)} figures, expected {expected}")
    big.sort(key=lambda i: boxes[i][1].start)
    spans = {i: [boxes[i][1].start, boxes[i][1].stop, boxes[i][0].start, boxes[i][0].stop] for i in big}
    owner = np.zeros(count + 1, int)
    for i in big:
        owner[i + 1] = i + 1
    for i, box in enumerate(boxes):
        if i in spans or sizes[i] < 30:
            continue
        cx = (box[1].start + box[1].stop) / 2
        nearest = min(big, key=lambda b: abs(cx - (spans[b][0] + spans[b][1]) / 2))
        owner[i + 1] = nearest + 1
        s = spans[nearest]
        spans[nearest] = [min(s[0], box[1].start), max(s[1], box[1].stop), min(s[2], box[0].start), max(s[3], box[0].stop)]
    out = []
    for i in big:
        x0, x1, y0, y1 = spans[i]
        mask = owner[labels[y0:y1, x0:x1]] == i + 1
        fig = rgba[y0:y1, x0:x1].copy()
        fig[..., 3] = np.where(mask, fig[..., 3], 0)
        out.append(fig)
    return out


def scaled(fig: np.ndarray, scale: float) -> Image.Image:
    w = max(1, round(fig.shape[1] * scale))
    h = max(1, round(fig.shape[0] * scale))
    return Image.fromarray(fig).resize((w, h), Image.LANCZOS)


def place(frame_w: int, fig: Image.Image, left: float | None, feet: float, dy: int = 0) -> Image.Image:
    """Put a figure on a transparent frame: centred (or at `left` units), feet at `feet` units."""
    frame = Image.new("RGBA", (frame_w * U, 32 * U), (0, 0, 0, 0))
    x = round(left * U) if left is not None else (frame_w * U - fig.width) // 2
    y = round(feet * U) - fig.height + dy
    frame.alpha_composite(fig, (x, y)) if x >= 0 and y >= 0 else frame.paste(fig, (x, y), fig)
    return frame


def strip(frames: list[Image.Image]) -> Image.Image:
    sheet = Image.new("RGBA", (sum(f.width for f in frames), frames[0].height), (0, 0, 0, 0))
    x = 0
    for f in frames:
        sheet.alpha_composite(f, (x, 0))
        x += f.width
    return sheet


def mirror(img: Image.Image) -> Image.Image:
    return img.transpose(Image.FLIP_LEFT_RIGHT)


def build(cid: str) -> None:
    gen = HERE / "generated"
    front, back, side = figures(gen / f"{cid}-turnaround.webp", 3)
    walk = figures(gen / f"{cid}-walk.webp", 6)
    sit, typing, phone = figures(gen / f"{cid}-poses.webp", 3)

    # One scale per generated image, from its standing figures, so every figure
    # in an image keeps its proportions; then one target size for the character.
    turn_h = np.median([f.shape[0] for f in (front, back, side)])
    walk_h = np.median([f.shape[0] for f in walk])
    poses_h = phone.shape[0]
    widest = max(f.shape[1] / turn_h for f in (front, back, side))
    widest = max(widest, max(f.shape[1] / walk_h for f in walk), phone.shape[1] / poses_h)
    height_units = min(STAND_HEIGHT, MAX_WIDTH / widest)
    px = height_units * U
    s_turn, s_walk, s_pose = px / turn_h, px / walk_h, px / poses_h

    stand = {"south": scaled(front, s_turn), "north": scaled(back, s_turn), "east": scaled(side, s_turn)}
    stand["west"] = mirror(stand["east"])
    steps = {
        "south": [scaled(walk[0], s_walk), scaled(walk[1], s_walk)],
        "north": [scaled(walk[2], s_walk), scaled(walk[3], s_walk)],
        "east": [scaled(walk[4], s_walk), scaled(walk[5], s_walk)],
    }
    steps["west"] = [mirror(f) for f in steps["east"]]

    order = ["east", "north", "west", "south"]
    idle = [place(16, stand[d], None, FEET_Y, bob) for d in order for bob in IDLE_BOB]
    run = []
    for d in order:
        a, b = steps[d]
        cycle = [(a, 0), (a, -2), (stand[d], -1), (b, 0), (b, -2), (stand[d], -1)]
        run += [place(16, fig, None, FEET_Y, dy) for fig, dy in cycle]

    sit_img, type_img = scaled(sit, s_pose), scaled(typing, s_pose)
    sit_e = [place(32, sit_img, SIT_LEFT, SIT_FEET, bob // 2) for bob in IDLE_BOB]
    type_e = [place(32, type_img, SIT_LEFT, TYPE_FEET, dy) for dy in [0, -1, 0, -1, 0, -1]]
    sit_sheet = sit_e + [mirror(f) for f in sit_e]
    type_sheet = type_e + [mirror(f) for f in type_e]

    phone_img = scaled(phone, s_pose)
    phone_sheet = [place(16, phone_img, None, FEET_Y, dy) for dy in [0, -1, -1, 0, 0, -1, -1, 0, 0]]

    dest = OUT / cid
    dest.mkdir(parents=True, exist_ok=True)
    for name, frames in [
        ("idle_anim", idle),
        ("run", run),
        ("sit", sit_sheet),
        ("sit2", type_sheet),
        ("phone", phone_sheet),
    ]:
        strip(frames).save(dest / f"{name}.png", optimize=True)
    print(f"{cid}: standing height {height_units:.1f} units")


if __name__ == "__main__":
    for cid in sys.argv[1:] or CAST:
        build(cid)
