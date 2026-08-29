import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, ImageOverlay, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import { 
  Search, 
  ShieldCheck, 
  Map as MapIcon, 
  Eye, 
  Download, 
  Sliders, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  Crosshair, 
  FileJson, 
  FileSpreadsheet, 
  Info,
  Layers,
  Activity
} from 'lucide-react';

const API_BASE = 'http://127.0.0.1:8000';

// Fallback bounds for Guwahati Sentinel-2 scene (EPSG:4326)
const DEFAULT_BOUNDS = [[26.11648, 91.71033], [26.16819, 91.76204]];

// Map synchronization helper
function MapSynchronizer({ center, zoom, onMapMoved }) {
  const map = useMap();
  const isMovingRef = useRef(false);

  useEffect(() => {
    if (center && zoom && !isMovingRef.current) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      if (
        Math.abs(currentCenter.lat - center[0]) > 1e-5 ||
        Math.abs(currentCenter.lng - center[1]) > 1e-5 ||
        currentZoom !== zoom
      ) {
        map.setView(center, zoom, { animate: true });
      }
    }
  }, [center, zoom, map]);

  useMapEvents({
    movestart: () => {
      isMovingRef.current = true;
    },
    moveend: () => {
      isMovingRef.current = false;
      const c = map.getCenter();
      onMapMoved([c.lat, c.lng], map.getZoom());
    },
    zoomend: () => {
      isMovingRef.current = false;
      const c = map.getCenter();
      onMapMoved([c.lat, c.lng], map.getZoom());
    }
  });

  return null;
}

// Automatically fit map view to GeoTIFF bounds on load
function MapBoundsFitter({ bounds }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (bounds && bounds.length === 2 && bounds[0] && bounds[1] && !fittedRef.current) {
      map.fitBounds(bounds, { padding: [8, 8], maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [bounds, map]);

  return null;
}

// Convert rasterio transform parameters to Leaflet lat/lon bounds
function getBoundsFromTransform(transform, width = 512, height = 512) {
  if (!transform) return DEFAULT_BOUNDS;
  
  // transform: [a, b, c, d, e, f]
  const a = transform[0]; // pixel width (lon step)
  const c = transform[2]; // min_x / lon_min
  const e = transform[4]; // pixel height (lat step, negative)
  const f = transform[5]; // max_y / lat_max
  
  const lonMin = c;
  const lonMax = c + (a * width);
  const latMax = f;
  const latMin = f + (e * height);
  
  return [[latMin, lonMin], [latMax, lonMax]];
}

// Evidence Canvas Cropper Component
function EvidenceCrop({ imgUrl, pixelBbox, label, pad = 24 }) {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    if (!imgUrl || !pixelBbox) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const [minX, minY, maxX, maxY] = pixelBbox;
      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(img.width - cropX, (maxX - minX) + 2 * pad);
      const cropH = Math.min(img.height - cropY, (maxY - minY) + 2 * pad);
      
      canvas.width = 160;
      canvas.height = 160;
      ctx.clearRect(0, 0, 160, 160);
      ctx.imageSmoothingEnabled = false; // Preserves high-contrast satellite pixel definition
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, 160, 160);
    };
    img.src = imgUrl;
  }, [imgUrl, pixelBbox, pad]);

  return (
    <div className="detail-thumb-box">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <span className="detail-thumb-label">{label}</span>
    </div>
  );
}

// Image Debug Info HUD (Requirement 7)
function ImageDebugBadge({ scene, title, bounds }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!scene && !bounds) return null;

  const w = scene?.width || 512;
  const h = scene?.height || 512;
  const crs = scene?.crs || 'EPSG:4326';
  const b = bounds || scene?.bounds || DEFAULT_BOUNDS;
  const south = b[0] ? b[0][0]?.toFixed(4) : '26.1448';
  const west = b[0] ? b[0][1]?.toFixed(4) : '91.7362';
  const north = b[1] ? b[1][0]?.toFixed(4) : '26.1960';
  const east = b[1] ? b[1][1]?.toFixed(4) : '91.7874';

  return (
    <div className="image-debug-container" onClick={() => setShowDetail(!showDetail)}>
      <div className="image-debug-pill">
        <Info size={11} />
        <span>{w}×{h} • {crs} • 10m/px</span>
      </div>
      {showDetail && (
        <div className="image-debug-tooltip">
          <div className="debug-header">{title || 'Raster Georeference'}</div>
          <div>Dimension: {w} × {h} px (4 Bands: B4,B3,B2,B8)</div>
          <div>CRS: {crs} (WGS84 Lat/Lon)</div>
          <div>Bounds: [{south}°N, {west}°E] to [{north}°N, {east}°E]</div>
          <div>Resolution: 10.0 meters/pixel (Sentinel-2 MSI)</div>
          {scene?.file_path && <div className="debug-path">Source: {scene.file_path}</div>}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [scenes, setScenes] = useState([]);
  const [beforeSceneId, setBeforeSceneId] = useState('');
  const [afterSceneId, setAfterSceneId] = useState('');
  
  const [pipelineResult, setPipelineResult] = useState(null);
  const [changes, setChanges] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedChange, setSelectedChange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scenesLoading, setScenesLoading] = useState(true);
  
  // Overlay opacity slider (0.1 to 1.0)
  const [maskOpacity, setMaskOpacity] = useState(0.85);

  // Shared map view coordinates (Guwahati Sentinel-2 center)
  const [mapCenter, setMapCenter] = useState([26.14234, 91.73618]);
  const [mapZoom, setMapZoom] = useState(14);

  // Fetch available scenes on startup
  useEffect(() => {
    fetchScenes();
  }, []);

  const fetchScenes = async () => {
    setScenesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/scenes`);
      if (!res.ok) throw new Error('Could not fetch scenes from backend API');
      const data = await res.json();
      setScenes(data);
      if (data.length >= 2) {
        const refScene = data.find(s => s.id === 'scene_2024') || data[0];
        const tgtScene = data.find(s => s.id === 'scene_2026') || data[1];
        setBeforeSceneId(refScene.id);
        setAfterSceneId(tgtScene.id);
        
        // Auto-compute center from bounds
        if (refScene.bounds && refScene.bounds.length === 2) {
          const latMid = (refScene.bounds[0][0] + refScene.bounds[1][0]) / 2;
          const lonMid = (refScene.bounds[0][1] + refScene.bounds[1][1]) / 2;
          setMapCenter([latMid, lonMid]);
        }
      } else if (data.length > 0) {
        setBeforeSceneId(data[0].id);
        setAfterSceneId(data[0].id);
      }
    } catch (err) {
      console.error('Fetch scenes error:', err);
      setError('Offline Pipeline: Could not connect to local FastAPI backend.');
    } finally {
      setScenesLoading(false);
    }
  };

  const handleRunPipeline = async () => {
    if (!beforeSceneId || !afterSceneId) return;
    setLoading(true);
    setError(null);
    setSelectedChange(null);
    try {
      const res = await fetch(
        `${API_BASE}/change-detect?before_id=${beforeSceneId}&after_id=${afterSceneId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        throw new Error('Pipeline error during geospatial alignment / change detection.');
      }
      const data = await res.json();
      setPipelineResult(data);
      setChanges(data.changes);
      setSearchResults(data.changes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (queryText) => {
    setSearchQuery(queryText);
    if (!queryText.trim()) {
      setSearchResults(changes);
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(queryText)}`, {
        method: 'POST'
      });
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Search error', err);
    }
  };

  const handleSelectChange = (change) => {
    setSelectedChange(change);
    // Focus all map panes to change centroid
    if (change.centroid && change.centroid.length === 2) {
      setMapCenter([change.centroid[0], change.centroid[1]]);
      setMapZoom(16);
    } else if (change.geometry && change.geometry.coordinates && change.geometry.coordinates[0]) {
      const coords = change.geometry.coordinates[0];
      let latSum = 0, lonSum = 0;
      const count = coords.length - 1;
      for (let i = 0; i < count; i++) {
        lonSum += coords[i][0];
        latSum += coords[i][1];
      }
      setMapCenter([latSum / count, lonSum / count]);
      setMapZoom(16);
    }
  };

  const handleExport = (format) => {
    window.open(`${API_BASE}/export?format=${format}`, '_blank');
  };

  // Preset query buttons
  const presets = [
    "Show new buildings",
    "Construction near roads",
    "Road expansion",
    "Vegetation loss near water",
    "Water extent change"
  ];

  // Helper to determine badge color style
  const getBadgeStyle = (type) => {
    switch (type) {
      case 'NEW CONSTRUCTION': return 'badge-construction';
      case 'ROAD CHANGE': return 'badge-road';
      case 'VEGETATION CHANGE': return 'badge-veg';
      case 'WATER CHANGE': return 'badge-water';
      default: return '';
    }
  };

  // Helper to render geojson style
  const getGeoJsonStyle = (changeItem) => {
    const isSelected = selectedChange && (
      (selectedChange.id && selectedChange.id === changeItem.id) ||
      (selectedChange.pixel_bbox && changeItem.pixel_bbox &&
       selectedChange.pixel_bbox.join() === changeItem.pixel_bbox.join())
    );
    
    const type = changeItem.type;
    let color = '#3b82f6';
    if (type === 'NEW CONSTRUCTION') color = '#ef4444';
    else if (type === 'ROAD CHANGE') color = '#f59e0b';
    else if (type === 'VEGETATION CHANGE') color = '#10b981';
    else if (type === 'WATER CHANGE') color = '#06b6d4';
    
    return {
      color: isSelected ? '#ffffff' : color,
      weight: isSelected ? 3.5 : 2,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: isSelected ? 0.65 : 0.45,
      dashArray: isSelected ? '4, 4' : null
    };
  };

  // Extract scene records & georeferenced bounds
  const beforeScene = scenes.find(s => s.id === beforeSceneId);
  const afterScene = scenes.find(s => s.id === afterSceneId);
  
  const beforeBounds = beforeScene?.bounds || (beforeScene ? getBoundsFromTransform(beforeScene.transform) : DEFAULT_BOUNDS);
  const afterBounds = afterScene?.bounds || (afterScene ? getBoundsFromTransform(afterScene.transform) : DEFAULT_BOUNDS);
  
  const beforeImgUrl = beforeScene ? `${API_BASE}${beforeScene.image_url}` : null;
  const afterImgUrl = afterScene ? `${API_BASE}${afterScene.image_url}` : null;
  const alignedImgUrl = pipelineResult ? `${API_BASE}${pipelineResult.aligned_target_url}` : null;
  const changeMaskUrl = pipelineResult ? `${API_BASE}${pipelineResult.change_mask_url}` : null;

  return (
    <>
      <header>
        <div className="logo-section">
          <div className="logo-icon">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="logo-text">Antigravity Change Intelligence</div>
            <div className="logo-subtext">Geospatial AI & Multi-Temporal Sentinel-2 Analysis</div>
          </div>
        </div>

        <div className="header-actions">
          {pipelineResult && (
            <div className="export-btn-group">
              <button className="export-btn" onClick={() => handleExport('geojson')} title="Export GeoJSON Feature Collection">
                <Download size={14} />
                <span>GeoJSON</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('csv')} title="Export Tabular CSV Report">
                <FileSpreadsheet size={14} />
                <span>CSV</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('json')} title="Export Full JSON Intelligence Report">
                <FileJson size={14} />
                <span>Report JSON</span>
              </button>
            </div>
          )}
          
          <div className="health-badge">
            <ShieldCheck size={15} />
            <span>100% Offline AI Active</span>
          </div>
        </div>
      </header>

      <div className="dashboard-container">
        {/* Left Sidebar - Configuration & Search */}
        <div className="sidebar">
          {/* Configuration Panel */}
          <div className="panel-section">
            <div className="section-title-row">
              <Sliders size={16} />
              <h3>AOI Scene Selection</h3>
            </div>
            
            <div className="scene-select-row">
              <div style={{ flex: 1 }}>
                <label className="field-label">Reference ($T_1$)</label>
                <select 
                  className="select-box"
                  value={beforeSceneId}
                  onChange={(e) => setBeforeSceneId(e.target.value)}
                >
                  {scenes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.date})</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">Target ($T_2$)</label>
                <select 
                  className="select-box"
                  value={afterSceneId}
                  onChange={(e) => setAfterSceneId(e.target.value)}
                >
                  {scenes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.date})</option>)}
                </select>
              </div>
            </div>
            
            <button 
              className="run-btn" 
              onClick={handleRunPipeline}
              disabled={loading || !beforeSceneId || !afterSceneId}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="spinner"></span> Running Geospatial Analytics...
                </span>
              ) : (
                'Run Change Analytics'
              )}
            </button>
            
            {error && (
              <div className="error-banner">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
            
            {/* Analysis Summary Card */}
            {pipelineResult && (
              <div className="summary-card">
                <div className="summary-card-header">
                  <CheckCircle2 size={15} style={{ color: '#10b981' }} />
                  <span>Analysis Verified ({pipelineResult.total_area_sqkm} km² AOI)</span>
                </div>
                <div className="summary-breakdown-row">
                  <div className="stat-box">
                    <span className="stat-val">{pipelineResult.changes_count}</span>
                    <span className="stat-lbl">Changes</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#ef4444' }}>{pipelineResult.breakdown?.['NEW CONSTRUCTION'] || 0}</span>
                    <span className="stat-lbl">Built-up</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#f59e0b' }}>{pipelineResult.breakdown?.['ROAD CHANGE'] || 0}</span>
                    <span className="stat-lbl">Roads</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#10b981' }}>{pipelineResult.breakdown?.['VEGETATION CHANGE'] || 0}</span>
                    <span className="stat-lbl">Vegetation</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-val" style={{ color: '#06b6d4' }}>{pipelineResult.breakdown?.['WATER CHANGE'] || 0}</span>
                    <span className="stat-lbl">Water</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Search Panel */}
          {pipelineResult && (
            <div className="panel-section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="section-title-row">
                <Search size={16} />
                <h3>Semantic Search & Proximity</h3>
              </div>
              
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder="e.g. construction near roads, vegetation loss..." 
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                />
                <div className="search-icon-btn">
                  <Search size={16} />
                </div>
              </div>

              <div className="preset-queries">
                {presets.map(p => (
                  <button 
                    key={p} 
                    className="preset-btn"
                    onClick={() => handleSearch(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              
              <div className="results-header">
                <span>Verified Change Events ({searchResults.length})</span>
              </div>
              
              <div className="results-list">
                {searchResults.map((change, idx) => (
                  <div 
                    key={idx}
                    className={`result-card ${selectedChange === change ? 'selected' : ''}`}
                    onClick={() => handleSelectChange(change)}
                  >
                    <div className="result-header">
                      <span className={`badge ${getBadgeStyle(change.type)}`}>
                        {change.type}
                      </span>
                      <span className="confidence-text">
                        Confidence: {Math.round(change.confidence * 100)}%
                      </span>
                    </div>
                    
                    <div className="result-meta-row">
                      <span>Area: {change.area_sqm ? `${change.area_sqm.toLocaleString()} m²` : `${change.area_pixels} px`}</span>
                      {change.distance_to_road_m < 999 && (
                        <span>Road: {change.distance_to_road_m}m</span>
                      )}
                    </div>
                    
                    {change.explanation && (
                      <div className="explanation-text">
                        {change.explanation}
                      </div>
                    )}
                  </div>
                ))}
                
                {searchResults.length === 0 && (
                  <div className="empty-results">
                    No changes matching current query filter.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Center Panel - Synchronized 3-Pane Leaflet Map Views */}
        <div className="maps-grid">
          {/* Pane 1: Reference Satellite Image (2024-05-15) */}
          <div className="map-pane">
            <div className="map-title">
              <Eye size={13} />
              <span>REFERENCE: {beforeScene ? beforeScene.date : '2024-05-15'} (T₁)</span>
            </div>
            
            {scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : beforeImgUrl ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                <ImageOverlay url={beforeImgUrl} bounds={beforeBounds} />
                <MapBoundsFitter bounds={beforeBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Reference GeoTIFF not loaded</span>
              </div>
            )}
            
            <ImageDebugBadge scene={beforeScene} title="Reference Satellite Raster (2024)" bounds={beforeBounds} />
          </div>

          {/* Pane 2: Target Satellite Image (2026-05-15) */}
          <div className="map-pane">
            <div className="map-title">
              <Eye size={13} />
              <span>TARGET: {afterScene ? afterScene.date : '2026-05-15'} {alignedImgUrl ? '(T₂ Aligned)' : '(T₂)'}</span>
            </div>
            
            {scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : (alignedImgUrl || afterImgUrl) ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                <ImageOverlay url={alignedImgUrl || afterImgUrl} bounds={beforeBounds || afterBounds} />
                <MapBoundsFitter bounds={beforeBounds || afterBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Target GeoTIFF not loaded</span>
              </div>
            )}
            
            <ImageDebugBadge scene={afterScene} title="Target Satellite Raster (2026)" bounds={afterBounds} />
          </div>

          {/* Pane 3: Verified Change Mask Over Satellite Layer */}
          <div className="map-pane">
            <div className="map-title">
              <MapIcon size={13} />
              <span>VERIFIED CHANGE MASK OVERLAY</span>
            </div>

            {/* Map Legend Overlay */}
            {pipelineResult && (
              <div className="map-floating-legend">
                <div className="legend-header">Change Legend</div>
                <div className="legend-item">
                  <span className="legend-dot dot-construction"></span>
                  <span>New Construction</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-road"></span>
                  <span>Road Change</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-veg"></span>
                  <span>Vegetation Loss</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot dot-water"></span>
                  <span>Water Extent</span>
                </div>
                <div className="opacity-slider-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    <span>Mask Opacity</span>
                    <span>{Math.round(maskOpacity * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05" 
                    value={maskOpacity} 
                    onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
                    className="opacity-slider"
                  />
                </div>
              </div>
            )}

            {scenesLoading ? (
              <div className="map-placeholder">
                <span className="spinner"></span>
                <span>LOADING SATELLITE IMAGERY...</span>
              </div>
            ) : (beforeImgUrl || afterImgUrl) ? (
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                zoomControl={false}
                className="map-element"
              >
                {/* Base Satellite Imagery (Always rendered underneath the change layer) */}
                <ImageOverlay url={alignedImgUrl || afterImgUrl || beforeImgUrl} bounds={beforeBounds || afterBounds} opacity={0.88} />
                
                {/* Transparent RGBA Change Mask layer (alpha=0 on unchanged areas) */}
                {changeMaskUrl && (
                  <ImageOverlay url={changeMaskUrl} bounds={beforeBounds || afterBounds} opacity={maskOpacity} />
                )}
                
                {/* Interactive Change Polygons */}
                {searchResults.map((change, idx) => (
                  <GeoJSON 
                    key={`${idx}-${selectedChange === change}`}
                    data={change.geometry}
                    style={() => getGeoJsonStyle(change)}
                    eventHandlers={{
                      click: () => handleSelectChange(change)
                    }}
                  />
                ))}
                
                <MapBoundsFitter bounds={beforeBounds || afterBounds} />
                <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
              </MapContainer>
            ) : (
              <div className="map-placeholder">
                <AlertCircle size={18} style={{ color: '#ef4444', marginBottom: 8 }} />
                <span>SATELLITE IMAGERY UNAVAILABLE</span>
              </div>
            )}

            <ImageDebugBadge scene={beforeScene} title="Change Composite Georeference" bounds={beforeBounds} />
          </div>
        </div>

        {/* Right Sidebar - High-Precision Change Details */}
        {selectedChange && (
          <div className="details-panel">
            <div className="panel-section">
              <div className="section-title-row">
                <Crosshair size={16} />
                <h3>Change Intelligence Detail</h3>
              </div>
              
              <div className="result-header" style={{ marginBottom: '15px' }}>
                <span className={`badge ${getBadgeStyle(selectedChange.type)}`} style={{ fontSize: '0.85rem' }}>
                  {selectedChange.type}
                </span>
                <span className="confidence-pill">
                  Confidence: {Math.round(selectedChange.confidence * 100)}%
                </span>
              </div>

              {/* Side-by-Side High-Precision Evidential Crops */}
              <div className="detail-section-label">Evidential Satellite Sub-Crops</div>
              <div className="detail-thumb-container">
                <EvidenceCrop 
                  imgUrl={beforeImgUrl} 
                  pixelBbox={selectedChange.pixel_bbox} 
                  label="Reference (T₁)" 
                />
                <EvidenceCrop 
                  imgUrl={alignedImgUrl || afterImgUrl} 
                  pixelBbox={selectedChange.pixel_bbox} 
                  label="Target (T₂ Aligned)" 
                />
              </div>
              
              {/* Factual Natural Language Explanation */}
              <div className="detail-box">
                <div className="detail-box-label">Observable Transition Explanation</div>
                <div className="detail-box-value" style={{ fontStyle: 'italic', fontSize: '0.82rem', color: '#e5e7eb' }}>
                  "{selectedChange.explanation}"
                </div>
              </div>

              {/* Real Geospatial Metrics Grid */}
              <div className="detail-section-label">Geospatial Metrics & Proximity</div>
              <div className="metrics-grid">
                <div className="metric-tile">
                  <span className="metric-tile-label">Surface Area</span>
                  <span className="metric-tile-val">
                    {selectedChange.area_sqm ? `${selectedChange.area_sqm.toLocaleString()} m²` : `${selectedChange.area_pixels} px`}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Dist to Road</span>
                  <span className="metric-tile-val">
                    {selectedChange.distance_to_road_m < 999 ? `${selectedChange.distance_to_road_m} m` : 'N/A'}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Dist to Water</span>
                  <span className="metric-tile-val">
                    {selectedChange.distance_to_water_m < 999 ? `${selectedChange.distance_to_water_m} m` : 'N/A'}
                  </span>
                </div>
                <div className="metric-tile">
                  <span className="metric-tile-label">Pixel Extent</span>
                  <span className="metric-tile-val">
                    {selectedChange.area_pixels} px
                  </span>
                </div>
              </div>

              {/* GIS Centroid & Bounding Box */}
              <div className="detail-section-label">Coordinates (EPSG:4326 WGS84)</div>
              <div className="coords-box">
                {selectedChange.centroid && (
                  <div style={{ marginBottom: '6px', color: '#60a5fa', fontWeight: 600 }}>
                    Centroid: {selectedChange.centroid[0].toFixed(5)}°N, {selectedChange.centroid[1].toFixed(5)}°E
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  Lat Bounds: {selectedChange.bbox[1].toFixed(5)}° to {selectedChange.bbox[3].toFixed(5)}°<br/>
                  Lon Bounds: {selectedChange.bbox[0].toFixed(5)}° to {selectedChange.bbox[2].toFixed(5)}°
                </div>
              </div>
              
              {/* Quality & Suppression Checks */}
              <div className="detail-section-label">Verification & Suppression Checks</div>
              <div className="suppression-list">
                {selectedChange.suppression_checks?.map((check, i) => (
                  <div key={i} className="suppression-item">
                    <CheckCircle2 size={12} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>{check.replace(/_/g, ' ')} passed</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
