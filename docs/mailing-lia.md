# LIA — Legitimate Interest Assessment (B2B prospecting, lastwebstudios)

> *In English: this is the legitimate-interest assessment (GDPR art. 6.1.f) that justifies B2B cold e-mail without
> prior consent under French law (opt-out regime, LCEN / CPCE L.34-5, GDPR art. 14 and 21). It is kept in French
> because it is the document a French regulator (the CNIL) would ask for; adapt it to your agency before sending.*

> Le document que la **CNIL demande en premier** en cas de contrôle : il justifie qu'on peut prospecter par email
> en B2B **sans consentement préalable** (régime opt-out), sur la base de l'**intérêt légitime** (RGPD art. 6.1.f).
> Base : LCEN / art. L.34-5 CPCE (opt-out B2B) + RGPD art. 14 (info) + art. 21 (opposition).

## 1. Finalité
Contacter des **professionnels** (gérants d'entreprises artisanales/commerciales) pour leur proposer un service de
refonte de site web **pertinent pour leur activité**. Aucun ciblage de particuliers.

## 2. Base légale : intérêt légitime (art. 6.1.f)
- **Notre intérêt** : développer notre activité en présentant une offre à des professionnels qui en ont un usage direct.
- **Licéité opt-out B2B** : en France, la prospection B2B par email est autorisée **sans consentement préalable** si
  (a) le message concerne la **profession** du destinataire, et (b) un **droit d'opposition simple** est offert à chaque envoi.

## 3. Nécessité
L'email est le canal le moins intrusif et le plus proportionné pour une première prise de contact professionnelle.
Les données traitées sont **minimales** : nom de l'entreprise, email professionnel, secteur, site web. **Aucune donnée sensible.**

## 4. Test de mise en balance (nos intérêts vs droits des personnes)
- **Attentes raisonnables** : un professionnel dont l'email pro est public s'attend à recevoir des sollicitations pro. Impact faible.
- **Garanties qui font pencher la balance en faveur du traitement** :
  - Message **strictement professionnel**, pertinent pour leur métier.
  - **Opposition en 1 clic** dans chaque email (lien de désinscription), honorée **immédiatement**.
  - **Volume maîtrisé**, pas de harcèlement (séquence courte, stop dès réponse/opposition).
  - **Origine des données indiquée** (sources professionnelles publiques) — RGPD art. 14.
  - **Purge** des données après **3 ans** sans relation commerciale.
- **Conclusion** : l'intérêt légitime est établi, l'impact sur les personnes est faible et encadré.

## 5. Droits des personnes (garantis)
- **Information** (art. 14) : identité de LWS + origine des données + droit d'opposition, dès le 1er contact (footer du mail).
- **Opposition** (art. 21) : lien de désinscription 1 clic → retrait immédiat de la liste.
- **Accès / rectification / effacement** : sur simple demande à notre contact.

## 6. Mise en œuvre technique (dans notre pipeline)
- Footer légal automatique dans chaque mail (`outreach/scripts/lib/smtp.ts` → `withLegalFooter`).
- Désinscription 1-clic : header `List-Unsubscribe` (RFC 8058) + endpoint public `/t/u/<id>` → `drop` immédiat dans le séquenceur.
- Liste vérifiée avant envoi (bounces < 1 %), volume bas par boîte.

_Revoir ce LIA si la finalité, le volume ou les sources de données changent._
