/**
 * Scraping — config des métiers et des zones (la seule chose à éditer pour couvrir + de prospects).
 *
 * Chaque métier mappe vers : les tags OSM (source osm), les codes NAF/APE (source sirene FR),
 * et des `terms` (mots-clés métier pour valider/chercher un site à l'enrichissement).
 * Ajouter une ligne ici = un nouveau métier scrapable sur TOUTES les sources d'un coup.
 */
export type Industry = {
  label: string
  osm: string[] // sélecteurs de tags OSM (Overpass)
  naf: string[] // codes NAF pointés (API Recherche d'entreprises, FR)
  terms: string[] // mots-clés métier (requête d'enrichissement + validation de pertinence)
  /** le métier en ANGLAIS (agence hors francophonie : label affiché, mots-clés de validation/recherche). La CLÉ reste l'identifiant. */
  en?: { label: string; terms: string[] }
  chains?: string[] // marques de réseaux/franchises PROPRES au métier (fragments regex) → exclues (gate FIT)
  // baselines de scoring /100 (le métier décide à quel point un beau site compte / paie / peut grandir)
  lever: number // LEVIER : un meilleur site change-t-il la donne pour ce métier ? (vend-il par l'image ?)
  // VALEUR : la valeur-TICKET du métier = les € qu'il peut nous rapporter. Ancrée sur le ticket de SA
  // propre vente (plus sa vente est grosse, plus notre site se rembourse vite → plus il peut nous payer) :
  //   ~95 = ticket 10-100k€ (pisciniste)              · le site se rembourse en 1 vente, prix premium justifié
  //   ~90 = ticket 15-30k€ (lieu de réception)        · 1 réservation rembourse 100×
  //   ~80 = projet lourd / honoraires (architecte)    · le portfolio EST le commerce
  //   ~70-78 = ticket 10-30k€ (cuisiniste, paysagiste HDG)
  //   ~60-65 = artisan standard (menuisier, ferronnier)
  value: number
  expansion: number // EXPANSION : potentiel futur (réservation, e-commerce, récurrent…)
  // ── dimensions RADAR (`npm run radar` — quels MÉTIERS attaquer) ; optionnelles, défauts dans radar.ts ──
  ticket?: string // fourchette € de LEUR vente, lisible (ex "8–30 k€")
  tam?: number // nb d'indépendants estimé en francophonie (FR+BE+CH)
  franchised?: number // 0-100 : densité de franchises/réseaux (rogne le vivier vendable)
  recurring?: number // 0-100 : potentiel de revenu récurrent
}

export const INDUSTRIES: Record<string, Industry> = {
  cuisiniste: {
    label: "cuisiniste",
    osm: ['["shop"="kitchen"]'],
    naf: ["47.59A", "43.32A"], // commerce de détail de meubles · menuiserie bois/PVC
    terms: ["cuisiniste", "cuisines", "cuisine", "agencement"],
    en: { label: "kitchen designer", terms: ["kitchen", "kitchens", "kitchen design", "cabinetry", "kitchen remodel"] },
    lever: 80, value: 75, expansion: 40, // showroom = vente à l'image · ticket 10-30k · 3D/config
    tam: 6000, franchised: 60, recurring: 20, ticket: "10–30 k€",
  },
  menuisier: {
    label: "menuisier",
    osm: ['["craft"="carpenter"]', '["craft"="joiner"]'],
    naf: ["43.32A", "16.23Z"], // menuiserie bois/PVC · fabrication charpente/menuiserie
    terms: ["menuisier", "menuiserie", "agencement", "bois"],
    en: { label: "carpenter / joiner", terms: ["carpenter", "carpentry", "joinery", "woodwork", "custom millwork"] },
    lever: 70, value: 65, expansion: 35,
    tam: 15000, franchised: 20, recurring: 25, ticket: "3–30 k€",
  },
  ferronnier: {
    label: "ferronnier",
    osm: ['["craft"="metal_construction"]', '["craft"="blacksmith"]'],
    naf: ["25.62B", "43.32B"], // mécanique industrielle · menuiserie métallique/serrurerie
    terms: ["ferronnier", "ferronnerie", "métallerie", "serrurerie"],
    en: { label: "metalworker / blacksmith", terms: ["metalwork", "blacksmith", "wrought iron", "ironwork", "welding"] },
    lever: 65, value: 60, expansion: 30,
    tam: 8000, franchised: 5, recurring: 20, ticket: "2–20 k€",
  },
  architecte: {
    label: "architecte",
    osm: ['["office"="architect"]'],
    naf: ["71.11Z"], // activités d'architecture
    terms: ["architecte", "architecture", "agence"],
    en: { label: "architect", terms: ["architect", "architecture", "architectural practice", "residential architect"] },
    lever: 85, value: 80, expansion: 45, // le portfolio EST le commerce · honoraires élevés
    tam: 12000, franchised: 5, recurring: 30, ticket: "honoraires 20–200 k€",
  },
  paysagiste: {
    label: "paysagiste",
    osm: ['["craft"="gardener"]', '["shop"="garden_centre"]'],
    naf: ["81.30Z", "71.11Z"], // services d'aménagement paysager
    terms: ["paysagiste", "paysage", "jardin", "aménagement extérieur"],
    en: { label: "landscaper", terms: ["landscaping", "landscaper", "landscape design", "garden design", "hardscape"] },
    lever: 80, value: 72, expansion: 50, // avant/après visuel · projets HDG 5-50k€ · entretien = récurrent
    tam: 9000, franchised: 15, recurring: 60, ticket: "5–50 k€",
  },
  pisciniste: {
    label: "pisciniste",
    // Pas de tag OSM dédié solide ni de NAF propre (recall faible, comme cuisiniste) → l'enrichissement
    // par `terms` + la validation métier portent la découverte. OSM/NAF = filets d'appoint.
    osm: ['["shop"="swimming_pool"]', '["craft"="pool"]'],
    naf: ["43.99C", "42.99Z"], // gros œuvre / construction d'ouvrages NCA (piscinistes-constructeurs y atterrissent, bruité)
    terms: ["pisciniste", "piscine", "piscines", "construction piscine", "spa", "pool"],
    en: { label: "pool builder", terms: ["pool", "pools", "pool builder", "swimming pool", "pool construction", "pool contractor"] },
    // La piscine est l'un des métiers les plus FRANCHISÉS de France → liste de réseaux indispensable
    // (un franchisé ne décide pas de son site = invendable). Complétée par l'heuristique anti-réseau.
    chains: ["cash[- ]?piscines?", "desjoyaux", "magiline", "everblue", "hydro[- ]?sud", "aquilus",
      "carr[ée] ?bleu", "mondial piscine", "waterair", "diffazur", "piscines? ibiza", "alliance piscines",
      "irri[- ]?(jardin|piscine)", "procopi", "g[ée]n[ée]ration piscine", "piscinelle", "esprit piscine",
      "excel piscine", "sundance", "clair[- ]?azur", "abord[- ]?piscines", "france piscines composites",
      "piscine ?\\+", "piscine plus", "caron piscine"],
    // LA verticale premium : leur vente = 10-100k€ → 1 piscine de plus rembourse notre site ×4-10 (objection
    // prix annulée) · le choix se joue sur les photos avant/après (visuel décisif) · rénovation/entretien = récurrent
    lever: 90, value: 95, expansion: 55,
    tam: 4000, franchised: 55, recurring: 50, ticket: "10–100 k€",
  },
  "lieu-reception": {
    label: "lieu de réception / domaine de mariage",
    osm: ['["amenity"="events_venue"]'], // salles/halls louables pour mariages & événements
    naf: ["82.30Z", "93.29Z", "55.20Z"], // organisation d'événements · loisirs · hébergement court (recall faible → OSM = source principale)
    terms: ["mariage", "réception", "domaine", "salle de réception", "château", "séminaire", "événement", "wedding"],
    en: { label: "wedding & event venue", terms: ["wedding venue", "event venue", "venue", "weddings", "receptions"] },
    // le choix se fait à ~90 % sur les photos/vibe (notre design est décisif) · ticket 15-30k€ (1 réservation rembourse 100×) · réservation saisonnière + séminaires = récurrent
    lever: 92, value: 90, expansion: 55,
    tam: 3000, franchised: 10, recurring: 55, ticket: "10–30 k€/event",
  },

  // ═══ métiers premium câblés via le radar (recherche + vérification adversariale, 2026-06-14) ═══
  verandaliste: {
    label: "vérandaliste / pergola",
    // pas de tag OSM véranda dédié → menuiserie alu/fenêtres = filet d'appoint (recall partiel) ; terms + SIRENE portent
    osm: ['["craft"="window_construction"]', '["shop"="windows"]'],
    naf: ["43.32A", "43.32B"], // INSEE : « montage de serres et vérandas pour particuliers » dans les deux
    terms: ["véranda", "vérandas", "pergola", "pergolas", "extension vitrée", "véranda aluminium"],
    en: { label: "sunroom & pergola installer", terms: ["sunroom", "conservatory", "pergola", "patio cover", "sunrooms"] },
    chains: ["akena", "r[ée]noval", "vie ?(&|et) ?v[ée]randa", "gustave ?rideau", "v[ée]randa ?rideau", "tryba", "le ?v[ée]randier", "komilfo", "concept ?alu", "v[ée]rancial", "v[ée]randaline", "solisyst[èe]me"],
    lever: 80, value: 88, expansion: 30,
    tam: 2500, franchised: 40, recurring: 20, ticket: "8–30 k€",
  },
  "constructeur-ccmi": {
    label: "constructeur de maison individuelle (CCMI)",
    osm: ['["craft"="builder"]', '["office"="construction_company"]', '["office"="construction"]'],
    naf: ["41.20A"], // INSEE : construction de maisons individuelles (exclut promotion 41.10A / agences immo)
    terms: ["constructeur de maison", "maison individuelle", "CCMI", "contrat de construction", "construction de maison", "maison neuve", "faire construire"],
    en: { label: "home builder", terms: ["home builder", "custom homes", "new construction", "house builder"] },
    chains: ["maisons? france confort", "hexaom", "maisons? ph[ée]nix", "maison familiale", "maisons? castor", "maison catherine mamet", "demeures? de la c[oô]te d['e ]argent", "maisons? clairlande", "geoxia", "natilia", "mikit", "villas? club", "maisons? pierre", "babeau[- ]?seguin", "trecobat", "demeures? cala(?:doises?|isiennes?)", "top[- ]?duo", "maisons? s[ée]same", "maisons? d['e ]en france", "maisons? du marais", "maisons? berval", "maisons? aliz[ée]a?", "maisons? arlogis", "ast[- ]?groupe", "maisons? bati[- ]?france", "ami[- ]?bois"],
    lever: 75, value: 92, expansion: 20,
    tam: 3000, franchised: 35, recurring: 10, ticket: "150–400 k€",
  },
  "medecine-esthetique": {
    label: "médecine esthétique",
    // ⚠ recall PARTIEL : pas de tag « médecine esthétique » → proxy chirurgie plastique / dermatologie (bruité) ;
    // NAF 86.22B/C large → les terms (botox / acide hyaluronique…) valident l'appartenance.
    osm: ['["healthcare:speciality"="plastic_surgery"]', '["healthcare:speciality"~"dermatology"]'],
    naf: ["86.22C", "86.22B"],
    terms: ["médecine esthétique", "injection acide hyaluronique", "botox", "peeling", "épilation laser", "médecin esthétique"],
    en: { label: "aesthetic medicine clinic", terms: ["aesthetic", "med spa", "botox", "fillers", "cosmetic clinic"] },
    chains: ["clinique des champs[- ]?[ée]lys[ée]es", "crpce", "dermatys", "laserel", "laser ?26", "d[ée]pil[- ]?tech", "smart ?duck", "centre ?murano"],
    lever: 72, value: 80, expansion: 65,
    tam: 4000, franchised: 25, recurring: 70, ticket: "500–10 k€/acte",
  },
  "dentisterie-esthetique": {
    label: "dentisterie esthétique / cabinet dentaire",
    osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    naf: ["86.23Z"], // pratique dentaire
    terms: ["chirurgien-dentiste", "cabinet dentaire", "implant dentaire", "facettes", "blanchiment dentaire", "invisalign"],
    en: { label: "dental practice", terms: ["dentist", "dental", "cosmetic dentistry", "dental clinic"] },
    chains: ["dentego", "dentylis", "clinadent", "docali", "dentelia", "place\\s?dentaire", "dentapte", "denteka", "cemedis", "dentasmile", "dentifree", "espace dentaire mutualiste", "vyv dentaire", "mutualit[ée] fran[çc]aise dentaire"],
    lever: 68, value: 78, expansion: 60,
    tam: 8000, franchised: 10, recurring: 65, ticket: "1–20 k€",
  },
  "installateur-pv-pac": {
    label: "installateur photovoltaïque / pompe à chaleur (RGE)",
    osm: ['["craft"="photovoltaic"]', '["craft"="heating_engineer"]', '["shop"="energy"]'],
    naf: ["43.21A", "43.22B"], // installation électrique / eau et gaz (chauffage)
    terms: ["photovoltaïque", "panneaux solaires", "pompe à chaleur", "RGE", "QualiPV", "QualiPAC", "autoconsommation"],
    en: { label: "solar & heat pump installer", terms: ["solar", "solar panels", "heat pump", "hvac", "solar installer"] },
    chains: ["edf\\s*enr", "edf\\s*solutions?\\s*solaires?", "engie", "mypower", "cap\\s*soleil", "otovo", "cozynergy", "sweetcom", "comwatt", "maclem", "garanka", "proxiserve", "mon\\s*chauffagiste\\s*priv[ée]", "adekwatts", "solarock", "soleil\\s*en\\s*t[êe]te", "le\\s*roi\\s*solaire", "tuco\\s*[ée]?nergie", "izi\\s*by\\s*edf", "effy", "hellio"],
    lever: 68, value: 75, expansion: 40,
    tam: 10000, franchised: 45, recurring: 30, ticket: "8–25 k€",
  },
  "wedding-planner": {
    label: "wedding planner / organisateur de mariage",
    osm: ['["office"="wedding_planner"]', '["office"="event_management"]'],
    naf: ["82.30Z", "96.09Z", "93.29Z", "56.21Z"], // organisation d'événements / services perso / loisirs / traiteur
    terms: ["wedding planner", "organisation de mariage", "organisateur de mariage", "organisatrice de mariage", "coordination jour J", "organisation de mariage sur-mesure"],
    en: { label: "wedding planner", terms: ["wedding planner", "wedding planning", "event planner"] },
    // pas de réseau national franchisé notable (métier d'indépendants) → l'heuristique anti-réseau suffit
    lever: 75, value: 55, expansion: 35,
    tam: 5000, franchised: 10, recurring: 20, ticket: "2–8 k€",
  },

  // ═══ découverte de masse via le radar (workflow wire-industries-folie, 2026-06-14) ═══
  "architecte-interieur": {
    label: "architecte d'intérieur / décorateur d'intérieur",
    osm: ['["office"="interior_design"]', '["craft"="interior_decorator"]'],
    naf: ["74.10Z", "71.11Z", "74.13Y", "71.11Y"],
    terms: ["architecte d'intérieur", "décorateur d'intérieur", "décoration d'intérieur", "aménagement intérieur", "agencement sur-mesure", "home staging"],
    en: { label: "interior designer", terms: ["interior design", "interior designer", "interiors", "decorator"] },
    chains: ["notes de styles", "mh ?deco", "mh ?interior", "camif ?habitat", "ladd", "ateliers du d[ée]corateur", "archit[ée]a", "perene"],
    lever: 85, value: 80, expansion: 45,
    tam: 10000, franchised: 8, recurring: 18, ticket: "8-30 k€", // vérifié
  },
  "maitre-oeuvre": {
    label: "maître d'œuvre en bâtiment",
    osm: ['["office"="construction_company"]', '["craft"="builder"]'],
    naf: ["74.90A", "71.12B"],
    terms: ["maître d'œuvre", "maîtrise d'œuvre", "suivi de chantier", "rénovation", "économiste de la construction", "pilotage de travaux"],
    en: { label: "general contractor / project manager", terms: ["general contractor", "construction management", "remodeling", "contractor"] },
    chains: ["la maison des travaux", "illico ?travaux", "camif ?habitat", "hexa ?r[ée]nov", "hexaom", "la maison saint[- ]?gobain", "maison ?\\& ?travaux", "courtier ?en ?travaux", "r[ée]novman", "maisons france confort"],
    lever: 82, value: 78, expansion: 42,
    tam: 14000, franchised: 20, recurring: 30, ticket: "5-25 k€/chantier", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "salle-de-bain": {
    label: "concepteur / spécialiste de salles de bains",
    osm: ['["shop"="bathroom_furnishing"]'],
    naf: ["47.52B", "47.52A", "43.22A", "43.32A"],
    terms: ["salle de bains", "salle de bain", "rénovation salle de bain", "douche à l'italienne", "sur mesure", "showroom"],
    en: { label: "bathroom remodeler", terms: ["bathroom", "bathrooms", "bathroom remodel", "bath design"] },
    chains: ["espace ?aubade", "cedeo", "envie de salle de bain", "brossette", "au fil du bain", "zaleoo", "ind[ée]pendance royale", "camif ?habitat", "illico ?travaux", "monsieur salle de bain", "la maison saint[- ]?gobain", "saint[- ]?gobain", "bain ?\\& ?d[ée]co"],
    lever: 82, value: 78, expansion: 42,
    tam: 9000, franchised: 55, recurring: 15, ticket: "8-30 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "couvreur-zingueur": {
    label: "couvreur-zingueur / charpentier toiture",
    osm: ['["craft"="roofer"]'],
    naf: ["43.91B", "43.91A"],
    terms: ["couvreur", "zingueur", "couverture", "toiture", "charpente", "zinguerie", "démoussage"],
    en: { label: "roofer", terms: ["roofing", "roofer", "roof repair", "roof replacement", "gutters"] },
    chains: ["attila", "technitoit", "la compagnie des toits", "la toiturgerie", "m[ée]tho[- ]?drone"],
    lever: 60, value: 68, expansion: 30,
    tam: 18000, franchised: 8, recurring: 22, ticket: "13-30 k€", // vérifié
  },
  "facadier-ite": {
    label: "façadier / ravalement / isolation thermique extérieure ITE",
    osm: ['["craft"="plasterer"]', '["craft"="insulation"]'],
    naf: ["43.34Z", "43.99C", "43.29A", "43.39Z"],
    terms: ["façadier", "ravalement de façade", "ITE", "isolation thermique extérieure", "enduit de façade", "ravalement"],
    en: { label: "exterior & siding contractor", terms: ["siding", "stucco", "exterior insulation", "facade", "rendering"] },
    lever: 80, value: 72, expansion: 42,
    tam: 9000, franchised: 15, recurring: 25, ticket: "8-30 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  portaillste: {
    label: "installateur de portails, clôtures et motorisation",
    osm: ['["craft"="fence_maker"]', '["craft"="metal_construction"]'],
    naf: ["43.32B", "43.29B", "43.32A"],
    terms: ["portail", "clôture", "portail aluminium", "motorisation portail", "automatisme", "portillon"],
    en: { label: "gate & fence installer", terms: ["gates", "fencing", "fence", "automatic gates", "driveway gates"] },
    chains: ["tryba", "komilfo", "solabaie", "k ?par ?k", "art ?(et|&) ?fen[êe]tres", "cl[oô]ture ?id[ée]ale", "lapeyre", "monsieur ?store", "store ?center", "ma ?fen[êe]tre", "rêve ?de ?cl[oô]ture", "r[êe]ve ?de ?cl[oô]ture", "casa ?cl[oô]ture", "cl[oô]turfree"],
    lever: 78, value: 70, expansion: 42,
    tam: 9000, franchised: 45, recurring: 25, ticket: "2-15 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  storiste: {
    label: "storiste / pergola bioclimatique / stores et volets",
    osm: ['["craft"="sun_protection"]', '["craft"="window_construction"]'],
    naf: ["43.32A", "43.32B"],
    terms: ["storiste", "store banne", "pergola bioclimatique", "volets roulants", "protection solaire", "stores et fermetures"],
    en: { label: "blinds, shutters & awnings", terms: ["blinds", "shutters", "awnings", "window treatments", "pergola"] },
    chains: ["storistes? de france", "komilfo", "tryba", "solabaie", "la boutique du store", "boutique du store", "walter stores?", "heytens", "stores? (et|&) pergolas", "soliso", "store ?2000", "reparstores?"],
    lever: 82, value: 72, expansion: 45,
    tam: 4000, franchised: 70, recurring: 35, ticket: "2-25 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "poele-cheminee": {
    label: "installateur de poêles, cheminées et inserts",
    osm: ['["shop"="fireplace"]'],
    naf: ["43.22B", "47.59B"],
    terms: ["poêle à granulés", "poêle à bois", "cheminée", "insert", "foyer fermé", "chauffage bois"],
    en: { label: "fireplace & stove installer", terms: ["fireplace", "stove", "wood stove", "chimney", "hearth"] },
    chains: ["turbo[- ]?fonte", "brisach", "flammes du monde", "chemin[eé]+es?\\s+philippe", "invicta", "j[øo]tul"],
    lever: 80, value: 68, expansion: 45,
    tam: 5500, franchised: 40, recurring: 28, ticket: "4-12 k€", // vérifié
  },
  "installateur-spa-sauna-hammam": {
    label: "installateur de spas, saunas et hammams privés",
    osm: ['["shop"="swimming_pool"]'],
    naf: ["43.22B", "47.78C", "43.99C"],
    terms: ["spa", "sauna", "hammam", "spa de nage", "jacuzzi", "balnéo"],
    en: { label: "hot tub & sauna installer", terms: ["hot tub", "spa", "sauna", "steam room", "hot tubs"] },
    chains: ["irri[- ]?jardin", "irripiscine", "aquilus", "clair[- ]?azur", "nordique france"],
    lever: 85, value: 82, expansion: 55,
    tam: 2000, franchised: 25, recurring: 45, ticket: "6–35 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  marbrier: {
    label: "marbrier / plans de travail pierre et quartz",
    osm: ['["craft"="stonemason"]'],
    naf: ["23.70Z", "43.33Z"],
    terms: ["marbrier", "marbrerie", "plan de travail granit", "quartz", "pierre naturelle", "plan de travail sur mesure"],
    en: { label: "stone & countertop fabricator", terms: ["countertops", "granite", "quartz", "marble", "stone fabrication"] },
    lever: 75, value: 66, expansion: 38,
    tam: 2500, franchised: 5, recurring: 25, ticket: "3–15 k€", // vérifié
  },
  escalieteur: {
    label: "fabricant d'escaliers sur mesure",
    osm: ['["craft"="carpenter"]', '["craft"="joiner"]', '["craft"="metal_construction"]'],
    naf: ["16.23Z", "43.32A", "43.32B"],
    terms: ["escalier", "escaliers", "escaliéteur", "escalier sur mesure", "escalier bois", "rampe"],
    en: { label: "staircase maker", terms: ["staircase", "stairs", "custom stairs", "railings"] },
    chains: ["treppenmeister", "skali", "lapeyre", "ascenso"],
    lever: 85, value: 70, expansion: 35,
    tam: 3500, franchised: 25, recurring: 15, ticket: "5-20 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  domoticien: {
    label: "intégrateur domotique / home cinéma / maison connectée",
    osm: ['["craft"="electrician"]', '["shop"="hifi"]', '["shop"="electronics"]'],
    naf: ["43.21A", "47.43Z", "95.21Z"],
    terms: ["domotique", "maison connectée", "home cinéma", "KNX", "Crestron", "Control4", "Loxone", "intégrateur domotique"],
    en: { label: "smart home integrator", terms: ["smart home", "home automation", "home theater", "av integration"] },
    chains: ["\\bandom\\b", "\\bav[ée]lis ?connect\\b", "\\binhome ?tech\\b", "\\bhomkia\\b"],
    lever: 88, value: 85, expansion: 55,
    tam: 3000, franchised: 15, recurring: 45, ticket: "15–60 k€", // vérifié
  },
  veterinaire: {
    label: "clinique / cabinet vétérinaire",
    osm: ['["amenity"="veterinary"]'],
    naf: ["75.00Z"],
    terms: ["vétérinaire", "clinique vétérinaire", "cabinet vétérinaire", "soins animaux", "vétérinaires", "animaux de compagnie"],
    en: { label: "veterinary clinic", terms: ["veterinarian", "veterinary", "vet clinic", "animal hospital"] },
    chains: ["ivc[- ]?evidensia", "anicura", "vet ?partners", "sevetys", "vetdev", "mon ?v[ée]to", "argos[- ]?v[ée]t", "univet", "vet ?one", "unavets", "groupe cristal", "vplus", "vetonimo"],
    lever: 58, value: 55, expansion: 70,
    tam: 6000, franchised: 45, recurring: 85, ticket: "30-80 €/consult (LTV client élevée, récurrent)", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "opticien-createur": {
    label: "opticien-lunetier indépendant / créateur",
    osm: ['["shop"="optician"]', '["craft"="optician"]', '["healthcare"="optometrist"]'],
    naf: ["47.78A", "32.50B"],
    terms: ["opticien", "lunetier", "lunettes", "sur-mesure", "créateur", "optométriste"],
    en: { label: "independent optician", terms: ["optician", "eyewear", "optometrist", "glasses"] },
    chains: ["krys", "optic ?2000", "afflelou", "atol", "g[ée]n[ée]rale ?d.?optique", "grand ?optical", "optical center", "visual", "lissac", "[ée]couter ?voir", "opticiens? mutualistes?", "lynx ?optique", "vision ?plus", "optic ?duroc", "solaris", "alliance optique", "le collectif des lunetiers", "optique lafayette", "luz optique", "monopticien", "you ?do", "optalor", "les opticiens mobiles", "direct ?optic", "optic ?libre", "groupoptim", "man[ée]o opticiens", "pierre l[ée]man"],
    lever: 72, value: 68, expansion: 55,
    tam: 4500, franchised: 58, recurring: 52, ticket: "300 €-3 k€", // vérifié
  },
  audioprothesiste: {
    label: "audioprothésiste",
    osm: ['["shop"="hearing_aids"]', '["healthcare"="audiologist"]'],
    naf: ["47.74Z", "86.90E"],
    terms: ["audioprothésiste", "audioprothèse", "appareil auditif", "aide auditive", "correction auditive", "bilan auditif"],
    en: { label: "hearing care professional", terms: ["hearing aids", "audiologist", "hearing care", "hearing clinic"] },
    chains: ["amplifon", "audika", "audilab", "audition[ -]?conseil", "audition[ -]?sant[ée]", "audition[ -]?mutualiste", "acuitis", "entendre", "sonance", "vivason", "id[ée]al[ -]?audition", "krys[ -]?audition", "audioptic", "dyapason", "audio[ -]?2000", "g[ée]n[ée]ration[ -]?audition"],
    lever: 55, value: 62, expansion: 58,
    tam: 1500, franchised: 82, recurring: 75, ticket: "1,5-3 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "clinique-capillaire": {
    label: "clinique de greffe de cheveux / centre capillaire",
    osm: ['["healthcare:speciality"="plastic_surgery"]', '["healthcare:speciality"~"dermatology"]'],
    naf: ["86.22B", "86.22C"],
    terms: ["greffe de cheveux", "implant capillaire", "greffe capillaire", "FUE", "DHI", "microgreffe capillaire", "restauration capillaire"],
    en: { label: "hair restoration clinic", terms: ["hair transplant", "hair restoration", "hair loss clinic"] },
    chains: ["clinique du cheveu", "hairpalace", "hair palace", "elithair", "cosmedica", "dr\\.? ?cinik", "maison lut[ée]tia", "hair ?clinic"],
    lever: 90, value: 80, expansion: 55,
    tam: 300, franchised: 12, recurring: 30, ticket: "3–11 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "chirurgien-esthetique": {
    label: "chirurgien esthétique / plasticien",
    osm: ['["healthcare:speciality"="plastic_surgery"]', '["healthcare"="clinic"]["healthcare:speciality"="plastic_surgery"]'],
    naf: ["86.22B", "86.22A"],
    terms: ["chirurgien esthétique", "chirurgie esthétique", "plasticien", "chirurgie plastique", "rhinoplastie", "médecine esthétique"],
    en: { label: "plastic surgeon", terms: ["plastic surgeon", "cosmetic surgery", "plastic surgery"] },
    chains: ["clinique des champs[- ]?[ée]lys[ée]es", "crpce", "maia", "esth[ée]tique gallia", "centre laser"],
    lever: 93, value: 88, expansion: 50,
    tam: 1400, franchised: 25, recurring: 40, ticket: "3–12 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "institut-beaute": {
    label: "institut de beauté / spa urbain haut de gamme",
    osm: ['["shop"="beauty"]', '["leisure"="spa"]', '["amenity"="spa"]'],
    naf: ["96.02B", "96.04Z"],
    terms: ["institut de beauté", "soins esthétiques", "spa", "soin du visage", "épilation", "bien-être"],
    en: { label: "beauty salon & day spa", terms: ["beauty salon", "day spa", "spa", "facials", "skincare"] },
    chains: ["body[- ]?minute", "beauty[- ]?success", "esthetic[- ]?center", "guinot", "yves[- ]?rocher", "carlance", "l['\\s-]?onglerie", "d[ée]pil[- ]?tech", "d[ée]pil[- ]?plus", "smart[- ]?duck", "laserel", "body[- ]?nature", "mary[- ]?cohr", "nocib[ée]", "marionnaud", "sephora", "spa[- ]?nuxe", "cinq[- ]?mondes", "deep[- ]?nature"],
    lever: 85, value: 55, expansion: 62,
    tam: 30000, franchised: 55, recurring: 75, ticket: "30–150 € / soin", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "traiteur-evenementiel": {
    label: "traiteur événementiel / de réception",
    osm: ['["craft"="caterer"]', '["shop"="catering"]'],
    naf: ["56.21Z", "56.21Y"],
    terms: ["traiteur", "traiteur événementiel", "réception", "mariage", "cocktail", "buffet"],
    en: { label: "event caterer", terms: ["catering", "caterer", "event catering", "wedding catering"] },
    chains: ["api restauration", "class.?croute", "sodexo", "elior", "compass", "newrest"],
    lever: 90, value: 75, expansion: 58,
    tam: 17000, franchised: 12, recurring: 45, ticket: "3–15 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "photographe-mariage": {
    label: "photographe / vidéaste de mariage",
    osm: ['["craft"="photographer"]', '["shop"="photo_studio"]'],
    naf: ["74.20Z", "59.11B"],
    terms: ["photographe mariage", "vidéaste mariage", "wedding photographer", "reportage mariage", "film de mariage", "photographe"],
    en: { label: "wedding photographer", terms: ["wedding photographer", "wedding photography", "videographer"] },
    chains: ["foxaep", "grenadine"],
    lever: 90, value: 62, expansion: 40,
    tam: 25000, franchised: 8, recurring: 15, ticket: "1,3–5 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "domaine-viticole": {
    label: "domaine viticole / cave avec vente directe et œnotourisme",
    osm: ['["craft"="winery"]', '["shop"="wine"]'],
    naf: ["01.21Z", "11.02B", "11.02A", "47.25Z"],
    terms: ["domaine viticole", "vigneron indépendant", "vente au domaine", "œnotourisme", "dégustation", "caveau"],
    en: { label: "winery", terms: ["winery", "vineyard", "wine tasting", "cellar door", "estate wines"] },
    chains: ["castel", "grands chais de france", "advini", "jeanjean", "vranken[- ]?pommery", "boisset", "j\\.?p\\.? chenet", "cordier", "les grands chais", "invivo"],
    lever: 85, value: 70, expansion: 65,
    tam: 9000, franchised: 20, recurring: 65, ticket: "50–500 € / commande (récurrent, marge directe forte)", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "hotel-charme": {
    label: "hôtel de charme / boutique-hôtel indépendant",
    osm: ['["tourism"="hotel"]', '["tourism"="guest_house"]'],
    naf: ["55.10Z", "55.20Z"],
    terms: ["hôtel de charme", "boutique-hôtel", "maison d'hôtes", "hôtel indépendant", "demeure de caractère", "hôtel*** réservation"],
    en: { label: "boutique hotel", terms: ["boutique hotel", "hotel", "inn", "bed and breakfast"] },
    chains: ["\\bibis\\b", "mercure", "novotel", "sofitel", "pullman", "mama shelter", "\\bnovotel\\b", "b&b ?h[oô]tels?", "campanile", "kyriad", "premi[èe]re classe", "golden tulip", "best western", "balladins", "h[oô]tel ?f1", "\\bibis (budget|styles)\\b", "louvre hotels", "accor", "kyriad ?prestige", "appart'?city", "okko ?h[oô]tels", "greet h[oô]tel"],
    lever: 90, value: 85, expansion: 70,
    tam: 17000, franchised: 45, recurring: 70, ticket: "nuit 150–600 €", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "chambres-hotes": {
    label: "chambres d'hôtes / gîte de standing",
    osm: ['["tourism"="guest_house"]', '["tourism"="chalet"]'],
    naf: ["55.20Z", "55.10Z"],
    terms: ["chambres d'hôtes", "maison d'hôtes", "gîte de charme", "hébergement de charme", "table d'hôtes", "réservation directe"],
    en: { label: "bed & breakfast / guesthouse", terms: ["bed and breakfast", "guesthouse", "inn", "cottage rental"] },
    lever: 90, value: 68, expansion: 70,
    tam: 35000, franchised: 10, recurring: 65, ticket: "100–400 €/nuit (séjour charme 2–15 k€/sem.)", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "fleuriste-evenementiel": {
    label: "fleuriste / décorateur floral événementiel",
    osm: ['["shop"="florist"]'],
    naf: ["47.76Z", "82.30Z"],
    terms: ["fleuriste", "art floral", "décoration florale", "mariage", "événementiel", "scénographie florale"],
    en: { label: "event florist", terms: ["florist", "wedding flowers", "floral design", "event florist"] },
    chains: ["monceau ?fleurs", "au nom de la rose", "c(?:oe|œ)ur de fleurs", "rapid'?flore", "carr[ée]ment fleurs", "le jardin des fleurs", "oya fleurs", "histoire de fleurs", "rosa bonheur", "emova", "happy ?fleurs?", "interflora", "florajet", "bebloom", "aquarelle"],
    lever: 88, value: 62, expansion: 50,
    tam: 6000, franchised: 35, recurring: 50, ticket: "1,5–15 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "vehicule-premium": {
    label: "vente de véhicules premium / occasion haut de gamme",
    osm: ['["shop"="car"]', '["shop"="car"]["second_hand"="only"]'],
    naf: ["45.11Z"],
    terms: ["véhicules d'exception", "voiture de collection", "supercar", "youngtimer", "occasion premium", "négociant automobile", "GT sportive", "automobile de collection"],
    en: { label: "premium car dealer", terms: ["luxury cars", "used cars", "car dealer", "pre-owned", "dealership"] },
    chains: ["aramis ?auto", "elite[- ]?auto", "distinxion", "club[- ]?auto\\b", "auto[- ]?ies", "autosphere", "spoticar", "das ?welt ?auto", "bmw premium selection", "la centrale", "starterre", "agence automobili[èe]re", "ewigo", "carizy", "cardoen", "carjager", "car[- ]?avenue", "autohero", "capcar"],
    lever: 88, value: 88, expansion: 50,
    tam: 2500, franchised: 45, recurring: 30, ticket: "30–200 k€", // vérifié
  },
  "carrosserie-covering": {
    label: "carrosserie / covering / detailing automobile",
    osm: ['["shop"="car_repair"]'],
    naf: ["45.20A", "45.20B", "81.29B"],
    terms: ["carrosserie", "carrossier", "covering", "detailing", "esthétique automobile", "débosselage"],
    en: { label: "auto body, wrap & detailing", terms: ["auto body", "car wrap", "detailing", "paint protection", "collision repair"] },
    chains: ["ad carrosserie", "five ?star", "axial", "acoat ?selected", "autoneo", "precisium", "top carrosserie", "ixell", "fix ?auto", "ze ?carrossery", "mon petit carrossier", "bosch car service", "carglass", "france pare[- ]?brise", "mondial pare[- ]?brise", "europe d[ée]bosselage", "x['’]?pert impact", "maaco", "speedy", "midas", "feu vert", "norauto"],
    lever: 82, value: 68, expansion: 42,
    tam: 10000, franchised: 55, recurring: 30, ticket: "1,5–6 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "boat-dealer": {
    label: "vente et entretien de bateaux / yacht broker",
    osm: ['["shop"="boat"]', '["craft"="boatbuilder"]'],
    naf: ["46.14Z", "47.64Z", "33.15Z"],
    terms: ["yacht broker", "courtier maritime", "vente bateau occasion", "concessionnaire nautique", "courtage bateaux", "plaisance"],
    en: { label: "boat dealer / yacht broker", terms: ["boat dealer", "yacht broker", "boats for sale", "marine service"] },
    chains: ["boatshed"],
    lever: 88, value: 90, expansion: 55,
    tam: 1200, franchised: 12, recurring: 35, ticket: "8-40 k€ (commission 5-10% sur bateaux de 40-500 k€)", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  ebeniste: {
    label: "ébéniste / créateur de mobilier sur mesure",
    osm: ['["craft"="cabinet_maker"]', '["craft"="joiner"]'],
    naf: ["31.09B", "43.32A", "43.32C"],
    terms: ["ébéniste", "ébénisterie", "mobilier sur mesure", "agencement", "bois massif", "meuble sur mesure"],
    en: { label: "custom furniture maker", terms: ["furniture maker", "custom furniture", "cabinetmaker", "woodworker"] },
    lever: 88, value: 78, expansion: 35,
    tam: 7000, franchised: 5, recurring: 20, ticket: "8–60 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  tapissier: {
    label: "tapissier-décorateur",
    osm: ['["craft"="upholsterer"]'],
    naf: ["95.24Z", "31.09B", "31.09A"],
    terms: ["tapissier", "tapissier décorateur", "réfection de sièges", "garniture", "rideaux", "tapisserie d'ameublement"],
    en: { label: "upholsterer", terms: ["upholstery", "upholsterer", "reupholstery", "furniture restoration"] },
    chains: ["heytens", "carr[ée] ?blanc", "mondial ?tissus", "mh ?d[ée]co", "saint ?maclou", "rouge ?orange"],
    lever: 82, value: 58, expansion: 35,
    tam: 3500, franchised: 20, recurring: 15, ticket: "800–6 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },
  "bijoutier-joaillier": {
    label: "bijoutier-joaillier / créateur",
    osm: ['["craft"="jeweller"]', '["shop"="jewelry"]'],
    naf: ["32.12Z", "47.77Z", "32.13Z"],
    terms: ["bijoutier", "joaillier", "joaillerie", "création sur mesure", "bague de fiançailles", "atelier"],
    en: { label: "jeweler", terms: ["jeweler", "jewelry", "fine jewelry", "custom rings", "goldsmith"] },
    chains: ["histoire d'?or", "marc orian", "tr[ée]sor", "cl[ée]or", "maty", "julien d'?orcel", "guilde des orf[èe]vres", "man[èe]ge [àa] bijoux", "adelior", "synalia", "thom", "agatha", "pandora", "swarovski", "thomas sabo", "apm monaco", "lou\\.?yetu", "edenly", "oka[ïi]di", "go[ée]lia", "ozencia"],
    lever: 88, value: 78, expansion: 60,
    tam: 9000, franchised: 45, recurring: 45, ticket: "1,5–15 k€", // recherche non vérifiée (verify rate-limité — à re-vérifier)
  },

  // ═══ verticales LEGACY présentes dans les fiches réelles (data/prospects) mais absentes de la table :
  // sans entrée, model.ts retombait sur value 50 générique → un tiers du portefeuille scoré à l'aveugle.
  // Baselines ESTIMÉES (pas de recherche radar complète) — mieux qu'un fallback silencieux, à affiner. ═══
  charpente: {
    label: "charpentier / construction bois",
    osm: ['["craft"="carpenter"]'],
    naf: ["43.91A", "16.23Z"], // travaux de charpente · fabrication charpente/menuiserie
    terms: ["charpente", "charpentier", "ossature bois", "construction bois"],
    en: { label: "timber frame & carpentry", terms: ["timber frame", "framing", "carpentry", "post and beam"] },
    lever: 72, value: 70, expansion: 30, // chantiers lourds, ticket élevé, mais vend moins à l'image // baseline estimée (verticale legacy)
    tam: 8000, franchised: 5, recurring: 15, ticket: "10–80 k€",
  },
  chr: {
    label: "équipementier CHR (cafés-hôtels-restaurants)",
    osm: [],
    naf: ["46.69B", "33.12Z"], // commerce de gros équipements · réparation machines
    terms: ["CHR", "équipement restaurant", "cuisine professionnelle", "matériel de restauration"],
    en: { label: "restaurant equipment supplier", terms: ["restaurant equipment", "commercial kitchen", "foodservice equipment", "catering equipment"] },
    lever: 60, value: 62, expansion: 35, // B2B, catalogue + devis ; le site rassure plus qu'il ne vend // baseline estimée (verticale legacy)
    tam: 2500, franchised: 15, recurring: 40, ticket: "5–60 k€",
  },
  "chr-inox": {
    label: "fabricant inox CHR / agencement pro",
    osm: [],
    naf: ["25.99A", "25.62B"], // fabrication d'articles métalliques · mécanique industrielle
    terms: ["inox", "agencement inox", "mobilier inox", "cuisine professionnelle inox"],
    en: { label: "stainless steel fabricator (foodservice)", terms: ["stainless steel fabrication", "commercial kitchen fabrication", "custom stainless"] },
    lever: 58, value: 60, expansion: 25, // baseline estimée (verticale legacy)
    tam: 1200, franchised: 5, recurring: 30, ticket: "5–50 k€",
  },
  construction: {
    label: "entreprise générale de construction",
    osm: ['["office"="construction_company"]'],
    naf: ["41.20A", "41.20B"], // construction de bâtiments
    terms: ["construction", "entreprise générale", "gros œuvre", "bâtiment"],
    en: { label: "construction company", terms: ["construction", "builder", "building contractor", "remodeling"] },
    lever: 65, value: 72, expansion: 25, // gros tickets mais bouche-à-oreille/AO dominent // baseline estimée (verticale legacy)
    tam: 20000, franchised: 10, recurring: 15, ticket: "50–500 k€",
  },
  "construction-bois": {
    label: "constructeur maisons bois",
    osm: [],
    naf: ["41.20A", "16.23Z"],
    terms: ["maison bois", "ossature bois", "construction bois", "maison écologique"],
    en: { label: "timber home builder", terms: ["timber homes", "log homes", "timber frame homes", "wood construction"] },
    lever: 80, value: 82, expansion: 30, // vente à l'image (réalisations), ticket maison entière // baseline estimée (verticale legacy)
    tam: 2500, franchised: 25, recurring: 10, ticket: "100–400 k€",
  },
  tp: {
    label: "travaux publics / VRD",
    osm: [],
    naf: ["42.11Z", "43.12A"], // routes · terrassements
    terms: ["travaux publics", "VRD", "terrassement", "assainissement", "enrobé"],
    en: { label: "civil works contractor", terms: ["civil works", "excavation", "site work", "paving", "utilities contractor"] },
    lever: 50, value: 65, expansion: 20, // B2B/collectivités : appels d'offres, le site pèse peu // baseline estimée (verticale legacy)
    tam: 12000, franchised: 10, recurring: 25, ticket: "10–200 k€",
  },
  terrassement: {
    label: "terrassier",
    osm: [],
    naf: ["43.12A"],
    terms: ["terrassement", "terrassier", "enrochement", "assainissement", "démolition"],
    en: { label: "excavation contractor", terms: ["excavation", "earthworks", "grading", "site preparation"] },
    lever: 55, value: 58, expansion: 20, // baseline estimée (verticale legacy)
    tam: 9000, franchised: 5, recurring: 20, ticket: "3–40 k€",
  },
  metallerie: {
    label: "métallerie / serrurerie",
    osm: ['["craft"="metal_construction"]'],
    naf: ["25.11Z", "43.32B"], // structures métalliques · menuiserie métallique
    terms: ["métallerie", "métallier", "serrurerie", "escalier métallique", "garde-corps"],
    en: { label: "metal fabrication & locksmith", terms: ["metal fabrication", "steel", "locksmith", "railings", "welding"] },
    lever: 68, value: 62, expansion: 25, // baseline estimée (verticale legacy)
    tam: 7000, franchised: 5, recurring: 20, ticket: "3–40 k€",
  },
  agencement: {
    label: "agenceur d'espaces (boutiques, bureaux)",
    osm: [],
    naf: ["43.32A", "41.20A"],
    terms: ["agencement", "agenceur", "aménagement intérieur", "agencement magasin", "agencement bureau"],
    en: { label: "commercial fit-out contractor", terms: ["fit-out", "shopfitting", "office fit out", "retail interiors"] },
    lever: 82, value: 75, expansion: 30, // portfolio décisif, tickets pro élevés // baseline estimée (verticale legacy)
    tam: 4000, franchised: 10, recurring: 20, ticket: "15–150 k€",
  },
  equipement: {
    label: "équipementier professionnel",
    osm: [],
    naf: ["46.69B"],
    terms: ["équipement professionnel", "matériel professionnel", "fournisseur"],
    en: { label: "professional equipment supplier", terms: ["equipment supplier", "industrial equipment", "professional equipment"] },
    lever: 55, value: 55, expansion: 35, // baseline estimée (verticale legacy)
    tam: 5000, franchised: 15, recurring: 40, ticket: "2–50 k€",
  },
  mobilier: {
    label: "fabricant / éditeur de mobilier",
    osm: [],
    naf: ["31.09A", "31.09B"],
    terms: ["mobilier", "meubles", "fabricant de meubles", "mobilier sur mesure"],
    en: { label: "furniture manufacturer", terms: ["furniture manufacturer", "furniture maker", "contract furniture"] },
    lever: 78, value: 65, expansion: 45, // vend à l'image, potentiel e-commerce // baseline estimée (verticale legacy)
    tam: 6000, franchised: 20, recurring: 20, ticket: "2–30 k€",
  },
  outillage: {
    label: "outillage / machines-outils",
    osm: [],
    naf: ["46.62Z"],
    terms: ["outillage", "machines-outils", "outillage professionnel"],
    en: { label: "tools & machinery dealer", terms: ["machine tools", "tools", "machinery", "industrial supply"] },
    lever: 50, value: 52, expansion: 40, // catalogue B2B, e-commerce possible // baseline estimée (verticale legacy)
    tam: 3000, franchised: 20, recurring: 35, ticket: "1–30 k€",
  },
  securite: {
    label: "sécurité / alarme / surveillance",
    osm: [],
    naf: ["80.20Z", "43.21A"], // systèmes de sécurité · installation électrique
    terms: ["alarme", "vidéosurveillance", "sécurité", "télésurveillance", "contrôle d'accès"],
    en: { label: "security & alarm company", terms: ["security systems", "alarm", "cctv", "surveillance", "access control"] },
    chains: ["verisure", "securitas", "homiris", "nexecur", "eps\\b"],
    lever: 60, value: 58, expansion: 50, // abonnements = récurrent fort // baseline estimée (verticale legacy)
    tam: 5000, franchised: 35, recurring: 70, ticket: "1–15 k€ + abonnement",
  },
}

// ─── TAXONOMIE : source de vérité UNIQUE ───────────────────────────────────────────────────────────
// Les clés de INDUSTRIES ci-dessus sont LE vocabulaire canonique du projet (fiches, DB, scoring, design).
// Tout autre vocabulaire historique (fiches legacy, design/industries/, union TS d'avant) passe par ici.
// RÈGLE : toute écriture d'un `industry` (structure.ts, scrape, imports) DOIT passer par normalizeIndustry().
export const INDUSTRY_ALIASES: Record<string, string> = {
  // legacy data/design → canonique
  piscine: "pisciniste",
  piscines: "pisciniste",
  couverture: "couvreur-zingueur",
  couvreur: "couvreur-zingueur",
  ferronnerie: "ferronnier",
  menuiserie: "menuisier",
  ebenisterie: "ebeniste",
  // union TS historique (packages/shared/prospect.ts d'avant) → canonique
  "paysagiste-concepteur": "paysagiste",
  "lieu-reception-mariage": "lieu-reception",
  "menuisier-agenceur": "menuisier",
  "architecte-dinterieur": "architecte-interieur",
  // variantes d'orthographe vues dans les données
  "lieu-de-reception": "lieu-reception",
  veranda: "verandaliste",
}

/** Normalise un métier vers la clé canonique de INDUSTRIES. Inconnu → renvoie la clé nettoyée telle
 *  quelle (jamais d'invention) ; `isKnownIndustry` permet à l'appelant de logger/flaguer le hors-table. */
export function normalizeIndustry(raw: string | null | undefined): string {
  const k = (raw ?? "").toLowerCase().trim().replace(/\s+/g, "-")
  if (!k) return ""
  if (INDUSTRIES[k]) return k
  return INDUSTRY_ALIASES[k] ?? k
}
export const isKnownIndustry = (k: string): boolean => !!INDUSTRIES[normalizeIndustry(k)]

// départements français (métropole + Corse + DOM francophones) — SIRENE itère dessus
export const FR_DEPTS = [
  ..."01,02,03,04,05,06,07,08,09".split(","),
  ...Array.from({ length: 86 }, (_, i) => String(i + 10).padStart(2, "0")).filter((d) => d !== "20"),
  "2A", "2B", "971", "972", "973", "974", "976",
]

// zones Overpass (codes ISO : robustes aux noms bilingues), une requête unie par zone
/** Mots-clés d'un métier dans TOUTES les langues couvertes (validation d'un site trouvé, requêtes de recherche). */
export function industryTerms(key: string): string[] {
  const ind = INDUSTRIES[normalizeIndustry(key)]
  return ind ? [...ind.terms, ...(ind.en?.terms ?? [])] : []
}
/** Le libellé d'un métier dans la langue de l'agence (« kitchen designer » en anglais, sinon le label français). */
export function industryLabel(key: string, language = "fr"): string {
  const ind = INDUSTRIES[normalizeIndustry(key)]
  if (!ind) return key
  return language.toLowerCase().startsWith("en") && ind.en ? ind.en.label : ind.label
}

/**
 * Une zone OSM par clé : les zones francophones nommées ci-dessous, sinon N'IMPORTE QUEL pays ISO 3166-1 (« us »,
 * « gb », « ca », « au ») ou subdivision ISO 3166-2 (« us-ca », « ca-on », « au-nsw ») : une requête Overpass sur un
 * pays entier comme les États-Unis dépasse le délai ; vise un État / une province.
 */
export function osmZone(key: string): { label: string; areas: string[] } | null {
  const k = key.toLowerCase()
  if (OSM_ZONES[k]) return OSM_ZONES[k]
  if (/^[a-z]{2}$/.test(k)) return { label: k.toUpperCase(), areas: [`area["ISO3166-1"="${k.toUpperCase()}"][admin_level=2];`] }
  if (/^[a-z]{2}-[a-z0-9]{1,3}$/.test(k)) return { label: k.toUpperCase(), areas: [`area["ISO3166-2"="${k.toUpperCase()}"];`] }
  return null
}

export const OSM_ZONES: Record<string, { label: string; areas: string[] }> = {
  fr: { label: "France", areas: ['area["ISO3166-1"="FR"][admin_level=2];'] },
  be: { label: "Belgique francophone", areas: ['area["ISO3166-2"="BE-WAL"];', 'area["ISO3166-2"="BE-BRU"];'] },
  ch: {
    label: "Suisse romande",
    areas: ["GE", "VD", "VS", "NE", "JU", "FR"].map((c) => `area["ISO3166-2"="CH-${c}"];`),
  },
}
