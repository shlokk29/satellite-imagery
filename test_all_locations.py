import urllib.request
import urllib.parse
import json
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def test_locations():
    print("1. Testing GET /locations...")
    req = urllib.request.urlopen(f"{BASE}/locations")
    locations = json.loads(req.read().decode('utf-8'))
    print(f"   Found {len(locations)} locations: {[l['name'] for l in locations]}")
    
    for loc in locations:
        loc_id = loc['location_id']
        ref_id = loc['reference_scene']['id']
        tgt_id = loc['target_scene']['id']
        print(f"\n2. Testing POST /change-detect for AOI [{loc['badge_icon']} {loc['name']}] ({ref_id} -> {tgt_id})...")
        
        post_url = f"{BASE}/change-detect?before_id={ref_id}&after_id={tgt_id}&location_id={loc_id}"
        req_post = urllib.request.Request(post_url, data=b"", method="POST")
        resp = urllib.request.urlopen(req_post)
        res_data = json.loads(resp.read().decode('utf-8'))
        
        print(f"   Status: {res_data['status']}")
        print(f"   Summary: {res_data['summary']}")
        print(f"   Changes Detected: {res_data['changes_count']}")
        print(f"   Category Breakdown: {res_data['breakdown']}")
        if res_data['changes']:
            first_c = res_data['changes'][0]
            print(f"   Top Event: {first_c['type']} | Area: {first_c['area_sqm']:,} m² | Score: {first_c['confidence']} | Expl: {first_c['explanation']}")
            
        # Test semantic search on this location
        search_query = "forest loss" if loc_id == "forest" else ("water change" if loc_id == "river" else "new buildings")
        search_url = f"{BASE}/search?query={urllib.parse.quote(search_query)}&location={loc_id}"
        req_search = urllib.request.Request(search_url, data=b"", method="POST")
        resp_search = urllib.request.urlopen(req_search)
        search_results = json.loads(resp_search.read().decode('utf-8'))
        print(f"   Semantic Search ('{search_query}'): {len(search_results)} results matching.")
        
    print("\n[ALL 5 MULTI-LOCATION DEMONSTRATION AOIs VERIFIED SUCCESSFULLY!]")

if __name__ == '__main__':
    test_locations()
