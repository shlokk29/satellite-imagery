import os
import json
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window
import cv2

# Base archive scenes already stored locally from Sentinel-2 MSI L2A
ARCHIVE_DIR = "data/sample/archive"

LOCATIONS = [
    {
        "id": "forest",
        "name": "Garbhanga Forest, Assam",
        "category": "VEGETATION LOSS",
        "badge_icon": "🌲",
        "description": "Garbhanga Forest Reserve & Wildlife Sanctuary corridor monitoring tree canopy transitions, vegetation loss, and forest density.",
        "window": Window(0, 200, 360, 312), # Southern forested hills
        "ref_scene_file": "scene_20240210.tif",
        "ref_date": "2024-02-10",
        "tgt_scene_file": "scene_20260306.tif",
        "tgt_date": "2026-03-06",
    },
    {
        "id": "river",
        "name": "Brahmaputra River, Assam",
        "category": "WATER EXTENT CHANGE",
        "badge_icon": "🌊",
        "description": "Brahmaputra River main braided channel and sandbar evolution tracking multi-year hydrological shifts and shoreline displacement.",
        "window": Window(50, 0, 420, 280), # Northern river channel & sandbars
        "ref_scene_file": "scene_20240210.tif",
        "ref_date": "2024-02-10",
        "tgt_scene_file": "scene_20241022.tif",
        "tgt_date": "2024-10-22",
    },
    {
        "id": "urban",
        "name": "Dispur, Assam",
        "category": "NEW CONSTRUCTION",
        "badge_icon": "🏢",
        "description": "Guwahati Metropolis Eastern Expansion Corridor analyzing commercial, industrial, and residential built-up development.",
        "window": Window(180, 160, 332, 352), # Eastern urban development
        "ref_scene_file": "scene_20240210.tif",
        "ref_date": "2024-02-10",
        "tgt_scene_file": "scene_20260306.tif",
        "tgt_date": "2026-03-06",
    },
    {
        "id": "mixed",
        "name": "Guwahati, Assam",
        "category": "MIXED CHANGE",
        "badge_icon": "🌍",
        "description": "Integrated riverfront, urban residential core, and hill forest landscape demonstrating simultaneous building, road, forest, and water changes.",
        "window": Window(0, 0, 512, 512), # Full scene
        "ref_scene_file": "scene_20240311.tif",
        "ref_date": "2024-03-11",
        "tgt_scene_file": "scene_20260306.tif",
        "tgt_date": "2026-03-06",
    },
    {
        "id": "wetland",
        "name": "Deepor Beel, Assam",
        "category": "WATER EXTENT CHANGE",
        "badge_icon": "🌿",
        "description": "Deepor Beel Ramsar Wetland basin tracking open water surface area and aquatic macrophyte variations between multi-year dry seasons.",
        "window": Window(0, 100, 300, 300), # Western wetland basin
        "ref_scene_file": "scene_20240210.tif",
        "ref_date": "2024-02-10",
        "tgt_scene_file": "scene_20250209.tif",
        "tgt_date": "2025-02-09",
    }
]

def crop_and_save_scene(src_path, dst_path, window, preview_paths):
    with rasterio.open(src_path) as src:
        data = src.read(window=window)
        # Calculate new transform for the sub-window
        new_transform = rasterio.windows.transform(window, src.transform)
        h, w = data.shape[1], data.shape[2]
        
        # Calculate exact WGS84 bounding box
        bounds = rasterio.windows.bounds(window, src.transform)
        # bounds are: (west, south, east, north)
        
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        with rasterio.open(
            dst_path,
            'w',
            driver='GTiff',
            height=h,
            width=w,
            count=data.shape[0],
            dtype=data.dtype,
            crs=src.crs,
            transform=new_transform,
        ) as dst:
            dst.write(data)
            
        # Create RGB preview image (BGR order for OpenCV)
        # Bands: 1=Red, 2=Green, 3=Blue, 4=NIR
        r, g, b = data[0], data[1], data[2]
        bgr = np.stack([b, g, r], axis=-1)
        
        for p in preview_paths:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            cv2.imwrite(p, bgr)
            
    return new_transform, bounds, w, h

def main():
    print("=== Staging 5 Multi-Location Sentinel-2 Demonstration AOIs ===")
    os.makedirs("data/locations", exist_ok=True)
    os.makedirs("backend/static", exist_ok=True)
    
    locations_summary = []
    
    for loc in LOCATIONS:
        loc_id = loc['id']
        print(f"\nSetting up AOI [{loc['name']}]...")
        loc_dir = os.path.join("data", "locations", loc_id)
        
        ref_src = os.path.join(ARCHIVE_DIR, loc['ref_scene_file'])
        tgt_src = os.path.join(ARCHIVE_DIR, loc['tgt_scene_file'])
        
        ref_dst = os.path.join(loc_dir, "reference", f"scene_{loc['ref_date'].replace('-', '')}.tif")
        tgt_dst = os.path.join(loc_dir, "target", f"scene_{loc['tgt_date'].replace('-', '')}.tif")
        
        ref_previews = [
            os.path.join(loc_dir, "reference", "preview.png"),
            f"backend/static/{loc_id}_ref.png"
        ]
        tgt_previews = [
            os.path.join(loc_dir, "target", "preview.png"),
            f"backend/static/{loc_id}_tgt.png"
        ]
        
        # Crop & Save Reference Scene
        ref_transform, bounds_ref, w, h = crop_and_save_scene(ref_src, ref_dst, loc['window'], ref_previews)
        # Crop & Save Target Scene
        tgt_transform, bounds_tgt, _, _ = crop_and_save_scene(tgt_src, tgt_dst, loc['window'], tgt_previews)
        
        # Create Cloud / Quality Mask
        mask_dst = os.path.join(loc_dir, "target", "cloud_mask.tif")
        qm = np.full((h, w), 255, dtype=np.uint8)
        with rasterio.open(
            mask_dst,
            'w',
            driver='GTiff',
            height=h,
            width=w,
            count=1,
            dtype=rasterio.uint8,
            crs='EPSG:4326',
            transform=tgt_transform,
        ) as dst:
            dst.write(qm, 1)
            
        # Center coordinates
        lat_center = (bounds_ref[1] + bounds_ref[3]) / 2.0
        lon_center = (bounds_ref[0] + bounds_ref[2]) / 2.0
        
        meta = {
            "location_id": loc_id,
            "name": loc['name'],
            "category": loc['category'],
            "badge_icon": loc['badge_icon'],
            "description": loc['description'],
            "center": [lat_center, lon_center],
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
            "width": w,
            "height": h,
            "reference_scene": {
                "id": f"{loc_id}_ref",
                "name": f"{loc['name']} ({loc['ref_date']})",
                "date": loc['ref_date'],
                "file_path": ref_dst.replace('\\', '/'),
                "image_url": f"/static/{loc_id}_ref.png",
                "transform": list(ref_transform)
            },
            "target_scene": {
                "id": f"{loc_id}_tgt",
                "name": f"{loc['name']} ({loc['tgt_date']})",
                "date": loc['tgt_date'],
                "file_path": tgt_dst.replace('\\', '/'),
                "mask_path": mask_dst.replace('\\', '/'),
                "image_url": f"/static/{loc_id}_tgt.png",
                "transform": list(tgt_transform)
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
        print(f"  --> Saved AOI [{loc_id}] with {w}x{h} px resolution.")

    # Save overall locations index
    with open('data/locations/locations_index.json', 'w') as f:
        json.dump(locations_summary, f, indent=2)
        
    print("\n[SUCCESS] Staged 5 real Sentinel-2 multi-location demonstration datasets!")

if __name__ == '__main__':
    main()
