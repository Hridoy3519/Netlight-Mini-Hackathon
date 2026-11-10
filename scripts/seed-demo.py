"""Fill the specialist console and analytics dashboard with demo data.

Runs real quotes and orders through the app's own APIs (so every number is
consistent), resolves a few tickets as specialists, leaves some open for the
demo, and adds synthetic analytics traffic.

Usage (dev server running):  python3 scripts/seed-demo.py [base_url]
All names/emails are fictional (example.test).
"""
import base64, json, sys, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
AUTH = "Basic " + base64.b64encode(b"nopea:demo").decode()

def call(path, body=None, staff=False):
    headers = {"content-type": "application/json"}
    if staff:
        headers["authorization"] = AUTH
    req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body is not None else None, headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:200], "status": e.code}

def answers(desc, **kw):
    a = dict(description=desc, link="", fromPostcode="", toPostcode="", urgency="balanced", alreadyPacked="no",
             fragile="unsure", weightKg=None, lengthCm=None, widthCm=None, heightCm=None, valueEur=None, parcels=1)
    a.update(kw)
    return a

def addr(name, street, postcode, city, email=""):
    return dict(name=name, street=street, postcode=postcode, city=city, email=email)

PEOPLE = [
    addr("Aino Virtanen", "Mannerheimintie 12 A 4", "00100", "Helsinki", "aino.virtanen@example.test"),
    addr("Mikko Korhonen", "Hämeenkatu 7", "33100", "Tampere", "mikko.korhonen@example.test"),
    addr("Laura Mäkinen", "Aurakatu 3 B", "20100", "Turku", "laura.makinen@example.test"),
    addr("Juha Nieminen", "Kauppakatu 21", "40100", "Jyväskylä", "juha.nieminen@example.test"),
    addr("Emma Lehtonen", "Isokatu 15", "90100", "Oulu", "emma.lehtonen@example.test"),
    addr("Ville Heikkinen", "Torikatu 2", "22100", "Mariehamn", "ville.heikkinen@example.test"),
]

# (label, answers, place order?, sender idx, recipient idx, selection overrides)
SCENARIOS = [
    ("books",       answers("Two paperback books", weightKg=1.2, lengthCm=22, widthCm=15, heightCm=6), True, 0, 1, {}),
    ("vase",        answers("A ceramic vase", fragile="yes", valueEur=180, urgency="fastest"), True, 2, 3, {}),
    ("chair",       answers("A wooden dining chair", weightKg=5.5, lengthCm=45, widthCm=45, heightCm=82, urgency="cheapest"), True, 3, 4, {}),
    ("shoes",       answers("A pair of running shoes", alreadyPacked="yes", weightKg=1.1, urgency="cheapest"), True, 1, 0, {}),
    ("laptop",      answers("A laptop", valueEur=1200, urgency="fastest"), True, 4, 2, {}),
    ("documents",   answers("Signed contract documents", alreadyPacked="no", urgency="fastest"), False, 0, 0, {}),
    # Restricted goods -> specialist tickets
    ("power bank",  answers("A power bank, 20000 mAh", weightKg=0.4), True, 1, 3, {}),
    ("perfume",     answers("Two bottles of perfume", weightKg=0.8, fragile="yes"), True, 2, 0, {}),
    ("cheese",      answers("Homemade cheese for my grandmother", weightKg=2), False, 0, 0, {}),
    # Åland recipient -> specialist (tax border)
    ("aland",       answers("A box of winter clothes", weightKg=4, alreadyPacked="yes"), True, 0, 5, {}),
    # Volume shipper -> sales lead
    ("volume",      answers("We send 150 parcels a month of clothes, about 2 kg each", weightKg=2), False, 0, 0, {}),
]

# Tickets a specialist has already answered (by label), with a confirmed price
RESOLVE = {
    "power bank": ("Pirjo", "Hi! Small power banks under 100 Wh are fine when packed in their original box. Approved, and you're good to go!", 14.90),
    "perfume":    ("Pirjo", "Hi! Perfume is OK in small quantities if each bottle is wrapped and the box is upright. I've added fragile handling.", 24.50),
}

def main():
    created = {}
    for label, a, order, si, ri, sel in SCENARIOS:
        r = call("/api/assess", {"answers": a})
        if "error" in r:
            print(f"  ! {label}: {r}")
            continue
        created[label] = r
        line = f"  {label:11} {r['confidence']['decision']:12} {round(r['confidence']['overall']*100)}%"
        if order:
            selection = {"productId": None, "addOnIds": None, "packagingIds": None, **sel}
            o = call("/api/orders", {"conversationId": r["conversationId"], "selection": selection,
                                     "sender": PEOPLE[si], "recipient": PEOPLE[ri]})
            line += f"  order {o.get('order', {}).get('id')} {o.get('order', {}).get('status')}" if "order" in o else f"  order error {o}"
        print(line)

    tickets = call("/api/tickets", staff=True)["tickets"]
    for label, (agent, text, price) in RESOLVE.items():
        conv = created.get(label, {}).get("conversationId")
        t = next((t for t in tickets if t["conversationId"] == conv and t["status"] == "open" and t["kind"] == "support"), None)
        if t:
            call("/api/tickets", {"ticketId": t["id"], "text": text, "agentName": agent, "confirmedTotal": price, "approveQuote": True}, staff=True)
            print(f"  resolved {label} ticket as {agent} (€{price})")

    seeded = call("/api/analytics", {"action": "seed_demo"}, staff=True)
    print(f"  analytics demo events: {seeded}")
    t = call("/api/tickets", staff=True)
    print("  console stats:", t["stats"])
    print("  open tickets:", [(x["kind"], ", ".join(x["parts"]) or "sales") for x in t["tickets"] if x["status"] == "open"])

if __name__ == "__main__":
    main()
