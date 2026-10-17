# InComfort (Intergas)

Vos chaudières Intergas dans Gladys, par la passerelle locale **Lan2RF**
(InComfort / InTouch) sur votre réseau, sans cloud :

- chaque chaudière liée à la passerelle devient un appareil Gladys :
  **température de l'eau du circuit**, **pression** (bar), **température de
  l'eau chaude sanitaire**, **brûleur allumé**, **pompe en marche**, **eau
  chaude en puisage**, **défaut (verrouillage)**, et en texte son **état**
  (veille, chauffage, eau chaude…) et son **défaut** (code `E…` et libellé) ;
- chaque thermostat de pièce (deux au plus par chaudière) devient un appareil
  avec la **température de la pièce**, la **consigne** et **chauffe** (brûleur
  et pompe en marche).

> **Cette intégration n'a jamais été testée sur une vraie passerelle.** Cette
> première version a été écrite à partir de la bibliothèque incomfort-client
> et de l'intégration incomfort de Home Assistant, et testée seulement contre
> une fausse passerelle. Dites sur le forum de Gladys ce qui marche et ce qui
> ne marche pas.

Intégration non officielle, sans lien avec Intergas.

## Configuration

- **Adresse de la passerelle** : son adresse IP sur votre réseau
  (`192.168.1.20`), ou son nom ; un port peut suivre (`192.168.1.20:80`).
  Donnez-lui une adresse fixe dans votre box. La passerelle ne parle qu'en
  http simple : une adresse `https://` est refusée avec un message clair.
- **Identifiant** et **mot de passe** : laissez-les vides pour une ancienne
  passerelle. Les passerelles récentes demandent ceux inscrits sur leur
  étiquette ou dans leur notice ; Gladys utilise alors les pages
  `/protect/` de la passerelle. Le mot de passe est gardé par Gladys dans sa
  base, jamais réaffiché, envoyé seulement à la passerelle, dans l'en-tête
  HTTP d'authentification (jamais dans une adresse, jamais dans un journal).
  Attention : la passerelle n'a pas de https, l'identifiant et le mot de passe
  traversent donc votre réseau local en clair, à chaque lecture.
- **Autoriser le changement de la consigne de pièce** : désactivé par défaut
  (voir Commande).
- **Langue des appareils** : français (par défaut) ou anglais, pour les noms
  des appareils et les textes d'état et de défaut.

Ouvrez ensuite l'onglet **Découverte** et créez les chaudières et les
thermostats à suivre. Le bouton **Tester la connexion** lit la passerelle
tout de suite et liste ce qu'elle voit.

## Commande

- **Seule la consigne de pièce** peut être changée, et seulement après avoir
  coché **Autoriser le changement de la consigne de pièce**. Rien ne commande
  l'eau chaude, la chaudière ni sa mise en marche : aucune fonctionnalité
  n'est un interrupteur, donc ni un assistant vocal ni « éteins tout » ne peut
  agir sur la chaudière.
- La consigne va de **5 à 30 °C** (les bornes de la passerelle), au dixième
  de degré : une valeur en dehors est refusée, jamais ramenée dans les bornes.
- Juste avant d'agir, Gladys relit la liste des chaudières et la chaudière
  elle-même : si la lecture échoue, si la chaudière n'est plus liée ou si le
  thermostat ne répond plus, rien n'est envoyé ; si la consigne est déjà
  celle demandée, rien n'est envoyé non plus. Quand la commande ne peut pas
  être vérifiée en 3,5 s, rien n'est envoyé et Gladys affiche un échec
  (jamais d'action après un échec affiché). Une fois envoyée, Gladys répond
  au plus 4,3 s après votre commande ; la consigne affichée suit la réponse de
  la passerelle.
- Les commandes passent une par une (une seule passerelle).
- La consigne affichée est, comme dans Home Assistant, la consigne envoyée à
  distance quand il y en a une, sinon celle du thermostat. Le thermostat
  reçoit la consigne par radio : elle peut mettre un moment à s'y afficher.
  Certains anciens thermostats gardent la consigne envoyée à distance même
  après un réglage à la main : la consigne affichée dans Gladys peut alors
  rester l'ancienne.

## Rafraîchissement et limites

- La passerelle est lue toutes les **30 secondes** : la liste des chaudières,
  puis chaque chaudière (ses thermostats viennent avec). Les états ont donc
  jusqu'à 30 secondes de retard. Seules les valeurs qui changent sont
  envoyées à Gladys (et chacune au moins toutes les 30 minutes).
- Une chaudière qui ne répond pas ne rend injoignables que ses propres
  appareils ; les autres continuent.
- Les températures de l'eau (circuit, eau chaude) sont des sondes : Gladys ne
  les compte pas dans la température de la pièce où se trouve la chaudière.
- Une passerelle Lan2RF gère 8 chaudières au plus, 2 thermostats de pièce
  par chaudière. Un thermostat n'apparaît que quand la passerelle en donne
  une température valide.
- Les chaudières sont reconnues par leur **numéro de série** (celui que la
  passerelle liste), pas par leur position dans la liste : une chaudière qui
  change de place garde son appareil, son historique et ses scènes.

## Problèmes de connexion

- **Passerelle injoignable** : tous les appareils apparaissent injoignables ;
  nouvel essai après 30 s, puis de plus en plus rarement jusqu'à toutes les
  10 min (jamais plus vite que la lecture normale).
- **Identifiants demandés ou refusés** (HTTP 401) : Gladys ne réessaie pas
  seul, même après une reconnexion à Gladys. Corrigez l'identifiant et le mot
  de passe puis enregistrez, ou appuyez sur **Tester la connexion**. Un
  redémarrage de l'intégration fait un seul nouvel essai.
- **HTTP 404 avec un identifiant** : la passerelle est ancienne et n'a pas de
  pages protégées : videz l'identifiant et le mot de passe.
- **Passerelle surchargée** (HTTP 429) : toutes les requêtes s'arrêtent de 1
  minute à 6 heures ; enregistrer la configuration ou appuyer sur **Tester
  la connexion** lève la pause.
- Les journaux ne contiennent ni le mot de passe ni le texte des réponses de
  la passerelle, seulement des codes (HTTP 500, pas de connexion…).

## Limites

- Une seule passerelle par intégration.
- Pas de commande d'eau chaude ni de mode de la chaudière : la passerelle ne
  les propose pas, et l'eau chaude est volontairement en lecture seule.
- Ni la force du signal radio ni le numéro de nœud ne sont publiés.
- Jamais testée sur une vraie passerelle, ni avec des identifiants réels.
