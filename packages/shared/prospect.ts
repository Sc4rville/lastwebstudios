/**
 * ProspectSheet — LE CONTRAT du pipeline.
 *
 * Produit par : leadengine  (sources → scraping → scoring)
 * Consommé par : design     (template-fill : filler → site demo)
 *
 * Les deux blocs ne se parlent JAMAIS directement : le leadengine écrit un
 * ProspectSheet dans `data/prospects/`, le design le lit. Ce fichier est donc
 * la seule chose que les deux blocs ont en commun. On le garde stable et minimal.
 *
 * Règle pilote : la cible A TOUJOURS un site existant (faible/daté). C'est notre
 * acheteur. Pas de site → écarté en amont, n'arrive jamais ici.
 */

/** Chemin de fichier LOCAL (les médias sont téléchargés ; le contrat ne porte que des chemins). */
type LocalPath = string

export type Tier = "hot" | "warm" | "cold"

/**
 * Industrie du prospect = LA CLÉ D'AIGUILLAGE du bloc design et du scoring.
 *
 * SOURCE DE VÉRITÉ UNIQUE : les clés de `INDUSTRIES` (leadengine/1_scraping/scripts/industries.ts).
 * L'ancienne union TS ici était un FAUX contrat : le JSON la contournait et 3 vocabulaires divergents
 * circulaient (fiches, industries.ts, design/) → 1/3 du portefeuille scoré sur des baselines génériques.
 * Toute écriture passe par `normalizeIndustry()` (industries.ts) ; ici on type large + doc.
 */
export type Industry = string // clé canonique de INDUSTRIES — normalisée par normalizeIndustry()

export type ProspectSheet = {
  /** Identifiant stable, lisible. Ex: "orvane-piscines-valmont-sur-lys". */
  id: string

  /** Industrie → détermine quel profil métier le filler va lire. */
  industry: Industry

  /** Qui est le commerce. */
  identity: {
    name: string
    city: string
    /** Zone d'intervention si connue. Ex: "Grand Lyon". */
    zone?: string
    phone?: string
    email?: string
    /** Horaires en texte libre pour le pilote. Ex: "Lun–Sam 9h–19h". */
    hours?: string
  }

  /** Le contenu normalisé, prêt à être réécrit/affiché par la création. */
  content: {
    /** Phrase d'accroche / proposition de valeur. */
    tagline?: string
    /** À-propos / histoire (artisan, années, showroom). */
    about?: string
    /** Services proposés. Ex: ["cuisine sur mesure", "pose", "plan 3D"]. */
    services: string[]
    /** Marques portées (électroménager, fournisseurs) — fréquent chez les cuisinistes. */
    brands?: string[]
  }

  /** Les médias récupérés, en local. */
  assets: {
    logo?: LocalPath
    /** Photos de réalisations — la matière de la galerie du site demo. */
    photos: LocalPath[]
    /** Vidéo de réalisation (optionnel) — hero/section. Ajoutable depuis la station ; le filler
     * sait l'injecter (<video> hero). Rétro-compat : absente sur les fiches existantes. */
    video?: { src: LocalPath; poster?: LocalPath }
  }

  /** Le site actuel (toujours présent : c'est le prérequis de la cible). */
  existing: {
    url: string
    /** Screenshot pleine page du site actuel = l'argument "avant". */
    screenshot?: LocalPath
  }

  /** Score d'opportunité — MINIMAL pour le pilote (qualité du site seulement). */
  score: {
    /** 0–100. */
    value: number
    tier: Tier
    /** Raisons lisibles du score. Ex: ["pas responsive", "pas de HTTPS"]. */
    reasons: string[]
  }

  /**
   * Brief de diagnostic — produit par `/diagnose`, consommé par `/composer` : la DIRECTION créative
   * ciblée sur CE prospect (ce que c'est, ce qui cloche sur son site actuel, l'angle, les moves).
   * Optionnel : absent tant que `/diagnose` n'a pas tourné. Le composer le réclame alors. Typé ici pour
   * que la dépendance dure du composer ne repose plus sur un champ écrit "à la main" hors contrat.
   */
  brief?: {
    beauty_before?: { score?: number; why?: string }
    what?: string
    problems?: string[]
    angle?: string
    moves?: string[]
  }
}
