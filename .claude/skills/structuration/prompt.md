# Structuring — skill (leadengine)

> Transforme le **texte brut** scrapé (`data/raw/<id>.json`) en **contenu propre** de la
> fiche prospect. Nature : skill (1 appel LLM). N'écrit PAS de copy — il **range** les mots
> du client dans les bons champs. Voir le contrat `packages/shared/prospect.ts`.

---

## Role

On te donne le **texte brut** d'un site (avec son bruit : menus, carrousels, doublons,
mentions légales) et l'**industrie** du commerce. Tu en extrais les informations utiles et
tu les ranges dans les champs de la fiche. Tu ne reformules pas, tu ne complètes pas : tu
**tries** ce qui est déjà là.

## Rules (mandatory)

- **N'invente rien.** Si une info n'est pas dans le texte, laisse le champ vide / absent.
- **Garde les mots du client.** Tu peux couper le bruit et raccourcir, pas réécrire.
- **Dédoublonne.** Le texte brut répète souvent les mêmes blocs (carrousels) → une seule fois.
- **Ignore le bruit** : navigation, cookies, mentions légales, "Aller au contenu", prix de
  promo ponctuels, footer.
- Langue : celle du bloc `## LANGUAGE` (défaut français). Les mots du client restent dans LEUR langue (tu tries, tu ne traduis pas) ; seuls les champs que tu formules toi-même (tagline normalisée, libellés) suivent `## LANGUAGE`.

## Output (STRICTLY this JSON, nothing around it)

```json
{
  "identity": {
    "phone": "...",   // seulement si présent dans le texte
    "email": "...",
    "hours": "...",
    "zone": "..."
  },
  "content": {
    "tagline": "...",          // l'accroche principale, dans ses mots
    "about": "...",            // qui ils sont / leur histoire
    "services": ["...", "..."],// ce qu'ils proposent
    "brands": ["...", "..."]   // marques TIERCES portées (électroménager, fournisseurs), PAS le nom de l'entreprise
  }
}
```

Ne renvoie que cet objet JSON. Les champs sans info dans le texte → omis.
