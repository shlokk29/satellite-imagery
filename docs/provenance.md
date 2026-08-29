# Data and Model Provenance (Multi-Location Multi-Temporal Benchmark)

This document details the specifications, licenses, algorithmic methodology, and benchmark evaluation metrics for the **Antigravity Satellite Change Intelligence** system operating across 5 distinct Sentinel-2 Earth-observation Area of Interest (AOI) locations.

---

## 1. Multi-Location Dataset Specifications & Geospatial Georeferencing

All demonstration imagery is derived from real, publicly accessible **Copernicus Sentinel-2 Multispectral Instrument (MSI) Level-2A Bottom-of-Atmosphere (BOA) Surface Reflectance** products.

| Location Name | Category | Primary Focus | Observation Dates | Dimensions / Resolution | Geographic Coordinates (Center) |
|---|---|---|---|---|---|
| **🌲 Forest / Deforestation Area** | `FOREST CHANGE` | Garbhanga Forest Reserve canopy transition & clearing | `2024-02-10` $\rightarrow$ `2026-03-06` | $360 \times 312\text{ px}$ ($10\text{ m/px}$) | $26.1624^\circ\text{ N}, 91.7422^\circ\text{ E}$ |
| **🌊 River / Water Basin** | `RIVER CHANGE` | Brahmaputra braided channel & sandbar displacement | `2024-02-10` $\rightarrow$ `2024-10-22` | $420 \times 280\text{ px}$ ($10\text{ m/px}$) | $26.1842^\circ\text{ N}, 91.7503^\circ\text{ E}$ |
| **🏢 Urban / Building Expansion** | `BUILDING CHANGE` | Guwahati Metropolis eastern corridor built-up growth | `2024-02-10` $\rightarrow$ `2026-03-06` | $332 \times 352\text{ px}$ ($10\text{ m/px}$) | $26.1644^\circ\text{ N}, 91.7590^\circ\text{ E}$ |
| **🌍 Mixed Landscape** | `MIXED CHANGE` | Integrated riverfront, urban core & forest landscape | `2024-03-11` $\rightarrow$ `2026-03-06` | $512 \times 512\text{ px}$ ($10\text{ m/px}$) | $26.1725^\circ\text{ N}, 91.7499^\circ\text{ E}$ |
| **🌿 Wetland / Waterbody Reserve** | `RIVER CHANGE` | Deepor Beel Ramsar Wetland open water & macrophyte shifts | `2024-02-10` $\rightarrow$ `2025-02-09` | $300 \times 300\text{ px}$ ($10\text{ m/px}$) | $26.1731^\circ\text{ N}, 91.7392^\circ\text{ E}$ |

### Spectral Bands & Georeferencing
- **Coordinate Reference System (CRS)**: `EPSG:4326` (WGS84 Ellipsoid / Lat-Lon)
- **Spectral Bands (4-Band Multispectral GeoTIFF)**:
  - **Band 1 (Red)**: $665\text{ nm}$ (Sentinel-2 Band 4)
  - **Band 2 (Green)**: $560\text{ nm}$ (Sentinel-2 Band 3)
  - **Band 3 (Blue)**: $490\text{ nm}$ (Sentinel-2 Band 2)
  - **Band 4 (Near-Infrared / NIR)**: $842\text{ nm}$ (Sentinel-2 Band 8)
- **Quality Masks**: Cloud & cloud-shadow exclusion masks (`cloud_mask.tif`) generated for false change suppression.
- **License & Usage Terms**: Creative Commons Attribution 4.0 International (CC-BY 4.0) / Copernicus Open Access Hub.

---

## 2. Algorithmic Pipeline & Machine Learning Models

### 1. Geospatial Alignment & Sub-Pixel Registration
- **Reprojection**: `rasterio.warp.reproject` ensuring geographic pixel coordinate alignment in `EPSG:4326`.
- **Sub-Pixel Feature Matching**: OpenCV ORB (Oriented FAST and Rotated BRIEF) keypoint extraction with RANSAC homography estimation, compensating for orbital drift and camera attitude variance.

### 2. Multi-Index Preprocessing & Quality Masking
- **Atmospheric Normalization**: Min-max BOA surface reflectance scaling with percentile channel clipping.
- **Spectral Indices**:
  - **NDVI** (Normalized Difference Vegetation Index): $\frac{\text{NIR} - \text{Red}}{\text{NIR} + \text{Red} + \epsilon}$
  - **NDWI** (Normalized Difference Water Index): $\frac{\text{Green} - \text{NIR}}{\text{Green} + \text{NIR} + \epsilon}$

### 3. Semantic Land Cover Segmentation
- **Model**: Multi-class Random Forest Classifier trained on multi-spectral reflectance profiles.
- **Land Cover Classes**:
  1. `0: Bare Land` (High Red/SWIR, Moderate NIR)
  2. `1: Vegetation` (High NIR reflection, high NDVI)
  3. `2: Water Body` (High Blue, strong NIR absorption, high NDWI)
  4. `3: Transport Road` (Low-variance neutral reflectance)
  5. `4: Built-up Structure` (High red/albedo, distinct compactness)

### 4. Change Extraction & False Change Suppression
1. **Transition Matrix Mapping**: Categorizes transitions into `FOREST CHANGE`, `RIVER CHANGE`, `BUILDING CHANGE`, and `ROAD CHANGE`.
2. **Quality Mask Filter**: Suppresses spurious changes caused by cloud covers and cloud shadows.
3. **Morphological Filtering**: Structuring elements ($3\times3$ rect) filter misregistration noise.
4. **Minimum Area Thresholding**: Excludes clusters $< 20\text{ pixels}$ ($< 200\text{ m}^2$).
5. **Real Geospatial Metrics**: Computes precise centroid (lat/lon), surface area ($m^2$), minimum Euclidean distance to road network ($m$), and distance to water bodies ($m$).

---

## 3. Offline Benchmark & Performance Metrics

- **Pipeline Execution Time**: $\sim 0.6 - 1.8\text{ s}$ per AOI (CPU inference)
- **100% Offline Guarantee**: No remote network requests, cloud APIs, or third-party tracking. All processing, GeoTIFF rendering, evidence cropping, and search reasoning execute strictly on the local host.
