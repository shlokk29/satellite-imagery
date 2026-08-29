import numpy as np
import cv2
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine

def align_geospatial(ref_path, target_path, mask_path=None):
    """
    Align target_path (and optional mask_path) to ref_path's grid, CRS, and transform.
    Returns:
        ref_img: np.ndarray (4, H, W)
        aligned_img: np.ndarray (4, H, W)
        aligned_mask: np.ndarray (H, W) or None
        ref_meta: dict
    """
    with rasterio.open(ref_path) as ref_src:
        ref_meta = ref_src.meta.copy()
        ref_img = ref_src.read() # shape: (4, H, W)
        
    with rasterio.open(target_path) as tgt_src:
        tgt_img = tgt_src.read()
        tgt_meta = tgt_src.meta.copy()
        
    # Step 1: Geospatial Reprojection
    # If the spatial bounds or CRS don't match, reproject target to ref's grid
    reprojected_tgt = np.zeros_like(ref_img)
    reproject(
        source=tgt_img,
        destination=reprojected_tgt,
        src_transform=tgt_meta['transform'],
        src_crs=tgt_meta['crs'],
        dst_transform=ref_meta['transform'],
        dst_crs=ref_meta['crs'],
        resampling=Resampling.bilinear
    )
    
    reprojected_mask = None
    if mask_path:
        with rasterio.open(mask_path) as mask_src:
            mask_img = mask_src.read(1) # single band
            mask_transform = mask_src.transform
            mask_crs = mask_src.crs
        
        reprojected_mask = np.zeros((ref_meta['height'], ref_meta['width']), dtype=np.uint8)
        reproject(
            source=mask_img,
            destination=reprojected_mask,
            src_transform=mask_transform,
            src_crs=mask_crs,
            dst_transform=ref_meta['transform'],
            dst_crs=ref_meta['crs'],
            resampling=Resampling.nearest
        )
    
    # Step 2: Fine Pixel Alignment (ECC or ORB)
    # We will use ORB keypoint matching to compute a homography matrix
    # for fine registration to handle small shifts/distortions.
    # Convert first band to uint8 for matching
    ref_gray = ref_img[0]
    tgt_gray = reprojected_tgt[0]
    
    # Find ORB keypoints
    orb = cv2.ORB_create(nfeatures=1000)
    kp1, des1 = orb.detectAndCompute(ref_gray, None)
    kp2, des2 = orb.detectAndCompute(tgt_gray, None)
    
    fine_aligned_tgt = reprojected_tgt.copy()
    fine_aligned_mask = reprojected_mask.copy() if reprojected_mask is not None else None
    
    if des1 is not None and des2 is not None and len(kp1) > 10 and len(kp2) > 10:
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        matches = sorted(matches, key=lambda x: x.distance)
        
        # Take top matches
        good_matches = matches[:50]
        if len(good_matches) >= 4:
            src_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            
            H, status = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
            if H is not None:
                h, w = ref_meta['height'], ref_meta['width']
                # Warp each band
                for i in range(reprojected_tgt.shape[0]):
                    fine_aligned_tgt[i] = cv2.warpPerspective(reprojected_tgt[i], H, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                
                if reprojected_mask is not None:
                    fine_aligned_mask = cv2.warpPerspective(reprojected_mask, H, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
                    
    return ref_img, fine_aligned_tgt, fine_aligned_mask, ref_meta
