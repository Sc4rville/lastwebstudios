/**
 * sim-data.ts · the SANDBOX casts fictional prospects that are coherent: a US search sounds American (names built
 * from the trade, the asked town with its real-shaped ZIP and area code), a French search sounds French (« Toitures
 * Lambrey », a department-coherent fiction phone). Reserved domains (.example), fiction phone ranges only (NANP
 * 555-01xx ; ARCEP 01 99 00 · 02 61 91 · 03 53 01 · 04 65 71 · 05 36 49), never a real business. Deterministic by seed.
 * No two prospects of one search share a name or its distinctive word (no « Sorel & Fils » next to « Sorel & Fils Studio »).
 */
import { INDUSTRIES } from "../../leadengine/1_scraping/scripts/industries.ts"

export type SimProspect = { id: string; industry: string; name: string; city: string; region: string; zip: string; phone: string; email: string | null; url: string; palette: { a: string; b: string; bg: string }; services: string[]; since: number; reasons: string[]; lang: "en" | "fr" }

/** the demo finds at most this many per search (said in the job line, never silently) */
export const SIM_MAX = 12

export type Family = "pool" | "kitchen" | "wood" | "roof" | "garden" | "build" | "home" | "service" | "care" | "event" | "auto" | "other"
const FAMILY_OF: Record<string, Family> = {
  pisciniste: "pool", "installateur-spa-sauna-hammam": "pool",
  cuisiniste: "kitchen", "salle-de-bain": "kitchen", agencement: "kitchen", marbrier: "kitchen", "architecte-interieur": "kitchen", chr: "kitchen", "chr-inox": "kitchen",
  menuisier: "wood", ebeniste: "wood", charpente: "wood", escalieteur: "wood", mobilier: "wood", tapissier: "wood", "construction-bois": "wood", solier: "wood",
  "couvreur-zingueur": "roof", "facadier-ite": "roof", storiste: "roof", portaillste: "roof", metallerie: "roof", ferronnier: "roof", cloturiste: "roof",
  paysagiste: "garden", terrassement: "garden", tp: "garden", verandaliste: "garden",
  construction: "build", "maitre-oeuvre": "build", "constructeur-ccmi": "build", architecte: "build", "entrepreneur-general": "build", domoticien: "build",
  "poele-cheminee": "home", "installateur-pv-pac": "home", plombier: "home", electricien: "home", chauffagiste: "home",
  securite: "service", serrurier: "service", nettoyage: "service", desinsectisation: "service", peintre: "service", outillage: "service", equipement: "service",
  "medecine-esthetique": "care", "dentisterie-esthetique": "care", veterinaire: "care", "opticien-createur": "care", audioprothesiste: "care", "clinique-capillaire": "care", "chirurgien-esthetique": "care", "institut-beaute": "care",
  "lieu-reception": "event", "wedding-planner": "event", "traiteur-evenementiel": "event", "photographe-mariage": "event", "fleuriste-evenementiel": "event", "domaine-viticole": "event", "hotel-charme": "event", "chambres-hotes": "event", "bijoutier-joaillier": "event",
  "vehicule-premium": "auto", "carrosserie-covering": "auto", "boat-dealer": "auto",
}
export function familyOf(trade: string): Family {
  if (FAMILY_OF[trade]) return FAMILY_OF[trade]
  // legacy keys and free text: the closest family by word
  if (/piscin|pool|spa|sauna/.test(trade)) return "pool"
  if (/cuisin|kitchen|bain|bath|agencement|marbr/.test(trade)) return "kitchen"
  if (/menuis|ebenist|charpent|escal|mobilier|tapis|bois|wood|carpent/.test(trade)) return "wood"
  if (/couvr|toit|roof|facad|stor|portail|metal|ferronn|clot|fence/.test(trade)) return "roof"
  if (/paysag|jardin|garden|landscap|terrass/.test(trade)) return "garden"
  if (/construct|maitre|ccmi|architect|build|domotic/.test(trade)) return "build"
  if (/plomb|plumb|electr|chauff|hvac|poele|pv-pac|solar/.test(trade)) return "home"
  return "other"
}

// ── names: a distinctive word + the trade's own words (US) ; the trade's words + a surname (FR) ──
const US_FIRST = ["Ridgeway", "Summit", "Ironbark", "Blue Sky", "Prairie", "Keystone", "Clearwater", "Lone Star", "Cedar Creek", "Maple Street", "Northgate", "Stonebridge", "Heritage", "Granite Bay", "Northwind", "Oakline", "Timberfield", "Red Barn", "Hollow Creek", "Ridgeline", "Willow Creek", "Greenfield", "Hillside", "Evergreen", "Foundry", "Stonepath", "Hawthorne", "Meridian", "Brightline", "Northstar", "Pinecrest", "Eastbrook", "Copper Canyon", "Bluebonnet", "Lakeshore", "High Plains", "Riverbend", "Bridgewater", "Sterling", "Cornerstone", "Lighthouse", "Sunline", "Harborline", "Cascade", "Big Sky", "Twin Oaks", "Fox Hollow", "Wildflower", "Old Mill", "Iron Horse", "Whitestone", "Bayview", "Silver Hollow", "Juniper", "Redwood", "Mesa Verde", "Arrowhead", "Canyon Ridge", "Driftwood", "Elm Street"]
const US_TAILS: Record<string, string[]> = {
  pisciniste: ["Pools", "Pool & Spa", "Pool Builders", "Pool Co."], "installateur-spa-sauna-hammam": ["Hot Tubs", "Spa & Sauna", "Hot Tub Co."],
  cuisiniste: ["Kitchens", "Cabinetry", "Kitchen Design", "Kitchen Works"], "salle-de-bain": ["Bath & Tile", "Bathworks", "Bath Remodeling"], marbrier: ["Countertops", "Stone Works", "Granite & Quartz"],
  menuisier: ["Carpentry", "Woodworks", "Millwork", "Joinery"], ebeniste: ["Furniture Co.", "Woodcraft", "Fine Furniture"], charpente: ["Timber Frames", "Framing Co."], escalieteur: ["Stairs & Rails", "Staircase Co."], solier: ["Flooring", "Floors", "Hardwood Floors"],
  "couvreur-zingueur": ["Roofing", "Roofing Co.", "Roof & Gutter", "Roofing & Exteriors"], "facadier-ite": ["Siding", "Exteriors", "Stucco & Siding"], storiste: ["Blinds & Shutters", "Awning Co."], portaillste: ["Gates", "Gate & Fence"], cloturiste: ["Fence Co.", "Fencing", "Fence & Gate"], ferronnier: ["Ironworks", "Metal Works", "Forge"], metallerie: ["Metal Fabrication", "Steel Works"],
  paysagiste: ["Landscaping", "Landscapes", "Lawn & Garden", "Outdoor Living"], terrassement: ["Excavation", "Earthworks", "Site Work"], tp: ["Civil Works", "Paving Co."], verandaliste: ["Sunrooms", "Patio Covers", "Pergola Co."],
  construction: ["Construction", "Builders", "Building Co."], "maitre-oeuvre": ["Contractors", "Remodeling", "Design Build"], "constructeur-ccmi": ["Homes", "Home Builders", "Custom Homes"], architecte: ["Architects", "Architecture", "Design Studio"], "entrepreneur-general": ["Contractors", "General Contracting", "Remodeling", "Design Build"], domoticien: ["Smart Home", "Home Theater", "AV Systems"], "construction-bois": ["Timber Homes", "Log Homes"],
  plombier: ["Plumbing", "Plumbing & Drain", "Plumbing Co.", "Rooter & Plumbing"], electricien: ["Electric", "Electrical Services", "Electric Co."], chauffagiste: ["Heating & Air", "Comfort Systems", "HVAC", "Air & Heat"], "poele-cheminee": ["Fireplace & Stove", "Hearth Co.", "Chimney Co."], "installateur-pv-pac": ["Solar", "Solar & Heat Pumps", "Energy"],
  peintre: ["Painting", "Painting Co.", "Paint & Finish"], serrurier: ["Lock & Key", "Locksmith", "Lock Co."], nettoyage: ["Cleaning", "Cleaning Co.", "Maid Service"], desinsectisation: ["Pest Control", "Exterminators", "Pest Solutions"], securite: ["Security", "Alarm Co.", "Security Systems"],
  "medecine-esthetique": ["Med Spa", "Aesthetics"], "dentisterie-esthetique": ["Dental", "Family Dentistry", "Dental Studio"], veterinaire: ["Animal Hospital", "Veterinary Clinic", "Vet Clinic"], "opticien-createur": ["Eyewear", "Optical"], audioprothesiste: ["Hearing Center", "Hearing Care"], "institut-beaute": ["Day Spa", "Beauty Studio", "Skin Studio"],
  "lieu-reception": ["Event Barn", "Estate", "Event Venue"], "wedding-planner": ["Weddings", "Events"], "traiteur-evenementiel": ["Catering", "Catering Co."], "photographe-mariage": ["Photography", "Wedding Photo"], "fleuriste-evenementiel": ["Florals", "Flower Co."], "domaine-viticole": ["Winery", "Vineyards", "Cellars"], "hotel-charme": ["Inn", "Hotel"], "chambres-hotes": ["Bed & Breakfast", "Guesthouse"], "bijoutier-joaillier": ["Jewelers", "Fine Jewelry"],
  "vehicule-premium": ["Motors", "Auto Gallery"], "carrosserie-covering": ["Auto Body", "Wraps & Detailing", "Collision"], "boat-dealer": ["Marine", "Boats & Yachts"],
  "architecte-interieur": ["Interiors", "Interior Design", "Design Studio"], agencement: ["Cabinet Co.", "Millwork Studio"],
}
const FR_SURNAMES = ["Lambrey", "Sorel", "Mornay", "Vireuil", "Lauvel", "Rozel", "Tarcel", "Brémond", "Noriac", "Calvine", "Orbelle", "Avrance", "Vallore", "Mirelle", "Dorsay", "Clairemont", "Aubry", "Delorme", "Lavrenne", "Verdoie", "Castel", "Marvelin", "Sauvelune", "Morvan", "Ferrand", "Bastide", "Charlier", "Daubigny", "Escoffre", "Garnier-Vey", "Hautval", "Joubert", "Lescure", "Marsac", "Peyrol", "Quesnay", "Ribault", "Sabatier", "Thévenot", "Vidalie", "Montrel", "Ardouin", "Belcourt", "Corbière", "Fontanel", "Granval", "Laborie", "Maurin"]
const FR_HEADS: Record<string, string[]> = {
  pisciniste: ["Piscines", "Bassins", "Aqua Piscines"], "installateur-spa-sauna-hammam": ["Spas", "Bien-être"],
  cuisiniste: ["Cuisines", "Atelier Cuisine", "Cuisines & Bains"], "salle-de-bain": ["Bains", "Salles de bains"], marbrier: ["Marbrerie", "Pierres"], agencement: ["Agencement"], "architecte-interieur": ["Intérieurs", "Atelier"],
  menuisier: ["Menuiserie", "Atelier Bois", "Menuiseries"], ebeniste: ["Ébénisterie", "Atelier"], charpente: ["Charpentes", "Charpente"], escalieteur: ["Escaliers"], solier: ["Parquets", "Sols"], tapissier: ["Tapisserie"], "construction-bois": ["Maisons Bois"],
  "couvreur-zingueur": ["Toitures", "Couverture", "Zinguerie"], "facadier-ite": ["Façades", "Ravalement"], storiste: ["Stores", "Fermetures"], portaillste: ["Portails"], cloturiste: ["Clôtures"], ferronnier: ["Ferronnerie"], metallerie: ["Métallerie"],
  paysagiste: ["Paysages", "Jardins", "Espaces Verts"], terrassement: ["Terrassement"], tp: ["Travaux Publics"], verandaliste: ["Vérandas"],
  construction: ["Constructions", "Bâti"], "maitre-oeuvre": ["Maîtrise d'œuvre"], "constructeur-ccmi": ["Maisons"], architecte: ["Atelier d'Architecture", "Architectes"], "entrepreneur-general": ["Bâtiment", "Rénovation"], domoticien: ["Domotique"],
  plombier: ["Plomberie"], electricien: ["Électricité"], chauffagiste: ["Chauffage", "Thermique"], "poele-cheminee": ["Cheminées", "Poêles"], "installateur-pv-pac": ["Solaire", "Énergies"],
  peintre: ["Peinture", "Décors"], serrurier: ["Serrurerie"], nettoyage: ["Nettoyage"], desinsectisation: ["Anti-nuisibles"], securite: ["Sécurité"],
  veterinaire: ["Clinique vétérinaire"], "institut-beaute": ["Institut"], "domaine-viticole": ["Domaine"], "hotel-charme": ["Hôtel"], "chambres-hotes": ["Le Clos"], "lieu-reception": ["Domaine"], "traiteur-evenementiel": ["Traiteur"], "photographe-mariage": ["Studio"], "fleuriste-evenementiel": ["Fleurs"],
}
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
function enTails(trade: string): string[] {
  if (US_TAILS[trade]) return US_TAILS[trade]
  const l = String((INDUSTRIES[trade] as any)?.en?.label || "").split(/\s*\/\s*/)[0]
  return l ? [title(l), `${title(l)} Co.`] : ["Co.", "Services"]
}
function frHeads(trade: string): string[] {
  if (FR_HEADS[trade]) return FR_HEADS[trade]
  const l = String(INDUSTRIES[trade]?.label || "").split(/\s*[/(]\s*/)[0].trim()
  return l ? [l[0].toUpperCase() + l.slice(1)] : ["Atelier"]
}

const SERVICES: Record<Family, string[]> = {
  pool: ["In-ground pools", "Renovation", "Spas and covers", "Maintenance"], kitchen: ["Custom kitchens", "Bathrooms", "Storage", "3D design"], wood: ["Windows and doors", "Staircases", "Fitted furniture", "Decking"],
  roof: ["Re-roofing", "Repairs", "Gutters", "Insulation"], garden: ["Garden design", "Lawns", "Patios", "Planting"], build: ["New builds", "Extensions", "Renovation", "Project management"], home: ["Installation", "Repairs", "Maintenance plans", "Upgrades"],
  service: ["Residential", "Commercial", "Emergency calls", "Free estimates"], care: ["Consultations", "Treatments", "Follow-up care", "Online booking"], event: ["Weddings", "Private events", "Packages", "Visits"], auto: ["Sales", "Service", "Financing", "Detailing"], other: ["Consulting", "Projects", "Service"],
}
const SERVICES_FR: Record<Family, string[]> = {
  pool: ["Piscines enterrées", "Rénovation", "Spas et abris", "Entretien"], kitchen: ["Cuisines sur mesure", "Salles de bains", "Rangements", "Étude 3D"], wood: ["Portes et fenêtres", "Escaliers", "Meubles sur mesure", "Terrasses"],
  roof: ["Réfection de toiture", "Réparations", "Zinguerie", "Isolation"], garden: ["Création de jardins", "Pelouses", "Terrasses", "Plantations"], build: ["Construction neuve", "Extensions", "Rénovation", "Maîtrise d'œuvre"], home: ["Installation", "Dépannage", "Contrats d'entretien", "Mise aux normes"],
  service: ["Particuliers", "Professionnels", "Urgences", "Devis gratuit"], care: ["Consultations", "Soins", "Suivi", "Prise de rendez-vous"], event: ["Mariages", "Événements privés", "Formules", "Visites"], auto: ["Vente", "Entretien", "Financement", "Préparation"], other: ["Conseil", "Projets", "Service"],
}
// what they sell, for the trades people search most ; the family's list otherwise
const OWN_EN: Record<string, string[]> = {
  pisciniste: ["In-ground pools", "Pool renovation", "Spas and covers", "Weekly maintenance"], "couvreur-zingueur": ["Roof replacement", "Storm repairs", "Gutters", "Inspections"], cuisiniste: ["Custom kitchens", "Cabinet refacing", "Countertops", "3D design"],
  menuisier: ["Custom millwork", "Doors and windows", "Built-ins", "Decks"], paysagiste: ["Landscape design", "Lawn care", "Patios", "Irrigation"], plombier: ["Leak repair", "Water heaters", "Drain cleaning", "Bathroom plumbing"],
  electricien: ["Panel upgrades", "EV chargers", "Lighting", "Rewiring"], peintre: ["Interior painting", "Exterior painting", "Cabinet painting", "Color advice"], chauffagiste: ["AC repair", "Furnaces", "Heat pumps", "Maintenance plans"],
  "entrepreneur-general": ["Home remodels", "Additions", "Kitchens and baths", "Design-build"], cloturiste: ["Wood fences", "Privacy fences", "Gates", "Repairs"], solier: ["Hardwood floors", "Tile", "Refinishing", "Luxury vinyl"],
  serrurier: ["Lockouts", "Rekeying", "Smart locks", "Commercial locks"], nettoyage: ["House cleaning", "Deep cleaning", "Move-out cleaning", "Offices"], desinsectisation: ["Termites", "Rodents", "Bed bugs", "Quarterly service"],
  "salle-de-bain": ["Bathroom remodels", "Walk-in showers", "Tile work", "Vanities"], "wedding-planner": ["Full planning", "Day-of coordination", "Venue scouting", "Design"], veterinaire: ["Wellness exams", "Vaccinations", "Dental care", "Surgery"],
  architecte: ["Custom homes", "Renovations", "Permits", "3D renderings"], "constructeur-ccmi": ["Custom homes", "Floor plans", "Lot selection", "Warranty"],
}
const OWN_FR: Record<string, string[]> = {
  plombier: ["Dépannage", "Chauffe-eau", "Salles de bains", "Recherche de fuite"], electricien: ["Mise aux normes", "Tableaux électriques", "Éclairage", "Bornes de recharge"], peintre: ["Peinture intérieure", "Ravalement", "Décoration", "Revêtements muraux"],
  chauffagiste: ["Chaudières", "Pompes à chaleur", "Climatisation", "Entretien"], serrurier: ["Ouverture de porte", "Blindage", "Serrures", "Dépannage"], nettoyage: ["Bureaux", "Fin de chantier", "Vitres", "Particuliers"],
  desinsectisation: ["Dératisation", "Punaises de lit", "Guêpes et frelons", "Contrats"], veterinaire: ["Consultations", "Vaccins", "Chirurgie", "Soins dentaires"],
}
const servicesFor = (trade: string, fam: Family, fr: boolean): string[] => (fr ? OWN_FR[trade] || SERVICES_FR[fam] : OWN_EN[trade] || SERVICES[fam])
const PALETTES: Record<Family, { a: string; b: string; bg: string }[]> = {
  pool: [{ a: "#0f6fa8", b: "#f4a261", bg: "#f6f3ec" }, { a: "#1d4e89", b: "#e9c46a", bg: "#f8f7f2" }], kitchen: [{ a: "#5a3e2b", b: "#c9a66b", bg: "#f7f3ee" }, { a: "#2b2b2b", b: "#b08968", bg: "#f5f2ed" }],
  wood: [{ a: "#3b2f2f", b: "#a97c50", bg: "#f6f1ea" }, { a: "#2f3e2e", b: "#c98a3d", bg: "#f7f4ee" }], roof: [{ a: "#1f2a37", b: "#c0392b", bg: "#f4f4f2" }, { a: "#2c3e50", b: "#e67e22", bg: "#f6f6f4" }],
  garden: [{ a: "#2d5a27", b: "#d4a017", bg: "#f5f7f0" }], build: [{ a: "#222831", b: "#f2a93b", bg: "#f6f6f6" }], home: [{ a: "#1b4965", b: "#ff9f1c", bg: "#f5f7f9" }, { a: "#14213d", b: "#fca311", bg: "#f6f6f4" }],
  service: [{ a: "#0b3954", b: "#f25f5c", bg: "#f7f7f5" }], care: [{ a: "#24555e", b: "#e3b5a4", bg: "#f8f5f2" }], event: [{ a: "#3d2c3e", b: "#c9a227", bg: "#faf7f2" }], auto: [{ a: "#111111", b: "#d62828", bg: "#f4f4f4" }], other: [{ a: "#333", b: "#888", bg: "#f6f6f6" }],
}

// ── places: US metros with real-shaped ZIPs and area codes ; a state's code and ZIP prefix when only the state is known ──
const US_PLACES: Record<string, { state: string; zips: string[]; area: string[] }> = {
  austin: { state: "TX", zips: ["78701", "78704", "78731", "78745", "78759"], area: ["512", "737"] },
  // the towns around Austin : their own ZIPs, Austin's area codes (a Round Rock plumber is never on a Washington number)
  "round rock": { state: "TX", zips: ["78664", "78665", "78681"], area: ["512", "737"] }, "cedar park": { state: "TX", zips: ["78613"], area: ["512", "737"] }, pflugerville: { state: "TX", zips: ["78660"], area: ["512", "737"] },
  georgetown: { state: "TX", zips: ["78626", "78628", "78633"], area: ["512", "737"] }, leander: { state: "TX", zips: ["78641"], area: ["512", "737"] }, "dripping springs": { state: "TX", zips: ["78620"], area: ["512", "737"] },
  lakeway: { state: "TX", zips: ["78734", "78738"], area: ["512", "737"] }, "bee cave": { state: "TX", zips: ["78738"], area: ["512", "737"] }, kyle: { state: "TX", zips: ["78640"], area: ["512", "737"] },
  buda: { state: "TX", zips: ["78610"], area: ["512", "737"] }, "san marcos": { state: "TX", zips: ["78666"], area: ["512", "737"] }, hutto: { state: "TX", zips: ["78634"], area: ["512", "737"] },
  "san antonio": { state: "TX", zips: ["78205", "78209", "78230"], area: ["210", "726"] }, "fort worth": { state: "TX", zips: ["76102", "76107", "76109"], area: ["817", "682"] }, dallas: { state: "TX", zips: ["75201", "75225", "75230"], area: ["214", "469"] }, houston: { state: "TX", zips: ["77002", "77024", "77056"], area: ["713", "832"] },
  denver: { state: "CO", zips: ["80202", "80210", "80231"], area: ["303", "720"] }, portland: { state: "OR", zips: ["97201", "97209", "97214"], area: ["503", "971"] }, seattle: { state: "WA", zips: ["98101", "98109", "98115"], area: ["206"] },
  miami: { state: "FL", zips: ["33130", "33139", "33156"], area: ["305", "786"] }, boston: { state: "MA", zips: ["02108", "02116", "02215"], area: ["617", "857"] }, chicago: { state: "IL", zips: ["60601", "60614", "60657"], area: ["312", "773"] },
  phoenix: { state: "AZ", zips: ["85004", "85016", "85032"], area: ["602", "480"] }, atlanta: { state: "GA", zips: ["30305", "30309", "30324"], area: ["404", "678"] }, nashville: { state: "TN", zips: ["37203", "37205", "37215"], area: ["615", "629"] },
  boise: { state: "ID", zips: ["83702", "83704", "83706"], area: ["208"] }, "san diego": { state: "CA", zips: ["92101", "92103", "92109"], area: ["619", "858"] }, charlotte: { state: "NC", zips: ["28202", "28203", "28209"], area: ["704", "980"] },
}
const STATES: Record<string, [string, string]> = { // code → [area code, ZIP prefix]
  AL: ["205", "352"], AK: ["907", "995"], AZ: ["602", "850"], AR: ["501", "722"], CA: ["213", "900"], CO: ["303", "802"], CT: ["203", "065"], DE: ["302", "198"], FL: ["305", "331"], GA: ["404", "303"], HI: ["808", "968"], ID: ["208", "837"], IL: ["312", "606"], IN: ["317", "462"], IA: ["515", "503"], KS: ["316", "672"], KY: ["502", "402"], LA: ["504", "701"], ME: ["207", "041"], MD: ["410", "212"], MA: ["617", "021"], MI: ["313", "482"], MN: ["612", "554"], MS: ["601", "392"], MO: ["314", "631"], MT: ["406", "591"], NE: ["402", "681"], NV: ["702", "891"], NH: ["603", "033"], NJ: ["201", "070"], NM: ["505", "871"], NY: ["212", "100"], NC: ["919", "276"], ND: ["701", "581"], OH: ["614", "432"], OK: ["405", "731"], OR: ["503", "972"], PA: ["215", "191"], RI: ["401", "029"], SC: ["803", "292"], SD: ["605", "571"], TN: ["615", "372"], TX: ["512", "787"], UT: ["801", "841"], VT: ["802", "054"], VA: ["804", "232"], WA: ["206", "981"], WV: ["304", "253"], WI: ["414", "532"], WY: ["307", "820"],
}
const US_TOWNS = [["Fairhaven", "ME", "04099", "207"], ["Oakmont", "TX", "78099", "512"], ["Riverbend", "OH", "43099", "614"], ["Pinecrest", "CO", "80499", "303"], ["Silver Hollow", "OR", "97099", "503"], ["Eastbrook", "NC", "27099", "919"]]
const FR_PLACES: Record<string, string[]> = { lyon: ["69001", "69003", "69006", "69007", "69009"], paris: ["75011", "75015", "75017"], marseille: ["13001", "13008"], lille: ["59000", "59800"], bordeaux: ["33000", "33200"], toulouse: ["31000", "31200"], nantes: ["44000", "44300"], rennes: ["35000", "35200"], nice: ["06000", "06300"], strasbourg: ["67000", "67100"], montpellier: ["34000", "34070"], grenoble: ["38000", "38100"], annecy: ["74000"], dijon: ["21000"], rouen: ["76000"] }
const FR_TOWNS = [["Valmont-sur-Lys", "62499"], ["Castel-Aurin", "31499"], ["Brézelonne", "35499"], ["Sornac-le-Haut", "19499"], ["Véreuil", "41499"], ["Quillanne-sur-Orme", "61499"], ["Lavrenne-la-Côte", "22499"], ["Mont-Rozel", "88499"]]
// ARCEP blocks reserved for fiction, by the zone of the department (01 Île-de-France · 02 north-west · 03 north-east · 04 south-east · 05 south-west)
const FR_FICTION: Record<string, string> = { "1": "01 99 00", "2": "02 61 91", "3": "03 53 01", "4": "04 65 71", "5": "05 36 49" }
const FR_ZONE: Record<string, string> = {}
for (const [z, depts] of Object.entries({ "1": "75,77,78,91,92,93,94,95", "2": "14,18,22,27,28,29,35,36,37,41,44,45,49,50,53,56,61,72,76,85", "3": "02,08,10,21,25,39,51,52,54,55,57,58,59,60,62,67,68,70,71,80,88,89,90", "4": "01,03,04,05,06,07,11,13,15,20,26,30,34,38,42,43,48,63,66,69,73,74,83,84", "5": "09,12,16,17,19,23,24,31,32,33,40,46,47,64,65,79,81,82,86,87" })) for (const d of depts.split(",")) FR_ZONE[d] = z
export const frFictionBlock = (zip: string): string => FR_FICTION[FR_ZONE[String(zip || "").slice(0, 2)] || "1"]
const US_STATE_NAMES: Record<string, string> = { texas: "TX", california: "CA", florida: "FL", "new york": "NY", ohio: "OH", maine: "ME", oregon: "OR", colorado: "CO", washington: "WA", georgia: "GA", tennessee: "TN", arizona: "AZ", illinois: "IL", massachusetts: "MA", idaho: "ID", "north carolina": "NC" }

const REASONS_FR = ["pas responsive (pas de viewport)", "pas de HTTPS (sécurité + SEO pénalisé)", "dernière trace de maj : 2012", "page très pauvre (peu de contenu)", "aucune photo", "SEO pauvre (pas de description / OG)", "vieux jQuery (socle technique daté)"]
const REASONS_EN = ["not responsive (no viewport)", "no HTTPS (security, Google penalty)", "last updated: 2012", "thin page (little content)", "no photos", "poor SEO (no description / OG)", "old jQuery (dated stack)"]
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
function rnd(seed: number) { let x = seed || 1; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff } }
const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)]

/** « Austin, TX » → { city: "Austin", state: "TX" } ; « austin » → « Austin » */
export function splitPlace(place: string): { city: string; state: string } {
  const p = String(place || "").trim()
  const m = /^(.*?)(?:,\s*|\s+)([A-Z]{2})$/.exec(p)
  if (m && STATES[m[2]]) return { city: title(m[1].trim()), state: m[2] }
  const named = Object.entries(US_STATE_NAMES).find(([n]) => new RegExp(`(^|,\\s*|\\s)${n}$`, "i").test(p))
  if (named) return { city: title(p.replace(new RegExp(`,?\\s*${named[0]}$`, "i"), "").trim()), state: named[1] }
  return { city: p ? title(p) : "", state: "" }
}

/** `home` : the agency's own US state (from its postal address) : a town the demo doesn't know, said without a state,
 *  gets that state's ZIP prefix and area code (never a Washington DC number by default) */
export function invent(o: { trades: string[]; place?: string; country: string; count: number; seed: number; taken: Set<string>; takenPhones?: Set<string>; home?: string }): SimProspect[] {
  const r = rnd(o.seed)
  const us = o.country !== "FR" && o.country !== "BE" && o.country !== "CH" // French-speaking markets sound French ; everyone else, American-English
  const n = Math.max(1, Math.min(SIM_MAX, Math.round(o.count) || 4))
  const { city: askedCity, state: askedState } = splitPlace(o.place || "")
  const placeKey = askedCity.toLowerCase()
  const out: SimProspect[] = []
  // a number is never given to two businesses : not in this search, nor one already on the list (an earlier search)
  const usedWords = new Set<string>(), usedPhones = new Set<string>([...(o.takenPhones || [])].map((p) => p.replace(/\D/g, "")))
  // names already on the board (the cast, earlier searches) count too: « Redwood Pool & Spa » there means no « Redwood Roofing » here
  for (const id of o.taken) for (const w of id.split("-").slice(0, 2)) if (w.length > 3) usedWords.add(w.toLowerCase())
  for (let i = 0; i < n * 40 && out.length < n; i++) {
    const trade = o.trades.length ? o.trades[out.length % o.trades.length] : "menuisier"
    const fam = familyOf(trade)
    // the name: its distinctive word is never reused in this search (no near-duplicates)
    let name: string, word: string
    if (us) { word = pick(r, US_FIRST); name = `${word} ${pick(r, enTails(trade))}` }
    else { word = pick(r, FR_SURNAMES); name = `${pick(r, frHeads(trade))} ${word}${r() < 0.2 ? " & Fils" : ""}` }
    if (usedWords.has(word.toLowerCase())) continue
    let city: string, region = "", zip = "", phone: string
    if (us) {
      const m = US_PLACES[placeKey]
      let area: string
      if (m && (!askedState || askedState === m.state)) { city = askedCity; region = m.state; zip = pick(r, m.zips); area = pick(r, m.area) }
      else if (askedCity) { const stc = STATES[askedState] ? askedState : STATES[o.home || ""] ? o.home! : "TX"; city = askedCity; region = stc; const st = STATES[stc]; zip = `${st[1]}${String(10 + Math.floor(r() * 89))}`; area = st[0] }
      else { const t = pick(r, US_TOWNS); city = t[0]; region = t[1]; zip = t[2]; area = t[3] }
      phone = `(${area}) 555-01${String(10 + Math.floor(r() * 89))}`
    } else {
      const z = FR_PLACES[placeKey]
      if (z) { city = askedCity; zip = pick(r, z) }
      else if (askedCity) { city = askedCity; zip = "" }
      else { const t = pick(r, FR_TOWNS); city = t[0]; zip = t[1] }
      phone = `${frFictionBlock(zip)} ${String(10 + Math.floor(r() * 89))} ${String(10 + Math.floor(r() * 89))}`
    }
    const id = `${slug(name)}-${slug(city)}`
    if (o.taken.has(id) || usedPhones.has(phone.replace(/\D/g, ""))) continue // never two businesses on one number
    usedWords.add(word.toLowerCase()); usedPhones.add(phone.replace(/\D/g, "")); o.taken.add(id)
    const pal = pick(r, PALETTES[fam])
    const pool = us ? REASONS_EN : REASONS_FR
    const reasons = pool.filter(() => r() < 0.5).slice(0, 4); if (reasons.length < 2) reasons.push(pool[0], pool[2])
    out.push({ id, industry: trade, name, city, region, zip, phone, email: r() < 0.7 ? `contact@${slug(name)}.example` : null, url: `http://${slug(name)}.example/`, palette: pal, services: servicesFor(trade, fam, !us), since: 1994 + Math.floor(r() * 16), reasons: [...new Set(reasons)], lang: us ? "en" : "fr" })
  }
  return out
}
export function toSheet(p: SimProspect, country: string): any {
  // « Strong fit » marks about a third of a search (the sites with the most to gain), never nearly all of it : four
  // problems, and two of three of those (a stable pick from the id) ; the others are a fit
  let h = 0; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const strong = p.reasons.length >= 4 && h % 3 !== 2
  const value = strong ? 76 + (h % 15) : Math.min(74, 58 + (p.reasons.length * 4) + (h % 5))
  const en = p.lang ? p.lang === "en" : country !== "FR"
  return {
    id: p.id, industry: p.industry,
    identity: { name: p.name, city: p.city, ...(p.region ? { state: p.region } : {}), ...(p.zip ? { zip: p.zip } : {}), phone: p.phone, ...(p.email ? { email: p.email } : {}), hours: en ? "Mon–Fri 8 am – 5 pm" : "Lun–Ven 8h–18h" },
    content: { services: p.services, tagline: "", about: "" }, assets: { photos: [] },
    existing: { url: p.url, screenshot: `assets/${p.id}/avant.png` },
    score: { value: Math.min(97, value), tier: strong ? "hot" : "warm", reasons: p.reasons, accroche: en ? `Your site: ${p.reasons[0]}.` : `Votre site : ${p.reasons[0]}.`, at: Date.now() },
    audit: { https: !p.reasons.some((x) => /HTTPS/.test(x)), mobile: { hasViewportMeta: !p.reasons.some((x) => /responsive/.test(x)) }, strengths: { copyrightYear: p.reasons.some((x) => /2012/.test(x)) ? 2012 : null } },
    _sample: "fictional prospect invented by the sandbox engine", _sim: { palette: p.palette, since: p.since, family: familyOf(p.industry), lang: en ? "en" : "fr" },
  }
}
