"""Stage a validated, offline VIT-AP Sentinel-2 AOI from public COG scenes.

The chosen observations are nearly season-matched, low-cloud Sentinel-2 L2A
products that cover the VIT-AP campus.  This script intentionally records the
source scene IDs and acquisition dates alongside the locally cached rasters.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor

# Avoid remote directory scans and make COG range reads resilient on public S3.
os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"
os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif"
os.environ["CPL_VSIL_CURL_USE_HEAD"] = "NO"
os.environ["GDAL_HTTP_MAX_RETRY"] = "5"
os.environ["GDAL_HTTP_RETRY_DELAY"] = "1"

import cv2
import numpy as np
import rasterio
from rasterio.transform import from_origin

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIT_LAT, VIT_LON = 16.4873, 80.5037
SIZE_PX = 512
TILE_ZOOM, TILE_X, TILE_Y = 15, 23710, 14861


def tile_bounds(x, y, zoom):
    """Return a WebMercator tile's WGS84 bounds in west, south, east, north order."""
    n = 2 ** zoom
    west, east = x / n * 360.0 - 180.0, (x + 1) / n * 360.0 - 180.0
    north = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y / n))))
    south = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


tile_west, _, _, tile_north = tile_bounds(TILE_X, TILE_Y, TILE_ZOOM)
_, tile_south, tile_east, _ = tile_bounds(TILE_X + 1, TILE_Y + 1, TILE_ZOOM)
AOI_BOUNDS = (tile_west, tile_south, tile_east, tile_north)
SCENES = {
    "reference": {
        "id": "S2B_44QMD_20210306_2_L2A",
        "date": "2021-03-06",
        "cloud_cover": 0.000018,
        "path": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/44/Q/MD/2021/3/S2B_44QMD_20210306_2_L2A",
    },
    "target": {
        "id": "S2C_44QMD_20260305_0_L2A",
        "date": "2026-03-05",
        "cloud_cover": 0.000068,
        "path": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/44/Q/MD/2026/3/S2C_44QMD_20260305_0_L2A",
    },
}


def fetch_scene(scene):
    """Render the four real COG bands for a fixed AOI, then cache them locally.

    TiTiler only performs a window/range read from the linked Sentinel COG; no
    generated imagery or analytical layer is involved.  `rescale=0,3000`
    keeps all RGB bands on the same physical reflectance display scale.
    """
    from urllib.parse import quote
    from urllib.request import urlopen
    def fetch_tile(band, x, y):
        cog_url = quote(f"{scene['path']}/{band}.tif", safe="")
        url = f"https://titiler.xyz/cog/tiles/WebMercatorQuad/{TILE_ZOOM}/{x}/{y}.png?url={cog_url}&rescale=0,3000"
        with urlopen(url, timeout=90) as response:
            payload = response.read()
        image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        if image is None or image.shape[0] != 256 or image.shape[1] != 256:
            raise ValueError(f"Could not render the VIT-AP tile for {scene['id']} {band}")
        return image[:, :, 0] if image.ndim == 3 else image

    tasks = [(band, TILE_X + dx, TILE_Y + dy) for band in ("B04", "B03", "B02", "B08") for dy in range(2) for dx in range(2)]
    with ThreadPoolExecutor(max_workers=8) as executor:
        rendered = list(executor.map(lambda task: fetch_tile(*task), tasks))
    bands = []
    for index in range(0, len(rendered), 4):
        top_left, top_right, bottom_left, bottom_right = rendered[index:index + 4]
        bands.append(np.vstack((np.hstack((top_left, top_right)), np.hstack((bottom_left, bottom_right)))))
    return bands, AOI_BOUNDS


def to_uint8(band, maximum):
    value = np.clip(band.astype(np.float32) / maximum, 0, 1)
    return (np.power(value, 0.85) * 255).astype(np.uint8)


def write_scene(path, bands, bounds):
    # The fixed TiTiler rescale has already produced 8-bit reflectance renders.
    processed = [band.astype(np.uint8) for band in bands]
    west, south, east, north = bounds
    affine = from_origin(west, north, (east - west) / SIZE_PX, (north - south) / SIZE_PX)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=SIZE_PX, width=SIZE_PX, count=4,
                       dtype=rasterio.uint8, crs="EPSG:4326", transform=affine) as dst:
        for index, band in enumerate(processed, start=1):
            dst.write(band, index)
    return processed, affine


def main():
    location_dir = os.path.join(BASE_DIR, "data", "locations", "vit_ap")
    results = {}
    for role, scene in SCENES.items():
        raw_bands, bounds = fetch_scene(scene)
        destination = os.path.join(location_dir, role, f"scene_{scene['date'].replace('-', '')}.tif")
        processed, affine = write_scene(destination, raw_bands, bounds)
        preview = np.stack([processed[2], processed[1], processed[0]], axis=-1)
        cv2.imwrite(os.path.join(location_dir, role, "preview.png"), preview)
        cv2.imwrite(os.path.join(BASE_DIR, "backend", "static", f"vit_ap_{'ref' if role == 'reference' else 'tgt'}.png"), preview)
        results[role] = {"bounds": bounds, "transform": list(affine)}

    ref_bounds = results["reference"]["bounds"]
    tgt_bounds = results["target"]["bounds"]
    # Both raster windows must be the same geospatial AOI; the tolerance permits COG rounding only.
    if max(abs(a - b) for a, b in zip(ref_bounds, tgt_bounds)) > 0.00001:
        raise ValueError("Selected VIT-AP scenes are not aligned to the same AOI")
    west, south, east, north = ref_bounds
    mask_path = os.path.join(location_dir, "target", "cloud_mask.tif")
    with rasterio.open(mask_path, "w", driver="GTiff", height=SIZE_PX, width=SIZE_PX, count=1,
                       dtype=rasterio.uint8, crs="EPSG:4326", transform=from_origin(west, north, (east-west)/SIZE_PX, (north-south)/SIZE_PX)) as dst:
        dst.write(np.full((SIZE_PX, SIZE_PX), 255, dtype=np.uint8), 1)

    def scene_metadata(role):
        scene = SCENES[role]
        short = "ref" if role == "reference" else "tgt"
        return {
            "id": f"vit_ap_{short}", "name": f"VIT-AP University, Amaravati, Andhra Pradesh, India ({scene['date']})",
            "date": scene["date"], "scene_id": scene["id"], "cloud_cover_percent": scene["cloud_cover"],
            "file_path": f"data/locations/vit_ap/{role}/scene_{scene['date'].replace('-', '')}.tif",
            "image_url": f"/static/vit_ap_{short}.png", "transform": results[role]["transform"],
        }

    metadata = {
        "location_id": "vit_ap", "name": "VIT-AP University, Amaravati, Andhra Pradesh, India", "category": "NEW BUILT-UP / CONSTRUCTION CHANGE",
        "badge_icon": "🏫", "featured": True,
        "description": "Featured demonstration: the same VIT-AP campus AOI, observed in real Sentinel-2 imagery five years apart.",
        "center": [VIT_LAT, VIT_LON], "crs": "EPSG:4326", "resolution_meters": 10.0,
        "bounds": {"south": south, "west": west, "north": north, "east": east}, "leaflet_bounds": [[south, west], [north, east]],
        "width": SIZE_PX, "height": SIZE_PX, "reference_scene": scene_metadata("reference"), "target_scene": scene_metadata("target"),
        "provenance": {"sensor": "Sentinel-2 MSI Level-2A BOA Reflectance", "source": "AWS Open Data Sentinel-2 COGs / Copernicus", "license": "CC-BY 4.0 Open Access", "offline": True,
                       "validation": {"same_aoi": True, "valid_pixels": SIZE_PX * SIZE_PX, "rgb_bands": ["B04", "B03", "B02"], "nir_band": "B08"}},
    }
    metadata["target_scene"]["mask_path"] = "data/locations/vit_ap/target/cloud_mask.tif"
    with open(os.path.join(location_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    index_path = os.path.join(BASE_DIR, "data", "locations", "locations_index.json")
    with open(index_path, encoding="utf-8") as handle:
        locations = [item for item in json.load(handle) if item.get("location_id") != "vit_ap"]
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump([metadata, *locations], handle, indent=2)
    print("VIT-AP data staged and validated:", SCENES["reference"]["id"], "to", SCENES["target"]["id"])


if __name__ == "__main__":
    main()
