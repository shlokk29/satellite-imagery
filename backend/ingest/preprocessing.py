import numpy as np

def preprocess_scene(ref_img, target_img, target_mask=None):
    """
    Normalizes images and returns valid masks.
    ref_img, target_img are (4, H, W) numpy arrays.
    Returns:
        norm_ref: normalized reference image (0.0 to 1.0)
        norm_target: normalized target image (0.0 to 1.0)
        valid_mask: boolean mask (H, W) where True means valid (no cloud/shadow)
    """
    # Normalize to 0-1 float
    norm_ref = ref_img.astype(np.float32) / 255.0
    norm_target = target_img.astype(np.float32) / 255.0
    
    H, W = ref_img.shape[1], ref_img.shape[2]
    
    # Generate validity mask
    # True means valid, False means invalid (cloud or shadow)
    valid_mask = np.ones((H, W), dtype=bool)
    
    if target_mask is not None:
        # Our quality mask has 0 for cloud/shadow, 255/nonzero for valid
        valid_mask = (target_mask > 0)
        
    return norm_ref, norm_target, valid_mask
