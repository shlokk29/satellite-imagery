import numpy as np

def search_changes(query, changes, seg_after=None, location_id=None):
    """
    Search and rank detected changes based on a text query with proximity reasoning.
    query: string (e.g. "forest loss", "river change", "new buildings", "construction near roads")
    changes: list of change dicts returned by detect_changes or database
    seg_after: (H, W) optional target segmentation map
    location_id: optional filter by AOI location
    """
    query_raw = query.strip()
    query = query_raw.lower()
    
    if location_id:
        changes = [c for c in changes if c.get('location_id') == location_id]
        
    if not query:
        return changes
        
    results = []
    
    # Proximity and category intent detection
    has_road_intent = any(w in query for w in ["road", "highway", "corridor", "transport", "street", "paved", "infrastructure"])
    has_building_intent = any(w in query for w in ["building", "construction", "structure", "built", "complex", "house", "development", "urban"])
    has_veg_intent = any(w in query for w in ["forest", "veg", "tree", "canopy", "clearing", "loss", "deforestation", "green", "meadow"])
    has_water_intent = any(w in query for w in ["river", "water", "basin", "lake", "wetland", "reservoir", "stream", "flood", "shoreline", "sandbar"])
    has_proximity_road = any(w in query for w in ["near road", "near roads", "along road", "roadside", "corridor proximity"])
    has_proximity_water = any(w in query for w in ["near water", "near river", "waterfront", "riparian", "bank", "near lake"])
    
    for change in changes:
        ctype = change.get('type', '')
        conf = float(change.get('confidence', 0.8))
        dist_road = float(change.get('distance_to_road_m', 999.0))
        dist_water = float(change.get('distance_to_water_m', 999.0))
        area_sqm = int(change.get('area_sqm', 0))
        
        relevance = 0.0
        match = False
        explanation = change.get('explanation', '')
        
        # 1. Proximity queries: "construction near roads"
        if has_proximity_road or (has_building_intent and has_road_intent and "near" in query):
            if ctype in ["BUILDING CHANGE", "NEW CONSTRUCTION"]:
                if dist_road <= 80.0:
                    proximity_factor = max(0.0, 1.0 - (dist_road / 80.0))
                    relevance = round(0.75 + 0.25 * proximity_factor, 2)
                    match = True
                    explanation = f"High spatial relevance: New construction located {dist_road:.0f}m from road network ({area_sqm:,} m²)."
                else:
                    relevance = 0.30
            elif ctype == "ROAD CHANGE":
                relevance = 0.45
                match = True
                explanation = "Direct road infrastructure change."
                
        # 2. Proximity queries: "vegetation loss near water"
        elif has_proximity_water or (has_veg_intent and has_water_intent and "near" in query):
            if ctype in ["FOREST CHANGE", "VEGETATION CHANGE", "VEGETATION LOSS"]:
                if dist_water <= 100.0:
                    proximity_factor = max(0.0, 1.0 - (dist_water / 100.0))
                    relevance = round(0.75 + 0.25 * proximity_factor, 2)
                    match = True
                    explanation = f"High spatial relevance: Forest transition located {dist_water:.0f}m from water corridor."
                else:
                    relevance = 0.30
            elif ctype in ["RIVER CHANGE", "WATER CHANGE", "WATER EXTENT CHANGE"]:
                relevance = 0.45
                match = True
                explanation = "Direct river water extent expansion."
                
        # 3. Direct Category Intent Matches
        elif has_building_intent and ctype in ["BUILDING CHANGE", "NEW CONSTRUCTION"]:
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches building and urban expansion detection ({area_sqm:,} m²)."
                
        elif has_road_intent and ctype == "ROAD CHANGE":
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches road network and transport corridor change ({area_sqm:,} m²)."
                
        elif has_veg_intent and ctype in ["FOREST CHANGE", "VEGETATION CHANGE", "VEGETATION LOSS"]:
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches forest canopy transition and vegetation change ({area_sqm:,} m²)."
                
        elif has_water_intent and ctype in ["RIVER CHANGE", "WATER CHANGE", "WATER EXTENT CHANGE"]:
            relevance = round(0.75 + 0.25 * conf, 2)
            match = True
            if not explanation:
                explanation = f"Matches river basin waterbody and shoreline change ({area_sqm:,} m²)."
                
        # 4. General queries
        elif any(w in query for w in ["change", "detection", "all", "significant", "intelligence", "alert", "anomaly", "large", "high", "expansion", "loss"]):
            if "large" in query:
                size_factor = min(1.0, area_sqm / 15000.0)
                relevance = round(0.50 + 0.50 * size_factor, 2)
            else:
                relevance = round(conf * 0.85, 2)
            match = True
            if not explanation:
                explanation = f"General change event matching '{query_raw}'."
                
        if match or relevance > 0:
            res = change.copy()
            res['relevance'] = float(relevance)
            res['search_explanation'] = explanation
            results.append(res)
            
    # Sort results by relevance descending, then by confidence descending
    results = sorted(results, key=lambda x: (x['relevance'], x.get('confidence', 0)), reverse=True)
    return results


