# Noli API · référence des endpoints pour l'intégration mobile

_Mise à jour le 2026-10-02, écrite depuis le code réel (`src/**/*.controller.ts`, les DTOs et les mappers) et vérifiée par les tests HTTP et les vérifications en conditions réelles. Elle sert de contexte à une IA ou à un développeur qui construit l'application mobile. Le fichier machine équivalent est `docs/openapi.json` (OpenAPI 3, 62 routes) ; la doc interactive est sur `/api/docs` quand le serveur tourne._

## 1. Règles générales

### URL de base
- **Production : `https://api.nollli.com`** (hébergée sur Render ; ne jamais utiliser l'adresse `onrender.com` dans l'app)
- Local : `http://localhost:3000`
- Téléphone sur le même Wi Fi : `http://<IP du PC>:3000` (exemple : `http://192.168.100.31:3000`)
- Documentation interactive : `https://api.nollli.com/api/docs` (peut être fermée au lancement public avec `SWAGGER_ENABLED=false`)

### Appels depuis un site web (CORS)
Seuls les sites listés dans la variable `CORS_ORIGINS` du serveur peuvent appeler l'API depuis un navigateur, par exemple `https://admin.nollli.com` pour le dashboard. L'app mobile n'est pas concernée.

Aucun préfixe de version (`/api/v1` n'existe pas) : les chemins ci dessous s'ajoutent directement à l'URL de base.

### Authentification
- `POST /auth/login` renvoie un `accessToken` (valable **15 minutes**) et un `refreshToken` (valable **30 jours**).
- Chaque route marquée 🔒 attend l'en tête `Authorization: Bearer <accessToken>`. Sans token, ou avec un token expiré : `401`.
- Quand une requête répond `401`, appeler `POST /auth/refresh` avec le `refreshToken`, puis rejouer la requête avec le nouvel `accessToken`. Le refresh ne renvoie **pas** de nouveau `refreshToken` : garder l'ancien ; quand lui aussi est refusé (`401`), renvoyer l'utilisateur vers la connexion.
- Le rôle (`user` ou `admin`) et l'abonnement sont relus en base à chaque requête : un changement s'applique tout de suite, sans se reconnecter.
- 🛡️ signifie **admin uniquement** : un utilisateur normal reçoit `403`.

### Format des réponses
Presque toutes les réponses sont un objet avec un `message` lisible et les données sous une clé qui **varie selon la route** (`data`, `series`, `category`, `user`...). La forme exacte est donnée pour chaque route.

### Format des erreurs
Format NestJS standard :
```json
{ "statusCode": 404, "message": "Series not found", "error": "Not Found" }
```
- Erreur de validation (`400`) : `message` est souvent un **tableau** de phrases, par exemple `["limit must not be greater than 50"]`.
- Erreurs avec un `code` exploitable par l'app :
  - `403` `{ "statusCode": 403, "code": "PREMIUM_REQUIRED", "message": "Premium subscription required" }` : afficher l'écran d'abonnement.
  - `409` `{ "code": "CATEGORY_IN_USE", "seriesCount": 3, ... }` (admin).

### Validation des corps de requête
- Un champ non prévu est **retiré en silence** (pas d'erreur). Exemple : envoyer `rating` dans `PATCH /series/:id` ne fait rien.
- Les textes (titres) sont nettoyés de leurs espaces au début et à la fin.
- Les nombres de la query string (`page`, `limit`) sont convertis ; une valeur invalide (`abc`, `0`, `1.5`, au dessus du maximum) répond `400`.

### Identifiants
- Les ids sont des ObjectId MongoDB : 24 caractères hexadécimaux, par exemple `665f1b2c3d4e5f6789abcdef`.
- Un épisode n'a pas d'id public utile : il s'identifie par **série + saison + numéro d'épisode** (`/series/:id/episodes/:seasonNumber/:episodeNumber`). Saison et numéro ne changent jamais.

### Limite de débit
Les routes d'images et de vidéos partagent une limite de **10 appels par utilisateur toutes les 10 minutes**, puis `429`.
Mot de passe oublié : **20 demandes** et **30 vérifications de code par heure et par adresse IP**, puis `429` avec le message « Trop de tentatives, réessayez plus tard ».

---

## 2. Objets renvoyés

### Utilisateur (profil)
```json
{
  "id": "665f...",
  "email": "user@example.com",
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe",
  "avatar": null,
  "role": "user",
  "subscription": { "plan": "free", "isActive": true, "startDate": "2026-09-30T10:00:00.000Z", "endDate": null },
  "createdAt": "2026-09-30T10:00:00.000Z"
}
```
- `avatar` : URL d'image ou `null`.
- `subscription.plan` : `free` ou `premium`. Pour savoir si l'utilisateur est premium, regarder `plan === 'premium'`, `isActive === true` **et** `endDate` dans le futur (le serveur ajoute 1 jour de grâce après `endDate`). Le serveur reste juge : seul `/play` décide vraiment.

### Série (liste)
Dans les listes (catalogue, recherche, tendances, recommandations, catégorie), une série **n'a pas** d'`episodes` :
```json
{
  "_id": "665f...",
  "title": "Le Royaume",
  "description": "…",
  "coverImage": "https://res.cloudinary.com/.../f_auto,q_auto/v1/noli/production/series/665f.../cover-ab12cd34ef56",
  "bannerImage": null,
  "categories": [{ "_id": "66aa...", "name": "Drame", "slug": "drame" }],
  "languages": ["fr"],
  "country": "Bénin",
  "releaseYear": 2025,
  "status": "ongoing",
  "rating": 8.4,
  "votes": 120,
  "totalEpisodes": 12,
  "isPremium": true,
  "freeEpisodeCount": 2,
  "createdAt": "…",
  "updatedAt": "…"
}
```
- `coverImage` : format portrait 2:3, 1000 px de large au plus. `bannerImage` : format 16:9, 1920 px au plus. Les deux peuvent valoir `null` ou manquer ; prévoir une image par défaut.
- Les URLs Cloudinary choisissent automatiquement le meilleur format et la meilleure qualité pour l'appareil : les utiliser telles quelles.
- `categories` : uniquement les catégories visibles.
- `status` : `ongoing` (en cours) ou `completed` (terminée).
- `isPremium: false` : tout est gratuit. `isPremium: true` : seuls les `freeEpisodeCount` premiers épisodes sont gratuits.

### Série (détail) et épisodes
`GET /series/:id` ajoute `episodes`, triés par saison puis par épisode :
```json
{
  "seasonNumber": 1,
  "episodeNumber": 1,
  "title": "Pilote",
  "description": "…",
  "duration": 1500,
  "releaseDate": "2026-01-20T00:00:00.000Z",
  "views": 0,
  "thumbnail": null,
  "isFree": true
}
```
- `duration` est en **secondes**.
- `thumbnail` : vignette 16:9 (1280 px au plus) ou `null`.
- `isFree` est calculé par le serveur : `true` = jouable par tout utilisateur connecté, `false` = premium requis (afficher un cadenas).
- **Aucune réponse ne contient le lien vidéo** (`videoUrl`), sauf `/play`.
- Seuls les épisodes **lisibles** sont listés : un épisode dont la vidéo est encore en préparation n'apparaît pas, et `totalEpisodes` compte les épisodes lisibles.

---

## 3. Authentification et compte

### `POST /users/register` · inscription
Corps :
```json
{ "email": "user@example.com", "username": "johndoe", "password": "secret123", "firstName": "John", "lastName": "Doe" }
```
- `email` : email valide. `username` : 3 à 30 caractères. `password` : 6 caractères au moins. `firstName`, `lastName` : facultatifs.
- `201` → `{ "message": "User registered successfully", "user": { "id", "email", "username", "role", "subscription", "createdAt" } }`
- `409` : email ou nom d'utilisateur déjà pris. `400` : champ invalide.
- L'inscription ne connecte pas : enchaîner avec `POST /auth/login`.

### `POST /auth/login` · connexion
Corps : `{ "email": "user@example.com", "password": "secret123" }`
- `200` → `{ "message": "Login successful", "accessToken": "…", "refreshToken": "…", "user": { "id", "email", "username", "role", "subscription" } }`
- `401` : email ou mot de passe incorrect.

### `POST /auth/refresh` · nouveau token d'accès
Corps : `{ "refreshToken": "…" }`
- `200` → `{ "message": "Token refreshed", "accessToken": "…" }`
- `401` : refresh token invalide ou expiré, retour à la connexion.
- Après une réinitialisation du mot de passe, tous les anciens tokens (accès et refresh) répondent `401` : l'utilisateur doit se reconnecter sur ses autres appareils.

### `POST /auth/password/forgot` · mot de passe oublié, étape 1
Corps : `{ "email": "user@example.com" }`
- `200` → `{ "message": "Si un compte existe pour cet email, un code a été envoyé." }`, **toujours la même réponse**, que le compte existe ou non. Ne jamais afficher « compte introuvable ».
- Si le compte existe, un email part avec un **code à 6 chiffres valable 15 minutes**. Une nouvelle demande annule le code précédent : seul le dernier email compte.
- Limites silencieuses par compte : 1 demande par minute, 5 par heure, 10 par jour. Au delà, même réponse `200` mais aucun email. Côté app, afficher un minuteur de 60 secondes avant le bouton « Renvoyer le code ».
- `400` : email mal formé. `429` : trop de demandes depuis cette IP. `503` `{ "code": "MAIL_UNAVAILABLE" }` : service email indisponible.
- En développement sans clé Brevo, le code s'affiche dans la console du serveur (`[mail:dev] password reset code for user …`).

### `POST /auth/password/verify-code` · étape 2, vérifier le code
Corps : `{ "email": "user@example.com", "code": "482913" }`
- `200` → `{ "message": "Code vérifié", "resetToken": "…", "expiresAt": "2026-10-06T10:20:00.000Z" }`. Le `resetToken` vaut **10 minutes, une seule fois** : le garder en mémoire pour l'étape 3.
- `400` → `{ "statusCode": 400, "code": "INVALID_OR_EXPIRED_CODE", "message": "Code invalide ou expiré" }` pour **toute** erreur (code faux, expiré, déjà utilisé, email inconnu, champ manquant). Pas de compteur d'essais : afficher « Code invalide ou expiré » et proposer de redemander un code.
- 5 codes faux annulent la demande ; il faut alors redemander un code.
- `429` : trop de vérifications depuis cette IP.

### `POST /auth/password/reset` · étape 3, nouveau mot de passe
Corps : `{ "resetToken": "…", "newPassword": "nouveauMotDePasse" }`
- `newPassword` : 6 à 72 caractères.
- `200` → `{ "message": "Mot de passe réinitialisé", "accessToken": "…", "refreshToken": "…", "user": { "id", "email", "username", "role", "subscription" } }`, la même forme que la connexion : **l'utilisateur est connecté directement**, stocker ces tokens.
- Tous les autres appareils sont déconnectés, et un email confirme le changement.
- `400` → `{ "statusCode": 400, "code": "INVALID_OR_EXPIRED_TOKEN", "message": "Session de réinitialisation invalide ou expirée" }` si le jeton est faux, expiré ou déjà utilisé : recommencer à l'étape 1. `400` (liste d'erreurs habituelle) si le mot de passe n'a pas la bonne longueur ; le jeton reste alors valable.

### 🔒 `GET /auth/profile` · utilisateur connecté
- `200` → `{ "message": "Profile retrieved", "user": { … } }` (l'utilisateur complet, sans mot de passe ; l'id est dans `_id`).

### 🔒 `GET /users/:id` · profil d'un utilisateur
- `200` → l'objet **Utilisateur (profil)**, directement, sans enveloppe. `404` si inconnu.

### 🔒 `PUT /users/me/avatar` · changer sa photo
- Corps en `multipart/form-data`, avec le fichier dans le champ **`file`**.
- Fichier : JPEG, PNG ou WebP, pas animé, 5 Mo au plus, au moins 200 × 200 px. Il est recadré en carré centré sur le visage (400 px).
- `200` → `{ "message": "Avatar updated", "user": <Utilisateur (profil)> }`
- Erreurs : `413` (plus de 5 Mo), `415` (type refusé ou image animée), `400` (fichier absent, illisible ou trop petit), `429`, `503` (service d'images indisponible).

### 🔒 `DELETE /users/me/avatar` · retirer sa photo
- `200` → `{ "message": "Avatar removed", "user": { …, "avatar": null } }`

### 🔒 `GET /users` · liste des utilisateurs
- `200` → `{ "count": 2, "users": [ … ] }`. Prévu pour un usage admin, pas utile dans l'app.

---

## 4. Catalogue (lecture)

### `GET /series` · catalogue paginé
Query : `page` (défaut 1), `limit` (défaut 10).
- `200` → `{ "message": "Series retrieved successfully", "data": { "total": 42, "page": 1, "limit": 10, "series": [<Série (liste)>] } }`
- Ordre : les plus récentes d'abord.

### `GET /series/search?q=...` · recherche
Query : `q` (obligatoire, cherché dans le titre et la description, sans tenir compte des majuscules), `page`, `limit`.
- `200` → `{ "message": "Search results", "data": { "total": 3, "series": [<Série (liste)>] } }`

### `GET /series/trending` · tendances
Query : `limit` (défaut 10).
- `200` → `{ "message": "Trending series retrieved", "series": [<Série (liste)>] }` (triées par note puis par nombre de votes).

### `GET /series/:id` · détail d'une série
- `200` → `{ "message": "Series retrieved successfully", "series": <Série (détail)> }`
- `404` : série inconnue.

### `GET /series/:id/episodes` · épisodes paginés
Query : `page` (défaut 1), `limit` (défaut 10).
- `200` → `{ "message": "Episodes retrieved successfully", "data": { "total": 12, "episodes": [<épisode>] } }`
- `isFree` est calculé sur toute la série avant la pagination : la page 2 sait déjà quels épisodes sont payants.

### 🔒 `GET /series/:id/episodes/:seasonNumber/:episodeNumber/play` · lire un épisode
C'est **la seule** route qui renvoie un lien vidéo.
- `200` →
```json
{
  "message": "Episode ready to play",
  "data": {
    "seriesId": "665f...", "seasonNumber": 1, "episodeNumber": 1,
    "title": "Pilote", "duration": 1500,
    "videoUrl": "https://…",
    "type": "direct",
    "expiresAt": null
  }
}
```
- `type: "direct"` : `videoUrl` est un fichier vidéo classique (un MP4 hébergé ailleurs) ; `expiresAt` vaut `null`.
- `type: "hls"` : `videoUrl` est une playlist HLS (`.m3u8`) signée, dont la qualité s'adapte au réseau. Elle expire à `expiresAt` (environ 2 × la durée + 1 h). Si le lecteur reçoit `401` ou `403` en cours de lecture, ou à la reprise après une longue pause, rappeler `/play` pour obtenir un nouveau lien. Le lecteur doit savoir lire le HLS : c'est le cas des lecteurs natifs iOS et Android.
- `403` avec `code: "PREMIUM_REQUIRED"` : épisode payant et utilisateur non premium. Afficher l'offre d'abonnement.
- `404` : série ou épisode inconnu, ou vidéo pas encore prête. `400` : saison ou épisode qui n'est pas un nombre entier. `503` : lecture vidéo indisponible côté serveur.
- Pour l'instant, toutes les vidéos sont de type `direct` : l'hébergement HLS est construit mais en attente d'activation.

### 🔒 `POST /series/:id/rate` · noter une série
Corps : `{ "rating": 8 }` (de 0 à 10)
- `200` → `{ "message": "Series rated successfully", "series": <Série (détail)> }`
- La note devient la moyenne de tous les votes. Aucune limite à un vote par utilisateur pour l'instant.

---

## 5. Catégories

### `GET /categories` · catégories visibles
- `200` → `{ "message": …, "categories": [{ "_id", "name", "slug", "description", "imageUrl", "isVisible", "displayOrder", "createdAt", "updatedAt" }] }`, dans l'ordre d'affichage choisi par l'admin.
- `imageUrl` : image carrée (800 px) ou `null`.

### `GET /categories/:slug` · une catégorie
- `200` → `{ "message": …, "category": { … } }`. `404` : catégorie inconnue ou masquée.

### `GET /categories/:slug/series` · séries d'une catégorie
Query : `page` (défaut 1), `limit` (défaut 10, 50 au plus), `sort` = `newest` (défaut) ou `rating`.
- `200` → `{ "message": …, "data": { "total", "page", "limit", "series": [<Série (liste)>] } }`
- `404` : catégorie inconnue ou masquée. `400` : `page`, `limit` ou `sort` invalide.

Utiliser le `slug` (par exemple `comedie-romantique`) dans les URLs de l'app : il ne change pas quand l'admin renomme la catégorie.

---

## 6. Recommandations

Toutes répondent `{ "message": …, "data": [<Série (liste)>] }`. Query : `limit` (défaut 10, de 1 à 50).

| Route | Contenu |
|---|---|
| 🔒 `GET /recommendations/for-me` | Séries qui partagent une catégorie avec tout ce que l'utilisateur a regardé (sans les séries déjà vues). Sans historique, ou sans rien à rapprocher : les séries populaires. |
| `GET /recommendations/popular` | Les plus populaires. |
| `GET /recommendations/trending` | En tendance. |
| `GET /recommendations/top-rated` | Les mieux notées. |
| `GET /recommendations/new` | Les plus récentes. |
| `GET /recommendations/similar/:seriesId` | Séries des mêmes catégories que cette série. `404` si la série est inconnue. |
| `GET /recommendations/category/:slug` | Les mieux notées d'une catégorie visible. `404` si la catégorie est inconnue ou masquée. |

---

## 7. Historique de visionnage 🔒

Toutes ces routes concernent l'utilisateur connecté.

### `POST /watch-history/add` · enregistrer un visionnage
Corps :
```json
{ "seriesId": "665f...", "seasonNumber": 1, "episodeNumber": 1, "title": "Pilote", "watchedDuration": 1200, "totalDuration": 1500, "progressPercentage": 80 }
```
- Obligatoires : `seriesId`, `seasonNumber`, `episodeNumber`, `title`. Facultatifs : `watchedDuration` et `totalDuration` (secondes), `progressPercentage` (0 à 100).
- Si l'épisode est déjà dans l'historique, il est mis à jour. `progressPercentage: 100` le marque comme terminé.
- `201` → `{ "message": "Episode added to watch history", "data": <historique> }`

### `GET /watch-history` · historique paginé
Query : `page` (défaut 1), `limit` (défaut 10, 50 au plus).
- `200` → `{ "message": "Watch history retrieved", "data": { "total": 5, "page": 1, "limit": 10, "history": { "userId", "episodes": [ … ] } } }`
- Les épisodes sont triés du plus récent au plus ancien (`lastWatchedAt`). Chaque entrée contient `seriesId`, `seasonNumber`, `episodeNumber`, `title`, `progressPercentage`, `isCompleted`, `watchedAt` et `lastWatchedAt`.
- ⚠️ **Un utilisateur qui n'a encore rien regardé reçoit `404`** (`Watch history not found`). L'app doit traiter ce cas comme une liste vide.

### `GET /watch-history/continue-watching` · reprendre la lecture
Query : `limit` (défaut 5, 50 au plus).
- `200` → `{ "message": "Continue watching retrieved", "data": { "userId", "episodes": [ … ] } }`, avec seulement les épisodes **non terminés**, du plus récent au plus ancien.
- ⚠️ Même cas que ci dessus : `404` tant que l'historique est vide.

### `PATCH /watch-history/progress/:seriesId/:episodeNumber/:seasonNumber` · mettre à jour la progression
⚠️ Attention à l'ordre dans le chemin : **épisode avant saison**.
Corps : `{ "progressPercentage": 65 }` (0 à 100 ; 100 marque l'épisode comme terminé).
- `200` → `{ "message": "Progress updated", "data": <historique> }`
- `404` : pas d'historique, ou épisode absent de l'historique. `400` : pourcentage hors de 0 à 100.

### `DELETE /watch-history/:seriesId/:episodeNumber/:seasonNumber` · retirer un épisode
Même ordre : épisode avant saison.
- `200` → `{ "message": "Episode removed from history", "data": <historique> }`

### `DELETE /watch-history` · tout effacer
- `200` → `{ "message": "Watch history cleared" }`

L'historique se met à jour tout seul côté serveur : si un admin supprime un épisode ou une série, il en disparaît, et si un épisode est renommé, son titre suit.

---

## 8. Abonnement premium

- Le contenu payant est protégé par `/play` (`PREMIUM_REQUIRED`). L'état de l'abonnement se lit dans `user.subscription`.
- Le paiement passe par **KkiaPay** et le serveur reçoit la confirmation par un webhook (`POST /billing/webhook`, réservé à KkiaPay, que l'app ne doit pas appeler).
- ⚠️ **Il n'existe pas encore de route pour démarrer un achat depuis l'app** : c'est la prochaine fonctionnalité (« Subscription Checkout »). `POST /billing/dev/pending-checkout` sert seulement aux tests en développement. Pour l'instant, prévoir l'écran d'abonnement sans le brancher.

---

## 8 bis. Notifications push 🔒

Les notifications passent par **Firebase Cloud Messaging** (`firebase_messaging` côté Flutter). Le serveur envoie :

| Type (`data.type`) | Quand | Canal Android |
|---|---|---|
| `new_episodes` | un épisode devient lisible dans une série regardée ces 90 derniers jours (et jouable par l'utilisateur) ; regroupé par série et par jour | `content` |
| `new_series` | une nouvelle série a son premier épisode, dans une des 3 catégories les plus regardées | `content` |
| `premium_ending` | 3 jours avant la fin du premium, puis le jour même (9 h, heure de Lagos) | `account` |
| `payment_succeeded`, `payment_failed` | après un paiement KkiaPay | `account` |
| `test` | route admin de test | `account` |

Règles : au plus **3 notifications de contenu par jour**, rien entre **22 h et 7 h** (heure de Lagos) pour le contenu, chaque type se coupe dans les réglages. Tout arrive aussi dans la **boîte de réception** (30 jours).

**Données du push** (toutes en texte) : `type`, `notificationId`, et selon le cas `seriesId`, `seasonNumber`, `episodeNumber`. Au tap, ouvrir la série (`/series/:seriesId`), puis marquer la notification lue. Sur iOS, le badge vaut le nombre de non lues. Une série supprimée peut encore apparaître dans la boîte : gérer le `404` en affichant « Série plus disponible ».

### `PUT /notifications/devices` · enregistrer le téléphone
Corps : `{ "token": "<jeton FCM>", "platform": "android" | "ios", "appVersion": "1.0.0" }`
- `200` → `{ "message": "Device registered", "device": { "token", "platform", "appVersion", "lastSeenAt" } }`
- À appeler **après chaque connexion** et dans `onTokenRefresh`. Sans risque de doublon. 10 téléphones au plus par compte.

### `DELETE /notifications/devices` · retirer le téléphone
Corps : `{ "token": "<jeton FCM>" }` → `200 { "message": "Device removed" }`. À appeler **à la déconnexion**, avant d'effacer les tokens. Une réinitialisation du mot de passe retire tous les téléphones du compte.

### `GET /notifications/preferences` · réglages
- `200` → `{ "newEpisodes": true, "newSeries": true, "premium": true, "payment": true }` (tout est activé par défaut).

### `PATCH /notifications/preferences` · modifier les réglages
Corps : un ou plusieurs booléens, par exemple `{ "newSeries": false }` → `200` avec les quatre valeurs. `400` si une valeur n'est pas booléenne ou si le corps ne contient aucun réglage connu.

### `GET /notifications?page=1&limit=20` · boîte de réception
- `limit` : 1 à 50 (20 par défaut).
- `200` → `{ "total", "page", "limit", "unread", "notifications": [{ "_id", "type", "title", "body", "data", "readAt", "createdAt", "updatedAt" }] }`, les plus récemment mises à jour d'abord. `unread` sert au badge de l'icône cloche.
- Une notification `new_episodes` regroupée remonte en tête et redevient non lue quand un autre épisode arrive le même jour (`data.count` = nombre d'épisodes).

### `PATCH /notifications/:id/read` · marquer lue
- `200` → `{ "message": "Notification read", "notification": { … } }`. `404` si elle n'existe pas ou n'est pas à toi.

### `POST /notifications/read-all` · tout marquer lu
- `200` → `{ "message": "All notifications read", "updated": 3 }`

### 🛡️ `POST /notifications/test` · notification de test (admin)
- Envoie tout de suite une notification de test sur les téléphones de l'admin connecté. `200` → `{ "devices", "sent", "failed" }`. `403` si pas admin. `503` `{ "code": "PUSH_UNAVAILABLE" }` si Firebase n'est pas configuré sur le serveur.
- En développement sans clé Firebase, le push s'affiche dans la console du serveur (`[push:dev] …`) au lieu de partir.

---

## 9. Routes admin 🛡️ (gestion du contenu)

Toutes demandent un token admin. Un utilisateur normal reçoit `403`. Les réponses sur les séries utilisent la **forme admin** : chaque épisode, lisible ou non, avec un objet `video` (`status` vaut `ready`, `pending`, `error`, `legacy` ou `none`).

### Séries
| Route | Corps / effet |
|---|---|
| `POST /series` | `{ title, description?, coverImage?, bannerImage?, categoryIds: [id, …], languages?, country?, releaseYear?, status?, isPremium?, freeEpisodeCount? }`. Au moins une catégorie existante. `409` si le titre est déjà pris. |
| `PATCH /series/:id` | Modifie un ou plusieurs champs parmi ceux de `POST`. `rating`, `votes`, `totalEpisodes` et `episodes` sont ignorés. `null` efface `description`, les images et `country`. `409` si le titre est pris, `400` si le corps est vide. |
| `PATCH /series/:id/access` | `{ isPremium?, freeEpisodeCount? }` : raccourci pour les réglages premium. |
| `DELETE /series/:id` | Supprime la série, ses images et ses vidéos, et la retire de tous les historiques. |
| `GET /series/:id/admin` | La série avec **tous** ses épisodes et l'état de leur vidéo. |

### Épisodes
| Route | Corps / effet |
|---|---|
| `POST /series/:id/episodes` | `{ seasonNumber, episodeNumber, title, duration, description?, releaseDate?, videoUrl? }`. Nombres entiers de 1 ou plus. `releaseDate` au format ISO. `400` si cet épisode existe déjà. |
| `PATCH /series/:id/episodes/:s/:e` | `{ title?, description?, duration?, releaseDate? }`. La saison, le numéro et la vidéo ne se changent pas ici. Un renommage met à jour les historiques. |
| `DELETE /series/:id/episodes/:s/:e` | Supprime l'épisode, sa vignette et sa vidéo, et le retire des historiques. Le nombre d'épisodes gratuits ne change pas, donc la limite gratuite passe aux épisodes suivants. |

### Images (multipart, champ `file`)
| Route | Format |
|---|---|
| `PUT` / `DELETE /series/:id/cover` | 2:3, au moins 400 × 600 |
| `PUT` / `DELETE /series/:id/banner` | 16:9, au moins 1280 × 720 |
| `PUT` / `DELETE /series/:id/episodes/:s/:e/thumbnail` | 16:9, au moins 640 × 360 |
| `PUT` / `DELETE /categories/:id/image` | carré, au moins 400 × 400 |

Mêmes règles que pour l'avatar : JPEG, PNG ou WebP, 5 Mo au plus, codes `413`, `415`, `400` et `429`.

### Vidéos (hébergement HLS, en attente d'activation, répond `503` pour l'instant)
| Route | Effet |
|---|---|
| `POST /series/:id/episodes/:s/:e/video/upload` | `{ uploadLength }` (taille en octets) → `{ method, uploadUrl, uid, expiresAt }`. Le fichier part ensuite directement vers `uploadUrl` : en une seule requête quand `method` vaut `post`, avec un client tus (envoi qui reprend après une coupure) quand il vaut `tus`. |
| `POST /series/:id/episodes/:s/:e/video/import` | `{ url }` (lien `https` public) → le serveur vidéo télécharge le fichier lui même. |
| `POST /series/:id/episodes/:s/:e/video/refresh` | Redemande l'état de la vidéo en préparation. |
| `DELETE /series/:id/episodes/:s/:e/video` | Retire la vidéo de l'épisode. |

### Catégories
| Route | Corps / effet |
|---|---|
| `GET /categories/all` | Toutes les catégories, masquées comprises. |
| `POST /categories` | `{ name, description?, imageUrl?, isVisible? }`. Le slug est déduit du nom. `409` si un nom proche existe déjà (même nom aux majuscules ou aux accents près). |
| `PATCH /categories/:id` | `{ name?, description?, imageUrl?, isVisible?, slug? }`. Renommer garde le slug. |
| `PUT /categories/order` | `{ ids: [tous les ids, dans le nouvel ordre] }` |
| `DELETE /categories/:id` | `409 CATEGORY_IN_USE` si des séries l'utilisent encore. |

---

## 10. Routes à ne pas appeler depuis l'app

- `GET /` : vérification que le serveur répond.
- `POST /billing/webhook` et `POST /webhooks/cloudflare-stream` : appelés par KkiaPay et Cloudflare, protégés par une signature.
- `POST /billing/dev/pending-checkout` : outil de test en développement.

---

## 11. Données de démo (base de développement)

La base de développement contient du contenu de démonstration (`npm run db:seed-demo`) :
- **10 catégories** : drame, comedie, romance, action, thriller, policier, famille, fantastique, histoire-et-culture, jeunesse (avec image).
- **12 séries**, 72 épisodes : gratuites et premium (1 à 3 épisodes offerts), en cours ou terminées, 1 ou 2 saisons, avec couverture, bannière et vignettes (images de remplacement). Les vidéos sont de courts clips de test publics (`type: "direct"`) : elles se lisent, mais leur longueur ne correspond pas au champ `duration`.
- **3 comptes**, mot de passe `NoliDemo2026` :
  - `demo.free@noli.test` : gratuit, avec un historique (2 épisodes terminés, 3 en cours) pour « Reprendre » et « Pour vous » ;
  - `demo.premium@noli.test` : premium actif pendant 1 an, lit tous les épisodes ;
  - `demo.admin@noli.test` : admin, pour les routes de gestion.

Exemple pour tester le premium : « Le Trône d'Abomey » a 8 épisodes en saison 1, les 2 premiers gratuits.

## 12. Parcours types pour l'app

1. **Démarrage** : relire les tokens stockés. `GET /auth/profile` vérifie la session ; sur `401`, faire `POST /auth/refresh`, puis renvoyer vers la connexion si le refresh échoue aussi.
2. **Accueil** : `GET /categories`, `GET /recommendations/for-me` (connecté) ou `/popular`, `/trending`, `/new`, et `GET /watch-history/continue-watching` (où `404` veut dire une liste vide).
3. **Fiche série** : `GET /series/:id` (épisodes avec `isFree`), et `GET /recommendations/similar/:id` pour « Vous aimerez aussi ».
4. **Lecture** : `GET .../play`. Sur `200`, lire `videoUrl` selon `type`. Sur `403 PREMIUM_REQUIRED`, ouvrir l'écran d'abonnement. Pendant la lecture, envoyer `POST /watch-history/add` (au début) puis `PATCH /watch-history/progress/...` de temps en temps et à la sortie.
5. **Profil** : `GET /users/:id` avec son propre id, et `PUT /users/me/avatar` pour la photo.
6. **Mot de passe oublié** : écran email → `POST /auth/password/forgot` (toujours « code envoyé ») → écran code → `POST /auth/password/verify-code` → écran nouveau mot de passe → `POST /auth/password/reset`, puis stocker les tokens reçus comme après une connexion.
7. **Notifications** : après la connexion, demander l'autorisation, récupérer le jeton FCM et faire `PUT /notifications/devices` (et à chaque `onTokenRefresh`). À la déconnexion, `DELETE /notifications/devices`. L'icône cloche lit `unread` de `GET /notifications` ; l'écran Réglages lit et modifie `/notifications/preferences`.
