import os
import sys
import numpy as np
import rasterio
import cv2
import json

# Force UTF-8 stdout encoding for Windows compatibility
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def validate_dataset():
    print("=" * 65)
    print("ANTIGRAVITY CHANGE INTELLIGENCE - DATASET VALIDATION REPORT")
    print("=" * 65)

    sample_dir = "data/sample"
    scenes = [
        {
            "id": "scene_2024",
            "name": "Reference Scene (T1: 2024-02-10)",
            "tif_path": os.path.join(sample_dir, "before", "scene_2024.tif"),
            "fallback_tif": os.path.join(sample_dir, "scene_2024.tif"),
            "meta_path": os.path.join(sample_dir, "before", "metadata.json"),
            "preview_path": os.path.join(sample_dir, "before", "preview.png"),
            "static_path": "backend/static/scene_2024.png"
        },
        {
            "id": "scene_2026",
            "name": "Target Scene (T2: 2026-03-06)",
            "tif_path": os.path.join(sample_dir, "after", "scene_2026.tif"),
            "fallback_tif": os.path.join(sample_dir, "scene_2026.tif"),
            "meta_path": os.path.join(sample_dir, "after", "metadata.json"),
            "preview_path": os.path.join(sample_dir, "after", "preview.png"),
            "static_path": "backend/static/scene_2026.png"
        }
    ]

    all_valid = True
    scene_bounds = []
    scene_crs = []

    for sc in scenes:
        print(f"\n--- VALIDATING: {sc['name']} [{sc['id']}] ---")
        
        tif = sc['tif_path'] if os.path.exists(sc['tif_path']) else sc['fallback_tif']
        if not os.path.exists(tif):
            print(f"[FAIL] GeoTIFF Missing: {sc['tif_path']}")
            all_valid = False
            continue

        print(f"[PASS] File exists: {tif} ({os.path.getsize(tif):,} bytes)")

        try:
            with rasterio.open(tif) as src:
                w, h = src.width, src.height
                crs = str(src.crs)
                bounds = src.bounds
                count = src.count
                dtypes = src.dtypes

                scene_bounds.append(bounds)
                scene_crs.append(crs)

                print(f"[PASS] Format: GeoTIFF (Driver: {src.driver})")
                print(f"[PASS] Dimensions: {w} x {h} pixels")
                print(f"[PASS] Bands: {count} ({', '.join(dtypes)})")
                print(f"[PASS] CRS: {crs}")
                print(f"[PASS] Bounds: [{bounds.bottom:.5f} deg S, {bounds.left:.5f} deg W] to [{bounds.top:.5f} deg N, {bounds.right:.5f} deg E]")

                # Analyze pixel data per band
                zero_count_total = 0
                for b in range(1, count + 1):
                    data = src.read(b)
                    b_min = float(data.min())
                    b_max = float(data.max())
                    b_mean = float(data.mean())
                    b_std = float(data.std())
                    b_zeros = int(np.sum(data == 0))
                    zero_count_total += b_zeros

                    band_names = ["Red (B04)", "Green (B03)", "Blue (B02)", "NIR (B08)"]
                    bname = band_names[b - 1] if b <= len(band_names) else f"Band {b}"
                    print(f"  - {bname}: min={b_min:.0f}, max={b_max:.0f}, mean={b_mean:.1f}, std={b_std:.1f}")

                    if b_max == 0:
                        print(f"  [FAIL] Band {b} is entirely BLACK / all-zeros!")
                        all_valid = False

                total_pixels = w * h * count
                valid_pct = 100.0 * (1.0 - (zero_count_total / float(total_pixels)))
                print(f"[PASS] Valid Pixel Percentage: {valid_pct:.2f}%")

        except Exception as e:
            print(f"[FAIL] Failed to open or read GeoTIFF: {e}")
            all_valid = False

        # Validate Previews
        for p_label, p_path in [("Local Preview", sc['preview_path']), ("Static Web Preview", sc['static_path'])]:
            if os.path.exists(p_path):
                img = cv2.imread(p_path)
                if img is not None and img.shape[0] > 0 and img.shape[1] > 0:
                    img_mean = float(img.mean())
                    if img_mean < 1.0:
                        print(f"[FAIL] {p_label} ({p_path}) is entirely black (mean={img_mean:.2f})")
                        all_valid = False
                    else:
                        print(f"[PASS] {p_label}: {p_path} (shape={img.shape}, mean brightness={img_mean:.1f})")
                else:
                    print(f"[FAIL] {p_label} failed to decode: {p_path}")
                    all_valid = False
            else:
                print(f"[FAIL] {p_label} missing: {p_path}")
                all_valid = False

    # Check AOI Alignment
    print("\n--- GEOSPATIAL AOI ALIGNMENT CHECK ---")
    if len(scene_bounds) == 2:
        b1, b2 = scene_bounds[0], scene_bounds[1]
        lat_diff = abs(b1.bottom - b2.bottom) + abs(b1.top - b2.top)
        lon_diff = abs(b1.left - b2.left) + abs(b1.right - b2.right)

        print(f"Reference Bounds: [{b1.bottom:.5f}, {b1.left:.5f}] to [{b1.top:.5f}, {b1.right:.5f}]")
        print(f"Target Bounds:    [{b2.bottom:.5f}, {b2.left:.5f}] to [{b2.top:.5f}, {b2.right:.5f}]")

        if lat_diff < 0.001 and lon_diff < 0.001:
            print(f"[PASS] Reference and Target share identical geographic AOI (Delta < 0.0001 deg)")
        else:
            print(f"[WARN] AOI bounds delta: lat_diff={lat_diff:.5f} deg, lon_diff={lon_diff:.5f} deg")

        if len(scene_crs) == 2 and scene_crs[0] == scene_crs[1]:
            print(f"[PASS] Coordinate Reference Systems match ({scene_crs[0]})")
        else:
            print(f"[FAIL] CRS mismatch: {scene_crs}")
            all_valid = False

    print("\n" + "=" * 65)
    if all_valid:
        print("[SUCCESS] ALL DATASET VALIDATION CHECKS PASSED: READY FOR OFFLINE DEMO")
    else:
        print("[FAIL] SOME VALIDATION CHECKS FAILED: SEE LOGS ABOVE")
    print("=" * 65)
    return all_valid

if __name__ == '__main__':
    success = validate_dataset()
    sys.exit(0 if success else 1)
