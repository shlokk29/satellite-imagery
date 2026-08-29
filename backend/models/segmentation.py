import numpy as np
from sklearn.ensemble import RandomForestClassifier

# Class mappings
CLASS_MAP = {
    0: 'Bare land',
    1: 'Vegetation',
    2: 'Water',
    3: 'Road',
    4: 'Building'
}

class SemanticSegmenter:
    def __init__(self):
        self.model = None
        self._train_baseline_model()
        
    def _compute_features(self, img_normalized):
        """
        Computes features for each pixel.
        img_normalized: (4, H, W) float array (R, G, B, NIR)
        Returns:
            features: (H*W, 6) array containing R, G, B, N, NDVI, NDWI
        """
        R = img_normalized[0]
        G = img_normalized[1]
        B = img_normalized[2]
        N = img_normalized[3]
        
        # NDVI = (NIR - Red) / (NIR + Red)
        ndvi = (N - R) / (N + R + 1e-5)
        # NDWI = (Green - NIR) / (Green + NIR)
        ndwi = (G - N) / (G + N + 1e-5)
        
        H, W = R.shape
        features = np.stack([
            R.ravel(),
            G.ravel(),
            B.ravel(),
            N.ravel(),
            ndvi.ravel(),
            ndwi.ravel()
        ], axis=1)
        
        return features, H, W

    def _train_baseline_model(self):
        """
        Train a Random Forest classifier on synthetic pixel spectral profiles.
        """
        # Feature profile: [R, G, B, NIR, NDVI, NDWI]
        # We will create 20 synthetic training samples per class to represent remote sensing bands
        np.random.seed(42)
        X_train = []
        y_train = []
        
        # Class 0: Bare Land (Higher Red than NIR, negative to low NDVI)
        for _ in range(80):
            r = np.random.normal(0.46, 0.04)
            g = np.random.normal(0.38, 0.03)
            b = np.random.normal(0.28, 0.03)
            n = np.random.normal(0.38, 0.04)
            ndvi = (n - r) / (n + r + 1e-5)
            ndwi = (g - n) / (g + n + 1e-5)
            X_train.append([r, g, b, n, ndvi, ndwi])
            y_train.append(0)
            
        # Class 1: Vegetation (Strong NIR reflectance, high NDVI > 0.35)
        for _ in range(80):
            r = np.random.normal(0.20, 0.03)
            g = np.random.normal(0.35, 0.03)
            b = np.random.normal(0.18, 0.03)
            n = np.random.normal(0.68, 0.05)
            ndvi = (n - r) / (n + r + 1e-5)
            ndwi = (g - n) / (g + n + 1e-5)
            X_train.append([r, g, b, n, ndvi, ndwi])
            y_train.append(1)
            
        # Class 2: Water (Strong NIR absorption, high NDWI > 0.3)
        for _ in range(80):
            r = np.random.normal(0.12, 0.02)
            g = np.random.normal(0.22, 0.03)
            b = np.random.normal(0.48, 0.04)
            n = np.random.normal(0.08, 0.02)
            ndvi = (n - r) / (n + r + 1e-5)
            ndwi = (g - n) / (g + n + 1e-5)
            X_train.append([r, g, b, n, ndvi, ndwi])
            y_train.append(2)
            
        # Class 3: Road (Neutral grey reflectance, balanced spectrum)
        for _ in range(80):
            r = np.random.normal(0.30, 0.03)
            g = np.random.normal(0.30, 0.03)
            b = np.random.normal(0.30, 0.03)
            n = np.random.normal(0.28, 0.03)
            ndvi = (n - r) / (n + r + 1e-5)
            ndwi = (g - n) / (g + n + 1e-5)
            X_train.append([r, g, b, n, ndvi, ndwi])
            y_train.append(3)
            
        # Class 4: Building (High albedo/reflectance in Red/NIR, low NDVI)
        for _ in range(80):
            r = np.random.normal(0.62, 0.05)
            g = np.random.normal(0.50, 0.04)
            b = np.random.normal(0.42, 0.04)
            n = np.random.normal(0.52, 0.04)
            ndvi = (n - r) / (n + r + 1e-5)
            ndwi = (g - n) / (g + n + 1e-5)
            X_train.append([r, g, b, n, ndvi, ndwi])
            y_train.append(4)
            
        self.model = RandomForestClassifier(n_estimators=50, random_state=42)
        self.model.fit(np.array(X_train), np.array(y_train))
        
    def segment(self, img_normalized):
        """
        Segments the input image.
        img_normalized: (4, H, W) float array
        Returns:
            seg_map: (H, W) uint8 array of class labels (0 to 4)
        """
        features, H, W = self._compute_features(img_normalized)
        preds = self.model.predict(features)
        return preds.reshape(H, W).astype(np.uint8)
