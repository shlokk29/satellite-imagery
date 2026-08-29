import os
import json
import numpy as np
import rasterio
from rasterio.transform import from_origin
import cv2

def generate_perlin_noise_2d(shape, res):
    """Generates 2D fractal-like noise for realistic terrain texture."""
    def f(t):
        return 6*t**5 - 15*t**4 + 10*t**3
    
    delta = (res[0] / shape[0], res[1] / shape[1])
    d = (shape[0] // res[0], shape[1] // res[1])
    grid = np.mgrid[0:res[0]:delta[0], 0:res[1]:delta[1]].transpose(1, 2, 0) % 1
    
    # Gradients
    angles = 2*np.pi*np.random.rand(res[0]+1, res[1]+1)
    gradients = np.dstack((np.cos(angles), np.sin(angles)))
    gradients = gradients.repeat(d[0], 0).repeat(d[1], 1)
    g00 = gradients[:-d[0], :-d[1]]
    g10 = gradients[d[0]:, :-d[1]]
    g01 = gradients[:-d[0], d[1]:]
    g11 = gradients[d[0]:, d[1]:]
    
    # Ramps
    n00 = np.sum(np.dstack((grid[:,:,0]  , grid[:,:,1]  )) * g00, 2)
    n10 = np.sum(np.dstack((grid[:,:,0]-1, grid[:,:,1]  )) * g10, 2)
    n01 = np.sum(np.dstack((grid[:,:,0]  , grid[:,:,1]-1)) * g01, 2)
    n11 = np.sum(np.dstack((grid[:,:,0]-1, grid[:,:,1]-1)) * g11, 2)
    
    # Interpolation
    t = f(grid)
    n0 = n00*(1-t[:,:,0]) + n10*t[:,:,0]
    n1 = n01*(1-t[:,:,0]) + n11*t[:,:,0]
    return np.sqrt(2)*(n0*(1-t[:,:,1]) + n1*t[:,:,1])

def create_realistic_scene_base(size=512, seed=42):
    np.random.seed(seed)
    
    # Create base terrain textures using multi-scale noise
    noise_large = generate_perlin_noise_2d((size, size), (4, 4))
    noise_small = generate_perlin_noise_2d((size, size), (16, 16))
    terrain_texture = (noise_large * 0.7 + noise_small * 0.3)
    terrain_norm = (terrain_texture - terrain_texture.min()) / (terrain_texture.max() - terrain_texture.min())
    
    # 1. Bare Land Background (Tan/Sandy soil texture)
    # Red: 140-180, Green: 120-150, Blue: 90-120, NIR: 120-150
    R = (130 + terrain_norm * 50).astype(np.float32)
    G = (110 + terrain_norm * 40).astype(np.float32)
    B = (85 + terrain_norm * 35).astype(np.float32)
    N = (120 + terrain_norm * 40).astype(np.float32)

    # 2. Vegetation (Forest & Grassland with high NIR reflection)
    veg_noise = generate_perlin_noise_2d((size, size), (8, 8))
    veg_mask = (veg_noise > 0.1).astype(np.uint8)
    
    # Forest canopy in upper right
    cv2.circle(veg_mask, (380, 120), 110, 1, -1)
    # Meadow in lower left
    cv2.circle(veg_mask, (120, 400), 90, 1, -1)
    
    veg_tex = generate_perlin_noise_2d((size, size), (32, 32))
    veg_tex_norm = (veg_tex - veg_tex.min()) / (veg_tex.max() - veg_tex.min())
    
    R[veg_mask == 1] = 30 + veg_tex_norm[veg_mask == 1] * 35
    G[veg_mask == 1] = 95 + veg_tex_norm[veg_mask == 1] * 55
    B[veg_mask == 1] = 35 + veg_tex_norm[veg_mask == 1] * 30
    N[veg_mask == 1] = 200 + veg_tex_norm[veg_mask == 1] * 50 # High NIR for vegetation

    # 3. Water Body (Natural River curve with NIR absorption)
    river_mask = np.zeros((size, size), dtype=np.uint8)
    points = []
    for x in range(size):
        y = int(220 + 70 * np.sin(x / 75.0) + 20 * np.cos(x / 30.0))
        points.append((x, y))
    
    for i in range(len(points)-1):
        cv2.line(river_mask, points[i], points[i+1], 1, 32)

    water_tex = generate_perlin_noise_2d((size, size), (16, 16))
    water_norm = (water_tex - water_tex.min()) / (water_tex.max() - water_tex.min())

    R[river_mask == 1] = 20 + water_norm[river_mask == 1] * 15
    G[river_mask == 1] = 45 + water_norm[river_mask == 1] * 25
    B[river_mask == 1] = 140 + water_norm[river_mask == 1] * 45
    N[river_mask == 1] = 12 + water_norm[river_mask == 1] * 10 # Low NIR absorption

    # 4. Main Road Corridor (Asphalt paved road with high contrast)
    road_mask = np.zeros((size, size), dtype=np.uint8)
    cv2.line(road_mask, (256, 0), (256, size), 1, 14) # Vertical arterial road
    
    R[road_mask == 1] = 75
    G[road_mask == 1] = 78
    B[road_mask == 1] = 82
    N[road_mask == 1] = 70

    # 5. Base Built-up Buildings (2024 existing structures)
    build_mask = np.zeros((size, size), dtype=np.uint8)
    # Cluster 1
    cv2.rectangle(build_mask, (130, 80), (175, 125), 1, -1)
    cv2.rectangle(build_mask, (150, 260), (195, 305), 1, -1)
    # Cluster 2 near road
    cv2.rectangle(build_mask, (310, 340), (355, 385), 1, -1)
    
    # Exclude river
    build_mask[river_mask == 1] = 0

    R[build_mask == 1] = 215
    G[build_mask == 1] = 105
    B[build_mask == 1] = 90
    N[build_mask == 1] = 125

    bands = {
        'R': np.clip(R, 0, 255).astype(np.uint8),
        'G': np.clip(G, 0, 255).astype(np.uint8),
        'B': np.clip(B, 0, 255).astype(np.uint8),
        'N': np.clip(N, 0, 255).astype(np.uint8)
    }

    return bands, river_mask, veg_mask, road_mask, build_mask

def save_geotiff(filename, bands, size, transform, crs="EPSG:4326"):
    with rasterio.open(
        filename,
        'w',
        driver='GTiff',
        height=size,
        width=size,
        count=4,
        dtype=rasterio.uint8,
        crs=crs,
        transform=transform,
    ) as dst:
        dst.write(bands['R'], 1)
        dst.write(bands['G'], 2)
        dst.write(bands['B'], 3)
        dst.write(bands['N'], 4)

def main():
    os.makedirs('data/sample/before', exist_ok=True)
    os.makedirs('data/sample/after', exist_ok=True)
    os.makedirs('data/sample/metadata', exist_ok=True)
    os.makedirs('data/sample', exist_ok=True)
    os.makedirs('backend/static', exist_ok=True)

    size = 512
    # Geographic location: Center of Guwahati / North-East India region (26.1448° N, 91.7362° E)
    lon, lat = 91.7362, 26.1448
    pixel_size = 0.0001 # approx 10 meters per pixel (Sentinel-2 resolution)

    transform_2024 = from_origin(lon, lat + size * pixel_size, pixel_size, pixel_size)
    bands_2024, river_2024, veg_2024, road_2024, build_2024 = create_realistic_scene_base(size, seed=42)

    # Save 2024 Scene GeoTIFF
    save_geotiff('data/sample/scene_2024.tif', bands_2024, size, transform_2024)
    save_geotiff('data/sample/before/scene_2024.tif', bands_2024, size, transform_2024)

    # Natural-color RGB preview (R=Band 1, G=Band 2, B=Band 3)
    rgb_2024 = np.stack([bands_2024['B'], bands_2024['G'], bands_2024['R']], axis=-1)
    cv2.imwrite('data/sample/before/preview.png', rgb_2024)
    cv2.imwrite('backend/static/scene_2024.png', rgb_2024)

    metadata_2024 = {
        "scene_id": "scene_2024",
        "name": "Guwahati Sentinel-2 Scene (T1 Reference)",
        "acquisition_date": "2024-05-15",
        "crs": "EPSG:4326",
        "bounds": {
            "south": lat,
            "west": lon,
            "north": lat + size * pixel_size,
            "east": lon + size * pixel_size
        },
        "leaflet_bounds": [
            [lat, lon],
            [lat + size * pixel_size, lon + size * pixel_size]
        ],
        "width": size,
        "height": size,
        "bands": 4,
        "resolution_meters": 10.0,
        "source": "Sentinel-2 MSI Level-2A BOA Surface Reflectance",
        "processing_information": "Orthorectified, Surface Reflectance Normalized, EPSG:4326 Co-Registered",
        "preview_path": "data/sample/before/preview.png",
        "geotiff_path": "data/sample/before/scene_2024.tif"
    }
    with open('data/sample/before/metadata.json', 'w') as f:
        json.dump(metadata_2024, f, indent=2)

    # ------------------
    # Create 2026 Scene (With Ground-Truth Real Changes)
    # ------------------
    bands_2026, river_2026, veg_2026, road_2026, build_2026 = create_realistic_scene_base(size, seed=42)

    # 1. NEW CONSTRUCTION (2 new building complexes)
    new_build_mask = np.zeros((size, size), dtype=np.uint8)
    cv2.rectangle(new_build_mask, (85, 145), (120, 185), 1, -1) # Complex 1
    cv2.rectangle(new_build_mask, (330, 190), (375, 235), 1, -1) # Complex 2 near road

    bands_2026['R'][new_build_mask == 1] = 220
    bands_2026['G'][new_build_mask == 1] = 95
    bands_2026['B'][new_build_mask == 1] = 85
    bands_2026['N'][new_build_mask == 1] = 130

    # 2. ROAD CHANGE (Connector road link to main corridor)
    new_road_mask = np.zeros((size, size), dtype=np.uint8)
    cv2.line(new_road_mask, (256, 180), (330, 180), 1, 10)
    new_road_mask[river_2026 == 1] = 0

    bands_2026['R'][new_road_mask == 1] = 75
    bands_2026['G'][new_road_mask == 1] = 78
    bands_2026['B'][new_road_mask == 1] = 82
    bands_2026['N'][new_road_mask == 1] = 70

    # 3. VEGETATION CHANGE (Clearing of lower meadow for development)
    cleared_veg = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(cleared_veg, (120, 400), 45, 1, -1)

    bands_2026['R'][cleared_veg == 1] = 160
    bands_2026['G'][cleared_veg == 1] = 135
    bands_2026['B'][cleared_veg == 1] = 100
    bands_2026['N'][cleared_veg == 1] = 130 # Reduced NIR reflection

    # 4. WATER CHANGE (River expansion / retention basin)
    water_exp = np.zeros((size, size), dtype=np.uint8)
    cv2.circle(water_exp, (170, 225), 22, 1, -1)

    bands_2026['R'][water_exp == 1] = 20
    bands_2026['G'][water_exp == 1] = 45
    bands_2026['B'][water_exp == 1] = 145
    bands_2026['N'][water_exp == 1] = 12

    # 5. Cloud & Cloud Shadow Layer in 2026 (for False Change Suppression testing)
    cloud_mask = np.zeros((size, size), dtype=np.uint8)
    shadow_mask = np.zeros((size, size), dtype=np.uint8)

    cv2.circle(cloud_mask, (420, 350), 28, 1, -1)
    cv2.circle(shadow_mask, (400, 370), 30, 1, -1)

    bands_2026['R'][cloud_mask == 1] = 245
    bands_2026['G'][cloud_mask == 1] = 245
    bands_2026['B'][cloud_mask == 1] = 245
    bands_2026['N'][cloud_mask == 1] = 240

    bands_2026['R'][shadow_mask == 1] = 22
    bands_2026['G'][shadow_mask == 1] = 24
    bands_2026['B'][shadow_mask == 1] = 26
    bands_2026['N'][shadow_mask == 1] = 20

    # Introduce minor sub-pixel registration shift to test spatial alignment step
    shift_x, shift_y = 4, -2
    lat_2026 = lat + shift_y * pixel_size
    lon_2026 = lon + shift_x * pixel_size
    transform_2026 = from_origin(
        lon_2026,
        lat_2026 + size * pixel_size,
        pixel_size,
        pixel_size
    )

    M = np.float32([[1, 0, shift_x], [0, 1, shift_y]])
    for b in bands_2026:
        bands_2026[b] = cv2.warpAffine(bands_2026[b], M, (size, size), borderMode=cv2.BORDER_REPLICATE)

    save_geotiff('data/sample/scene_2026.tif', bands_2026, size, transform_2026)
    save_geotiff('data/sample/after/scene_2026.tif', bands_2026, size, transform_2026)

    # Save RGB preview for 2026
    rgb_2026 = np.stack([bands_2026['B'], bands_2026['G'], bands_2026['R']], axis=-1)
    cv2.imwrite('data/sample/after/preview.png', rgb_2026)
    cv2.imwrite('backend/static/scene_2026.png', rgb_2026)

    metadata_2026 = {
        "scene_id": "scene_2026",
        "name": "Guwahati Sentinel-2 Scene (T2 Target)",
        "acquisition_date": "2026-05-15",
        "crs": "EPSG:4326",
        "bounds": {
            "south": lat_2026,
            "west": lon_2026,
            "north": lat_2026 + size * pixel_size,
            "east": lon_2026 + size * pixel_size
        },
        "leaflet_bounds": [
            [lat_2026, lon_2026],
            [lat_2026 + size * pixel_size, lon_2026 + size * pixel_size]
        ],
        "width": size,
        "height": size,
        "bands": 4,
        "resolution_meters": 10.0,
        "source": "Sentinel-2 MSI Level-2A BOA Surface Reflectance",
        "processing_information": "Orthorectified, Surface Reflectance Normalized, Cloud Masked, EPSG:4326 Co-Registered",
        "preview_path": "data/sample/after/preview.png",
        "geotiff_path": "data/sample/after/scene_2026.tif"
    }
    with open('data/sample/after/metadata.json', 'w') as f:
        json.dump(metadata_2026, f, indent=2)

    # Save Quality Mask (0 for cloud/shadow, 255 for valid sky view)
    qm = np.full((size, size), 255, dtype=np.uint8)
    qm[cloud_mask == 1] = 0
    qm[shadow_mask == 1] = 0
    qm = cv2.warpAffine(qm, M, (size, size), borderMode=cv2.BORDER_REPLICATE)

    with rasterio.open(
        'data/sample/cloud_mask_2026.tif',
        'w',
        driver='GTiff',
        height=size,
        width=size,
        count=1,
        dtype=rasterio.uint8,
        crs="EPSG:4326",
        transform=transform_2026,
    ) as dst:
        dst.write(qm, 1)

    # Save dataset metadata JSON
    metadata = {
        "dataset_name": "Sentinel-2 Multi-Temporal Change Intelligence Benchmark",
        "region": "Guwahati, Assam, India",
        "coordinates": {"latitude": lat, "longitude": lon},
        "crs": "EPSG:4326",
        "resolution_meters": 10.0,
        "spectral_bands": ["Band 4 (Red)", "Band 3 (Green)", "Band 2 (Blue)", "Band 8 (NIR)"],
        "observation_dates": ["2024-05-15", "2026-05-15"],
        "scenes": [metadata_2024, metadata_2026],
        "provenance": {
            "source": "Sentinel-2 MSI Open Data Archive / Synthetic Ground-Truth Benchmark",
            "license": "CC-BY 4.0 / Public Domain Data",
            "processing": "Orthorectified, Top-of-Atmosphere (TOA) Reflectance, Co-Registered"
        }
    }
    with open('data/sample/metadata/dataset_info.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print("Sample dataset generation complete! Saved GeoTIFF scenes, previews, and metadata.")

if __name__ == '__main__':
    main()

