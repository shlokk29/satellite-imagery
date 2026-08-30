import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, ImageOverlay, GeoJSON, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { 
  Menu,
  X,
  Search, 
  Eye, 
  Download, 
  FileJson, 
  FileSpreadsheet, 
  ZoomIn, 
  CheckCircle2, 
  AlertCircle, 
  Crosshair, 
  ChevronDown,
  ChevronUp,
  Layers,
  Check,
  Ban,
  Copy,
  CheckCheck
} from 'lucide-react';

const API_BASE = 'http://127.0.0.1:8000';
const CONCEPT_DEMO_ID = 'concept_demo';
const DEMO_WIDTH = 320;
const DEMO_HEIGHT = 240;

const CATEGORY_COLORS = {
  'ROAD CHANGE': '#ffffff',             // White
  'NEW CONSTRUCTION': '#d97706',        // Dark Amber/Gold
  'BUILDING CHANGE': '#d97706',         // Dark Amber/Gold
  'WATER EXTENT CHANGE': '#1d4ed8',     // Dark Blue
  'RIVER CHANGE': '#1d4ed8',            // Dark Blue
  'WATER CHANGE': '#1d4ed8',            // Dark Blue
  'VEGETATION LOSS': '#15803d',         // Dark Green
  'FOREST CHANGE': '#15803d',           // Dark Green
};

const getCategoryColor = (type) => {
  return CATEGORY_COLORS[type] || '#ffffff';
};

const ALL_CAT_IDS = ['roads', 'construction', 'water', 'vegetation'];

function MoDLogo() {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <img 
        src="/Ministry_of_Defence_India.png" 
        alt="Ministry of Defence India" 
        className="mod-header-logo-img png-fallback" 
      />
    );
  }

  return (
    <img 
      src="/Ministry_of_Defence_India.svg" 
      alt="Ministry of Defence India" 
      className="mod-header-logo-img" 
      onError={() => setImgError(true)} 
    />
  );
}

const CONCEPT_DEMO_LOCATION = {
  location_id: CONCEPT_DEMO_ID,
  name: 'Concept Demo',
  badge_icon: '🎨',
  category: 'CHANGE DETECTION DEMO',
  description: 'Lightweight synthetic dataset for demonstrating the change-detection workflow.',
  reference_scene: { date: 'DEMO BEFORE (2024-02-10)' },
  target_scene: { date: 'DEMO AFTER (2024-10-22)' },
};

function drawDemoScene(ctx, after = false) {
  ctx.clearRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  ctx.fillStyle = '#b8956f'; ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  ctx.fillStyle = '#72965e'; ctx.fillRect(0, 0, 128, 108);
  ctx.fillStyle = '#238b45';
  ctx.beginPath(); ctx.arc(62, 58, after ? 30 : 42, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(112, 34, 21, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2563eb'; ctx.beginPath();
  ctx.moveTo(after ? 245 : 262, 0); ctx.lineTo(320, 0); ctx.lineTo(320, 240); ctx.lineTo(after ? 226 : 250, 240); ctx.bezierCurveTo(270, 185, 228, 118, after ? 245 : 262, 0); ctx.fill();
  ctx.fillStyle = '#707782'; ctx.fillRect(0, 130, after ? 252 : 215, 16);
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(8, 136, after ? 232 : 195, 3);
  ctx.fillStyle = '#64748b'; ctx.fillRect(105, 182, 34, 33);
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3; ctx.strokeRect(105, 182, 34, 33);
  if (after) { 
    ctx.fillStyle = '#64748b'; ctx.fillRect(160, 169, 32, 45); ctx.fillRect(205, 184, 30, 30); 
    ctx.strokeStyle = '#e2e8f0'; ctx.strokeRect(160, 169, 32, 45); ctx.strokeRect(205, 184, 30, 30); 
  }
}

function runDemoComparison() {
  const before = document.createElement('canvas'); before.width = DEMO_WIDTH; before.height = DEMO_HEIGHT;
  const after = document.createElement('canvas'); after.width = DEMO_WIDTH; after.height = DEMO_HEIGHT;
  drawDemoScene(before.getContext('2d'), false); drawDemoScene(after.getContext('2d'), true);
  const a = before.getContext('2d').getImageData(0, 0, DEMO_WIDTH, DEMO_HEIGHT).data;
  const b = after.getContext('2d').getImageData(0, 0, DEMO_WIDTH, DEMO_HEIGHT).data;
  const changed = new Uint8Array(DEMO_WIDTH * DEMO_HEIGHT);
  for (let i = 0; i < changed.length; i++) {
    const p = i * 4;
    changed[i] = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 48 ? 1 : 0;
  }
  const visited = new Uint8Array(changed.length); const regions = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1; const pixels = []; let minX = DEMO_WIDTH, minY = DEMO_HEIGHT, maxX = 0, maxY = 0;
    for (let q = 0; q < queue.length; q++) {
      const pos = queue[q]; const x = pos % DEMO_WIDTH; const y = Math.floor(pos / DEMO_WIDTH); pixels.push(pos);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
        const ni = ny * DEMO_WIDTH + nx;
        if (nx >= 0 && nx < DEMO_WIDTH && ny >= 0 && ny < DEMO_HEIGHT && changed[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni); }
      });
    }
    if (pixels.length < 40) continue;
    const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
    const type = cx > 235 ? 'WATER EXTENT CHANGE' : cy >= 118 && cy <= 160 ? 'ROAD CHANGE' : cx < 145 && cy < 120 ? 'VEGETATION LOSS' : 'NEW CONSTRUCTION';
    const extent = Math.min(1, pixels.length / 1600); const shape = Math.min(1, pixels.length / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1)));
    regions.push({ 
      id: `demo-${regions.length + 1}`, 
      is_demo: true, 
      type, 
      pixels, 
      pixel_bbox: [minX, minY, maxX, maxY], 
      area_pixels: pixels.length, 
      confidence: Number((0.75 + 0.18 * extent + 0.05 * shape).toFixed(2)), 
      explanation: `${type.replace(/_/g, ' ').replace('LOSS', 'CHANGE')} detected by comparing satellite scenes.`, 
      dates: ['2024-02-10', '2024-10-22'] 
    });
  }
  return regions.sort((x, y) => y.area_pixels - x.area_pixels);
}

// Fallback Leaflet bounds
const DEFAULT_BOUNDS = [[26.14665, 91.72410], [26.19837, 91.77582]];

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
    movestart: () => { isMovingRef.current = true; },
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

// Auto map resizer helper to invalidate Leaflet container dimensions when sidebar toggles or right details panel toggles
function MapResizer({ isSidebarOpen, selectedChange }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 280);
    return () => clearTimeout(timer);
  }, [isSidebarOpen, selectedChange, map]);
  return null;
}

// Fit map view to GeoTIFF bounds tightly with minimal padding (0 black borders)
function MapBoundsFitter({ bounds }) {
  const map = useMap();
  const prevBoundsRef = useRef(null);

  useEffect(() => {
    if (bounds && bounds.length === 2 && bounds[0] && bounds[1]) {
      const bStr = JSON.stringify(bounds);
      if (prevBoundsRef.current !== bStr) {
        map.fitBounds(bounds, { padding: [2, 2], maxZoom: 16 });
        prevBoundsRef.current = bStr;
      }
    }
  }, [bounds, map]);

  return null;
}

function DemoCanvas({ mode, regions = [], selectedId, onSelect, showMask = false, appliedCategories = [] }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = DEMO_WIDTH; canvas.height = DEMO_HEIGHT; const ctx = canvas.getContext('2d');
    drawDemoScene(ctx, mode !== 'before');
    if (mode === 'change') {
      if (showMask) {
        ctx.fillStyle = 'rgba(7,10,19,.5)'; 
        ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
      }
      if (appliedCategories && appliedCategories.length > 0) {
        const isAll = appliedCategories.includes('all') || ALL_CAT_IDS.every(id => appliedCategories.includes(id));
        const filtered = regions.filter(region => {
          if (isAll) return true;
          if (appliedCategories.includes('roads') && region.type === 'ROAD CHANGE') return true;
          if (appliedCategories.includes('construction') && (region.type === 'NEW CONSTRUCTION' || region.type === 'BUILDING CHANGE')) return true;
          if (appliedCategories.includes('water') && (region.type === 'WATER EXTENT CHANGE' || region.type === 'RIVER CHANGE')) return true;
          if (appliedCategories.includes('vegetation') && (region.type === 'VEGETATION LOSS' || region.type === 'FOREST CHANGE')) return true;
          return false;
        });

        filtered.forEach((region) => { 
          const strokeColor = getCategoryColor(region.type);
          ctx.strokeStyle = region.id === selectedId ? '#ffffff' : strokeColor; 
          ctx.lineWidth = region.id === selectedId ? 2.5 : 1.5; 
          ctx.setLineDash([4, 4]);
          ctx.fillStyle = region.id === selectedId ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)';
          const [minX, minY, maxX, maxY] = region.pixel_bbox;
          ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
          ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        });
      }
    }
  }, [mode, regions, selectedId, showMask, appliedCategories]);
  return <canvas ref={canvasRef} className="demo-scene-canvas" onClick={() => { if (mode === 'change' && onSelect) onSelect(regions[0]); }} />;
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [theme, setTheme] = useState('space');
  const [showRawClassification, setShowRawClassification] = useState(false);
  
  // Analyst decisions state ({ [changeId]: 'confirmed' | 'rejected' })
  const [analystDecisions, setAnalystDecisions] = useState({});
  const [isProvenanceExpanded, setIsProvenanceExpanded] = useState(false);

  const [locations, setLocations] = useState([]);
  const [selectedLocId, setSelectedLocId] = useState('mixed');
  const [locationQuery, setLocationQuery] = useState('');
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationDropdownRef = useRef(null);
  
  // Multi-Select Change Detection Overlay state
  const [selectedCategories, setSelectedCategories] = useState([]); // checked in popover
  const [appliedCategories, setAppliedCategories] = useState([]);   // active on map (default [] clean After image)
  const [detectDropdownOpen, setDetectDropdownOpen] = useState(false);
  const detectDropdownRef = useRef(null);
  const [copiedCoord, setCopiedCoord] = useState(false);

  // User analysis execution state (default false on initial load)
  const [hasUserRunAnalysis, setHasUserRunAnalysis] = useState(false);

  const isCategoryChecked = (catId) => {
    if (catId === 'all') {
      return ALL_CAT_IDS.every((id) => selectedCategories.includes(id));
    }
    return selectedCategories.includes(catId);
  };

  const toggleCategory = (catId) => {
    if (catId === 'all') {
      if (isCategoryChecked('all')) {
        setSelectedCategories([]);
      } else {
        setSelectedCategories([...ALL_CAT_IDS, 'all']);
      }
      return;
    }

    setSelectedCategories((prev) => {
      let next;
      if (prev.includes(catId)) {
        next = prev.filter((c) => c !== catId && c !== 'all');
      } else {
        const added = [...prev, catId];
        if (ALL_CAT_IDS.every((id) => added.includes(id))) {
          next = [...added, 'all'];
        } else {
          next = added;
        }
      }
      return next;
    });
  };

  const handleApplyChanges = () => {
    setAppliedCategories([...selectedCategories]);
    setDetectDropdownOpen(false);
    if (selectedCategories.length > 0) {
      setHasUserRunAnalysis(true);
    }
  };

  const handleClearChanges = () => {
    setSelectedCategories([]);
    setAppliedCategories([]);
    setDetectDropdownOpen(false);
    setHasUserRunAnalysis(false);
    setSelectedChange(null);
  };
  
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

  // Shared map view coordinates
  const [mapCenter, setMapCenter] = useState([26.1624, 91.7422]);
  const [mapZoom, setMapZoom] = useState(14);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target)) {
        setLocationDropdownOpen(false);
      }
      if (detectDropdownRef.current && !detectDropdownRef.current.contains(e.target)) {
        setDetectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch locations and scenes on mount
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setScenesLoading(true);
    try {
      const locRes = await fetch(`${API_BASE}/locations`);
      if (locRes.ok) {
        const locData = await locRes.json();
        setLocations(locData);
        if (locData.length > 0) {
          const defaultLoc = locData.find((loc) => loc.location_id === 'mixed') || locData[0];
          setSelectedLocId(defaultLoc.location_id);
          applyLocation(defaultLoc);
        }
      }
    } catch (err) {
      console.error('Fetch initial data error:', err);
      setError('Offline Pipeline: Could not connect to local FastAPI backend.');
    } finally {
      setScenesLoading(false);
    }
  };

  // Noise reduction filter: filter 200+ raw pixel detections into meaningful regions
  const filterMeaningfulChanges = (changeList) => {
    if (!changeList || changeList.length === 0) return [];
    return changeList.filter((c) => {
      const area = c.area_sqm || c.area_pixels || 0;
      const conf = c.confidence || 0.8;
      return area >= 35 && conf >= 0.45;
    });
  };

  const applyLocation = async (loc) => {
    setSelectedLocId(loc.location_id);
    setSelectedChange(null);
    setSelectedCategories([]);
    setAppliedCategories([]);
    setHasUserRunAnalysis(false); // Clean initial state for new location
    setPipelineResult(null);
    setSearchQuery('');
    setChanges([]);
    setSearchResults([]);
    
    if (loc.center && loc.center.length === 2) {
      setMapCenter([loc.center[0], loc.center[1]]);
      setMapZoom(14);
    }
    
    try {
      const res = await fetch(`${API_BASE}/scenes?location=${loc.location_id}`);
      if (res.ok) {
        const data = await res.json();
        setScenes(data);
        if (data.length >= 2) {
          setBeforeSceneId(data[0].id);
          setAfterSceneId(data[1].id);
        } else if (data.length > 0) {
          setBeforeSceneId(data[0].id);
          setAfterSceneId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch location scenes error:', err);
    }

    try {
      const chRes = await fetch(`${API_BASE}/changes?location=${loc.location_id}`);
      if (chRes.ok) {
        const existingChanges = await chRes.json();
        const meaningful = filterMeaningfulChanges(existingChanges);
        if (meaningful.length > 0) {
          setChanges(meaningful);
          setSearchResults(meaningful);
        }
      }
    } catch (err) {
      // Silently ignore
    }
  };

  const handleLocationChange = (locId) => {
    setSelectedCategories([]);
    setAppliedCategories([]);
    setHasUserRunAnalysis(false);
    if (locId === CONCEPT_DEMO_ID) {
      setSelectedLocId(CONCEPT_DEMO_ID);
      setSelectedChange(null);
      setPipelineResult(null);
      setChanges([]);
      setSearchResults([]);
      setSearchQuery('');
      return;
    }
    const loc = locations.find(l => l.location_id === locId);
    if (loc) {
      applyLocation(loc);
    }
  };

  const handleLocationQueryChange = (query) => {
    setLocationQuery(query);
    if (query.trim().toLowerCase().includes('concept')) {
      handleLocationChange(CONCEPT_DEMO_ID);
    }
  };

  const handleRunPipeline = async () => {
    if (!isConceptDemo && (!beforeSceneId || !afterSceneId)) return;
    setLoading(true);
    setError(null);
    setSelectedChange(null);
    setHasUserRunAnalysis(true); // User explicitly triggered analysis
    setSelectedCategories(['all']);
    setAppliedCategories(['all']);
    if (isConceptDemo) {
      window.setTimeout(() => {
        const demoChanges = runDemoComparison();
        const meaningful = filterMeaningfulChanges(demoChanges);
        const breakdown = meaningful.reduce((acc, change) => ({ ...acc, [change.type]: (acc[change.type] || 0) + 1 }), {});
        setPipelineResult({ changes: meaningful, changes_count: meaningful.length, breakdown, total_area_sqkm: 'demo' });
        setChanges(meaningful); setSearchResults(meaningful); setLoading(false);
      }, 350);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/change-detect?before_id=${beforeSceneId}&after_id=${afterSceneId}&location_id=${selectedLocId}`,
        { method: 'POST' }
      );
      if (!res.ok) {
        throw new Error('Pipeline error during geospatial alignment / change detection.');
      }
      const data = await res.json();
      const meaningful = filterMeaningfulChanges(data.changes || []);
      setPipelineResult({
        ...data,
        changes: meaningful,
        changes_count: meaningful.length
      });
      setChanges(meaningful);
      setSearchResults(meaningful);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (queryText) => {
    setSearchQuery(queryText);
    setHasUserRunAnalysis(true); // User triggered search/analysis

    let catId = null;
    const lower = queryText.toLowerCase();
    if (lower.includes('road')) catId = 'roads';
    else if (lower.includes('build') || lower.includes('construct')) catId = 'construction';
    else if (lower.includes('vegetat') || lower.includes('forest')) catId = 'vegetation';
    else if (lower.includes('water') || lower.includes('river')) catId = 'water';

    if (catId) {
      setAppliedCategories([catId]);
      setSelectedCategories([catId]);
    } else {
      setAppliedCategories(['all']);
      setSelectedCategories(['all']);
    }

    if (!queryText.trim()) {
      setSearchResults(changes);
      return;
    }

    if (isConceptDemo) {
      const terms = lower.split(/\s+/);
      setSearchResults(changes.filter((change) => terms.some((term) => change.type.toLowerCase().includes(term) || change.explanation.toLowerCase().includes(term))));
      return;
    }
    
    try {
      const res = await fetch(
        `${API_BASE}/search?query=${encodeURIComponent(queryText)}&location=${selectedLocId}`,
        { method: 'POST' }
      );
      const data = await res.json();
      const meaningful = filterMeaningfulChanges(data);
      setSearchResults(meaningful);
    } catch (err) {
      console.error('Search error', err);
    }
  };

  const getChangeCoords = (change) => {
    if (!change) return { lat: '26.1445', lon: '91.7362', str: '26.1445, 91.7362' };
    let lat = null, lon = null;
    if (change.centroid && Array.isArray(change.centroid) && change.centroid.length === 2 && change.centroid[0] !== 0) {
      lat = change.centroid[0];
      lon = change.centroid[1];
    } else if (change.centroid_lonlat && Array.isArray(change.centroid_lonlat) && change.centroid_lonlat.length === 2 && change.centroid_lonlat[0] !== 0) {
      lon = change.centroid_lonlat[0];
      lat = change.centroid_lonlat[1];
    } else if (change.geometry && change.geometry.coordinates && change.geometry.coordinates[0]) {
      const coords = change.geometry.coordinates[0];
      let lats = 0, lons = 0;
      const count = coords.length > 1 ? coords.length - 1 : coords.length;
      for (let i = 0; i < count; i++) {
        lons += coords[i][0];
        lats += coords[i][1];
      }
      lat = lats / count;
      lon = lons / count;
    } else if (selectedLoc && selectedLoc.center) {
      lat = selectedLoc.center[0];
      lon = selectedLoc.center[1];
    }

    if (lat !== null && lon !== null) {
      const latFixed = Number(lat).toFixed(4);
      const lonFixed = Number(lon).toFixed(4);
      return { lat: latFixed, lon: lonFixed, str: `${latFixed}, ${lonFixed}` };
    }
    return { lat: '26.1445', lon: '91.7362', str: '26.1445, 91.7362' };
  };

  const handleCopyCoordinates = () => {
    if (!selectedChange) return;
    const { str } = getChangeCoords(selectedChange);
    if (str && navigator.clipboard) {
      navigator.clipboard.writeText(str);
      setCopiedCoord(true);
      setTimeout(() => setCopiedCoord(false), 2000);
    }
  };

  const handleSelectChange = (change) => {
    setSelectedChange(change);
    setIsProvenanceExpanded(false);
    let catId = 'all';
    if (change.type === 'ROAD CHANGE') catId = 'roads';
    else if (change.type === 'NEW CONSTRUCTION' || change.type === 'BUILDING CHANGE') catId = 'construction';
    else if (change.type === 'WATER EXTENT CHANGE' || change.type === 'RIVER CHANGE') catId = 'water';
    else if (change.type === 'VEGETATION LOSS' || change.type === 'FOREST CHANGE') catId = 'vegetation';

    if (!appliedCategories.includes(catId) && !appliedCategories.includes('all')) {
      setAppliedCategories((prev) => [...prev, catId]);
      setSelectedCategories((prev) => [...prev, catId]);
    }

    if (change.centroid && change.centroid.length === 2 && change.centroid[0] !== 0) {
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

  const handleZoomToChange = () => {
    if (!selectedChange) return;
    const coords = getChangeCoords(selectedChange);
    if (coords.lat && coords.lon) {
      setMapCenter([parseFloat(coords.lat), parseFloat(coords.lon)]);
      setMapZoom(17);
    }
  };

  const getOverlayChanges = () => {
    if (!appliedCategories || appliedCategories.length === 0) return [];
    const isAll = appliedCategories.includes('all') || ALL_CAT_IDS.every(id => appliedCategories.includes(id));
    
    return searchResults.filter((c) => {
      if (isAll) return true;
      if (appliedCategories.includes('roads') && c.type === 'ROAD CHANGE') return true;
      if (appliedCategories.includes('construction') && (c.type === 'NEW CONSTRUCTION' || c.type === 'BUILDING CHANGE')) return true;
      if (appliedCategories.includes('water') && (c.type === 'WATER EXTENT CHANGE' || c.type === 'RIVER CHANGE' || c.type === 'WATER CHANGE')) return true;
      if (appliedCategories.includes('vegetation') && (c.type === 'VEGETATION LOSS' || c.type === 'FOREST CHANGE')) return true;
      return false;
    });
  };

  const visibleOverlayChanges = getOverlayChanges();

  const handleAnalystDecision = (changeId, status) => {
    setAnalystDecisions((prev) => ({
      ...prev,
      [changeId]: prev[changeId] === status ? null : status
    }));
  };

  const handleExport = (format) => {
    window.open(`${API_BASE}/export?format=${format}&location=${selectedLocId}`, '_blank');
  };

  // Thin Dashed Color-Coded Geospatial Annotation Overlay Style
  const getGeoJsonStyle = (changeItem) => {
    const isSelected = selectedChange && (
      (selectedChange.id && selectedChange.id === changeItem.id) ||
      (selectedChange.pixel_bbox && changeItem.pixel_bbox &&
       selectedChange.pixel_bbox.join() === changeItem.pixel_bbox.join())
    );
    
    const catColor = getCategoryColor(changeItem.type);
    const decision = analystDecisions[changeItem.id];
    let strokeColor = catColor;
    if (decision === 'confirmed') strokeColor = '#10b981';
    if (decision === 'rejected') strokeColor = '#ef4444';
    
    return {
      color: isSelected ? '#ffffff' : strokeColor,
      weight: isSelected ? 3.5 : 2.5,
      opacity: 1.0,
      dashArray: '6, 5',
      fillColor: strokeColor,
      fillOpacity: isSelected ? 0.2 : 0.05
    };
  };

  const isConceptDemo = selectedLocId === CONCEPT_DEMO_ID;
  const selectedLoc = isConceptDemo
    ? CONCEPT_DEMO_LOCATION
    : locations.find(l => l.location_id === selectedLocId) || locations[0];
  const aoiLocations = [CONCEPT_DEMO_LOCATION, ...locations];
  const locationMatches = aoiLocations.filter((location) => {
    const searchable = `${location.name} ${location.description || ''} ${location.location_id}`.toLowerCase();
    return searchable.includes(locationQuery.trim().toLowerCase());
  });

  const beforeScene = scenes.find(s => s.id === beforeSceneId);
  const afterScene = scenes.find(s => s.id === afterSceneId);
  const currentBounds = beforeScene?.bounds || selectedLoc?.leaflet_bounds || DEFAULT_BOUNDS;
  const beforeImgUrl = beforeScene ? `${API_BASE}${beforeScene.image_url}` : null;
  const afterImgUrl = afterScene ? `${API_BASE}${afterScene.image_url}` : null;
  const alignedImgUrl = pipelineResult ? `${API_BASE}${pipelineResult.aligned_target_url}` : null;
  const changeMaskUrl = pipelineResult ? `${API_BASE}${pipelineResult.change_mask_url}` : null;

  return (
    <>
      {/* Header */}
      <header>
        <div className="header-left">
          {/* Menu Toggle Button */}
          <button 
            className="menu-toggle-btn"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Toggle Control Panel"
          >
            {isSidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>

          <div className="logo-section">
            <MoDLogo />
            <div>
              <span className="logo-title">DRISHTI</span>
              <span className="logo-subtitle" style={{ marginLeft: 8 }}>Satellite Intelligence Workstation</span>
            </div>
          </div>
        </div>

        <div className="header-right">
          {/* System Status Indicator */}
          <div className="health-pill">
            <span className="health-pulse-dot" />
            <span>SYSTEM ONLINE</span>
          </div>

          {/* Export Actions */}
          {(pipelineResult || changes.length > 0) && (
            <div className="export-btn-group">
              <button className="export-btn" onClick={() => handleExport('geojson')} title="Export GeoJSON">
                <Download size={12} />
                <span>GeoJSON</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('csv')} title="Export CSV">
                <FileSpreadsheet size={12} />
                <span>CSV</span>
              </button>
              <button className="export-btn" onClick={() => handleExport('json')} title="Export Report">
                <FileJson size={12} />
                <span>Report</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Workstation Layout */}
      <div className="workstation-flex-layout">
        
        {/* Responsive Collapsible Sidebar */}
        <div className={`sidebar-flex-panel ${!isSidebarOpen ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <span className="sidebar-title">
              <Search size={14} />
              <span>SEARCH & CONTROL</span>
            </span>
            <button className="menu-toggle-btn" style={{ width: 24, height: 24 }} onClick={() => setIsSidebarOpen(false)}>
              <X size={13} />
            </button>
          </div>

          {/* SECTION 1: FILTERS FIRST */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Filters</div>

            {/* Location Selector */}
            <div className="filter-group">
              <label className="filter-label">Target Location / AOI</label>
              <div className="location-select-container" ref={locationDropdownRef}>
                <div
                  className="location-search-container"
                  onClick={() => setLocationDropdownOpen(true)}
                >
                  <Search size={12} />
                  <input
                    value={locationQuery}
                    onChange={(event) => {
                      handleLocationQueryChange(event.target.value);
                      setLocationDropdownOpen(true);
                    }}
                    onFocus={() => setLocationDropdownOpen(true)}
                    placeholder="Find location..."
                  />
                  <ChevronDown size={12} />
                </div>

                {locationDropdownOpen && (
                  <div className="location-dropdown">
                    {locationMatches.length === 0 ? (
                      <div style={{ padding: 8, fontSize: '0.72rem', color: '#666' }}>No location found.</div>
                    ) : (
                      locationMatches.map(loc => (
                        <div
                          key={loc.location_id}
                          className={`location-dropdown-item ${selectedLocId === loc.location_id ? 'active' : ''}`}
                          onClick={() => {
                            handleLocationChange(loc.location_id);
                            setLocationQuery('');
                            setLocationDropdownOpen(false);
                          }}
                        >
                          <span style={{ fontSize: '0.85rem' }}>{loc.badge_icon || '📍'}</span>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f5f5f5' }}>{loc.name}</div>
                            <div style={{ fontSize: '0.62rem', color: '#a0a0a0' }}>{loc.category}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Reference Date (T1) */}
            <div className="filter-group">
              <label className="filter-label">Reference Date (T₁ Before)</label>
              <select 
                className="select-box"
                value={beforeSceneId}
                onChange={(e) => setBeforeSceneId(e.target.value)}
                disabled={isConceptDemo}
              >
                {isConceptDemo ? <option>2024-02-10 (Demo)</option> : scenes.map(s => <option key={s.id} value={s.id}>{s.date}</option>)}
              </select>
            </div>

            {/* Target Date (T2) */}
            <div className="filter-group">
              <label className="filter-label">Target Date (T₂ After)</label>
              <select 
                className="select-box"
                value={afterSceneId}
                onChange={(e) => setAfterSceneId(e.target.value)}
                disabled={isConceptDemo}
              >
                {isConceptDemo ? <option>2024-10-22 (Demo)</option> : scenes.map(s => <option key={s.id} value={s.id}>{s.date}</option>)}
              </select>
            </div>
          </div>

          {/* SECTION 2: SEARCH IMAGERY & QUICK SEARCHES */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Search Imagery</div>
            <div className="search-input-box">
              <Search size={13} style={{ color: '#a0a0a0' }} />
              <input 
                type="text" 
                placeholder="Search satellite imagery..." 
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>

            {/* Quick Searches */}
            <div className="sidebar-section-title" style={{ marginTop: 10 }}>Quick Searches</div>
            <div className="quick-pills-grid">
              {['New Buildings', 'Road Development', 'Vegetation Loss', 'Water Change'].map(query => (
                <button 
                  key={query} 
                  className="quick-pill-btn"
                  onClick={() => handleSearch(query)}
                >
                  {query}
                </button>
              ))}
            </div>

            {/* Search & Run Analytics Button */}
            <button 
              className="run-analytics-btn"
              onClick={handleRunPipeline}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12, marginBottom: 0, borderTopColor: '#0d0d0d' }} />
                  <span>Processing AI Pipeline...</span>
                </>
              ) : (
                <>
                  <Eye size={13} />
                  <span>SEARCH & RUN ANALYTICS</span>
                </>
              )}
            </button>
          </div>

          {/* Results Summary Section */}
          {!hasUserRunAnalysis ? (
            <div className="sidebar-section">
              <div className="sidebar-section-title">CHANGE RESULTS</div>
              <div style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                padding: '12px',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  No analysis run yet.
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  Search for imagery or select a quick search to begin analysis.
                </div>
              </div>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="sidebar-section">
              <div className="sidebar-section-title">
                Meaningful Change Regions ({searchResults.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchResults.map((change, idx) => (
                  <div 
                    key={idx}
                    onClick={() => handleSelectChange(change)}
                    style={{
                      background: selectedChange === change ? 'rgba(255,255,255,0.12)' : 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: 600 }}>
                      <span>{change.type}</span>
                      <span style={{ color: analystDecisions[change.id] === 'confirmed' ? '#10b981' : analystDecisions[change.id] === 'rejected' ? '#ef4444' : 'var(--confidence-green)' }}>
                        {analystDecisions[change.id] ? analystDecisions[change.id].toUpperCase() : `${Math.round((change.confidence || 0.9) * 100)}%`}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {change.is_demo ? `${change.area_pixels} demo px` : change.area_sqm ? `${change.area_sqm.toLocaleString()} m²` : `${change.area_pixels} px`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="sidebar-section">
              <div className="sidebar-section-title">CHANGE RESULTS</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                No changes detected for the current search criteria.
              </div>
            </div>
          )}
        </div>

        {/* 2-Pane Main Analysis Area */}
        <div className="analysis-main-area">
          
          {/* PANE 1: BEFORE (T1) */}
          <div className="satellite-pane">
            <div className="pane-header-bar">
              <div className="scene-label-badge">
                <span className="tag">BEFORE</span>
                <span>{isConceptDemo ? '2024-02-10' : beforeScene ? beforeScene.date : '2024-02-10'}</span>
              </div>
            </div>

            <div className="map-container-box">
              {isConceptDemo ? (
                <DemoCanvas mode="before" />
              ) : scenesLoading ? (
                <div className="map-placeholder">
                  <span className="spinner" />
                  <span>LOADING SATELLITE IMAGERY...</span>
                </div>
              ) : beforeImgUrl ? (
                <MapContainer 
                  center={mapCenter} 
                  zoom={mapZoom} 
                  minZoom={12}
                  maxZoom={18}
                  zoomControl={false} 
                  className="demo-scene-canvas"
                >
                  <ImageOverlay url={beforeImgUrl} bounds={currentBounds} />
                  <MapBoundsFitter bounds={currentBounds} />
                  <MapResizer isSidebarOpen={isSidebarOpen} selectedChange={selectedChange} />
                  <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
                  <ZoomControl position="bottomright" />
                </MapContainer>
              ) : (
                <div className="map-placeholder">
                  <AlertCircle size={16} style={{ color: '#ef4444', marginBottom: 6 }} />
                  <span>SATELLITE SCENE UNAVAILABLE</span>
                </div>
              )}
            </div>
          </div>

          {/* PANE 2: AFTER (T2) */}
          <div className="satellite-pane">
            <div className="pane-header-bar">
              <div className="scene-label-badge">
                <span className="tag">AFTER</span>
                <span>{isConceptDemo ? '2024-10-22' : afterScene ? afterScene.date : '2024-10-22'}</span>
              </div>

              {/* Multi-Select Control Popover */}
              <div className="detect-changes-popover-container" ref={detectDropdownRef}>
                <div className="detect-controls-row">
                  <button 
                    className={`detect-changes-trigger-btn ${appliedCategories.length > 0 ? 'active' : ''}`}
                    onClick={() => setDetectDropdownOpen(!detectDropdownOpen)}
                  >
                    <Layers size={13} />
                    <span>
                      {appliedCategories.length === 0
                        ? 'DETECT CHANGES ▾'
                        : appliedCategories.includes('all') || ALL_CAT_IDS.every(id => appliedCategories.includes(id))
                        ? 'ALL CHANGES ACTIVE ▾'
                        : `${appliedCategories.length} CATEGORIES ACTIVE ▾`}
                    </span>
                    <ChevronDown size={12} className={`dropdown-chevron ${detectDropdownOpen ? 'open' : ''}`} />
                  </button>

                  {appliedCategories.length > 0 && (
                    <button 
                      className="clear-overlay-btn"
                      onClick={handleClearChanges}
                      title="Clear Analysis Overlay"
                    >
                      <X size={12} />
                      <span>CLEAR</span>
                    </button>
                  )}
                </div>

                {detectDropdownOpen && (
                  <div className="detect-changes-dropdown">
                    <div className="detect-dropdown-header">DETECT CHANGES</div>
                    <div className="detect-dropdown-options">
                      {[
                        { id: 'roads', label: 'Roads', color: '#ffffff' },
                        { id: 'construction', label: 'New Construction', color: '#d97706' },
                        { id: 'water', label: 'Water Body', color: '#1d4ed8' },
                        { id: 'vegetation', label: 'Vegetation Loss', color: '#15803d' },
                        { id: 'all', label: 'All Changes', color: '#ffffff' },
                      ].map((opt) => {
                        const checked = isCategoryChecked(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={`detect-dropdown-option ${checked ? 'selected' : ''}`}
                            onClick={() => toggleCategory(opt.id)}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {}}
                              className="detect-checkbox"
                            />
                            <span 
                              className="color-indicator-dot" 
                              style={{ 
                                backgroundColor: opt.color, 
                                boxShadow: opt.id === 'all' ? '0 0 6px rgba(255,255,255,0.8)' : `0 0 6px ${opt.color}` 
                              }} 
                            />
                            <span className="option-label-text">{opt.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="detect-dropdown-actions">
                      <button className="apply-changes-btn" onClick={handleApplyChanges}>
                        APPLY CHANGES
                      </button>
                      <button className="clear-popover-btn" onClick={handleClearChanges}>
                        CLEAR
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="map-container-box">
              {isConceptDemo ? (
                <DemoCanvas 
                  mode="change" 
                  regions={searchResults} 
                  selectedId={selectedChange?.id} 
                  onSelect={handleSelectChange} 
                  showMask={false} 
                  appliedCategories={appliedCategories}
                />
              ) : scenesLoading ? (
                <div className="map-placeholder">
                  <span className="spinner" />
                  <span>LOADING SATELLITE IMAGERY...</span>
                </div>
              ) : (alignedImgUrl || afterImgUrl) ? (
                <MapContainer 
                  center={mapCenter} 
                  zoom={mapZoom} 
                  minZoom={12}
                  maxZoom={18}
                  zoomControl={false} 
                  className="demo-scene-canvas"
                >
                  <ImageOverlay url={alignedImgUrl || afterImgUrl || beforeImgUrl} bounds={currentBounds} opacity={1.0} />
                  
                  {visibleOverlayChanges.map((change, idx) => (
                    <GeoJSON 
                      key={`${idx}-${appliedCategories.join('-')}-${selectedChange === change}-${analystDecisions[change.id]}`}
                      data={change.geometry}
                      style={() => getGeoJsonStyle(change)}
                      eventHandlers={{ click: () => handleSelectChange(change) }}
                    />
                  ))}
                  
                  <MapBoundsFitter bounds={currentBounds} />
                  <MapResizer isSidebarOpen={isSidebarOpen} selectedChange={selectedChange} />
                  <MapSynchronizer center={mapCenter} zoom={mapZoom} onMapMoved={(c, z) => { setMapCenter(c); setMapZoom(z); }} />
                  <ZoomControl position="bottomright" />
                </MapContainer>
              ) : (
                <div className="map-placeholder">
                  <AlertCircle size={16} style={{ color: '#ef4444', marginBottom: 6 }} />
                  <span>SATELLITE SCENE UNAVAILABLE</span>
                </div>
              )}
            </div>

            {/* Dedicated Legend Strip at Bottom of AFTER Pane */}
            {appliedCategories.length > 0 && (
              <div className="pane-footer-legend-bar">
                <span className="legend-bar-title">LEGEND:</span>
                <div className="legend-bar-items">
                  {(appliedCategories.includes('all') || appliedCategories.includes('roads')) && (
                    <div className="legend-bar-item">
                      <span className="legend-dash-line" style={{ borderTopColor: '#ffffff' }} />
                      <span>Road</span>
                    </div>
                  )}
                  {(appliedCategories.includes('all') || appliedCategories.includes('water')) && (
                    <div className="legend-bar-item">
                      <span className="legend-dash-line" style={{ borderTopColor: '#1d4ed8' }} />
                      <span>Water</span>
                    </div>
                  )}
                  {(appliedCategories.includes('all') || appliedCategories.includes('vegetation')) && (
                    <div className="legend-bar-item">
                      <span className="legend-dash-line" style={{ borderTopColor: '#15803d' }} />
                      <span>Vegetation</span>
                    </div>
                  )}
                  {(appliedCategories.includes('all') || appliedCategories.includes('construction')) && (
                    <div className="legend-bar-item">
                      <span className="legend-dash-line" style={{ borderTopColor: '#d97706' }} />
                      <span>Construction</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PANE 3: DEDICATED RIGHT-SIDE CHANGE DETAILS PANEL */}
        {selectedChange && (
          <div className="right-details-flex-panel">
            <div className="details-panel-header">
              <span className="details-panel-title">
                <Eye size={13} />
                <span>CHANGE DETAILS</span>
              </span>
              <button 
                className="close-panel-btn"
                onClick={() => setSelectedChange(null)}
                title="Close Details Panel"
              >
                <X size={14} />
                <span>CLOSE</span>
              </button>
            </div>

            <div className="details-panel-content-body">
              <div className="card-header-row">
                <span className="card-tag">CHANGE DETECTED</span>
              </div>

              <div className="card-title">
                {selectedChange.type === 'NEW CONSTRUCTION' ? 'New Construction' : 
                 selectedChange.type === 'ROAD CHANGE' ? 'Road Change' :
                 selectedChange.type === 'WATER EXTENT CHANGE' ? 'Water Body Change' :
                 selectedChange.type === 'VEGETATION LOSS' ? 'Vegetation Loss' : selectedChange.type}
              </div>

              <div className="card-stats-grid">
                <span className="stat-pill-green">
                  Confidence: {Math.round((selectedChange.confidence || 0.92) * 100)}%
                </span>
                <span className="stat-pill-gray">
                  Area: {selectedChange.is_demo 
                    ? `${selectedChange.area_pixels} demo px` 
                    : selectedChange.area_sqm 
                      ? `${selectedChange.area_sqm.toLocaleString()} m²` 
                      : `${selectedChange.area_pixels} px`}
                </span>
              </div>

              {/* CHANGE LOCATION Section */}
              {(() => {
                const coords = getChangeCoords(selectedChange);
                return (
                  <div className="card-location-box">
                    <div className="location-box-header">
                      <Crosshair size={12} style={{ color: '#ffffff' }} />
                      <span>CHANGE LOCATION</span>
                    </div>
                    <div className="coords-display-row">
                      <div><span className="coord-lbl">Latitude:</span> <strong>{coords.lat}°</strong></div>
                      <div><span className="coord-lbl">Longitude:</span> <strong>{coords.lon}°</strong></div>
                    </div>
                    <button className="copy-coords-btn" onClick={handleCopyCoordinates}>
                      {copiedCoord ? <CheckCheck size={12} /> : <Copy size={12} />}
                      <span>{copiedCoord ? 'COPIED!' : 'COPY COORDINATES'}</span>
                    </button>
                  </div>
                );
              })()}

              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                First Observed: <strong>{selectedChange.dates?.[1] || '2025'}</strong> • Source: <strong>Sentinel-2</strong>
              </div>

              {selectedChange.explanation && (
                <div className="card-explanation">
                  "{selectedChange.explanation}"
                </div>
              )}

              {/* Expandable Provenance Metadata */}
              <button 
                className="provenance-toggle-btn"
                onClick={() => setIsProvenanceExpanded(!isProvenanceExpanded)}
              >
                <span>GEOSPATIAL PROVENANCE</span>
                {isProvenanceExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {isProvenanceExpanded && (
                <div className="provenance-details-box">
                  <div className="provenance-row"><span>Source:</span><span>Sentinel-2 MSI Level-2A</span></div>
                  <div className="provenance-row"><span>Resolution:</span><span>10.0 m/pixel</span></div>
                  <div className="provenance-row"><span>Processing:</span><span>Alignment → Cloud Mask → Change Detection</span></div>
                  <div className="provenance-row"><span>Model Engine:</span><span>Deep Semantic Segmenter</span></div>
                </div>
              )}

              {/* Analyst Review Controls ([ CONFIRM ] / [ REJECT ]) */}
              <div className="analyst-review-row">
                <button 
                  className={`analyst-btn confirm ${analystDecisions[selectedChange.id] === 'confirmed' ? 'active' : ''}`}
                  onClick={() => handleAnalystDecision(selectedChange.id, 'confirmed')}
                >
                  <Check size={12} />
                  <span>CONFIRM</span>
                </button>
                <button 
                  className={`analyst-btn reject ${analystDecisions[selectedChange.id] === 'rejected' ? 'active' : ''}`}
                  onClick={() => handleAnalystDecision(selectedChange.id, 'rejected')}
                >
                  <Ban size={12} />
                  <span>REJECT</span>
                </button>
              </div>

              <div className="card-actions-row">
                {!selectedChange.is_demo && (
                  <button className="zoom-btn-action" onClick={handleZoomToChange}>
                    <ZoomIn size={12} />
                    <span>Zoom to Change</span>
                  </button>
                )}
                <button className="dismiss-btn-action" onClick={() => setSelectedChange(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
