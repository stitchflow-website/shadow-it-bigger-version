import re
import difflib

# Read app names from applications.csv (column 4)
with open('public/applications.csv', 'r') as f:
    lines = f.readlines()[1:]  # Skip header
    app_names = []
    for line in lines:
        # Handle CSV parsing manually for quoted fields
        if line.strip():
            # Split by comma but handle quoted fields
            parts = []
            current = ""
            in_quotes = False
            for char in line:
                if char == '"' and (not current or current[-1] != '\\'):
                    in_quotes = not in_quotes
                elif char == ',' and not in_quotes:
                    parts.append(current.strip('"'))
                    current = ""
                    continue
                current += char
            parts.append(current.strip('"'))
            
            if len(parts) > 3:
                name = parts[3].strip()
                if name:
                    app_names.append(name)

# Read AI scoring app names (column 1)
with open('public/Adam_revised_latest_app.csv', 'r') as f:
    lines = f.readlines()[1:]  # Skip header
    ai_names = []
    for line in lines:
        if line.strip():
            name = line.split(',')[0].strip()
            if name:
                ai_names.append(name)

# Find fuzzy matches
matched_apps = []
unmatched_apps = []

for app in app_names:
    app_clean = app.strip(' "')
    
    # Check for exact match (case insensitive)
    exact_match = any(app_clean.lower() == ai.lower() for ai in ai_names)
    
    if exact_match:
        matched_apps.append(app_clean)
        continue
    
    # Check for fuzzy match (contains, similar words)
    fuzzy_match = False
    for ai in ai_names:
        # Check if app name is contained in AI name or vice versa
        if (app_clean.lower() in ai.lower() or ai.lower() in app_clean.lower()):
            if len(app_clean) > 3 and len(ai) > 3:  # Avoid very short matches
                matched_apps.append(f"{app_clean} -> {ai}")
                fuzzy_match = True
                break
        
        # Check similarity score
        similarity = difflib.SequenceMatcher(None, app_clean.lower(), ai.lower()).ratio()
        if similarity > 0.8:
            matched_apps.append(f"{app_clean} -> {ai} (similarity: {similarity:.2f})")
            fuzzy_match = True
            break
    
    if not fuzzy_match:
        unmatched_apps.append(app_clean)

print(f"Total apps: {len(app_names)}")
print(f"Matched apps: {len(matched_apps)}")
print(f"Unmatched apps: {len(unmatched_apps)}")
print("\n=== UNMATCHED APPS (No AI Scoring Data) ===")
for app in sorted(unmatched_apps):
    print(f"- {app}")

print(f"\n=== SOME FUZZY MATCHES FOUND ===")
fuzzy_matches = [m for m in matched_apps if " -> " in m]
for match in fuzzy_matches[:10]:  # Show first 10 fuzzy matches
    print(f"- {match}") 