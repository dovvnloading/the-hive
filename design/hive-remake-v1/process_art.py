"""Turn generated remake art into runtime assets.

Rooms:  generated/rooms/<id>.webp  -> public/assets/hive-remake-v1/interiors/room-<id>.webp
Props:  generated/props/<name>.webp -> public/assets/hive-remake-v1/interiors/<file>.webp

Masters are the images ChatGPT returned, stored as WebP (rooms q92, props q95)
to keep the repository small. Runtime art is WebP too.

Each output also gets a lights-off twin in interiors/lights-off/, graded the
same way as the earlier interior set (desaturated, darker, cool blue), so the
renderer's lit/lights-off blend keeps working.

Usage: python design/hive-remake-v1/process_art.py [rooms] [props]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / "public/assets/hive-remake-v1/interiors"
OLD = ROOT / "public/assets/homestead-v1/interiors"
ROOM_SCALE = 6  # output pixels per world unit for room backgrounds
PROP_SCALE = 8  # output pixels per world unit for props

# Generated prop name -> runtime file name(s). A second entry is a mirrored copy.
PROP_FILES = {
    "bookshelf-sparse": ["bookshelf-empty"],
    "chair-east": ["chair-east", ("chair-west", "mirror")],
}


def lights_off(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[..., :3].astype(float)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    night = lum[..., None] * np.array([0.52, 0.55, 0.72])
    graded = 0.85 * night + 0.15 * rgb * 0.45
    out = rgba.copy()
    out[..., :3] = np.clip(graded, 0, 255).astype(np.uint8)
    return out


def save_webp(rgba: np.ndarray, path: Path, quality: int) -> None:
    image = Image.fromarray(rgba)
    if rgba.shape[-1] == 4 and rgba[..., 3].min() == 255:
        image = image.convert("RGB")
    image.save(path, "WEBP", quality=quality, method=6)


MANIFEST: dict[str, dict] = {}


def record(name: str, logical: tuple[int, int], size: tuple[int, int], source: str, pair: str) -> None:
    MANIFEST[name] = {
        "name": name,
        "logicalWidth": logical[0],
        "logicalHeight": logical[1],
        "width": size[0],
        "height": size[1],
        "source": source,
        "lightingPair": pair,
    }


def save_pair(rgba: np.ndarray, name: str, quality: int = 90) -> None:
    (OUT / "lights-off").mkdir(parents=True, exist_ok=True)
    save_webp(rgba, OUT / f"{name}.webp", quality)
    save_webp(lights_off(rgba), OUT / "lights-off" / f"{name}.webp", quality)


def master(folder: str, name: str) -> Path:
    for ext in (".webp", ".png"):
        path = HERE / "generated" / folder / f"{name}{ext}"
        if path.exists():
            return path
    return HERE / "generated" / folder / f"{name}.webp"


def room_bbox(img: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box of the room inside the flat near-black canvas border."""
    rgb = img[..., :3].astype(float)
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    border = np.median(corners, axis=0)
    content = np.linalg.norm(rgb - border, axis=-1) > 28
    cols = np.where(content.mean(axis=0) > 0.5)[0]
    rows = np.where(content.mean(axis=1) > 0.5)[0]
    return cols[0], rows[0], cols[-1] + 1, rows[-1] + 1


def process_rooms() -> None:
    layout = json.loads((HERE / "mockups/layout.json").read_text())
    for room in layout["rooms"]:
        src = master("rooms", room["id"])
        if not src.exists():
            print(f"skip room {room['id']}: not generated")
            continue
        img = np.array(Image.open(src).convert("RGBA"))
        x0, y0, x1, y1 = room_bbox(img)
        _, _, w, h = room["world"]
        crop = Image.fromarray(img[y0:y1, x0:x1]).resize((w * ROOM_SCALE, h * ROOM_SCALE), Image.LANCZOS)
        save_pair(np.array(crop), f"room-{room['id']}", quality=88)
        record(f"room-{room['id']}", (w, h), crop.size, f"generated/rooms/{src.name}", "graded")
        print(f"room {room['id']}: bbox {x0},{y0}-{x1},{y1} -> {crop.size}")


def key_magenta(img: np.ndarray) -> np.ndarray:
    rgb = img[..., :3].astype(float)
    key = np.array([255.0, 0.0, 255.0])
    dist = np.linalg.norm(rgb - key, axis=-1)
    # Magenta-leaning pixels (red and blue both well above green) are background
    # or anti-aliased fringe; everything else is solid.
    spill = np.clip((np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 60) / 80, 0, 1)
    alpha = np.clip((dist - 70) / 110, 0, 1) * (1 - spill * (dist < 230))
    a = np.maximum(alpha, 1e-3)[..., None]
    color = np.clip((rgb - (1 - a) * key) / a, 0, 255)
    out = np.zeros_like(img)
    out[..., :3] = color.astype(np.uint8)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return out


def process_props() -> None:
    layout = json.loads((HERE / "mockups/layout.json").read_text())
    footprints = {p["name"]: p["footprint"] for p in layout["props"]}
    variants = json.loads((HERE / "variants.json").read_text()) if (HERE / "variants.json").exists() else {}
    footprints.update({name: footprints[base] for name, base in variants.items()})
    sources = {src.stem: src for src in sorted((HERE / "generated/props").glob("*.*"))}
    keyed = {}
    boxes = {}
    for name, src in sources.items():
        if name not in footprints:
            print(f"skip prop {name}: no footprint")
            continue
        keyed[name] = key_magenta(np.array(Image.open(src).convert("RGBA")))
        ys, xs = np.where(keyed[name][..., 3] > 128)
        boxes[name] = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    # State variants are edits of their base image with the same framing, so a
    # base and its variants share one crop box: the pot, lamp or mailbox stays
    # the same size and place when its state changes.
    group = {name: variants.get(name, name) for name in keyed}
    shared = {}
    for name, base in group.items():
        b = boxes[name]
        u = shared.get(base, b)
        shared[base] = (min(u[0], b[0]), min(u[1], b[1]), max(u[2], b[2]), max(u[3], b[3]))
    for name, image in keyed.items():
        x0, y0, x1, y1 = shared[group[name]]
        crop = image[y0:y1, x0:x1]
        w, h = footprints[name]
        # Pad rather than stretch to the footprint's aspect: centred
        # horizontally and resting on the bottom edge (the floor contact).
        cw, ch = crop.shape[1], crop.shape[0]
        target = w / h
        if cw / ch < target:
            pw = round(ch * target)
            pad = np.zeros((ch, pw, 4), np.uint8)
            pad[:, (pw - cw) // 2 : (pw - cw) // 2 + cw] = crop
        else:
            ph = round(cw / target)
            pad = np.zeros((ph, cw, 4), np.uint8)
            pad[ph - ch :, :] = crop
        sprite = np.array(Image.fromarray(pad).resize((w * PROP_SCALE, h * PROP_SCALE), Image.LANCZOS))
        for out in PROP_FILES.get(name, [name]):
            if isinstance(out, tuple):
                save_pair(sprite[:, ::-1].copy(), out[0])
                out = out[0]
            else:
                save_pair(sprite, out)
            record(out, (w, h), (sprite.shape[1], sprite.shape[0]), f"generated/props/{sources[name].name}", "graded")
        print(f"prop {name}: {cw}x{ch} -> {w * PROP_SCALE}x{h * PROP_SCALE}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    # Start from the previous interior set so assets not remade (corridor floor,
    # timber, rug, unused furniture) still load. UI icons stay in homestead-v1.
    (OUT / "lights-off").mkdir(exist_ok=True)
    # A partial run (rooms or props only) keeps the other half's entries.
    if (HERE / "manifest.json").exists():
        for asset in json.loads((HERE / "manifest.json").read_text())["assets"]:
            MANIFEST[asset["name"]] = asset
    old_manifest = json.loads((ROOT / "design/homestead-v1/interiors/manifest.json").read_text())
    for asset in old_manifest["assets"]:
        # Carried over unchanged: its lights-off partner is the earlier model-made one.
        if MANIFEST.get(asset["name"], {}).get("lightingPair") == "graded":
            continue
        record(asset["name"], (asset["logicalWidth"], asset["logicalHeight"]), (asset["width"], asset["height"]),
               "homestead-v1", "model")
    for sub in ("", "lights-off"):
        for f in (OLD / sub).glob("*.png"):
            target = OUT / sub / f"{f.stem}.webp"
            if f.name.startswith("icon-") or target.exists():
                continue
            save_webp(np.array(Image.open(f).convert("RGBA")), target, 92)
    which = set(sys.argv[1:]) or {"rooms", "props"}
    if "rooms" in which:
        process_rooms()
    if "props" in which:
        process_props()
    present = {f.stem for f in OUT.glob("*.webp")}
    manifest = {
        "note": "Runtime interior art for the Hive remake. lightingPair 'graded' means the lights-off "
        "file is a programmatic night grade of the lit art; 'model' means it was carried over from "
        "homestead-v1, whose dark partners were model-generated.",
        "assets": sorted((a for n, a in MANIFEST.items() if n in present), key=lambda a: a["name"]),
    }
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
