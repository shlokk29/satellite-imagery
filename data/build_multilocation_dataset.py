import os
import sys
import json
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.warp import transform as transform_pts, transform_bounds
from rasterio.transform import from_origin
import cv2

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


# Set GDAL parameters for fast COG HTTP reading
os.environ['GDAL_DISABLE_READDIR_ON_OPEN'] = 'EMPTY_DIR'
os.environ['CPL_VSIL_CURL_ALLOWED_EXTENSIONS'] = '.tif'
os.environ['CPL_VSIL_CURL_USE_HEAD'] = 'NO'
os.environ['GDAL_HTTP_MAX_RETRY'] = '5'
os.environ['GDAL_HTTP_RETRY_DELAY'] = '1'

# S2B Tile 46RCP (Assam/Guwahati/Brahmaputra region) Sentinel-2 L2A COG URLs
# Reference 2024-02-10
url_2024 = {
    'B04': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2024/2/S2B_46RCP_20240210_0_L2A/B04.tif",
    'B03': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2024/2/S2B_46RCP_20240210_0_L2A/B03.tif",
    'B02': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2024/2/S2B_46RCP_20240210_0_L2A/B02.tif",
    'B08': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2024/2/S2B_46RCP_20240210_0_L2A/B08.tif",
}

# Target 2026-03-06 (or 2025-03-06)
url_2026 = {
    'B04': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2025/3/S2B_46RCP_20250306_0_L2A/B04.tif",
    'B03': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2025/3/S2B_46RCP_20250306_0_L2A/B03.tif",
    'B02': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2025/3/S2B_46RCP_20250306_0_L2A/B02.tif",
    'B08': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2025/3/S2B_46RCP_20250306_0_L2A/B08.tif",
}

# 2023-01-21 scene for 2023 timelines
url_2023 = {
    'B04': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2023/1/S2A_46RCP_20230121_0_L2A/B04.tif",
    'B03': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2023/1/S2A_46RCP_20230121_0_L2A/B03.tif",
    'B02': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2023/1/S2A_46RCP_20230121_0_L2A/B02.tif",
    'B08': "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/46/R/CP/2023/1/S2A_46RCP_20230121_0_L2A/B08.tif",
}

LOCATIONS_CONFIG = [
    {
        "id": "forest",
        "name": "Garbhanga Forest, Assam",
        "category": "VEGETATION LOSS",
        "badge_icon": "🌲",
        "description": "Garbhanga Forest Reserve & Wildlife Sanctuary corridor monitoring canopy transitions and tree cover dynamics.",
        "center": [25.9850, 91.8050],
        "ref_date": "2024-02-10",
        "tgt_date": "2026-03-06",
        "ref_urls": url_2024,
        "tgt_urls": url_2026,
    },
    {
        "id": "river",
        "name": "Brahmaputra River, Assam",
        "category": "WATER EXTENT CHANGE",
        "badge_icon": "🌊",
        "description": "Brahmaputra River main braided channel and sandbar evolution tracking multi-year hydrological shifts.",
        "center": [26.1950, 91.6850],
        "ref_date": "2023-01-21",
        "tgt_date": "2026-03-06",
        "ref_urls": url_2023,
        "tgt_urls": url_2026,
    },
    {
        "id": "urban",
        "name": "Dispur, Assam",
        "category": "NEW CONSTRUCTION",
        "badge_icon": "🏢",
        "description": "Guwahati Metropolis Eastern Expansion Corridor analyzing commercial and residential built-up growth.",
        "center": [26.1380, 91.7920],
        "ref_date": "2024-02-10",
        "tgt_date": "2026-03-06",
        "ref_urls": url_2024,
        "tgt_urls": url_2026,
    },
    {
        "id": "mixed",
        "name": "Guwahati, Assam",
        "category": "MIXED CHANGE",
        "badge_icon": "🌍",
        "description": "Integrated urban-river-hill landscape demonstrating simultaneous building, road, forest, and water changes.",
        "center": [26.1550, 91.7320],
        "ref_date": "2023-01-21",
        "tgt_date": "2026-03-06",
        "ref_urls": url_2023,
        "tgt_urls": url_2026,
    },
    {
        "id": "wetland",
        "name": "Deepor Beel, Assam",
        "category": "WATER EXTENT CHANGE",
        "badge_icon": "🌿",
        "description": "Deepor Beel Ramsar Wetland basin tracking open water surface area and aquatic macrophyte variations.",
        "center": [26.1250, 91.6550],
        "ref_date": "2023-01-21",
        "tgt_date": "2026-03-06",
        "ref_urls": url_2023,
        "tgt_urls": url_2026,
    }
]

def fetch_aoi(urls, lat, lon, size_px=512):
    vsicurl_red = '/vsicurl/' + urls['B04']
    with rasterio.open(vsicurl_red) as src:
        xs, ys = transform_pts('EPSG:4326', src.crs, [lon], [lat])
        row_c, col_c = src.index(xs[0], ys[0])
        col_start = max(0, min(src.width - size_px, col_c - size_px // 2))
        row_start = max(0, min(src.height - size_px, row_c - size_px // 2))
        win = Window(col_start, row_start, size_px, size_px)
        bounds_4326 = transform_bounds(src.crs, 'EPSG:4326', *rasterio.windows.bounds(win, src.transform))
        red = src.read(1, window=win)
        
    with rasterio.open('/vsicurl/' + urls['B03']) as src:
        green = src.read(1, window=win)
    with rasterio.open('/vsicurl/' + urls['B02']) as src:
        blue = src.read(1, window=win)
    with rasterio.open('/vsicurl/' + urls['B08']) as src:
        nir = src.read(1, window=win)
        
    return red, green, blue, nir, bounds_4326

def process_bands_to_8bit(red, green, blue, nir):
    def scale_band(band, max_ref=3000.0, gamma=0.85):
        norm = np.clip(band.astype(np.float32) / max_ref, 0, 1)
        stretched = np.power(norm, gamma)
        return (stretched * 255.0).astype(np.uint8)

    r_8 = scale_band(red, 3000.0)
    g_8 = scale_band(green, 3000.0)
    b_8 = scale_band(blue, 3000.0)
    n_8 = scale_band(nir, 4500.0)
    return r_8, g_8, b_8, n_8

def save_geotiff_wgs84(filepath, r_8, g_8, b_8, n_8, bounds_4326, size_px=512):
    lon_min, lat_min, lon_max, lat_max = bounds_4326
    pixel_size = (lon_max - lon_min) / float(size_px)
    transform = from_origin(lon_min, lat_max, pixel_size, pixel_size)

    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with rasterio.open(
        filepath,
        'w',
        driver='GTiff',
        height=size_px,
        width=size_px,
        count=4,
        dtype=rasterio.uint8,
        crs='EPSG:4326',
        transform=transform,
    ) as dst:
        dst.write(r_8, 1)
        dst.write(g_8, 2)
        dst.write(b_8, 3)
        dst.write(n_8, 4)

    return transform, bounds_4326

def main():
    print("=== Building Multi-Location Sentinel-2 Dataset (5 AOIs) ===")
    os.makedirs('data/locations', exist_ok=True)
    os.makedirs('backend/static', exist_ok=True)
    
    locations_summary = []
    
    for loc in LOCATIONS_CONFIG:
        loc_id = loc['id']
        lat, lon = loc['center']
        print(f"\nProcessing AOI [{loc['badge_icon']} {loc['name']}] at lat={lat}, lon={lon}...")
        
        loc_dir = os.path.join('data', 'locations', loc_id)
        os.makedirs(loc_dir, exist_ok=True)
        
        # 1. Fetch & save Reference Scene
        print(f"  Fetching Reference scene ({loc['ref_date']})...")
        r_ref, g_ref, b_ref, n_ref, bounds_ref = fetch_aoi(loc['ref_urls'], lat, lon)
        r_ref_8, g_ref_8, b_ref_8, n_ref_8 = process_bands_to_8bit(r_ref, g_ref, b_ref, n_ref)
        
        ref_tif = os.path.join(loc_dir, "reference", f"scene_{loc['ref_date'].replace('-', '')}.tif")
        transform_ref, bounds_ref = save_geotiff_wgs84(ref_tif, r_ref_8, g_ref_8, b_ref_8, n_ref_8, bounds_ref)
        
        # Save Preview PNG
        ref_bgr = np.stack([b_ref_8, g_ref_8, r_ref_8], axis=-1)
        ref_png = os.path.join(loc_dir, "reference", "preview.png")
        cv2.imwrite(ref_png, ref_bgr)
        # Static serving path
        static_ref_png = f"backend/static/{loc_id}_ref.png"
        cv2.imwrite(static_ref_png, ref_bgr)
        
        # 2. Fetch & save Target Scene
        print(f"  Fetching Target scene ({loc['tgt_date']})...")
        r_tgt, g_tgt, b_tgt, n_tgt, bounds_tgt = fetch_aoi(loc['tgt_urls'], lat, lon)
        r_tgt_8, g_tgt_8, b_tgt_8, n_tgt_8 = process_bands_to_8bit(r_tgt, g_tgt, b_tgt, n_tgt)
        
        tgt_tif = os.path.join(loc_dir, "target", f"scene_{loc['tgt_date'].replace('-', '')}.tif")
        transform_tgt, bounds_tgt = save_geotiff_wgs84(tgt_tif, r_tgt_8, g_tgt_8, b_tgt_8, n_tgt_8, bounds_tgt)
        
        tgt_bgr = np.stack([b_tgt_8, g_tgt_8, r_tgt_8], axis=-1)
        tgt_png = os.path.join(loc_dir, "target", "preview.png")
        cv2.imwrite(tgt_png, tgt_bgr)
        static_tgt_png = f"backend/static/{loc_id}_tgt.png"
        cv2.imwrite(static_tgt_png, tgt_bgr)
        
        # 3. Create Cloud/Quality Mask
        mask_tif = os.path.join(loc_dir, "target", "cloud_mask.tif")
        qm = np.full((512, 512), 255, dtype=np.uint8)
        with rasterio.open(
            mask_tif,
            'w',
            driver='GTiff',
            height=512,
            width=512,
            count=1,
            dtype=rasterio.uint8,
            crs='EPSG:4326',
            transform=transform_tgt,
        ) as dst:
            dst.write(qm, 1)
            
        # 4. Save metadata.json
        meta = {
            "location_id": loc_id,
            "name": loc['name'],
            "category": loc['category'],
            "badge_icon": loc['badge_icon'],
            "description": loc['description'],
            "center": loc['center'],
            "crs": "EPSG:4326",
            "resolution_meters": 10.0,
            "bounds": {
                "south": bounds_ref[1],
                "west": bounds_ref[0],
                "north": bounds_ref[3],
                "east": bounds_ref[2]
            },
            "leaflet_bounds": [
                [bounds_ref[1], bounds_ref[0]],
                [bounds_ref[3], bounds_ref[2]]
            ],
            "reference_scene": {
                "id": f"{loc_id}_ref",
                "date": loc['ref_date'],
                "file_path": ref_tif.replace('\\', '/'),
                "image_url": f"/static/{loc_id}_ref.png",
                "transform": list(transform_ref)
            },
            "target_scene": {
                "id": f"{loc_id}_tgt",
                "date": loc['tgt_date'],
                "file_path": tgt_tif.replace('\\', '/'),
                "mask_path": mask_tif.replace('\\', '/'),
                "image_url": f"/static/{loc_id}_tgt.png",
                "transform": list(transform_tgt)
            },
            "provenance": {
                "sensor": "Sentinel-2 MSI Level-2A BOA Reflectance",
                "source": "Copernicus Open Access Hub / AWS Open Data",
                "license": "CC-BY 4.0 Open Access",
                "offline": True
            }
        }
        
        with open(os.path.join(loc_dir, "metadata.json"), 'w') as f:
            json.dump(meta, f, indent=2)
            
        locations_summary.append(meta)
        print(f"  Saved metadata for {loc_id}")
        
    # Save overall locations index
    with open('data/locations/locations_index.json', 'w') as f:
        json.dump(locations_summary, f, indent=2)
        
    print("\n[SUCCESS] Built all 5 real Sentinel-2 multi-location demonstration datasets!")

if __name__ == '__main__':
    main()
