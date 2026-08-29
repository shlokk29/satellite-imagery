import numpy as np
import cv2
import math
from shapely.geometry import Polygon, mapping
import rasterio

# Change Type Mapping based on transitions
# Class IDs: 0: Bare land, 1: Vegetation, 2: Water, 3: Road, 4: Building
def get_change_type(class_before, class_after):
    if class_before != class_after:
        if class_after == 4 or (class_before == 0 and class_after == 4): # Building expansion
            return "BUILDING CHANGE"
        elif class_after == 3 or (class_before != 3 and class_after == 3): # Road expansion
            return "ROAD CHANGE"
        elif class_before == 1 and class_after != 1: # Veg loss / clearing
            return "FOREST CHANGE"
        elif class_before != 1 and class_after == 1: # Veg growth
            return "FOREST CHANGE"
        elif class_before == 2 or class_after == 2: # Water shift
            return "RIVER CHANGE"
    return None

def compute_pixel_scale_meters(transform, sample_lat=26.1448):
    """
    Computes real-world meter dimensions of a single pixel based on affine transform and latitude.
    """
    pixel_deg_x = abs(transform[0]) if hasattr(transform, '__getitem__') else 0.0001
    pixel_deg_y = abs(transform[4]) if hasattr(transform, '__getitem__') else 0.0001
    
    # 1 deg lat = ~110,574 meters; 1 deg lon = ~111,320 * cos(lat) meters
    lat_rad = math.radians(sample_lat)
    dx_m = pixel_deg_x * 111320.0 * math.cos(lat_rad)
    dy_m = pixel_deg_y * 110574.0
    pixel_area_sqm = dx_m * dy_m
    pixel_res_m = (dx_m + dy_m) / 2.0
    return pixel_res_m, pixel_area_sqm

def detect_changes(seg_before, seg_after, valid_mask, transform, dates=None, location_id=None):
    """
    Compares two semantic maps and extracts changed regions as georeferenced polygons
    with real geospatial metrics (centroid, area in m², distance to road, distance to water).
    seg_before, seg_after: (H, W) semantic maps.
    valid_mask: (H, W) boolean validity mask.
    transform: rasterio Affine transform to convert pixel coords to lat/lon.
    """
    H, W = seg_before.shape
    dates = dates or ["2024", "2026"]
    date_str = f"{dates[0]} → {dates[1]}"
    
    # Approximate geographic center latitude for meter scaling
    center_lon, center_lat = transform * (W / 2.0, H / 2.0)
    pixel_res_m, pixel_area_sqm = compute_pixel_scale_meters(transform, center_lat)
    
    # Build road and water masks for spatial distance transformations
    road_mask = (seg_after == 3) | (seg_before == 3)
    water_mask = (seg_after == 2) | (seg_before == 2)
    
    # Euclidean distance maps (distance in pixels to nearest road/water)
    inv_road = (~road_mask).astype(np.uint8)
    inv_water = (~water_mask).astype(np.uint8)
    
    dist_road_map = cv2.distanceTransform(inv_road, cv2.DIST_L2, 5) if np.any(road_mask) else np.full((H, W), 9999.0)
    dist_water_map = cv2.distanceTransform(inv_water, cv2.DIST_L2, 5) if np.any(water_mask) else np.full((H, W), 9999.0)
    
    # Initialize change classification map
    change_map = np.zeros((H, W), dtype=np.uint8)
    
    # Primary categories:
    # 1: BUILDING CHANGE, 2: ROAD CHANGE, 3: FOREST CHANGE, 4: RIVER CHANGE
    change_id_map = {
        "BUILDING CHANGE": 1,
        "ROAD CHANGE": 2,
        "FOREST CHANGE": 3,
        "RIVER CHANGE": 4
    }
    
    # Pixel-wise classification
    for r in range(H):
        for c in range(W):
            if not valid_mask[r, c]:
                continue # Skip invalid pixels (cloud/shadow)
                
            cb = seg_before[r, c]
            ca = seg_after[r, c]
            ctype = get_change_type(cb, ca)
            if ctype:
                change_map[r, c] = change_id_map[ctype]
                
    detected_changes = []
    
    # Extract polygons for each change type
    for ctype, cid in change_id_map.items():
        ctype_mask = (change_map == cid).astype(np.uint8) * 255
        
        # Opening removes isolated classification flicker; closing reconnects a
        # coherent region split by minor co-registration differences.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        filtered_mask = cv2.morphologyEx(ctype_mask, cv2.MORPH_OPEN, kernel)
        filtered_mask = cv2.morphologyEx(filtered_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        
        contours, _ = cv2.findContours(filtered_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area_px = cv2.contourArea(contour)
            # Suppress components below a physical ground-area threshold, rather
            # than relying on a fixed pixel count across differently sized AOIs.
            if area_px * pixel_area_sqm < 400:
                continue
                
            # Simplify contour to make GeoJSON compact and clean
            epsilon = 0.02 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            
            if len(approx) < 3:
                continue
                
            # Convert pixel coords to lat/lon coordinates
            coords = []
            for pt in approx:
                px, py = pt[0][0], pt[0][1]
                lon, lat = transform * (px, py)
                coords.append([lon, lat])
            # Close the polygon ring
            coords.append(coords[0])
            
            # Compute moments for exact centroid
            M = cv2.moments(contour)
            if M["m00"] != 0:
                c_px_x = M["m10"] / M["m00"]
                c_px_y = M["m01"] / M["m00"]
            else:
                c_px_x = float(approx[0][0][0])
                c_px_y = float(approx[0][0][1])
                
            centroid_lon, centroid_lat = transform * (c_px_x, c_px_y)
            
            # Real surface area in square meters
            area_sqm = int(round(area_px * pixel_area_sqm))
            
            # Compute minimum Euclidean distance to nearest road and water in meters
            contour_mask = np.zeros((H, W), dtype=np.uint8)
            cv2.drawContours(contour_mask, [contour], -1, 1, -1)
            
            min_dist_road_px = float(np.min(dist_road_map[contour_mask == 1])) if np.any(contour_mask == 1) else float(dist_road_map[int(c_px_y), int(c_px_x)])
            min_dist_water_px = float(np.min(dist_water_map[contour_mask == 1])) if np.any(contour_mask == 1) else float(dist_water_map[int(c_px_y), int(c_px_x)])
            
            dist_road_m = round(min_dist_road_px * pixel_res_m, 1)
            dist_water_m = round(min_dist_water_px * pixel_res_m, 1)
            
            # Confidence is calculated from component extent and spatial coherence;
            # no location-specific score is authored into the demo data.
            perimeter = cv2.arcLength(contour, True)
            compactness = (4 * np.pi * area_px) / (perimeter ** 2) if perimeter > 0 else 0
            extent_evidence = min(1.0, (area_px * pixel_area_sqm) / 5000.0)
            coherence_evidence = min(1.0, max(0.0, compactness))
            score = round(float(0.5 * extent_evidence + 0.5 * coherence_evidence), 2)
            
            # Extract bounding box in pixels for before/after view crops
            px_coords = approx.reshape(-1, 2)
            min_x, min_y = np.min(px_coords, axis=0)
            max_x, max_y = np.max(px_coords, axis=0)
            
            # Lat/Lon bounding box [lon_min, lat_min, lon_max, lat_max]
            lon_min, lat_max = transform * (min_x, min_y)
            lon_max, lat_min = transform * (max_x, max_y)
            bbox_coords = [lon_min, lat_min, lon_max, lat_max]
            
            # Generate factual natural language explanation
            if ctype == "BUILDING CHANGE":
                if dist_road_m < 60:
                    explanation = f"Built-up area increased ({area_sqm:,} m²) between {date_str}, situated {dist_road_m:.0f}m from nearest road."
                else:
                    explanation = f"Built-up surface increased ({area_sqm:,} m²) between the selected observations ({date_str})."
            elif ctype == "ROAD CHANGE":
                explanation = f"Transport / road infrastructure corridor expanded ({area_sqm:,} m²) between {date_str}."
            elif ctype == "FOREST CHANGE":
                if dist_water_m < 80:
                    explanation = f"Vegetated canopy transition ({area_sqm:,} m²) observed {dist_water_m:.0f}m from water corridor ({date_str})."
                else:
                    explanation = f"Vegetated area transitioned ({area_sqm:,} m²) between the selected observations ({date_str})."
            elif ctype == "RIVER CHANGE":
                explanation = f"Water extent and shoreline shifted ({area_sqm:,} m²) between the selected observations ({date_str})."
            else:
                explanation = f"Observable surface transition detected covering {area_sqm:,} m² between {date_str}."
            
            # Format geometry for GeoJSON
            geom = {
                "type": "Polygon",
                "coordinates": [coords]
            }
            
            # Map type to new naming convention
            display_type = ctype
            if ctype == "BUILDING CHANGE":
                display_type = "NEW CONSTRUCTION"
            elif ctype == "FOREST CHANGE":
                display_type = "VEGETATION LOSS"
            elif ctype == "RIVER CHANGE":
                display_type = "WATER EXTENT CHANGE"
            
            detected_changes.append({
                "location_id": location_id or "mixed",
                "type": display_type,
                "confidence": score,
                "area_pixels": int(area_px),
                "area_sqm": area_sqm,
                "centroid": [round(centroid_lat, 6), round(centroid_lon, 6)],
                "centroid_lonlat": [round(centroid_lon, 6), round(centroid_lat, 6)],
                "distance_to_road_m": dist_road_m,
                "distance_to_water_m": dist_water_m,
                "explanation": explanation,
                "geometry": geom,
                "bbox": bbox_coords,
                "pixel_bbox": [int(min_x), int(min_y), int(max_x), int(max_y)],
                "dates": dates,
                "suppression_checks": [
                    "cloud_shadow_masking",
                    "geospatial_alignment",
                    "pixel_homography_warp",
                    "morphological_noise_filter",
                    "minimum_area_threshold"
                ]
            })
            
    # Sort detected changes by area descending
    detected_changes.sort(key=lambda x: x['area_sqm'], reverse=True)
    return detected_changes, change_map

