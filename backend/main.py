import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import json
import sqlite3
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response
import numpy as np
import rasterio
import cv2

# Import custom modules
from backend.database import init_db, save_scene, get_all_scenes, get_scene, save_changes, get_all_changes
from backend.gis.alignment import align_geospatial
from backend.ingest.preprocessing import preprocess_scene
from backend.models.segmentation import SemanticSegmenter
from backend.change.change_detection import detect_changes, compute_pixel_scale_meters
from backend.search.search import search_changes

app = FastAPI(title="AI-Powered Satellite Change Intelligence API (Multi-Location Multi-Temporal)")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base directory (project root, one level above backend/)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Setup directories
UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
LOCATIONS_DIR = os.path.join(BASE_DIR, "data", "locations")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(LOCATIONS_DIR, exist_ok=True)

# Mount static directory to serve generated PNGs
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.on_event("startup")
def startup_event():
    init_db()
    # Preload all 5 staged AOI demonstration locations from data/locations/locations_index.json
    try:
        index_file = os.path.join(LOCATIONS_DIR, "locations_index.json")
        if os.path.exists(index_file):
            with open(index_file, "r", encoding="utf-8") as f:
                locations = json.load(f)
                
            for loc in locations:
                loc_id = loc['location_id']
                ref_scene = loc['reference_scene']
                tgt_scene = loc['target_scene']
                
                ref_tif = os.path.join(BASE_DIR, ref_scene['file_path'])
                tgt_tif = os.path.join(BASE_DIR, tgt_scene['file_path'])
                mask_tif = os.path.join(BASE_DIR, tgt_scene.get('mask_path', '')) if tgt_scene.get('mask_path') else None
                
                if os.path.exists(ref_tif):
                    _ingest_local_file(
                        ref_tif, None, ref_scene['id'], loc_id,
                        ref_scene['name'], ref_scene['date']
                    )
                if os.path.exists(tgt_tif):
                    _ingest_local_file(
                        tgt_tif, mask_tif, tgt_scene['id'], loc_id,
                        tgt_scene['name'], tgt_scene['date']
                    )
            print(f"Successfully loaded {len(locations)} multi-location demonstration AOIs.")
    except Exception as e:
        print(f"Error preloading multi-location sample data: {e}")

def _ingest_local_file(tif_path, mask_path, scene_id, location_id, name, date):
    with rasterio.open(tif_path) as src:
        crs = str(src.crs)
        transform = list(src.transform)
        width = src.width
        height = src.height
        bounds = src.bounds # left, bottom, right, top
        
        # Calculate Leaflet WGS84 bounds [[latMin, lonMin], [latMax, lonMax]]
        if '4326' in crs or 'WGS 84' in crs:
            lat_min = float(bounds.bottom)
            lon_min = float(bounds.left)
            lat_max = float(bounds.top)
            lon_max = float(bounds.right)
        else:
            from rasterio.warp import transform_bounds
            wgs_bounds = transform_bounds(src.crs, 'EPSG:4326', *bounds)
            lon_min, lat_min, lon_max, lat_max = [float(x) for x in wgs_bounds]
            
        leaflet_bounds = [[lat_min, lon_min], [lat_max, lon_max]]
        resolution = abs(float(transform[0]))
        
        # Render PNG for static view
        r = src.read(1)
        g = src.read(2)
        b = src.read(3)
        img = np.stack([b, g, r], axis=-1)
        png_path = os.path.join(STATIC_DIR, f"{scene_id}.png")
        cv2.imwrite(png_path, img)
        
    save_scene(scene_id, location_id, name, tif_path, mask_path, date, crs, transform, leaflet_bounds, width, height, resolution)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "offline": True,
        "service": "Antigravity Change Intelligence",
        "engine": "FastAPI + OpenCV + Rasterio + Scikit-Learn",
        "archive_status": "6 Locations / 12 Sentinel-2 Observations Ready"
    }

@app.get("/locations")
def get_locations():
    """
    Returns the list of all available multi-location demonstration AOIs with metadata and scenes.
    """
    index_file = os.path.join(LOCATIONS_DIR, "locations_index.json")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    # Fallback default if index not yet generated
    scenes = get_all_scenes()
    return [{
        "location_id": "mixed",
        "name": "Mixed Landscape",
        "category": "MIXED CHANGE",
        "badge_icon": "🌍",
        "description": "Demonstration satellite observation region.",
        "center": [26.1725, 91.7499],
        "crs": "EPSG:4326"
    }]

@app.get("/scenes")
def get_scenes(location: str = Query(None)):
    scenes = get_all_scenes(location_id=location)
    for s in scenes:
        s['image_url'] = f"/static/{s['id']}.png"
        if 'bounds' in s and isinstance(s['bounds'], str) and s['bounds']:
            try:
                s['bounds'] = json.loads(s['bounds'])
            except Exception:
                pass
        if 'transform' in s and isinstance(s['transform'], str) and s['transform']:
            try:
                s['transform'] = json.loads(s['transform'])
            except Exception:
                pass
    return scenes

@app.post("/change-detect")
def run_change_detection(before_id: str, after_id: str, location_id: str = Query(None)):
    before_scene = get_scene(before_id)
    after_scene = get_scene(after_id)
    
    if not before_scene or not after_scene:
        raise HTTPException(status_code=404, detail="One or both scenes not found")
        
    loc = location_id or before_scene.get('location_id') or "mixed"
    
    try:
        # 1. Spatial alignment (reprojection + pixel ORB homography)
        ref_img, aligned_tgt, aligned_mask, ref_meta = align_geospatial(
            before_scene['file_path'],
            after_scene['file_path'],
            after_scene['mask_path']
        )
        
        # Save aligned target image to static folder for visual verification
        aligned_png_path = os.path.join(STATIC_DIR, f"{loc}_aligned_target.png")
        cv2.imwrite(aligned_png_path, np.stack([aligned_tgt[2], aligned_tgt[1], aligned_tgt[0]], axis=-1))
        
        # 2. Preprocessing & Normalization
        norm_ref, norm_tgt, valid_mask = preprocess_scene(ref_img, aligned_tgt, aligned_mask)
        
        # 3. Semantic understanding (classification)
        segmenter = SemanticSegmenter()
        seg_before = segmenter.segment(norm_ref)
        seg_after = segmenter.segment(norm_tgt)
        
        # Save segmentation maps as colored images for verification & visualization
        # Class colors: 0: Bare(brown), 1: Veg(green), 2: Water(blue), 3: Road(grey), 4: Build(red)
        colors = np.array([
            [120, 150, 180], # Bare land (BGR)
            [50, 150, 40],   # Vegetation
            [180, 60, 30],   # Water
            [100, 100, 100], # Road
            [80, 90, 210]    # Building
        ], dtype=np.uint8)
        
        color_before = colors[seg_before]
        color_after = colors[seg_after]
        
        cv2.imwrite(os.path.join(STATIC_DIR, f"{loc}_seg_before.png"), color_before)
        cv2.imwrite(os.path.join(STATIC_DIR, f"{loc}_seg_after.png"), color_after)
        
        # 4. Change Detection & False Change Suppression
        transform = ref_meta['transform']
        dates = [before_scene.get('date', '2024'), after_scene.get('date', '2026')]
        changes, change_map = detect_changes(seg_before, seg_after, valid_mask, transform, dates=dates, location_id=loc)
        
        # Calculate total scene area in km²
        H, W = seg_before.shape
        _, pixel_area_sqm = compute_pixel_scale_meters(transform)
        total_scene_sqm = H * W * pixel_area_sqm
        total_scene_sqkm = round(total_scene_sqm / 1_000_000.0, 2)
        
        # Render change map overlay as BGRA with full TRANSPARENCY for no-change pixels
        # 0: Transparent (alpha=0)
        # 1: BUILDING CHANGE -> Red [B=0, G=0, R=240, A=220]
        # 2: ROAD CHANGE -> Yellow [B=0, G=220, R=245, A=220]
        # 3: FOREST CHANGE -> Green [B=40, G=200, R=50, A=220]
        # 4: RIVER CHANGE -> Cyan [B=240, G=220, R=0, A=220]
        change_rgba = np.zeros((H, W, 4), dtype=np.uint8)
        change_rgba[change_map == 1] = [0, 0, 240, 220]
        change_rgba[change_map == 2] = [0, 220, 245, 220]
        change_rgba[change_map == 3] = [40, 200, 50, 220]
        change_rgba[change_map == 4] = [240, 220, 0, 220]
        
        cv2.imwrite(os.path.join(STATIC_DIR, f"{loc}_change_mask.png"), change_rgba)
        
        # Save to SQLite under this location
        save_changes(changes, location_id=loc)
        
        # Calculate summary statistics
        counts = {
            "NEW CONSTRUCTION": sum(1 for c in changes if c['type'] == "NEW CONSTRUCTION"),
            "VEGETATION LOSS": sum(1 for c in changes if c['type'] == "VEGETATION LOSS"),
            "WATER EXTENT CHANGE": sum(1 for c in changes if c['type'] == "WATER EXTENT CHANGE"),
            "ROAD CHANGE": sum(1 for c in changes if c['type'] == "ROAD CHANGE"),
        }
        
        summary = f"{len(changes)} significant change events verified across {total_scene_sqkm} km² AOI. " + ", ".join([f"{v} {k.lower()}s" for k, v in counts.items() if v > 0])
        
        # Cache segmentation arrays in app state for search
        app.state.seg_after = seg_after
        app.state.last_location = loc
        
        # Extract bounds
        ref_bounds = before_scene.get('bounds')
        if isinstance(ref_bounds, str) and ref_bounds:
            try:
                ref_bounds = json.loads(ref_bounds)
            except Exception:
                pass
        
        return {
            "status": "success",
            "location_id": loc,
            "summary": summary,
            "changes_count": len(changes),
            "total_area_sqkm": total_scene_sqkm,
            "dates": dates,
            "breakdown": counts,
            "bounds": ref_bounds,
            "changes": changes,
            "before_seg_url": f"/static/{loc}_seg_before.png",
            "after_seg_url": f"/static/{loc}_seg_after.png",
            "change_mask_url": f"/static/{loc}_change_mask.png",
            "aligned_target_url": f"/static/{loc}_aligned_target.png"
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")

@app.get("/changes")
def get_changes(location: str = Query(None)):
    return get_all_changes(location_id=location)

@app.post("/search")
def search(query: str, location: str = Query(None)):
    changes = get_all_changes(location_id=location)
    seg_after = getattr(app.state, "seg_after", None)
    results = search_changes(query, changes, seg_after, location_id=location)
    return results

@app.get("/export")
def export_report(format: str = "geojson", location: str = Query(None)):
    """
    Export change intelligence results in GeoJSON, CSV, or JSON format.
    """
    changes = get_all_changes(location_id=location)
    loc_tag = f"_{location}" if location else ""
    
    if format.lower() == "geojson":
        features = []
        for c in changes:
            feat = {
                "type": "Feature",
                "properties": {
                    "id": c.get("id"),
                    "location_id": c.get("location_id"),
                    "type": c.get("type"),
                    "confidence": c.get("confidence"),
                    "area_sqm": c.get("area_sqm"),
                    "area_pixels": c.get("area_pixels"),
                    "distance_to_road_m": c.get("distance_to_road_m"),
                    "distance_to_water_m": c.get("distance_to_water_m"),
                    "centroid_lat": c.get("centroid", [0,0])[0] if c.get("centroid") else None,
                    "centroid_lon": c.get("centroid", [0,0])[1] if c.get("centroid") else None,
                    "explanation": c.get("explanation"),
                    "dates": c.get("dates"),
                    "suppression_checks": c.get("suppression_checks")
                },
                "geometry": c.get("geometry")
            }
            features.append(feat)
            
        geojson_doc = {
            "type": "FeatureCollection",
            "name": f"Antigravity_Change_Intelligence_Export{loc_tag}",
            "crs": {
                "type": "name",
                "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
            },
            "features": features
        }
        return Response(
            content=json.dumps(geojson_doc, indent=2),
            media_type="application/geo+json",
            headers={"Content-Disposition": f"attachment; filename=change_intelligence{loc_tag}.geojson"}
        )
        
    elif format.lower() == "csv":
        import io
        import csv
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Location", "Change_Type", "Confidence_Score", "Area_Sqm", "Area_Pixels",
            "Centroid_Lat", "Centroid_Lon", "Dist_Road_Meters", "Dist_Water_Meters",
            "Dates", "Explanation"
        ])
        for c in changes:
            lat = c.get("centroid", [0,0])[0] if c.get("centroid") else ""
            lon = c.get("centroid", [0,0])[1] if c.get("centroid") else ""
            writer.writerow([
                c.get("id"),
                c.get("location_id"),
                c.get("type"),
                c.get("confidence"),
                c.get("area_sqm"),
                c.get("area_pixels"),
                lat,
                lon,
                c.get("distance_to_road_m"),
                c.get("distance_to_water_m"),
                " -> ".join(c.get("dates", [])),
                c.get("explanation")
            ])
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=change_intelligence{loc_tag}.csv"}
        )
        
    else: # JSON format
        report = {
            "title": "Antigravity Change Intelligence Report",
            "location_id": location,
            "timestamp": "2026-08-29",
            "total_changes": len(changes),
            "changes": changes
        }
        return Response(
            content=json.dumps(report, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=change_intelligence{loc_tag}.json"}
        )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

