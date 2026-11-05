"""Builds the shared catalog from the filtered Open Facts rows (see catalog/README.md).

python scripts/build-catalog.py <folder with rows-*.jsonl> <output folder>

Writes numbered SQL files, most useful products first, and stats.json. Barcodes are stored on 13
digits, the form src/lib/server/catalog.ts looks them up in.
"""
import json, os, re, sys
from collections import Counter

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
CHUNK = 50_000

SOURCES = {"food": "open_food_facts", "beauty": "open_beauty_facts", "pet": "open_pet_food_facts", "products": "open_products_facts"}

# First match wins, tested on the product's categories and name in lower case.
FOOD = [
    ("Bébé", r"baby|infant|bébé|nourrisson"),
    ("Eau", r"\bwaters?\b|\beaux?\b|mineral water"),
    ("Boissons chaudes", r"\bcoffees?\b|\bcafés?\b|\bteas?\b|\bthés?\b|infusion|cocoa powder"),
    ("Sodas et jus", r"soda|juice|\bjus\b|nectar|soft drink|sweetened beverage|energy drink|sirop|syrups?\b|beverage|boisson"),
    ("Alcool", r"alcohol|beers?\b|bière|wines?\b|\bvins?\b|spirit|whisk|vodka"),
    ("Lait et produits laitiers", r"yogurt|yaourt|cheese|fromage|\bmilks?\b|\blait\b|dairy|butter\b(?!.*hazelnut)|beurre|cream\b|crème fraîche"),
    ("Chocolat et confiserie", r"chocolate|chocolat|candy|candies|confectioner|confiserie|bonbon|sweets?\b|chewing gum|hazelnut butter|spreads?\b.*sweet"),
    ("Biscuits et gâteaux", r"biscuit|cookie|cake|gâteau|wafer|pastries|pastry|croissant|sweet snack"),
    ("Snacks salés", r"chips|crisps|salty snack|crackers|popcorn|nuts\b|cacahu|peanut|pistach"),
    ("Pain et céréales", r"breads?\b|\bpain\b|breakfast cereal|céréales|muesli|granola|rusks?\b|biscottes"),
    ("Pâtes, riz et féculents", r"pasta|pâtes|\brice\b|\briz\b|couscous|semoule|semolina|noodle|flour|farine|legume|lentil|chickpea"),
    ("Huiles et sauces", r"\boils?\b|huile|vinegar|vinaigre|sauces?\b|ketchup|mustard|moutarde|mayonnaise|condiment|dressing"),
    ("Épices et assaisonnement", r"spice|épice|\bsalt\b|\bsel\b|seasoning|herbs?\b|bouillon|stock cube"),
    ("Conserves", r"canned|conserve|tuna|thon|sardine|tomato paste|concentré"),
    ("Viande et poisson", r"\bmeats?\b|viande|poultry|chicken|poulet|sausage|charcuterie|\bham\b|fish|poisson|seafood"),
    ("Fruits et légumes", r"fruits?\b|vegetable|légume|olives?\b|dates?\b|\bjams?\b|confiture|honey|\bmiel\b|compote"),
    ("Surgelés", r"frozen|surgelé|ice cream|glace"),
    ("Plats préparés", r"meals?\b|\bplats?\b|pizza|soups?\b|soupe|sandwich"),
    ("Compléments alimentaires", r"dietary supplement|complément"),
]
BEAUTY = [
    ("Cheveux", r"shampoo|hair|shampoing|cheveux|conditioner|après-shampoing"),
    ("Hygiène dentaire", r"tooth|dentifrice|dental|mouthwash|bain de bouche|brosse à dents"),
    ("Déodorants", r"deodorant|déodorant|antiperspirant"),
    ("Parfums", r"perfume|parfum|fragrance|eau de toilette|cologne"),
    ("Maquillage", r"make-?up|maquillage|lipstick|mascara|foundation|nail|vernis"),
    ("Hygiène du corps", r"soap|savon|shower|douche|bath|bain|intimate|intime|razor|shaving|rasage|sanitary|towel|cotton"),
    ("Soins de la peau", r"cream|crème|lotion|skin|peau|moistur|sunscreen|solaire|serum|sérum|face|visage|body|corps"),
]
PRODUCTS = [
    ("Entretien de la maison", r"clean|nettoy|detergent|lessive|laundry|dish|vaisselle|bleach|javel|household|ménager"),
    ("Électronique", r"electronic|phone|computer|ordinateur|cable|câble|charger|chargeur|batter|pile|headphone|audio|televis|camera|appliance"),
    ("Bébé", r"baby|bébé|diaper|couche"),
    ("Hygiène du corps", r"hygiene|hygiène|soap|savon|paper|papier toilette|tissue"),
    ("Papeterie et jouets", r"stationery|papeterie|\bpens?\b|stylo|book|livre|\btoys?\b|jouet|games?\b"),
    ("Maison et cuisine", r"kitchen|cuisine|home|maison|furniture|meuble|garden|jardin|decor"),
    ("Bricolage", r"\btools?\b|outil|hardware|bricolage|paint|peinture"),
    ("Mode", r"cloth|vêtement|shoe|chaussure|fashion|\bbags?\b|\bsacs?\b"),
    ("Tabac", r"tobacco|cigarette|tabac"),
]


def category(row):
    # The start of the category path is too broad ("Plant-based foods and beverages" is on half of
    # all food): only the most precise categories and the name decide.
    precise = ", ".join(row["c"].split(",")[-3:])
    text = f"{row['m']} {precise} {row['n']}".lower().replace("foods and beverages", "foods")
    rules = {"food": FOOD, "beauty": BEAUTY, "products": PRODUCTS}.get(row["s"])
    if row["s"] == "pet":
        return "Animaux"
    for name, rule in rules:
        if re.search(rule, text):
            return name
    return {"food": "Épicerie", "beauty": "Beauté", "products": "Divers"}[row["s"]]


def valid(code):
    """Pads to 13 digits and checks the GS1 check digit, which also removes made-up codes."""
    code = code.lstrip("0").zfill(13) if len(code) > 13 else code.zfill(13)
    if len(code) != 13 or len(set(code)) < 3 or code.lstrip("0").startswith("12345678"):
        return None
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code[:12]))
    return code if (10 - total % 10) % 10 == int(code[12]) else None


def clean(text):
    # One null byte stops a D1 import in the middle of a file, and it still reports success.
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text.replace("\\n", " "))
    return re.sub(r"\s+", " ", text).strip()


def brand(text):
    first = clean(text.split(",")[0])
    return first[:60] or None


stats = Counter()
best = {}
for name in ("beauty", "pet", "products", "food"):
    for line in open(os.path.join(src, f"rows-{name}.jsonl"), encoding="utf8"):
        r = json.loads(line)
        stats["read"] += 1
        code = valid(r["b"])
        title = clean(r["n"])
        if not code:
            stats["bad barcode"] += 1
            continue
        if re.fullmatch(r"[\W\d_]+", title):
            stats["bad name"] += 1
            continue
        old = best.get(code)
        if old:
            stats["same barcode twice"] += 1
            if (old["sc"], bool(old["i"])) >= (r["sc"], bool(r["i"])):
                continue
        r["b"], r["n"] = code, title
        best[code] = r


def worth(r):
    # Sold nearby first, then any kind of product that is not food, then the most scanned.
    return (r["t"] != 1, r["s"] == "food", not r["i"], -r["sc"])


rows = sorted(best.values(), key=worth)
q = lambda v: "NULL" if v is None else ("'" + str(v).replace("'", "''") + "'")
report = Counter()
for start in range(0, len(rows), CHUNK):
    with open(os.path.join(out, f"load-{start // CHUNK:03d}.sql"), "w", encoding="utf8") as f:
        part = rows[start : start + CHUNK]
        for at in range(0, len(part), 200):
            values = []
            for r in part[at : at + 200]:
                c = category(r)
                report["cat " + c] += 1
                report["source " + SOURCES[r["s"]]] += 1
                report["image"] += bool(r["i"])
                report["brand"] += bool(r["br"])
                report["sold nearby"] += r["t"] == 1
                values.append("(" + ",".join([q(r["b"]), q(r["n"]), q(brand(r["br"])), q(clean(r["q"])[:40] or None), q(c), q(clean(r["i"]) or None), q(SOURCES[r["s"]]), str(int(r["t"] == 1)), str(r["sc"])]) + ")")
            f.write("insert or replace into catalog (barcode,name,brand,quantity,category,image_url,source,nearby,scans) values " + ",".join(values) + ";\n")
    # The name search, in the same order, so a partial load still covers the most useful products.
    with open(os.path.join(out, f"search-{start // CHUNK:03d}.sql"), "w", encoding="utf8") as f:
        for at in range(0, len(part), 200):
            values = [f"({q(r['b'])},{q(' '.join(x for x in (brand(r['br']), r['n'], clean(r['q'])) if x))})" for r in part[at : at + 200]]
            f.write("insert into catalog_search (barcode,title) values " + ",".join(values) + ";\n")
stats["rows"] = len(rows)
json.dump({"stats": stats, "report": report}, open(os.path.join(out, "stats.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)
print(json.dumps(stats))
print(json.dumps({k: v for k, v in report.most_common() if not k.startswith("cat ")}, ensure_ascii=False))
print(json.dumps({k[4:]: v for k, v in report.most_common() if k.startswith("cat ")}, ensure_ascii=False))
