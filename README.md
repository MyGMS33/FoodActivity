# FoodActivity

FoodActivity est une PWA mobile pour composer un repas à partir des aliments réellement disponibles devant soi.

## Objectif

1. Scanner plusieurs codes-barres.
2. Récupérer les données nutritionnelles via Open Food Facts.
3. Corriger si besoin la quantité consommable / le poids égoutté.
4. Ajouter des aliments sans code-barres.
5. Calculer des portions cohérentes avec les objectifs restants de la journée.
6. Valider le repas et le conserver dans l'historique.

## Version actuelle

La V0 est volontairement **100 % statique** afin de fonctionner sur GitHub Pages :

- scanner EAN/UPC avec la caméra ;
- récupération Open Food Facts ;
- composition automatique des portions ;
- objectifs calories / protéines / fibres ;
- historique local sur l'appareil ;
- installation en PWA.

Le stockage cloud sera ajouté ensuite via une API séparée : GitHub Pages ne peut pas exécuter FastAPI, SQLite ou un autre backend serveur.

## Déploiement

Le workflow `.github/workflows/pages.yml` publie automatiquement le site sur GitHub Pages à chaque push sur `main`.

URL prévue : **https://mygms33.github.io/FoodActivity/**

Si Pages n'est pas encore activé : `Settings > Pages > Source > GitHub Actions`.

## Données

Aucune donnée alimentaire personnelle n'est versionnée dans GitHub. La V0 conserve l'historique dans le stockage local du navigateur.

## Sources nutritionnelles

- Produits emballés : Open Food Facts.
- Aliments génériques / Ciqual : intégration prévue dans une prochaine étape.

## Développement

Le projet est conçu mobile-first, sans build obligatoire pour la V0.
