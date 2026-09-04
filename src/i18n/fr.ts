/**
 * The workspace in French.
 *
 * Typed against `en.ts`, so this file cannot fall behind without the build
 * saying so. Canadian French rather than European: this app draws
 * Environment and Climate Change Canada's radar, and the vocabulary follows
 * the terms those bilingual products already use, which is what a reader in
 * Quebec or New Brunswick will recognise. Alerte for a warning, veille for a
 * watch, avis for an advisory, as the Meteorological Service of Canada writes
 * them.
 *
 * The safety copy is translated as carefully as the rest and no more
 * cautiously: this app is not a warning source in any language, and the
 * French says exactly that rather than softening it.
 */
import type { Catalogue } from "./en";

export const fr: Catalogue = {
  "export.eyebrow": "Emportez-la",
  "export.title": "Exporter",
  "export.image": "Exporter l'image",
  "export.loop": "Exporter la boucle (WebM)",
  "export.mp4": "Exporter la boucle (MP4)",
  "export.loopFrames": " ({count, plural, one {# image} other {# images}})",
  "export.gif": "Exporter en GIF",
  "export.gifFrames":
    " ({count, plural, one {la dernière image} other {les # dernières images}})",
  "export.recording":
    "Enregistrement de l'image {done} sur {total}. Laissez la fenêtre au premier plan pendant l'opération.",
  "export.cardTitle": "Ce qui se retrouve dans le fichier",
  "export.cardBody":
    "La carte exactement telle qu'elle est, avec l'heure de l'image, la source radar et les mentions gravées dans le coin.",
  "export.note":
    "Les deux vont directement dans votre dossier de téléchargements, et un petit fichier JSON accompagne chacun en indiquant d'où vient chaque image. Rien n'est téléversé.",
  "export.dataHeading": "Les mesures derrière l'image",
  "export.dataNote":
    "Une image est une couleur par valeur, et une couleur ne se compare pas à un pluviomètre. Ceci écrit plutôt les valeurs, chacune avec un fichier JSON qui nomme la source, l'heure, les unités et tout ce qui a été fait aux mesures. Les tables de couleurs et les seuils d'affichage ne sont pas appliqués.",
  "export.dataFile": "{label} en {format}",
  "export.dataRadar": "Valeurs du radar",
  "export.dataComposite": "Composite MRMS",
  "export.dataWritten": "{label} enregistré",
  "export.dataWrittenBody":
    "{readings, plural, one {# relevé} other {# relevés}}, {size}, dans {path}, avec un fichier de provenance à côté.",
  "export.dataFailed": "L'exportation des données a échoué",
  "export.dataNoView": "La carte n'a pas encore de vue à découper.",
  "dataExport.bytes": "{count, plural, one {# octet} other {# octets}}",
  "dataExport.kilobytes": "{count} ko",
  "dataExport.megabytes": "{count} Mo",
  "dataExport.error.notDrawn":
    "Cette grille n'est pas sur la carte, donc il n'y a rien de décodé à écrire. Activez la couche et laissez-la se dessiner d'abord.",
  "dataExport.error.noProduct": "Il n'existe aucun produit nommé {0}.",
  "dataExport.error.nothingInView":
    "La vue ne contient aucune partie de cette grille.",
  "dataExport.error.tooLarge":
    "Cela ferait {0, plural, one {# relevé} other {# relevés}} dans un seul fichier. Zoomez pour que l'export couvre moins de terrain.",
  "dataExport.error.noFolder": "Il n'y a nulle part où écrire l'exportation.",
  "dataExport.error.write": "L'exportation n'a pas pu être écrite : {0}",
  "dataExport.error.grid": "{0}",
  "dataExport.error.unknown": "L'exportation n'a pas pu être écrite.",

  "search.eyebrow": "Trouver un endroit",
  "search.title": "Recherche",
  "search.placeholder": "Ville, région ou code postal",
  "search.label": "Rechercher un endroit",
  "search.unavailable":
    "La recherche d'endroits est indisponible. La carte reste utilisable.",
  "search.storms": "Tempêtes portant ce nom",
  "search.stormsMore":
    "Afficher {count, plural, one {l'autre} other {les # autres}}",
  "search.stormsNote":
    "Tiré du relevé de trajectoires fourni avec l'application. Aucune de ces tempêtes n'est en cours.",
  "search.none": "Aucun endroit correspondant.",
  "search.note": "Recherche d'endroits par Open-Meteo et GeoNames.",

  "alerts.eyebrow": "Veilles et alertes",
  "alerts.title": "Alertes",
  "alerts.layerOffTitle": "La couche des alertes est désactivée",
  "alerts.layerOffBody": "Réactivez-la pour voir les veilles et les alertes.",
  "alerts.turnOn": "Activer les alertes météo",
  "alerts.area": "Couvre {places}",
  "alerts.instruction": "Ce que le bureau demande de faire :",
  "alerts.issued": "Émise {issued} · expire {expires}",
  "alerts.unknownTime": "inconnue",
  "alerts.openProduct": "Ouvrir le produit officiel",
  "alertType.tornado": "Mettez-vous à l'abri maintenant",
  "alertType.tornadoDetail":
    "Alertes et veilles de tornade, alertes de tsunami, vents extrêmes, et les urgences civiles : matières dangereuses, centrale nucléaire, danger radiologique, confinement, évacuation immédiate.",
  "alertType.thunderstorm": "Orage et vent",
  "alertType.thunderstormDetail":
    "Alertes d'orage violent et de vents forts, avis de vent, tempêtes de poussière, et les produits maritimes de vent.",
  "alertType.flood": "Inondation",
  "alertType.floodDetail":
    "Crue soudaine et crue de rivière, inondation côtière et riveraine, fortes vagues et courants d'arrachement.",
  "alertType.winter": "Hiver et froid",
  "alertType.winterDetail":
    "Tempêtes hivernales, blizzards, verglas et pluie verglaçante, refroidissement éolien, gel intense, avalanche.",
  "alertType.tropical": "Tropical",
  "alertType.tropicalDetail":
    "Ouragans et tempêtes tropicales, onde de tempête, et les alertes de vents de force ouragan émises par les bureaux maritimes.",
  "alertType.fire": "Incendie",
  "alertType.fireDetail":
    "Alertes de risque extrême d'incendie, veilles météo-feu, fumée dense.",
  "alertType.heat": "Chaleur",
  "alertType.heatDetail": "Chaleur excessive et avis de chaleur.",
  "alertType.other": "Tout le reste",
  "alertType.otherDetail":
    "Tout ce que la liste n'a jamais vu, pour qu'un nouveau produit apparaisse au lieu de disparaître.",
  "layers.order": "Quelle couche passe par-dessus",
  "layers.orderDetail":
    "Les alertes restent toujours au-dessus du reste, parce qu'une alerte, c'est quelqu'un qui vous dit de vous mettre à l'abri",
  "layers.moveUp": "Monter {layer}",
  "layers.moveDown": "Descendre {layer}",
  "layers.opacity": "Opacité des couches",
  "layers.opacityDetail":
    "Chacune séparément, pour pouvoir atténuer une couche au lieu de l'éteindre",
  "layers.opacityFor": "{layer}, {percent} % d'opacité",
  "layers.files": "Fichiers que vous avez importés",
  "layers.picturesCeiling":
    "{count, plural, one {# image} other {# images}} dans ces fichiers ; les {drawn} premières sont dessinées.",
  "layers.filesDetail":
    "Chacun avec son propre interrupteur, le dernier de la liste dessiné par-dessus",
  "layers.filesNone":
    "Rien d'importé pour l'instant. Déposez un placefile ou un fichier GeoJSON dans le panneau Importer.",
  "layers.fileShapes": "{count, plural, one {# forme} other {# formes}}",
  "layers.fileShown": "Afficher {name}",
  "layers.fileRemove": "Retirer {name}",
  "layers.fileRemoved": "{name} retiré de la carte",
  "layers.fileRemovedBody":
    "Annuler le remet à la hauteur où il était dessiné.",
  "capture.title": "Disposition de capture",
  "capture.noAlerts": "Aucune alerte en cours dans la vue",
  "replay.warningsUnavailable":
    "L'archive des alertes n'a pas répondu, donc seul le radar vient de cette journée.",
  "replay.warningsSome":
    "Certaines alertes d'inondation de cette relecture n'ont pas pu être récupérées. Les autres sont dessinées.",
  "replay.warningsPartial":
    "Avant octobre 2007, les bureaux alertaient par comté, donc seules certaines de ces tempêtes ont un polygone.",
  "replay.warningsNone":
    "L'archive des alertes ne contient aucun polygone avant 2002, donc aucun n'est dessiné.",
  "replay.warningsHistorical": "Les alertes telles qu'elles étaient, {when}",
  "capture.leave": "Quitter la disposition de capture",
  "alerts.kinds": "Types d'alerte",
  "alerts.kindsDetail":
    "En décocher un le retire de la carte et de cette liste",
  "alerts.volume": "Volume",
  "alerts.volumeValue": "{percent} %",
  "alerts.previewNote":
    "Écoutez ce qu'une alerte fera avant qu'elle ne le fasse. Avec un son à vous choisi ci-dessous, les quatre jouent celui-là.",
  "alerts.soundFile": "Utiliser un son à vous",
  "alerts.soundFileDetail":
    "Gardé par son emplacement plutôt que copié, pour qu'une sauvegarde de l'espace de travail ne l'avale pas. Moins de 2 Mo, en wav, mp3, ogg, flac ou m4a, et coupé au bout de six secondes. Il remplace les quatre sons, la gravité cesse donc de s'entendre.",
  "alerts.soundFileChoose": "Choisir un fichier",
  "alerts.soundFileClear": "Revenir aux sons fournis",
  "alerts.soundFileRemoved": "Retour aux sons fournis",
  "alerts.soundFileRemovedBody":
    "Annuler récupère le fichier son que vous avez choisi.",
  "alerts.soundFileFailed": "Ce son n'a pas pu être utilisé",
  "alerts.soundFile.name":
    "Ce doit être un fichier wav, mp3, ogg, flac ou m4a.",
  "alerts.soundFile.noAudio":
    "Cette machine n'a pas de son, rien ne peut donc y être joué. La notification arrive quand même.",
  "alerts.soundFile.size": "Il pèse plus de 2 Mo.",
  "alerts.soundFile.decode":
    "Il n'a pas pu être lu comme de l'audio. Il a peut-être été déplacé, ou ce n'est pas un fichier son.",
  "alerts.sound": "Émettre un son",
  "alerts.soundDetail":
    "Une brève tonalité quand une alerte nouvelle ou rehaussée atteint l'endroit que vous surveillez",
  "alerts.impact.considerable": "dommages considérables",
  "alerts.impact.destructive": "destructrice",
  "alerts.impact.catastrophic": "catastrophique",
  "alerts.severity.extreme": "Extrême",
  "alerts.severity.severe": "Grave",
  "alerts.severity.moderate": "Modérée",
  "alerts.severity.minor": "Mineure",
  "alerts.impactLine": "Le bureau a qualifié celle-ci de {tag}.",
  "alerts.impactBadge": "{tag}",
  "alerts.hailTo":
    "{size, plural, one {{size} pouce} other {{size} pouces}} de grêle",
  "alerts.noneTitle": "Aucune alerte en cours dans la vue",
  "alerts.noneBody":
    "Déplacez la carte ou éloignez-vous pour couvrir une zone plus large. Les alertes se rafraîchissent chaque minute.",
  "alerts.noteOff": "Rien n'est récupéré tant que la couche est éteinte.",
  "alerts.noteError": "Affichage de la dernière liste valide. {error}",
  "alerts.noteChecked": "Veilles et alertes du NWS, vérifiées {when}.",
  "alerts.noteArchived":
    "Les alertes qui étaient en vigueur au moment affiché, tirées des archives de l'Iowa State.",
  "alerts.noteLoading": "Chargement des veilles et alertes du NWS.",
  "alerts.noteSafety":
    "Fiez-vous aux alertes officielles pour les décisions touchant la sécurité.",

  "units.miles": "milles",
  "units.kilometres": "kilomètres",
  "toast.settingsSaved": "Réglages enregistrés",
  "toast.settingsSavedBody": "Écrits dans votre dossier de téléchargements.",
  "toast.settingsSaveFailed": "Les réglages n'ont pas pu être enregistrés",
  "toast.settingsSaveFailedBody": "Rien n'a été écrit.",
  "toast.settingsRestored": "Réglages restaurés",
  "toast.settingsRestoredBody":
    "Tout ce que contenait le fichier est en place : les vues, les couches, l'endroit surveillé et la table de couleurs.",
  "toast.settingsRestoredPartly": "Réglages restaurés en partie",
  "toast.settingsFromNewer":
    "Ce fichier a été écrit par une version plus récente; ce qu'elle connaît et que celle-ci ignore a donc été laissé de côté.",
  "toast.settingsUnread": "Non lus dans le fichier : {names}.",
  "toast.notABackup": "Ce n'est pas un espace de travail enregistré",
  "toast.notABackupBody":
    "Restaurer depuis un fichier accepte un espace de travail que vous avez enregistré avec le bouton d'à côté. Rien n'a changé. Pour mettre un fichier de carte ou une palette sur la carte, utilisez le panneau Téléversement.",
  "toast.settingsBroken": "Ce fichier de réglages n'a pas pu être lu",
  "toast.settingsBrokenBody":
    "Le fichier n'est pas du JSON valide, alors rien n'a été modifié. Il a peut-être été modifié à la main ou écrit à moitié.",
  "toast.workspaceInvalidTitle": "Le fichier de réglages n'a pas été restauré",
  "toast.workspaceInvalid":
    "Cette copie de l'espace de travail est incomplète ou invalide, alors rien n'a été modifié.",
  "settings.backup": "Copie de sauvegarde",
  "settings.backupDetail":
    "Enregistrez tout dans un fichier, et restaurez depuis un fichier",
  "settings.import": "Restaurer depuis un fichier",
  "settings.export": "Enregistrer les réglages dans un fichier",
  "settings.units": "Unités",
  "settings.unitsImperial": "Pieds et Fahrenheit",
  "settings.unitsMetric": "Mètres et Celsius",
  "settings.clock": "Horloge",
  "settings.clockLocal": "Cet ordinateur",
  "settings.clockUtc": "UTC",
  "settings.clockDetail":
    "Tous les produits météo sont horodatés en UTC; lire la carte dans ce fuseau évite de convertir de tête",
  "settings.textSize": "Taille du texte",
  "settings.textSizeDetail": "Tout l'espace de travail, dessiné plus grand",
  "settings.language": "Langue",
  "settings.languageNote": "S'applique immédiatement",
  "storage.title": "Conservé sur le disque",
  "storage.format": "Données de carte et de météo",
  "storage.detail":
    "L'application conserve ce qu'elle a dessiné pour qu'un démarrage sans réseau ouvre sur la dernière vue que vous avez vue. Elle se vide au fur et à mesure, et ceci la vide maintenant. Vos paquets hors ligne et vos rediffusions enregistrées sont à part et ne sont pas touchés.",
  "storage.desktopOnly":
    "Rien n'est conservé sur le disque dans un navigateur.",
  "storage.held": "Conservé maintenant",
  "storage.unknown": "Illisible",
  "storage.reading": "Lecture",
  "storage.clearedOffline":
    "{freed} récupérés. Vous êtes hors ligne, donc la dernière vue est partie avec : la carte restera vide jusqu'à ce qu'un service soit de nouveau joignable.",
  "storage.clear": "Vider",
  "storage.cleared": "Vidé",
  "storage.clearedBody":
    "{freed} récupérés. La carte redemandera ce dont elle a besoin.",
  "storage.clearFailed": "Impossible de vider",
  "packs.title": "Trousses hors ligne",
  "packs.format": "PMTiles",
  "packs.detail":
    "Enregistrez la région affichée dans une archive PMTiles vérifiée. Les téléchargements peuvent être suspendus et repris, et la carte peut se servir d'une trousse terminée sans réseau.",
  "packs.desktopOnly":
    "Les trousses hors ligne sont offertes dans l'application de bureau.",
  "packs.defaultName": "Trousse d'intervention",
  "packs.ceiling": "Plafond disque des trousses",
  "packs.used": "{used} utilisés sur {limit}",
  "packs.megabytes": "{count} Mo",
  "packs.gigabytes": "{count} Go",
  "packs.name": "Nom de la trousse",
  "packs.minZoom": "Zoom minimal",
  "packs.maxZoom": "Zoom maximal",
  "packs.estimate":
    "{count, plural, one {# tuile} other {# tuiles}}. Environ {final} une fois terminée et jusqu'à {temporary} pendant la construction.",
  "packs.noRegion":
    "Amenez la carte sur la région que vous voulez enregistrer.",
  "packs.wontFit": "Cette trousse dépasserait le plafond disque configuré.",
  "packs.download": "Télécharger la région affichée",
  "packs.started": "Téléchargement de la trousse démarré",
  "packs.cancelled": "Trousse annulée et ses fichiers supprimés",
  "packs.deleted": "Trousse supprimée",
  "packs.deletedUndo": "{name} supprimée",
  "packs.deletedUndoBody":
    "Annuler récupère le téléchargement. Ensuite, il faudrait le refaire.",
  "packs.restored": "Trousse restaurée",
  "packs.paused": "Trousse suspendue",
  "packs.resumed": "Téléchargement de la trousse repris",
  "packs.selected": "{name} sert de fond de carte hors ligne",
  "packs.offlineActive": "Une trousse locale sert de fond de carte.",
  "packs.useOnline": "Utiliser le fond de carte en ligne",
  "packs.empty": "Aucune trousse n'a encore été préparée.",
  "packs.status.queued": "En file",
  "packs.status.downloading": "Téléchargement",
  "packs.status.paused": "Suspendue",
  "packs.status.finalizing": "Vérification du PMTiles",
  "packs.status.ready": "Prête hors ligne",
  "packs.status.failed": "À vérifier",
  "packs.packMeta": "Zoom {min} à {max} · {size}",
  "packs.progress":
    "{done} sur {total, plural, one {# tuile} other {# tuiles}}, {percent} %",
  "packs.usePack": "Utiliser hors ligne",
  "packs.pause": "Suspendre",
  "packs.resume": "Reprendre",
  "packs.cancel": "Annuler",
  "packs.delete": "Supprimer",
  "packs.missing":
    "Référencée par cet espace de travail, mais absente de cet appareil",
  "packs.forget": "Oublier la référence",

  "forecast.eyebrow": "Centre de la carte",
  "forecast.title": "Prévisions",
  "forecast.loading": "Chargement des dernières prévisions",
  "forecast.failedTitle": "Les prévisions ne sont pas disponibles",
  "forecast.failedBody": "Le radar et la carte restent en direct.",
  "forecast.feelsLike": "Ressenti {value} °",
  "forecast.wind": "Vent de {value} {unit}",
  "forecast.rainNow": "{value} {unit} en ce moment",
  "forecast.note":
    "Prévisions d'Open-Meteo. Consultez les alertes officielles pour les décisions touchant la sécurité.",
  "tropical.eyebrow": "National Hurricane Center",
  "tropical.title": "Tropical",
  "tropical.layerOffTitle": "La couche tropicale est éteinte",
  "tropical.layerOffBody":
    "Rallumez-la pour voir les cônes, les trajectoires et les perspectives.",
  "tropical.turnOn": "Allumer Tropical",
  "tropical.strength": "{category} · {knots} nœuds",
  "tropical.pressure": " · {value} mb",
  "tropical.advisory": "Bulletin {number} · {date}",
  "tropical.follow": "Suivre",
  "tropical.readAdvisory": "Lire le bulletin de {name}",
  "tropical.advisoryLink": "Bulletin",
  "tropical.noneTitle": "Aucun cyclone tropical en cours",
  "tropical.noneWithOutlook":
    "Les zones que la perspective surveille sont listées ci-dessous.",
  "tropical.noneAtAll": "La perspective n'a rien sous surveillance non plus.",
  "tropical.outlookTitle": "Perspective {basin}",
  "tropical.twoDays": "Deux jours {chance} · {risk}",
  "tropical.sevenDays": "Sept jours {chance} · {risk}",
  "tropical.noteError": "Affichage des derniers produits valides. {error}",
  "tropical.noteChecked": "Produits du NHC, vérifiés {when}.",
  "tropical.noteLoading": "Chargement des produits du NHC.",
  "tropical.noteSource": "Les bulletins officiels sur nhc.noaa.gov font foi.",
  "almanac.title": "À cette date",
  "almanac.note": "À partir de ce qui est déjà sur cette machine",
  "almanac.storm": "{name} était un {category}.",
  "almanac.track": "Meilleure trajectoire HURDAT2 de la NOAA",
  "almanac.show": "Montrer la trajectoire",
  "almanac.flyTo": "M'y emmener",
  "settings.almanac": "À cette date",
  "settings.almanacDetail":
    "Une carte dans Historique des tempêtes qui dit ce que la météo a fait à cette date d'autres années, d'après le registre livré avec l'application. Elle n'apparaît jamais tant qu'une alerte est en vigueur là où vous surveillez",
  "history.eyebrow": "Meilleure trajectoire HURDAT2",
  "history.title": "Historique des tempêtes",
  "history.placeholder": "Ian 2022",
  "history.searchLabel": "Chercher une tempête passée par nom ou par année",
  "history.archiveStatus": "L'archive des tempêtes {answer}.",
  "history.unknownStorm": "Cette tempête ne figure pas au registre.",
  "history.archiveDate": "{date} UTC",
  "history.failedTitle": "L'archive des tempêtes ne s'est pas chargée",
  "history.failedBody":
    "Réessayez dans un moment. La carte est toujours en direct.",
  "history.peak": "{category} · pointe de {knots} nœuds",
  "history.ace":
    "ACE {ace} · {fixes, plural, one {# position} other {# positions}} · du {from} au {to}",
  "history.liveRadar": "Radar en direct",
  "history.replayRadar": "Rejouer le radar",
  "history.clear": "Effacer",
  "history.tooOld":
    "L'archive radar commence en {year}; il n'y a donc rien à rejouer pour celle-ci. La trajectoire reste sur la carte.",
  "history.outside":
    "Cette tempête est restée à l'extérieur de la mosaïque radar nationale; il n'y a donc rien à rejouer. La trajectoire reste sur la carte.",
  "history.basinAtlantic": "Atlantique",
  "history.basinPacific": "Pacifique Est",
  "history.result": "{basin} · {category} · ACE {ace}",
  "history.none": "Rien ne correspond. Essayez un nom, une année, ou les deux.",
  "history.noteCount":
    "{count, plural, one {# tempête} other {# tempêtes}} depuis 1851, d'après le relevé HURDAT2 de la NOAA.",
  "history.noteLoading": "Chargement de l'archive des meilleures trajectoires.",
  "history.noteReplay":
    "Une reprise couvre trois heures de part et d'autre de {moment} le {date}, d'après l'archive radar de l'Iowa State.",
  "history.landfall": "l'arrivée sur les terres",
  "history.closestApproach": "son approche la plus proche",
  "history.noteReplaySource":
    "Les reprises viennent de l'archive radar de l'Iowa State.",
  "history.bundleHeading": "Dossier de reprise",
  "history.bundleNote":
    "Un dossier conserve les images de cette reprise et les alertes qui étaient en vigueur, octet pour octet, avec leurs adresses et leurs empreintes, pour qu'elle rejoue à l'identique sans réseau. La vue que vous regardez y entre avec elles, parce que les images qu'il contient sont celles que cette vue couvre.",
  "history.includeWorkspace": "Inclure mon espace de travail",
  "history.includeWorkspaceDetail":
    "Le domicile, les endroits surveillés, les vues enregistrées et les réglages. Exclus à moins que vous ne cochiez, chaque fois.",
  "history.saveBundle": "Enregistrer le dossier de reprise",
  "history.openBundle": "Ouvrir un dossier de reprise",
  "bundle.replayLabel": "Dossier de reprise",
  "bundle.openTitle": "Ouvrir un dossier de reprise OpenRadar",
  "bundle.fileKind": "Dossier de reprise OpenRadar",
  "bundle.missingTiles":
    "{count, plural, one {# tuile ne figurait pas} other {# tuiles ne figuraient pas}} dans le paquet.",
  "bundle.missingWarnings":
    "{count, plural, one {# flux d'alertes ne figurait pas} other {# flux d'alertes ne figuraient pas}} dans le paquet, ses alertes peuvent donc être incomplètes.",
  "bundle.missingBoth":
    "{tiles, plural, one {# tuile} other {# tuiles}} et {warnings, plural, one {# flux d'alertes} other {# flux d'alertes}} ne figuraient pas dans le paquet.",
  "bundle.error.invalidRequest":
    "Cette reprise ne peut pas être mise en dossier : {0}.",
  "bundle.error.tooManyTiles":
    "La vue couvre {0, plural, one {# tuile} other {# tuiles}} sur toute la relecture. Zoomez, ou dézoomez, pour qu'elle en couvre moins.",
  "bundle.error.tooLarge": "Le dossier dépasserait 256 Mo.",
  "bundle.error.noFolder": "Il n'y a nulle part où écrire le dossier.",
  "bundle.error.write": "Le dossier n'a pas pu être écrit : {0}",
  "bundle.error.read": "Le dossier n'a pas pu être lu : {0}",
  "bundle.error.notABundle":
    "Ce fichier n'est pas un dossier de reprise OpenRadar.",
  "bundle.error.newer":
    "Ce dossier a été fait par un OpenRadar plus récent. Mettez à jour pour l'ouvrir.",
  "bundle.error.corrupt": "Ce dossier est endommagé : {0}",
  "bundle.error.http": "{0}",
  "bundle.error.noView": "La carte n'a pas encore de vue à mettre en dossier.",
  "bundle.error.noFrames":
    "Ce dossier ne contient aucune image que cette version sait dessiner.",
  "bundle.error.letGo":
    "Le dossier qui était ouvert a été relâché; la carte est donc revenue au radar en direct.",
  "bundle.error.unknown": "Le dossier n'a pas pu être traité.",
  "route.eyebrow": "La météo en chemin",
  "route.title": "Trajet",
  "route.start": "Départ",
  "route.startPlaceholder": "Dallas",
  "route.destination": "Destination",
  "route.destinationPlaceholder": "Houston",
  "route.leaving": "Départ à",
  "route.plan": "Planifier le trajet",
  "route.failedTitle": "Le trajet n'a pas pu être planifié",
  "route.failed": "Vérifiez les deux endroits et réessayez.",
  "route.placeMissing": "Un de ces endroits est introuvable.",
  "alerts.failed": "Le service météo {answer}.",
  "earthquakes.failed": "Le service sismique de l'USGS {answer}.",
  "smoke.failed": "L'analyse de fumée de la NOAA {answer}.",
  "tropical.failed": "Le National Hurricane Center {answer}.",
  "wildfires.failed": "Le service des incendies du NIFC {answer}.",
  "hrrr.failed": "L'index des prévisions {answer}.",
  "provider.failed": "Le service radar {answer}.",
  "route.forecastFailed": "La prévision {answer}.",
  "search.failed": "La recherche de lieux {answer}.",
  "weather.failed": "La prévision {answer}.",
  "replay.archiveFailed": "L'archive des avertissements {answer}.",
  "kmz.notZip": "Ce fichier n'est pas une archive zip.",
  "kmz.noDecompressor":
    "Cette version ne peut pas décompresser une archive zip.",
  "kmz.tooBigUnpacked":
    "Cette archive se décompresse au-delà de ce qui peut être lu.",
  "kmz.tooBig": "Cette archive est plus grande que ce qui peut être lu.",
  "kmz.noKml": "Cette archive ne contient aucun fichier KML.",
  "kmz.truncated": "Cette archive est tronquée.",
  "kmz.notZipLayout": "Cette archive n'a pas la structure d'un zip.",
  "kmz.compression": "Cette archive utilise une compression illisible ici.",
  "kml.notXml": "Ce fichier n'a pas pu être lu comme du XML.",
  "kml.notKml": "Ce fichier n'est pas un document KML.",
  "export.encoderFailed":
    "L'encodeur vidéo de cette machine s'est arrêté au milieu de la boucle.",
  "metar.failed": "L'Aviation Weather Center {answer}.",
  "panel.vwp": "Profil du vent",
  "keywords.vwp": "vad profil vent barbules cisaillement hodographe",
  "vwp.eyebrow": "Affichage azimut-vitesse",
  "vwp.title": "Profil du vent",
  "vwp.loading": "Lecture du vent dans les volumes",
  "vwp.failedTitle": "Le profil du vent n'a pas pu être lu",
  "vwp.unavailable": "Le profil du vent n'est pas disponible ici.",
  "vwp.needsSite":
    "Fixez un seul radar et ceci lit son propre vent, hauteur par hauteur.",
  "vwp.noData": "ND",
  "vwp.note":
    "Le vent dans lequel se déplace chaque hauteur, ajusté sur un anneau de la vitesse mesurée par le radar. Une hauteur marquée ND est une hauteur où l'ajustement n'a pas pu être garanti : c'est un trou, pas de l'air calme.",
  "vwp.columnLabel": "Vent par hauteur pour le volume {volume}",
  "vwp.hodographLabel": "Hodographe du vent par hauteur",
  "layers.spcOutlookChoice": "Prévision convective",
  "layers.spcOutlookChoiceDetail":
    "Quel jour, et le risque par catégories ou la probabilité d'un aléa. Les jours 3 à 8 publient une seule probabilité, sans distinction d'aléa.",
  "layers.spcDay": "Jour de la prévision",
  "layers.spcHazard": "Aléa de la prévision",
  "layers.spcCategorical": "Par catégories",
  "layers.spcTornado": "Tornade",
  "layers.spcHail": "Grêle",
  "layers.spcWind": "Vent",
  "spc.significant":
    "Hachuré : où cet aléa serait significatif s'il se produit",
  "spc.asIssued": "La prévision en vigueur ce jour-là",
  "layer.lightningForecast": "Probabilité de foudre",
  "layer.lightningJump": "Saut de foudre",
  "layer.isothermReflectivity": "Réflectivité au niveau de la glace",
  "keywords.lightningForecast": "chance prevision foudre prochain",
  "keywords.lightningJump": "saut hausse taux sigma foudre",
  "keywords.isothermReflectivity": "isotherme glace froid dbz zero",
  "layers.lightningForecastDetail":
    "La probabilité que la foudre tombe là où elle n'est pas encore tombée.",
  "layers.lightningJumpDetail":
    "Là où le taux d'éclairs d'une cellule a grimpé plus vite que son propre historique.",
  "layers.isothermReflectivityDetail":
    "Réflectivité au niveau où l'air est assez froid pour former de la glace.",
  "layers.lightningWindow": "Moyenne sur",
  "layers.lightningWindowDetail":
    "Les quatre donnent un taux d'éclairs, donc vous pouvez passer de l'une à l'autre et comparer.",
  "layers.lightningForecastWindow": "Prévision pour les",
  "layers.lightningForecastWindowDetail":
    "Une prévision, pas un impact. Cela couvre du terrain où rien n'est tombé.",
  "layers.lightningJumpWindow": "Saut affiché",
  "layers.lightningJumpWindowDetail":
    "En écarts-types. À partir de deux, le WDTD dit qu'il faut regarder.",
  "layers.isothermLevel": "Mesurée à",
  "layers.isothermLevelDetailMinus10":
    "Là où la foudre démarre. Un écho fort ici veut dire que la charge se sépare.",
  "layers.isothermLevelDetailMinus20":
    "Plus profond dans la glace. Un écho fort ici accompagne la grêle et une hausse des éclairs.",
  "lightningWindow.1m": "1 min",
  "lightningWindow.5m": "5 min",
  "lightningWindow.15m": "15 min",
  "lightningWindow.30m": "30 min",
  "lightningForecast.30m": "30 min",
  "lightningForecast.60m": "60 min",
  "lightningJump.now": "Maintenant",
  "lightningJump.max": "5 dernières min",
  "isothermLevel.minus10": "-10 C",
  "isothermLevel.minus20": "-20 C",
  "mrms.lightning1min": "Foudre nuage-sol, 1 min",
  "mrms.lightning15min": "Foudre nuage-sol, 15 min",
  "mrms.lightning30min": "Foudre nuage-sol, 30 min",
  "mrms.lightningProbability30": "Probabilité de foudre dans 30 min",
  "mrms.lightningProbability60": "Probabilité de foudre dans 60 min",
  "mrms.lightningJump": "Saut de foudre",
  "mrms.lightningJumpMax": "Plus grand saut de foudre, 5 min",
  "mrms.reflectivityMinus10c": "Réflectivité à -10 C",
  "mrms.reflectivityMinus20c": "Réflectivité à -20 C",
  "layers.spcDay3Probability": "Probabilité",
  "watch.notificationsRefused":
    "Windows ne laisse pas OpenRadar afficher de notifications, donc elles ne peuvent apparaître que dans l'app. Activez-les dans les Paramètres de Windows, sous Système, Notifications.",
  "service.busy": "est occupé",
  "service.notFound": "ne l'a pas trouvé",
  "service.tooMany": "a reçu trop de demandes",
  "service.refused": "a refusé",
  "service.unexpected": "a répondu d'une manière illisible",
  "route.routerRefused": "Le calculateur d'itinéraire {answer}.",
  "route.straightOffer": "Utiliser plutôt une ligne droite",
  "route.straightNote":
    "Sans tracé routier : voici la ligne droite entre les deux endroits, et les heures le long de celle-ci supposent une vitesse constante de {speed}. La météo, elle, est réelle.",
  "route.summary": "{from} à {to} · {miles} {unit} · {minutes} min",
  "route.miles": "{value} {unit}",
  "route.noValue": "—",
  "route.note":
    "Routes des contributeurs d'OpenStreetMap, sous licence ODbL, par le service de routage FOSSGIS. Météo d'Open-Meteo. Tous les arrêts du trajet tiennent dans une seule requête de prévisions, alors laissez souffler les serveurs entre deux essais.",

  "storm.cat5": "Catégorie 5",
  "storm.cat4": "Catégorie 4",
  "storm.cat3": "Catégorie 3",
  "storm.cat2": "Catégorie 2",
  "storm.cat1": "Catégorie 1",
  "storm.tropicalStorm": "Tempête tropicale",
  "storm.tropicalDepression": "Dépression tropicale",
  "weather.clear": "Dégagé",
  "weather.partlyCloudy": "Partiellement nuageux",
  "weather.fog": "Brouillard",
  "weather.rain": "Pluie",
  "weather.snow": "Neige",
  "weather.showers": "Averses",
  "weather.snowShowers": "Averses de neige",
  "weather.thunderstorms": "Orages",
  "weather.mixed": "Conditions mixtes",
  "time.utcSuffix": " UTC",
  "time.justNow": "à l'instant",
  "age.minutes": "{count} min",
  "age.hours": "{count, plural, one {# heure} other {# heures}}",
  "age.days": "{count, plural, one {# jour} other {# jours}}",
  "time.ago": "il y a {age}",
  "upload.eyebrow": "Données locales",
  "upload.title": "Téléversement",
  "upload.dropTitle": "Ajouter une couche ou une table de couleurs",
  "upload.dropBody":
    "Choisissez un fichier GeoJSON local, un placefile GRLevelX ou une table de couleurs .pal. Rien n'est envoyé à un serveur.",
  "upload.colours": "{count, plural, one {# couleur} other {# couleurs}}",
  "upload.forUnits": " · {units}",
  "upload.forReflectivity": " · réflectivité",
  "upload.skipped": "{names} laissés de côté",
  "upload.clearPalette": "Retirer",
  "upload.libraryHeading": "Vos tables de couleurs",
  "upload.libraryBody":
    "Jusqu'à {count}. Une table s'applique à la seule chose pour laquelle elle se déclare, alors une échelle de réflectivité et une échelle de vitesse peuvent être actives en même temps.",
  "upload.useFor": "Utiliser pour {unit}",
  "upload.inForce": "En vigueur pour {unit}",
  "upload.removePalette": "Retirer {name}",
  "upload.asSupplied":
    "Dessinée telle que fournie. Le contraste accru modifie les rampes intégrées, jamais une table que vous avez chargée.",
  "diagnostics.eyebrow": "OpenRadar v{version}",
  "diagnostics.title": "Diagnostics",
  "diagnostics.renderer": "Moteur de rendu de la carte",
  "diagnostics.rendererReady": "Prêt",
  "diagnostics.rendererUnknown": "La carte graphique n'a pas donné son nom",
  "diagnostics.rendererStarting": "Démarrage",
  "diagnostics.timeline": "Chronologie du radar",
  "diagnostics.receiving": "{source} · réception des images",
  "diagnostics.live": "En direct",
  "diagnostics.waiting": "En attente de données",
  "diagnostics.failing": "{error} ({count} d'affilée)",
  "diagnostics.frames":
    "{count, plural, one {# image} other {# images}}, {when}",
  "diagnostics.answered": "A répondu {when}",
  "diagnostics.standingBy": "En attente",
  "diagnostics.neverContacted": "pas encore contacté",
  "diagnostics.underAMinute": "il y a moins d'une minute",
  "diagnostics.ago": "il y a {age}",
  "diagnostics.recentEvents": "Événements récents",
  "diagnostics.openLogs": "Ouvrir le dossier des journaux",
  "diagnostics.copy": "Copier pour un rapport de bogue",
  "diagnostics.whatIsCopied":
    "Le rapport contient la version de l'application, le moteur de rendu et la plateforme de cet ordinateur, les sources qui ont répondu, ce qui est gardé sur le disque et le journal récent. Les coordonnées du journal sont arrondies au kilomètre près et les noms de compte sont retirés des chemins de fichiers.",
  "diagnostics.includePlace":
    "Inclure l'endroit que je surveille, arrondi au kilomètre près",
  "diagnostics.watchedPlace": "Endroit surveillé",
  "diagnostics.copied": "Diagnostics copiés",
  "diagnostics.copiedBody":
    "La version, le moteur de rendu, les sources qui ont répondu et la fin du journal. Aucune coordonnée plus précise que le kilomètre, et aucun nom de dossier.",
  "diagnostics.copyFailed": "Les diagnostics n'ont pas pu être copiés",
  "diagnostics.copyFailedBody":
    "Le presse-papiers a refusé. Le même texte se trouve dans le dossier des journaux.",
  "diagnostics.nothingWrong": "Rien n'a encore mal tourné.",
  "diagnostics.updateAvailable": "OpenRadar {version} est sorti",
  "diagnostics.updateReady": "Redémarrage dans la nouvelle version",
  "diagnostics.updateDownloading": "Téléchargement, {percent} %",
  "diagnostics.updateChecking": "Recherche d'une version plus récente",
  "diagnostics.updateFailed": "La recherche de mise à jour a échoué",
  "diagnostics.version": "OpenRadar v{version}",
  "diagnostics.updateFallbackNotes":
    "Installez-la et OpenRadar redémarre dedans.",
  "diagnostics.upToDate": "C'est la version la plus récente.",
  "diagnostics.updateSource":
    "Les mises à jour sont téléchargées depuis les versions publiées du projet.",
  "diagnostics.install": "Installer {version}",
  "diagnostics.check": "Rechercher des mises à jour",
  "diagnostics.privateTitle": "Privé par défaut",
  "diagnostics.privateBody":
    "Les réglages et les couches importées restent sur cet appareil.",
  "diagnostics.disclaimerTitle": "Avertissement opérationnel",
  "diagnostics.disclaimerBody":
    "Fiez-vous aux alertes officielles et aux autorités locales pour les décisions touchant la sécurité.",

  "product.reflectivity": "Réflectivité",
  "product.stormRelative": "Vitesse relative à l'orage",
  "radar.stormMotion": "Déplacement de l'orage",
  "radar.stormMotionRead": "Lu dans le balayage : {speed} du {from}°",
  "radar.stormMotionGiven": "Le vôtre : {speed} du {from}°",
  "radar.stormMotionNone": "Aucun déplacement n'a pu être lu dans ce balayage",
  "radar.stormMotionSpeed": "Vitesse ({unit})",
  "radar.stormMotionFrom": "Provenance",
  "radar.stormMotionClear": "Le lire plutôt dans le balayage",
  "product.velocity": "Vitesse",
  "product.spectrumWidth": "Largeur du spectre",
  "product.differential": "Réflectivité différentielle",
  "product.correlation": "Coefficient de corrélation",
  "product.longRange": "Réflectivité longue portée",
  "radar.eyebrow": "Produit radar",
  "radar.title": "Radar composite",
  "radar.composite": "Réflectivité composite",
  "radar.compositeDetail": "Boucle de deux heures de la source active",
  "radar.opacity": "Opacité",
  "radar.speed": "Vitesse",
  "radar.history": "Historique",
  "radar.minutes": "{count} min",
  "radar.show": "Afficher le radar",
  "radar.showDetail":
    "Garder le fond de carte visible quand le radar est masqué",
  "radar.singleSite": "Un seul site, de près",
  "radar.singleSiteDetail":
    "Au-delà du zoom {zoom}, le balayage Level II du site NEXRAD le plus proche remplace la mosaïque nationale",
  "radar.dealias": "Déplier la vitesse",
  "radar.live": "Volume en cours",
  "radar.liveDetail":
    "Dessiner le balayage que le radar fait en ce moment par-dessus le dernier qu'il a terminé. L'image terminée a de quatre à six minutes au moment d'être publiée; celle-ci a quelques secondes sur le secteur que le radar a atteint, et ne change rien ailleurs.",
  "radar.smooth": "Lisser le balayage",
  "radar.smoothTdwr":
    "Les produits d'un radar d'aéroport arrivent déjà dessinés : il n'y a pas de portes entre lesquelles interpoler.",
  "radar.smoothDetail":
    "Interpole entre les portes au lieu de prendre la plus proche. L'image seulement : les valeurs consultées et les nombres exportés restent les portes elles-mêmes.",
  "radar.persistence": "Rémanence du phosphore",
  "radar.persistenceDetail":
    "Estompe le balayage terminé derrière celui que le radar est en train de faire, comme le fait un écran au phosphore. Rien des mesures ne change; la légende donne l'âge de la moitié la plus ancienne autant que de la plus récente, parce qu'une image estompée est plus vieille qu'une image qui ne l'est pas.",
  "radar.archiveBrowse": "Archive II",
  "radar.archiveBrowseDetail":
    "Ouvrez un volume local hors ligne ou demandez à l'archive publique de la NOAA un site et une heure UTC.",
  "radar.openArchiveTitle": "Ouvrir un volume NEXRAD Archive II",
  "radar.openArchive": "Ouvrir un fichier Archive II local",
  "radar.archiveStation": "Site NEXRAD",
  "radar.archiveStationPlaceholder": "KDMX",
  "radar.archiveTime": "Date et heure UTC",
  "radar.loadArchive": "Charger le volume de l'archive publique",
  "radar.archiveReading": "Lecture du volume choisi...",
  "radar.archiveUnavailable": "Le volume choisi n'est pas disponible.",
  "radar.localArchive": "Archive II locale",
  "radar.publicArchive": "Archive II publique",
  "radar.archiveCurrent": "{source}, {time}",
  "radar.returnRecent": "Revenir au radar récent",
  "radar.dealiasDetail":
    "Un vent plus rapide que ce que le radar peut mesurer se replie et se dessine comme s'il soufflait dans l'autre sens. Ceci le remet en place.",
  "radar.sweepLine": "{station} · {site} · {product} à {tilt}° · {age}",
  "radar.historicalSweepLine":
    "{station}, {site}, {product} à {tilt} degrés, {time}",
  "radar.justIn": "à l'instant",
  "radar.age": "{age}",
  "radar.reading": "Lecture du dernier volume de {station}.",
  "radar.nearestSite": "le site le plus proche",
  "radar.zoomIn":
    "Dépassez le zoom {zoom} au-dessus des États-Unis pour faire entrer un site.",
  "radar.product": "Produit",
  "radar.productLabel": "Produit Level II",
  "radar.classification": "Classification",
  "radar.classificationLabel": "Produit de classification des hydrométéores",
  "radar.classificationDetail":
    "Le produit Level III que lit la couche de classification des hydrométéores : l'angle le plus bas, ou le balayage hybride dans lequel tout le volume est lu.",
  "radar.error.unknownSite": "{0} n'est pas un site NEXRAD.",
  "radar.error.notWsr88d":
    "{0} est le radar terminal d'un aéroport : il n'a ni volume Level II à lire, ni archive.",
  "radar.error.noVolume":
    "Aucun volume radar n'a encore été publié pour {0} aujourd'hui ni hier.",
  "radar.error.badListing": "La liste des volumes n'a pas pu être lue.",
  "radar.error.decode": "Le volume n'a pas pu être décodé : {0}",
  "radar.error.noSweep": "{0} n'a aucun balayage {1} à cet angle.",
  "radar.error.noStormMotion":
    "Le vent à {0} n'a pas pu être lu, alors il n'y a rien à retirer de l'image.",
  "radar.error.encode": "L'image n'a pas pu être dessinée : {0}",
  "radar.error.invalidTime": "{0} n'est pas une date et une heure UTC.",
  "radar.error.localRead": "Le fichier choisi n'a pas pu être lu : {0}",
  "radar.error.localTooLarge": "Le fichier choisi dépasse 128 Mo.",
  "radar.error.outOfRange":
    "Les deux extrémités d'une coupe verticale doivent être à portée de {0}.",
  "radar.error.http": "L'archive radar n'a pas pu être jointe : {0}",
  "radar.error.unknown": "Le site radar n'a pas répondu.",
  "radar.dealiasForced":
    "La vitesse relative à l'orage doit d'abord déplier, parce que le vent qu'elle retire est lu dans le balayage",
  "radar.threshold": "Masquer sous",
  "radar.thresholdMosaic": "Masquer sous, sur la mosaïque",
  "radar.thresholdMosaicDetail":
    "La mosaïque retient l'écho le plus fort de toute la colonne, alors ses valeurs montent plus haut que celles d'un seul angle",
  "radar.thresholdLabel": "Masquer les valeurs sous ce seuil",
  "radar.thresholdOff": "Tout",
  "radar.thresholdValue": "{value} {unit}",
  "radar.thresholdDetail":
    "Tout ce qui est plus faible que cela quitte l'image, pour que les noyaux ressortent seuls",
  "radar.thresholdSpeed":
    "La vitesse est masquée selon son intensité et non son sens, alors les deux directions partent ensemble",
  "radar.tilt": "Angle",
  "radar.tiltLabel": "Angle Level II",
  "radar.site": "Site",
  "radar.siteLabel": "Site radar",
  "radar.terminalRadars": "Radars terminaux (TDWR)",
  "radar.siteInReach": "{station} · {city}, {state} · {distance}",
  "radar.sitesInReach": "Radars qui couvrent cette vue",
  "radar.siteWithFault": "{site} ({reason})",
  "radar.faultNoRecentData": "aucune donnée depuis {age}",
  "radar.faultOffline": "n'émet plus",
  "radar.faultNotOperating": "{state}",
  "radar.terminalLine":
    "Radar météorologique Doppler terminal, portée de {range} km · {source}",
  "radar.terminalProducts":
    "Le radar terminal d'un aéroport ne publie que la réflectivité et la vitesse, jusqu'à 48 milles marins, avec une réflectivité longue portée jusqu'à 225. Les autres produits restent indisponibles tant qu'il est retenu.",
  "radar.followMap": "Suivre la carte",
  "radar.hold": "Retenir {station}",
  "radar.stationHeld":
    "{station}, à {distance} de {home}, en train de publier.",
  "radar.stationQuiet":
    "{station}, à {distance} de {home}. Rien de nouveau depuis {count} min.",
  "radar.opacityLabel": "Opacité du radar",

  "command.group.layer": "Couche",
  "command.group.product": "Produit radar",
  "command.group.style": "Type de carte",
  "command.group.panel": "Panneau",
  "command.group.tool": "Outil",
  "command.group.layout": "Disposition",
  "keywords.ambientScreen":
    "ambiant, second moniteur, écran, plein écran, kiosque, mur",
  "keywords.capture": "capture direct diffusion propre observation",
  "keywords.home": "chez soi maison retour endroit surveille",
  "layer.probSevere": "Probabilité de sévérité",
  "layers.probSevereDetail":
    "Ce qu'un modèle attend de chaque orage dans la prochaine heure, ce qui tient de l'orientation et non de l'alerte",
  "probSevere.title": "Probabilité de sévérité",
  "probSevere.stale":
    "La dernière lecture a plus de quinze minutes, alors elle parle d'orages qui sont passés. Rien n'est dessiné avant la publication d'une lecture fraîche.",
  "probSevere.headline":
    "{percent} % de risque de temps violent dans la prochaine heure",
  "probSevere.kinds": "Grêle {hail} % · Vent {wind} % · Tornade {tornado} %",
  "probSevere.note":
    "Un modèle qui lit le radar, le satellite et l'air autour de l'orage. Ce n'est pas une alerte, et un chiffre bas n'est pas une promesse.",
  "layer.stormCells": "Cellules orageuses",
  "layers.stormCellsDetail":
    "Ce que suit l'algorithme de pistage du radar, avec la direction que prend chaque orage",
  "layer.classification": "Classification des hydrométéores",
  "layers.classificationDetail":
    "Ce que l'algorithme du site retenu dit qui tombe : pluie, neige, grêle, ou qu'il n'arrive pas à trancher",
  "hydrometeor.iceCrystals": "Cristaux de glace",
  "hydrometeor.drySnow": "Neige sèche",
  "hydrometeor.wetSnow": "Neige mouillée",
  "hydrometeor.graupel": "Grésil",
  "hydrometeor.rain": "Pluie",
  "hydrometeor.heavyRain": "Pluie forte",
  "hydrometeor.bigDrops": "Grosses gouttes",
  "hydrometeor.hail": "Grêle",
  "hydrometeor.largeHail": "Grosse grêle",
  "hydrometeor.giantHail": "Grêle géante",
  "hydrometeor.unknown": "Indéterminé",
  "classification.lowestTilt": "Angle le plus bas (N0H)",
  "classification.hybridScan": "Balayage hybride (HHC)",
  "chrome.classificationNote":
    "L'algorithme du radar nomme ce à quoi ressemblent ses moments à double polarisation. Ce n'est pas un rapport venu du sol.",
  "layer.stormReports": "Rapports d'orage",
  "layers.stormReportsDetail":
    "Ce que des gens sur le terrain ont vraiment vu depuis un jour : grêle, dégâts de vent, tornades, inondations",
  "keywords.stormReports": "rapport local orage observation terrain témoin sol",
  "reports.serviceStatus": "Le service des rapports d'orage {answer}.",
  "reports.measured": "{value} {unit}",
  "reports.reported": "Signalé {when}",
  "reports.reportedUnknown": "Heure du signalement inconnue",
  "reports.source": "De {source}",
  "layer.hailSwath": "Couloir de grêle",
  "layers.hailSwathDetail":
    "La plus grosse grêle que le réseau a vue où que ce soit depuis un jour",
  "layer.echoTops": "Sommets des échos",
  "layers.echoTopsDetail":
    "La hauteur que l'orage atteint, ce qui dit combien il travaille fort",
  "layer.vil": "Eau retenue en altitude",
  "layers.vilDetail":
    "L'eau que la colonne transporte, là où la grêle paraît avant de tomber",
  "layer.precipRate": "Taux de pluie",
  "layers.precipRateDetail": "Avec quelle force il tombe en ce moment",
  "layer.qpeHour": "Pluie, dernière heure",
  "layers.qpeHourDetail": "Ce qui est tombé depuis une heure",
  "layer.qpeDay": "Pluie, dernier jour",
  "layer.counties": "Comtés",
  "layer.gaugeQpe": "Pluie, corrigée par les pluviomètres",
  "layer.unitStreamflow": "Ruissellement modélisé",
  "layer.ffgThreeHour": "Seuil de crue soudaine, 3 h",
  "layer.ffgHour": "Seuil de crue soudaine, 1 h",
  "layers.qpeDayDetail": "Ce qui est tombé depuis hier à la même heure",
  "counties.failed": "Les limites de comtés n'ont pas pu être lues.",
  "layers.countiesDetail":
    "Limites de comtés et d'États, la façon dont les alertes et les signalements sont formulés.",
  "layers.gaugeQpePeriod": "Sur quelle durée",
  "layers.gaugeQpeDetail":
    "La pluie vue par le radar, ramenée vers ce que les pluviomètres ont réellement recueilli. Plus proche du réel que le radar seul, et toujours une estimation partout où il n'y a pas de pluviomètre.",
  "layers.unitStreamflowDetail":
    "Ce que le modèle de crue fait ruisseler par kilomètre carré. Un modèle du sol, pas une mesure du ciel.",
  "layers.ffgThreeHourDetail":
    "La même chose sur trois heures, la fenêtre dans laquelle une crue plus lente se forme.",
  "layers.ffgHourDetail":
    "Compare la pluie de la dernière heure à ce que le service estime que le sol peut absorber. 100 % veut dire que la pluie l'a atteint.",
  "layer.precipType": "Pluie ou neige",
  "layers.precipTypeDetail":
    "Ce que le réseau dit qui tombe vraiment, plutôt qu'avec quelle force",
  "keywords.precipType": "neige grésil verglas hiver type précipitation",
  "precipType.warmStratiform": "Pluie",
  "precipType.coolStratiform": "Pluie, air froid",
  "precipType.snow": "Neige",
  "precipType.convection": "Pluie convective",
  "precipType.hail": "Grêle",
  "precipType.tropicalStratiform": "Pluie tropicale",
  "precipType.tropicalConvection": "Pluie convective tropicale",
  "chrome.precipTypeNote":
    "La classification du réseau lui-même, à partir du radar et de la température du modèle ensemble, et non un rapport venu du sol",
  "layer.spcOutlooks": "Perspective de temps violent",
  "layer.wpcExcessiveRain": "Pluies excessives",
  "layer.wpcWinterSeverity": "Sévérité hivernale",
  "layers.spcOutlooksDetail":
    "Le risque d'orages violents aujourd'hui selon le Storm Prediction Center, dans ses propres couleurs",
  "layers.wpcExcessiveRainDetail":
    "Prévision du WPC de pluies assez fortes pour provoquer des crues soudaines",
  "layers.wpcWinterSeverityDetail":
    "Indice du WPC sur ce qu'une tempête hivernale fait à un lieu, pas sur ce qui tombe",
  "layers.wpcDay": "Pour quel jour la prévision vaut",
  "layers.wssiDay": "Pour quel jour l'indice vaut",
  "layers.outlookDay": "Jour {day}",
  "layer.spcDiscussions": "Discussions à méso-échelle",
  "layers.spcDiscussionsDetail":
    "Ce que les prévisionnistes surveillent en ce moment, une heure ou deux avant toute alerte",
  "spc.serviceStatus": "Le service du Storm Prediction Center {answer}.",
  "wpc.serviceStatus": "Le Weather Prediction Center {answer}",
  "wpc.eroTitle": "Prévision de pluies excessives",
  "wpc.wssiTitle": "Indice de sévérité des tempêtes hivernales",
  "wpc.validWindow": "Valable {window}",
  "wpc.issued": "Émis {when}",
  "wpc.wssiNote":
    "L'impact plutôt que la quantité : ce que cet hiver-là fait à ce lieu-là.",
  "wpc.outlookNote":
    "Une prévision, pas une alerte. Elle dit ce que la journée pourrait apporter, pas ce qui se passe.",
  "spc.outlookDay": "Prévision convective du jour {day}",
  "spc.validBetween": "Valide de {from} à {to} UTC",
  "spc.guidanceNote":
    "Ceci oriente sur ce qui pourrait arriver; ce n'est pas une alerte.",
  "spc.discussion": "Discussion à méso-échelle",
  "spc.issued": "Émise {when}",
  "spc.issuedUnknown": "Heure d'émission inconnue",
  "layer.weatherAlerts": "Alertes météo",
  "layer.earthquakes": "Séismes",
  "layer.wildfires": "Feux de forêt",
  "layer.smoke": "Fumée",
  "layer.forecastSmoke": "Fumée prévue",
  "layer.metar": "Observations en surface",
  "layer.tropical": "Tropical",
  "layer.satellite": "Satellite",
  "satellite.geocolor": "GeoColor",
  "satellite.geocolorDetail":
    "L'image de jour, telle que l'œil la verrait. Elle s'assombrit au-dessus des sommets d'orage la nuit.",
  "satellite.geocolorLegend": "Un rendu, pas une mesure",
  "satellite.cleanIr": "Infrarouge propre",
  "satellite.cleanIrDetail":
    "Bande 13, 10,3 µm. La température de tout ce dont le satellite voit le sommet, qui se lit pareil à minuit et à midi.",
  "satellite.cleanIrLegend":
    "Température de brillance, de −92 à +57 °C, colorée par NASA GIBS",
  "satellite.redVisible": "Visible rouge",
  "satellite.redVisibleDetail":
    "La bande visible à un demi-kilomètre : la vue diurne la plus nette d'un sommet de nuage, et noire la nuit",
  "satellite.redVisibleLegend":
    "Lumière solaire réfléchie, donc éteinte la nuit",
  "satellite.airMass": "Masse d'air",
  "satellite.airMassDetail":
    "Vapeur d'eau et ozone ensemble, là où se voient un courant-jet et une intrusion sèche",
  "satellite.airMassLegend":
    "Un mélange en fausses couleurs, pas une température",
  "satellite.dust": "Poussière",
  "satellite.dustDetail":
    "Poussière et cendres en suspension, distinguées du nuage par leur absorption de l'infrarouge",
  "satellite.dustLegend":
    "Un mélange en fausses couleurs, pas une concentration",
  "satellite.fireTemp": "Température de feu",
  "satellite.fireTempDetail":
    "Les bandes infrarouges à ondes courtes, où un front de feu chaud ressort à travers la fumée",
  "satellite.fireTempLegend":
    "Plus ça brûle chaud, plus c'est clair ; ce n'est pas un périmètre d'incendie",
  "satellite.east": "GOES-Est",
  "satellite.west": "GOES-Ouest",
  "satellite.himawari": "Himawari",
  "satellite.showing": "Affiche {satellite}, qui est au-dessus de cette vue.",
  "satellite.stepped":
    "Le créneau le plus récent n’a pas été publié, voici donc un plus ancien.",
  "satellite.notThere":
    "{satellite} n’a pas de {band} ici, donc voici l’infrarouge propre.",
  "satellite.product": "Vue satellite",
  "layer.rotationTracks": "Traces de rotation",
  "layer.azShear": "Cisaillement azimutal",
  "layer.hail": "Taille de la grêle",
  "layer.vilDensity": "Densité de liquide",
  "layer.shi": "Indice de grêle violente",
  "layer.posh": "Probabilité de grêle",
  "layer.vii": "Glace intégrée",
  "layer.lightningDensity": "Densité de foudre",
  "layer.lightningFlashes": "Éclairs",
  "layer.customOverlay": "Couche personnalisée",
  "panel.search": "Recherche",
  "panel.alerts": "Alertes",
  "panel.tropical": "Panneau tropical",
  "panel.history": "Historique des tempêtes",
  "panel.route": "Trajet",
  "panel.forecast": "Prévisions",
  "panel.export": "Exportation",
  "panel.upload": "Téléversement",
  "panel.layers": "Couches",
  "panel.mapType": "Type de carte",
  "panel.settings": "Réglages",
  "panel.more": "Diagnostics",
  "panel.radarProducts": "Produits radar",
  "panel.nearby": "Météo à proximité",
  "keywords.nearby":
    "accessible lecteur écran mots distance relèvement orages proches",
  "nearby.eyebrow": "Le radar en mots",
  "nearby.title": "Météo à proximité",
  "nearby.intro":
    "Ce que le radar et les alertes disent d'un endroit, pour qui ne regarde pas la carte.",
  "nearby.place": "Autour de",
  "nearby.placeCentre": "Le centre de la carte",
  "nearby.warningsHeading": "Alertes au-dessus de cet endroit",
  "nearby.noWarnings": "Aucune alerte au-dessus de cet endroit.",
  "nearby.warning": "{headline}.",
  "nearby.warningTagged": "{headline}, qualifiée de {tag}.",
  "nearby.warningUntil": "En vigueur jusqu'à {when}.",
  "nearby.cellsHeading": "Orages les plus proches",
  "nearby.noCells": "Le pisteur ne suit aucun orage près de cet endroit.",
  "nearby.cellsOff":
    "Les cellules orageuses sont éteintes, alors il n'y a rien à énumérer. Allumez la couche pour entendre ce que le radar suit.",
  "nearby.cellsUnavailable":
    "Le pistage des orages est lu dans le radar lui-même, ce que seule la version de bureau fait.",
  "nearby.cellsLoading": "Lecture du pisteur du radar.",
  "nearby.cellAt": "{id} est à {distance} vers le {direction}.",
  "nearby.cellMoving": "Se déplace vers le {direction} à {speed}.",
  "nearby.cellNewlyFound":
    "Repérée à l'instant, alors elle n'a pas encore de trajectoire.",
  "nearby.cellRotating": "Le radar y a trouvé de la rotation.",
  "nearby.source": "De {station}, observé {when}.",
  "nearby.nothing": "Rien près de {place} en ce moment.",
  "nearby.keysHeading": "Déplacer la carte sans souris",
  "nearby.keysBody":
    "Tabulez jusqu'à la carte, puis les flèches la déplacent et les touches plus et moins font le zoom. Maintenez Maj avec une flèche pour la faire pivoter ou l'incliner. Rien sur la carte n'exige un glissement.",
  "nearby.announcement": "{headline}. {body}",
  "follow.went": "Amené à {headline}",
  "follow.wentBody":
    "Le suivi des nouvelles alertes est actif. Déplacez la carte et il vous laissera tranquille un moment.",
  "follow.stop": "Cesser de suivre",
  "watch.followNew": "Aller aux nouvelles alertes",
  "watch.followNewDetail":
    "Amener la carte sur une alerte dès qu'elle atteint un endroit surveillé. Déplacer la carte vous-même arrête le vol, et arrête le suivant un moment.",
  "nearby.north": "nord",
  "nearby.northeast": "nord-est",
  "nearby.east": "est",
  "nearby.southeast": "sud-est",
  "nearby.south": "sud",
  "nearby.southwest": "sud-ouest",
  "nearby.west": "ouest",
  "nearby.northwest": "nord-ouest",
  "tool.draw": "Dessiner",
  "tool.range": "Portée",
  "tool.inspect": "Inspecteur",
  "tool.section": "Coupe verticale",
  "section.eyebrow": "Volume Level II",
  "section.title": "Coupe verticale",
  "section.cutting": "Découpe du volume le long de la ligne",
  "section.noSite":
    "Rapprochez-vous d'un site NEXRAD pour trancher son volume.",
  "section.noUnit": "sans unité",
  "section.imageAlt":
    "{product} de {station}, {distance} de large et {top} de haut, dessiné en hauteur selon la distance",
  "section.caption": "{product} ({unit}) · {station}, {site}",
  "section.collected": "Volume recueilli {when}",
  "section.cuts":
    "Dessiné à partir des angles entre {low}° et {high}°, sur les {count} du volume",
  "section.noCuts": "Aucun angle de ce volume n'atteint la ligne.",
  "section.gaps":
    "Les bandes vides sont des hauteurs qu'aucun faisceau n'a traversées, pas une météo absente.",
  "section.unfolded": "La vitesse a été dépliée avant la découpe.",
  "section.palette": "Dessiné avec la table de couleurs chargée.",
  "keywords.hailSwath": "grêle couloir trace dernier jour",
  "keywords.azShear": "cisaillement azimutal mesocyclone couple rotation",
  "keywords.posh": "chance de gros grelons severe",
  "keywords.shi": "energie cinetique witt violente",
  "keywords.vilDensity": "vil colonne metre grelons",
  "keywords.vii": "glace verticalement gelee grelons",
  "keywords.echoTops": "sommets échos hauteur ascendance",
  "keywords.vil": "eau liquide intégrée verticalement",
  "keywords.precipRate": "taux pluie intensité",
  "keywords.qpeHour": "accumulation heure précipitation",
  "keywords.qpeDay": "accumulation jour précipitation",
  "keywords.counties": "limites frontieres etats departements",
  "keywords.gaugeQpe": "cumul multisensor pluie mesuree",
  "keywords.unitStreamflow": "ruissellement debit crue eau",
  "keywords.ffgThreeHour": "seuil crue trois heures rapport",
  "keywords.ffgHour": "seuil crue heure rapport",
  "keywords.spcOutlooks": "perspective convective catégorique jour un",
  "keywords.wpcExcessiveRain": "crue soudaine pluie wpc ero",
  "keywords.wpcWinterSeverity": "wssi neige impact tempete",
  "keywords.spcDiscussions": "discussion méso-échelle court terme",
  "keywords.weatherAlerts": "alerte veille avis tornade violent polygone",
  "keywords.stormCells": "cellule orage trajectoire deplacement arrivee",
  "keywords.classification": "hydrometeore grele neige pluie classification",
  "keywords.probSevere": "violent grele vent tornade",
  "keywords.earthquakes": "seisme tremblement magnitude usgs",
  "keywords.wildfires": "incendie feu perimetre",
  "keywords.smoke": "brume qualité air panache hms",
  "keywords.forecastSmoke": "prevision hrrr modele panache",
  "keywords.metar":
    "metar station aéroport point rosée vent barbule observation",
  "keywords.riverGauges": "rivière crue jauge niveau eau hydrologie inondation",
  "keywords.tropical": "ouragan cyclone cone tempete typhon",
  "keywords.satellite": "satellite nuages image visible infrarouge",
  "keywords.rotationTracks": "mesocyclone rotation cisaillement tornade",
  "keywords.hail": "grelon taille violent",
  "keywords.lightningDensity": "foudre eclair decharge nuage sol",
  "keywords.lightningFlashes": "foudre eclair satellite totale",
  "keywords.windLayer": "vent particules vitesse direction modele",
  "keywords.customOverlay": "couche personnelle importer charger formes",
  "keywords.search": "lieu ville chercher aller a",
  "keywords.alerts": "alerte veille liste",
  "keywords.tropicalPanel": "ouragan tempete bulletin cone",
  "keywords.history": "passe archive reprise trajectoire",
  "keywords.route": "trajet chemin route pluie",
  "keywords.forecast": "meteo prevision temperature pluie",
  "keywords.export": "enregistrer image video partager",
  "keywords.upload": "importer charger palette couleurs",
  "keywords.layers": "couches interrupteurs afficher masquer",
  "keywords.mapType": "carte fond style theme relief",
  "keywords.settings": "options preferences configurer",
  "keywords.more": "etat sante journal version mise a jour sources",
  "keywords.radarProducts": "radar produit composite mosaique niveau deux",
  "keywords.draw": "mesurer trace ligne distance",
  "keywords.range": "distance mesurer jusqu ou milles",
  "keywords.inspect": "valeur point consulter qu est-ce",
  "keywords.reflectivity": "radar pluie",
  "keywords.velocity": "doppler vent rotation vitesse",
  "keywords.spectrumWidth": "turbulence largeur spectrale",
  "keywords.differential": "zdr",
  "keywords.correlation": "cc debris",

  "style.auto": "Suivre le thème",
  "style.autoDetail":
    "Sombre sous l'espace de travail sombre, clair sous le clair",
  "style.grayscale": "Niveaux de gris",
  "style.grayscaleDetail": "Étiquettes discrètes",
  "style.roads": "Routes",
  "style.roadsDetail": "Détail des rues",
  "style.aerial": "Aérienne",
  "style.aerialDetail": "Orthoimagerie de l'USGS, États-Unis",
  "style.topography": "Topographie",
  "style.topographyDetail": "Relief et courbes de niveau",
  "style.radarDark": "Radar sombre",
  "style.radarDarkDetail": "Radar sans éblouissement",
  "style.radarLight": "Radar clair",
  "style.radarLightDetail": "Fond lumineux",
  "style.daylight": "Plein jour",
  "style.daylightDetail": "Grande visibilité",

  "mapType.eyebrow": "Fond de carte et caméra",
  "mapType.title": "Type de carte",
  "mapType.projection": "Projection de la carte",
  "mapType.flat": "Plate",
  "mapType.globe": "Globe",
  "layers.eyebrow": "Information visible",
  "layers.title": "Couches",
  "layers.alertsDetail": "Veilles et alertes officielles",
  "layers.earthquakesDetail":
    "Séismes de magnitude supérieure à 2,5 relevés par l'USGS depuis un jour",
  "layers.wildfiresDetail": "Périmètres du NIFC de plus de 100 acres",
  "layers.smokeDetail":
    "L'analyse tracée à la main par la NOAA, une fois par jour",
  "layers.forecastSmokeDetail":
    "Où le modèle HRRR attend la fumée près du sol, heure par heure le long de la prévision",
  "layers.metarDetail": "Rapports d'aéroport, en modèles de station",
  "layer.riverGauges": "Jauges de rivière",
  "layers.riverGaugesDetail":
    "Ce que lisent les rivières près de l'orage en ce moment, et ce que le bureau de prévision attend d'elles. Points proches seulement, à partir du zoom 7.",
  "rivers.observed": "Niveau observé de {stage} à {when}",
  "rivers.forecast": "Niveau prévu de {stage} d'ici {when}",
  "rivers.noObservation": "Aucune observation courante de cette jauge.",
  "rivers.noForecast": "Aucune prévision courante pour cette jauge.",
  "rivers.timeUnknown": "une heure non précisée",
  "rivers.category": "Crue {category}",
  "rivers.categoryNone": "Sous le seuil de crue",
  "rivers.categoryUnknown":
    "Cette jauge n'a pas de seuils de crue, ou n'en déclare aucun.",
  "rivers.rising":
    "Le bureau s'attend à ce que celle-ci empire par rapport à maintenant.",
  "rivers.office": "Prévision de {office}",
  "rivers.flood.major": "majeure",
  "rivers.flood.moderate": "modérée",
  "rivers.flood.minor": "mineure",
  "rivers.flood.action": "seuil d'intervention",
  "rivers.failed": "Le National Water Prediction Service {answer}.",
  "rivers.zoom": "Rapprochez-vous pour voir les jauges près de l'orage.",
  "rivers.replay":
    "Les niveaux des rivières sont courants, alors ils sont retenus tant qu'une reprise est sur la carte.",
  "sounding.failed": "L'archive d'air en altitude {answer}.",
  "sounding.failedModel": "Le modèle {answer}.",
  "sounding.hereLabel": "Le milieu de la carte",
  "sounding.eyebrow": "Air en altitude",
  "sounding.title": "Radiosondage",
  "sounding.which": "Quel sondage",
  "sounding.observed": "Observé",
  "sounding.forecast": "Prévu",
  "sounding.isObserved": "Un ballon qui est monté",
  "sounding.isForecast": "L'estimation d'une colonne d'air par un modèle",
  "sounding.where": "{place}, {when}",
  "sounding.loadingObserved": "Recherche du ballon le plus proche, {site}",
  "sounding.loadingForecast": "Demande de cette colonne au modèle",
  "sounding.noneObserved":
    "Aucun ballon près d'ici depuis deux jours. Les lâchers en altitude ont lieu deux fois par jour à une petite centaine de sites, alors un endroit loin de l'un d'eux n'a rien à montrer.",
  "sounding.noneForecast": "Le modèle n'a pas de colonne pour ici.",
  "sounding.failedAny": "Le sondage n'a pas pu être lu.",
  "sounding.chartLabel": "Diagramme Skew-T log-P pour {place}",
  "sounding.chartNote":
    "Température et point de rosée en fonction de la pression. Les isothermes penchent vers la droite pour que les deux tracés se séparent; les courbes fines derrière eux sont les adiabatiques sèches, les adiabatiques saturées et le rapport de mélange.",
  "sounding.hodographLabel": "Hodographe du vent dans la colonne",
  "sounding.hodographNote":
    "Le vent des neuf premiers kilomètres, tracé à mesure qu'il tourne. Les anneaux sont espacés de dix nœuds et le point est le sol.",
  "sounding.cape": "CAPE",
  "sounding.cin": "CIN",
  "sounding.lcl": "Base des nuages (LCL)",
  "sounding.lfc": "NCL",
  "sounding.el": "Sommet (EL)",
  "sounding.shear6": "Cisaillement de 0 à 6 km",
  "sounding.freezing": "Niveau de congélation",
  "sounding.water": "Eau précipitable",
  "sounding.none": "Aucun",
  "sounding.assumptions":
    "Calculé ici et non par le bureau : une parcelle soulevée depuis la surface, sèche jusqu'à son niveau de condensation et saturée au-dessus, sans correction de température virtuelle. Un autre logiciel qui prend une parcelle de couche mélangée ou applique cette correction donnera un autre chiffre pour le même air.",
  "sounding.credit": "De {source}.",
  "sounding.mixingNote":
    "Lignes de rapport de mélange, en grammes par kilogramme : {values}.",
  "layers.tropicalDetail":
    "Cônes, trajectoires et perspectives de développement du NHC",
  "layers.satelliteDetail": "GOES-East GeoColor sous le radar",
  "layers.rotationDetail":
    "Cisaillement azimutal de MRMS cumulé sur la période que vous choisissez",
  "layers.rotationPeriod": "Jusqu'où la trace remonte",
  "layers.azShearDetail":
    "Cisaillement azimutal combiné de MRMS tel quel, sans cumul",
  "layers.azShearLevel": "Quelle tranche de l'orage est mesurée",
  "rotationPeriod.30m": "30 min",
  "rotationPeriod.1h": "1 heure",
  "rotationPeriod.2h": "2 heures",
  "rotationPeriod.4h": "4 heures",
  "rotationPeriod.24h": "1 jour",
  "azShearLevel.low": "0 à 2 km",
  "azShearLevel.mid": "3 à 6 km",
  "azShearLevel.midNote":
    "Au-dessus de 10 ici, le mésocyclone est profond, selon la lecture du WDTD.",
  "azShearLevel.lowNote":
    "La tranche sur laquelle s'appuie une alerte de tornade, là où le couple atteint le sol.",
  "layers.hailDetail": "Taille maximale estimée de la grêle, MRMS",
  "layers.vilDensityDetail":
    "Le liquide divisé par l'épaisseur de l'écho, ce qui distingue un orage humide d'un orage de grêle",
  "layers.shiDetail":
    "L'énergie cinétique de la grêle d'où sortent la probabilité et la taille",
  "layers.poshDetail":
    "Probabilité MRMS que la grêle qui atteint le sol soit violente",
  "layers.viiDetail":
    "La quantité de glace que la colonne porte au-dessus du niveau de congélation",
  "layers.lightningDensityDetail":
    "Éclairs nuage-sol MRMS des cinq dernières minutes",
  "layers.lightningFlashesDetail":
    "Foudre totale de GOES-East, éclairs intranuages compris",
  "layers.wind": "Vent",
  "layers.windDetail": "Vent GFS animé à dix mètres",
  "layers.customDetail": "Espace de travail GeoJSON local",
  "mrms.rotation": "Traces de rotation, dernière heure",
  "mrms.rotation30": "Traces de rotation, 30 dernières min",
  "mrms.rotation120": "Traces de rotation, 2 dernières heures",
  "mrms.rotation240": "Traces de rotation, 4 dernières heures",
  "mrms.rotation1440": "Traces de rotation, dernier jour",
  "mrms.azShearLow": "Cisaillement azimutal, 0 à 2 km",
  "mrms.azShearMid": "Cisaillement azimutal, 3 à 6 km",
  "mrms.vilDensity": "Liquide par mètre de colonne",
  "mrms.shi": "Indice de grêle violente",
  "mrms.posh": "Probabilité de grêle violente",
  "mrms.vii": "Glace intégrée verticalement",
  "mrms.mesh": "Taille maximale estimée de la grêle",
  "mrms.echoTops": "Sommets des échos",
  "mrms.vil": "Eau liquide intégrée verticalement",
  "mrms.precipRate": "Taux de pluie",
  "mrms.qpeHour": "Pluie de la dernière heure",
  "mrms.qpeDay": "Pluie du dernier jour",
  "gaugeQpe.72h": "3 jours",
  "gaugeQpe.24h": "1 jour",
  "gaugeQpe.1h": "1 heure",
  "mrms.gaugeQpeThreeDay":
    "Pluie des trois derniers jours, corrigée par les pluviomètres",
  "mrms.gaugeQpeDay": "Pluie du dernier jour, corrigée par les pluviomètres",
  "mrms.gaugeQpeHour":
    "Pluie de la dernière heure, corrigée par les pluviomètres",
  "mrms.unitStreamflow": "Ruissellement modélisé",
  "mrms.ffgThreeHour":
    "Pluie face au seuil de crue soudaine, trois dernières heures",
  "mrms.ffgHour": "Pluie face au seuil de crue soudaine, dernière heure",
  "mrms.hailSwath": "Plus grosse grêle du dernier jour",
  "mrms.lightning": "Foudre nuage-sol, 5 min",
  "mrms.precipType": "Type de précipitation",

  "layers.note":
    "Les interrupteurs de couche s'enregistrent tout de suite et agissent aussitôt sur la carte. Les alertes viennent du NWS, les séismes de l'USGS et les périmètres de feu du NIFC.",
  "settings.eyebrow": "Préférences d'OpenRadar",
  "settings.title": "Réglages",
  "settings.appearance": "Apparence",
  "settings.appliesNow": "S'applique immédiatement",
  "settings.systemColours":
    "Votre système utilise un thème de contraste, c'est donc lui qui choisit les couleurs. Clair et sombre lui appartiennent tant qu'il est actif.",
  "settings.theme": "Thème",
  "settings.dark": "Sombre",
  "settings.light": "Clair",
  "settings.accent": "Couleur d'accent",
  "occasion.spring": "Printemps",
  "occasion.summer": "Été",
  "occasion.autumn": "Automne",
  "occasion.midwinter": "Cœur de l'hiver",
  "occasion.notice":
    "L'espace de travail porte la saison. Rien sur la carte n'a changé.",
  "occasion.notThisYear": "Pas cette année",
  "settings.ambient": "La météo sur l'habillage",
  "settings.ambientDetail":
    "Pluie, neige ou brouillard dessinés sur la barre de commandes tant que la station la plus proche de l'endroit que vous surveillez le rapporte. Jamais par-dessus la carte, et cela s'arrête quand le rapport vieillit",
  "settings.ambientSeen": "Affiche ce que {station} a rapporté à {when}.",
  "settings.ambientQuiet":
    "Rien à dessiner : aucune station proche ne rapporte de temps.",
  "settings.ambientNeedsWatch":
    "Rien n'est dessiné tant que vous ne surveillez pas un endroit : c'est là que la météo est lue.",
  "settings.ambientDropped":
    "Arrêté : cette fenêtre ne suivait pas, alors l'effet s'est retiré. Éteignez-le et rallumez-le pour réessayer.",
  "settings.occasions": "Apparence saisonnière",
  "settings.occasionsDetail":
    "Un changement d'accent pendant quelques semaines par année. Elle n'atteint jamais la carte, et elle se retire tant qu'une alerte est en vigueur là où vous surveillez",
  "settings.accentDetail":
    "La couleur des titres, des interrupteurs et de l'anneau de focus. Elle n'atteint jamais une échelle du radar, le contour d'une alerte ni la trajectoire d'un orage.",
  "settings.themeInForce": "{name} s'applique par-dessus l'apparence intégrée.",
  "settings.themeClear": "Revenir à l'apparence intégrée",
  "settings.themeRemoved": "{name} retiré",
  "settings.themeRemovedBody":
    "L'espace de travail est revenu à l'apparence intégrée.",
  "settings.themeNote":
    "Déposez un fichier de thème sur le panneau Téléversement pour changer plus que la couleur. Un thème atteint l'espace de travail autour de la carte et rien de ce qui s'y trouve.",
  "settings.radar": "Radar composite",
  "settings.baseReflectivity": "Réflectivité de base",
  "settings.opacity": "Opacité",
  "settings.opacityLabel": "Opacité du radar",
  "settings.animationSpeed": "Vitesse d'animation",
  "settings.animationSpeedLabel": "Vitesse d'animation du radar",
  "settings.loopLength": "Durée de la boucle",
  "settings.siteLoopLength": "Durée de la boucle du site",
  "settings.loopLengthLabel": "Durée de la boucle en minutes",
  "settings.siteLoopLengthLabel": "Durée de la boucle du site en volumes",
  "settings.minutes": "{count} min",
  "settings.volumes": "{count, plural, one {# volume} other {# volumes}}",
  "settings.futureRadar": "Radar à venir",
  "settings.futureRadarDetail":
    "Prolonger la boucle avec la réflectivité prévue du modèle HRRR sur les quarante-huit États contigus",
  "settings.showRadar": "Afficher le radar",
  "settings.showRadarDetail":
    "Garder le fond de carte visible quand le radar est masqué",
  "cells.eyebrow": "Cellules orageuses",
  "cells.arriving":
    "{id} atteint l'endroit que vous surveillez dans {count} min",
  "approach.title": "Orage en route vers {place}",
  "approach.titleHome": "Orage qui vient vers vous",
  "approach.body":
    "Le radar suit {id} et calcule qu'il arrive dans environ {count} min. C'est un suivi, pas une alerte.",
  "approach.setting": "Prévenez-moi quand un orage vient par ici",
  "approach.settingDetail":
    "Le radar suit chaque orage et calcule quand il atteint un lieu que vous surveillez. C'est de l'arithmétique sur une tache en mouvement, pas une alerte de qui que ce soit.",
  "approach.window": "Combien de préavis vous voulez",
  "approach.windowMinutes": "{count} min",
  "approach.sound": "Avec un son",
  "approach.soundDetail":
    "Désactivé, parce qu'une alerte en fait déjà un et ceci n'en est pas une.",
  "approach.needsPlace":
    "Il faut un lieu surveillé, puisque c'est là que l'orage irait.",
  "approach.needsCells":
    "Nécessite la couche Cellules orageuses, qui est ce qui les suit.",
  "approach.heading": "En route",
  "approach.row": "{id} atteint {place} dans environ {count} min",
  "approach.rowSoon": "{id} atteint {place} maintenant",
  "approach.note": "Le radar qui suit ces orages, pas une alerte.",
  "lightningWatch.title": "Éclairs près de {place}",
  "lightningWatch.titleHome": "Éclairs près de vous",
  "lightningWatch.body":
    "{count, plural, one {# éclair} other {# éclairs}} dans un rayon de {miles, plural, one {# mille} other {# milles}}. Le satellite voit la lumière au-dessus du nuage, ce n'est donc pas un relevé de ce qui a touché le sol.",
  "lightningWatch.quietTitle": "{place} est calme depuis une demi-heure",
  "lightningWatch.quietTitleHome": "Calme depuis une demi-heure",
  "lightningWatch.quietBody":
    "Aucun éclair dans le rayon depuis trente minutes.",
  "lightningWatch.setting": "Prévenez-moi des éclairs près d'un lieu surveillé",
  "lightningWatch.settingDetail":
    "Compte les éclairs vus par satellite dans un rayon que vous choisissez, et prévient au début et après une demi-heure de calme.",
  "lightningWatch.needsLayer":
    "Nécessite la couche Éclairs, qui est ce qui les lit.",
  "lightningWatch.needsPlace":
    "Il faut un lieu surveillé, puisque c'est autour de lui que porte le rayon.",
  "lightningWatch.radius": "À quelle distance de chaque lieu",
  "lightningWatch.radiusMiles": "{count} mi",
  "lightningWatch.count": "Combien d'éclairs méritent un mot",
  "lightningWatch.countFlashes":
    "{count, plural, one {# éclair} other {# éclairs}}",
  "lightningWatch.sound": "Avec un son",
  "lightningWatch.soundDetail":
    "Désactivé, parce qu'une alerte en fait déjà un et ceci n'en est pas une.",
  "lightningWatch.note":
    "Éclairs détectés par satellite, pas des relevés d'impacts au sol.",
  "approach.none": "Rien de ce que le radar suit ne va vers vos lieux.",
  "cells.arrivingSoon":
    "{id} atteint l'endroit que vous surveillez d'ici une minute",
  "cells.nothingComing": "Rien de ce que le radar suit ne se dirige par là",
  "cells.needsWatch":
    "Choisissez un endroit à surveiller pour être averti quand un orage l'atteint",
  "cells.rotating": "{id} contient de la rotation",
  "cells.none": "Le radar ne suit aucun orage en ce moment",
  "cells.reading": "Lecture des cellules orageuses",
  "cells.count": "{count} suivies",
  "settings.watchedArea": "Zone surveillée",
  "settings.watchedAreaNote": "Les alertes près d'un endroit",
  "settings.tellMe": "M'avertir des alertes",
  "settings.tellMeDetail":
    "Surveiller un point même quand la carte regarde ailleurs",
  "settings.radius": "Rayon",
  "settings.radiusValue": "{distance}",
  "settings.radiusLabel": "Rayon surveillé, en {unit}",
  "settings.watchCentre": "Surveiller le centre de la carte",
  "settings.homeName": "Le nom que vous donnez à chez vous",
  "settings.placeName": "Nom de l'endroit",
  "settings.placeNumber": "Endroit {number}",
  "settings.placeRadius": "Rayon autour de {place}, en {unit}",
  "settings.placeSeverity": "M'avertir de",
  "settings.placeSeverityFor":
    "L'alerte la moins grave qui vaille un avertissement à {place}",
  "settings.removePlace": "Cesser de surveiller {place}",
  "settings.placeRemoved": "{place} n'est plus surveillé",
  "settings.placeRemovedBody":
    "Annuler remet le lieu avec les réglages qu'il avait.",
  "settings.addPlace": "Ajouter le centre de la carte comme endroit",
  "settings.placesFull":
    "Cela fait déjà {count, plural, one {# lieu} other {# lieux}}. Retirez-en un pour en surveiller un autre.",
  "settings.watching": "Surveillance de {lat}, {lon} pour les alertes et pire.",
  "settings.camera": "Où regarde la carte",
  "settings.zoom": "Zoom",
  "settings.bearing": "Orientation",
  "settings.pitch": "Inclinaison",
  "settings.center": "Centre",
  "settings.reset": "Réinitialiser les réglages",

  "bar.label": "Commandes de la carte",
  "bar.compact": "Commandes compactes",
  "bar.location": "Position",
  "bar.locate": "Me localiser",
  "bar.commands": "Commandes",
  "welcome.detail":
    "Commandes cherche par nom chaque produit, endroit et réglage. Couches est l'endroit où vous allumez et éteignez le radar, les alertes, la foudre et le reste.",
  "opening.rain": "de la pluie",
  "opening.snow": "de la neige",
  "opening.fog": "du brouillard",
  "opening.thunder": "un orage",
  "opening.weather": "{station} rapporte {weather}, {when}.",
  "opening.weatherAndAir":
    "{station} rapporte {weather} à {degrees} °, {when}.",
  "opening.quiet": "{station} rapporte que rien ne tombe, {when}.",
  "opening.quietAndAir":
    "{station} rapporte que rien ne tombe, {degrees} °, {when}.",
  "opening.showAgain": "Revoir l'accueil du premier lancement",
  "opening.showAgainDetail":
    "La ligne d'ouverture et le disque radar qui se dessine, une fois de plus, maintenant",
  "bar.commandsDetail":
    "Chaque couche, produit et panneau dans une seule liste",
  "bar.dualPane": "Double volet",
  "bar.share": "Partager",
  "bar.toFlat": "Passer à la carte plate",
  "bar.toGlobe": "Passer au globe",
  "bar.openPreset": "Ouvrir le préréglage {number}",
  "bar.savePreset": "Enregistrer le préréglage {number}",
  "bar.history": "Historique",

  "palette.eyebrow": "Tout, dans une seule liste",
  "palette.title": "Commandes",
  "palette.placeholder": "Essayez méso, grêle ou exporter",
  "palette.label": "Chercher parmi les couches, les produits et les panneaux",
  "palette.on": " · allumé",
  "palette.off": " · éteint",
  "palette.none": "Rien ici ne correspond. Essayez un mot plus court.",
  "legend.hidden": "RADAR MASQUÉ",
  "legend.smoothed": "Lissé entre les portes",
  "legend.scale": "{product} de {min} à {max} {unit}",
  "timeline.label": "Animation du radar",
  "timeline.play": "Lancer l'animation du radar",
  "timeline.pause": "Suspendre l'animation du radar",
  "timeline.frame": "Image radar",
  "timeline.connecting": "Connexion au radar",
  "timeline.frames":
    "{index} sur {total, plural, one {# image radar} other {# images radar}}",
  "timeline.forecastAt": "prévision de {time}",
  "timeline.hrrr": "Sortie HRRR {init}, {lead} min d'avance",
  "timeline.live": "en direct",
  "timeline.historical": "volume d'archive",
  "timeline.goLive": "Revenir au direct",
  "timeline.age": "{age}",
  "zoom.controls": "Commandes de navigation de la carte",
  "zoom.resetNorth": "Remettre le nord et l'inclinaison",
  "zoom.in": "Rapprocher",
  "zoom.out": "Éloigner",

  "panel.close": "Fermer {title}",
  "toast.dismiss": "Écarter la notification",
  "chrome.justIn": "à l'instant",
  "chrome.age": "{age}",
  "chrome.workspaceStatus": "État de l'espace de travail OpenRadar",
  "chrome.workstation": "Poste de travail météo",
  "chrome.radarWorkspace": "Espace de travail radar",
  "chrome.sourceHealthy": "Source en santé",
  "chrome.sourceWaiting": "Source en attente",
  "chrome.sourceIssue": "Source à vérifier",
  "chrome.connecting": "Connexion au radar",
  "chrome.updatedNow": "Mis à jour à l'instant",
  "chrome.updatedAge": "Mis à jour il y a {age}",
  "chrome.standby": "En veille",
  "chrome.toolClear": "Effacer",
  "chrome.toolKeyboard":
    "Appuyez sur Entrée ou Espace pour utiliser cet outil au centre de la carte.",
  "chrome.dwdComposite": "Composite allemand",
  "chrome.rainRate": "Taux de pluie",
  "chrome.composite": "Radar composite",
  "chrome.sweepProduct": "{station} {product}",
  "chrome.tilt": "ANGLE {degrees}°",
  "chrome.tiltHistorical": "ANGLE {degrees}°, ARCHIVE",
  "chrome.tiltLoop": "ANGLE {degrees}° · VOLUME {index} SUR {count}, {time}",
  "chrome.levelTwoLate": "SANS NOUVELLES DEPUIS {age}",
  "chrome.tiltDealiased": "ANGLE {degrees}° · DÉPLIÉ",
  "chrome.tiltLive": "ANGLE {degrees}° · DIRECT, IL Y A {seconds} S",
  "chrome.tiltLiveDealiased":
    "ANGLE {degrees}° · DÉPLIÉ · DIRECT, IL Y A {seconds} S",
  "chrome.liveProduct": "PRODUIT EN DIRECT",
  "chrome.behind": "DERRIÈRE, {count} MIN",
  "chrome.terminalRadar": "TDWR · {range} km",
  "chrome.extraScales": "Échelles des autres produits",
  "chrome.wind": "Vent",
  "chrome.windReduced":
    "Retenu parce que cet appareil demande moins de mouvement.",
  "chrome.windAt10": "Vent à 10 m",
  "chrome.windNote":
    "Orientation d'un modèle, pas une observation. Les particules montrent la direction et la vitesse relative.",
  "chrome.flashes": "Éclairs",
  "chrome.now": "maintenant",
  "chrome.windowMinutes": "{count} min",
  "chrome.flashCount": "{count}{more} de {satellite}",
  "chrome.filesRead":
    " · {read} sur {expected, plural, one {# fichier} other {# fichiers}}",
  "chrome.smokeAnalysed": "analysée {when}",
  "chrome.forecastSmoke": "Fumée prévue",
  "chrome.forecastSmokeValid": "Valide {time}.",
  "chrome.forecastSmokeNote":
    "Ce qu'un modèle attend de la fumée près du sol, jamais dessiné par-dessus l'analyse ni par-dessus quoi que ce soit d'observé.",
  "forecastSmoke.label": "HRRR {hour} +{lead} h · cycle vieux de {age} h",
  "chrome.smokeAnalysedUnknown": "date inconnue",
  "chrome.flashNote":
    "Foudre totale, pas un relevé d'impacts. Fiez-vous aux alertes officielles pour les décisions touchant la sécurité.",
  "chrome.densityNote":
    "Où les éclairs ont frappé, pas où le prochain frappera. Fiez-vous aux alertes officielles pour les décisions touchant la sécurité.",
  "chrome.layerUnit": "{label} ({unit})",
  "wind.label": "GFS {hour}{lead} · vieux de {age} h",
  "wind.lead": " +{hours} h",
  "wind.unknownHour": "inconnue",

  "chrome.stale": "Le radar est périmé · {age}",
  "watch.cannotSee":
    "Cette machine est sans réseau depuis {age}, donc rien n'est surveillé. Les lieux et les réglages sont conservés.",
  "chrome.offline":
    "Hors ligne depuis {age} · affichage de ce qui a été conservé",
  "chrome.cached": "Affichage de la dernière vue",
  "chrome.cachedAge": "Affichage de la dernière vue · {age}",

  "gpu.eyebrow": "OpenRadar ne peut pas dessiner la carte",
  "gpu.title": "Cet ordinateur n'a pas WebGL2.",
  "gpu.body":
    "La carte est dessinée par la carte graphique, et cette fenêtre n'arrive pas à en joindre une. Tout le reste d'OpenRadar dépend de la carte, alors il n'y a rien d'utile à montrer derrière ceci.",
  "gpu.hint":
    "C'est d'ordinaire l'accélération matérielle éteinte, une machine virtuelle sans passage graphique, ou une session de bureau à distance. Rallumer l'accélération matérielle et rouvrir OpenRadar règle la chose.",
  "fatal.eyebrow": "OpenRadar a récupéré la fenêtre",
  "fatal.title": "L'interface n'a pas pu finir de se dessiner.",
  "fatal.reload": "Recharger OpenRadar",
  "fatal.resetLayoutNote":
    "Réinitialiser la disposition remet la carte, le fond de carte, la taille du texte, la couleur d'accentuation, l'ordre des couches et la fenêtre comme à l'ouverture. Vos lieux surveillés, vos palettes, vos paquets hors ligne et vos réglages enregistrés ne sont pas touchés.",
  "fatal.resetLayout": "Réinitialiser la disposition",
  "fatal.copied": "Copié",
  "fatal.copyRefused": "Le presse-papiers a refusé",
  "fatal.copy": "Copier le diagnostic",
  "stage.secondary": "Deuxième carte météo interactive",
  "stage.satelliteAge": " · {age}",
  "stage.satellite": "{satellite} {product}",
  "stage.compare": "Comparer",
  "stage.compareOffset": "De combien le deuxième plan est en retard",
  "stage.compareUnavailable": "Pas assez d'images antérieures",
  "stage.live": "En direct",
  "stage.back": "{count} en arrière",

  "toast.following": "Suivi de {name}",
  "toast.theStorm": "l'orage",
  "toast.stormPreset": "Orage",
  "toast.presetsFull":
    "Toutes les cases de préréglage sont prises, alors cette vue n'a pas été gardée.",
  "toast.keptAs": "Gardée comme préréglage {number}.",
  "toast.globeOn": "Projection en globe activée",
  "toast.flatOn": "Projection plate activée",
  "toast.cameraUnchanged":
    "Votre centre, votre zoom, votre orientation et votre inclinaison n'ont pas changé.",
  "toast.noLocation": "La position n'est pas disponible",
  "toast.searchInstead": "La recherche peut encore déplacer la carte.",
  "toast.finding": "Recherche de votre position",
  "toast.centeredOnYou": "Carte centrée sur votre position",
  "toast.noPermission": "La permission de position n'était pas accordée",
  "toast.nothingChanged": "Rien n'a changé.",
  "toast.centeredOn": "Centrée sur {name}",
  "toast.presetOpened": "{name} ouvert",
  "toast.presetName": "Préréglage {number}",
  "toast.presetSaved": "Préréglage {number} enregistré",
  "toast.undo": "Annuler",
  "toast.paletteCleared": "Table de couleurs retirée",
  "toast.paletteClearedBody":
    "{name} est rangée, et ce produit revient à l'échelle intégrée.",
  "toast.paletteShelvedBody":
    "{name} est rangée. Rien sur la carte ne s'en servait.",
  "toast.paletteFull":
    "Vos tables de couleurs sont pleines à {count}. Retirez-en une pour faire de la place à celle-ci.",
  "toast.replayStopped": "Reprise arrêtée",
  "toast.bundleSaving": "Enregistrement du dossier de reprise",
  "toast.bundleSaved": "Dossier de reprise enregistré",
  "toast.bundleSavedBody":
    "{entries, plural, one {# fichier} other {# fichiers}}, {size} Mo, dans {path}.",
  "toast.bundleMissing":
    "{count} d'entre eux n'ont pas pu être récupérés et sont énumérés dans le dossier.",
  "toast.bundleFailed": "Le dossier de reprise a échoué",
  "toast.bundleOpened": "Reprise de {label} depuis un dossier",
  "toast.bundleOpenedBody":
    "{frames, plural, one {# image conservée} other {# images conservées}} le {made}. Rien n'est demandé pour elles ; le paquet répond.",
  "toast.bundleApplyWorkspace": "Appliquer son espace de travail",
  "toast.bundleWorkspaceApplied":
    "L'espace de travail du dossier est en vigueur",
  "toast.bundleWorkspacePartly":
    "L'espace de travail du dossier est en vigueur, en partie",
  "toast.replayStoppedBody": "La carte est revenue à la boucle en direct.",
  "toast.shareTitle": "Vue OpenRadar",
  "toast.shared": "Vue de la carte partagée",
  "toast.linkCopied": "Lien de la carte copié",
  "toast.linkFailed": "Le lien de la carte n'a pas pu être copié",
  "toast.linkFailedBody":
    "Le presse-papiers a refusé. Le même lien se trouve dans l'adresse que compose le bouton de partage.",
  "toast.show": "Afficher",
  "toast.fileTooBig": "Le fichier dépasse 5 Mo.",
  "toast.paletteEmpty":
    "Cette palette n'a aucune couleur que cette carte peut utiliser.",
  "toast.overlayEmpty": "Ce fichier GeoJSON ne contient aucune entité.",
  "toast.paletteApplied": "{name} appliquée",
  "toast.themeApplied": "{name} est l'apparence maintenant",
  "toast.themeBody":
    "{count, plural, one {# couleur} other {# couleurs}} changées. Rien du radar, des alertes ni des échelles n'a changé.",
  "toast.themeEmpty":
    "Ce fichier de thème ne définit rien que cette version comprend.",
  "toast.remove": "Retirer",
  "toast.colours": "{count, plural, one {# couleur} other {# couleurs}}",
  "toast.forUnits": "pour {units}",
  "toast.leftOut": "{names} laissés de côté",
  "toast.overlayLocal": "La couche reste sur cet appareil.",
  "toast.placefileEmpty":
    "Ce placefile ne contient rien que cette carte peut dessiner.",
  "toast.kmlEmpty": "Ce KML ne contient aucune forme.",
  "toast.shapes": "{count, plural, one {# forme} other {# formes}}",
  "toast.refreshEvery": "il demande à être rafraîchi toutes les {minutes} min",
  "toast.truncated": "le fichier s'est terminé au milieu d'une forme",
  "toast.notGeoJson": "Choisissez un fichier GeoJSON ou un placefile GRLevelX.",
  "toast.tooManyFeatures":
    "Une couche personnalisée peut contenir jusqu'à 5 000 entités.",
  "toast.overlayAdded": "{name} ajoutée",
  "toast.overlayReplaced": "{name} remplacée",
  "toast.overlaySetFull":
    "Vous avez déjà {count, plural, one {# fichier} other {# fichiers}} sur la carte. Retirez-en un dans Couches, puis importez celui-ci.",
  "toast.overlayFailed": "La couche n'a pas pu être ajoutée",
  "toast.unreadable": "Le fichier n'a pas pu être lu.",
  "toast.watching": "Surveillance de ce point",
  "toast.placesFull": "C'est là tous les endroits",
  "toast.placeAdded": "Surveillance de {place}",
  "toast.watchingDetail": "Les alertes à proximité vous interrompront.",
  "toast.logsFailed": "Le dossier des journaux n'a pas pu être ouvert",
  "toast.logsDesktop":
    "Les journaux ne sont écrits que par l'application de bureau.",
  "toast.settingsReset": "Réglages réinitialisés",
  "toast.sharedViewOpened": "Vue partagée ouverte",

  "popup.alert": "Alerte météo",
  "popup.issued": "Émise {when}",
  "popup.expires": "Expire {when}",
  "popup.alertSource": "Source : NWS {office}",
  "popup.alertOffice": "veilles et alertes",
  "popup.magnitude": "M {value} {place}",
  "popup.recorded": "Enregistré {when}",
  "popup.timeUnknown": "Heure inconnue",
  "popup.depth": "Profondeur de {km} km",
  "popup.depthUnknown": "Profondeur inconnue",
  "popup.usgs": "Source : USGS",
  "popup.wildfire": "Feu de forêt",
  "popup.acres":
    "{acres, plural, one {# acre} other {# acres}}, {contained} % maîtrisé",
  "popup.sizeUnknown": "Superficie inconnue",
  "popup.perimeterUpdated": "Périmètre mis à jour {when}",
  "popup.perimeterUnknown": "Date du périmètre inconnue",
  "popup.nifc": "Source : NIFC WFIGS",
  "smoke.light": "Fumée légère",
  "smoke.medium": "Fumée moyenne",
  "smoke.heavy": "Fumée dense",
  "smoke.analysed": "Analysée {when}.",
  "smoke.analysedUnknown": "La date de l'analyse ne figure pas au fichier.",
  "smoke.clear":
    "Les analystes n'ont trouvé de fumée nulle part aujourd'hui. Voici le fichier du jour, et il est vide.",
  "smoke.note":
    "Tracée par un analyste de la NOAA à partir de l'imagerie satellite, une fois par jour. C'est où la fumée était, pas ce que vaut l'air au sol.",
  "metar.observed": "Observé {when}.",
  "metar.observedUnknown": "Le rapport ne porte aucune heure.",
  "metar.air": "{temp}{unit}, point de rosée {dewp}{unit}.",
  "metar.wind": "Vent du {direction} degrés à {knots} nœuds.",
  "metar.windVariable": "Vent de direction variable à {knots} nœuds.",
  "metar.windVariableGusting":
    "Vent de direction variable à {knots} nœuds, rafales à {gust}.",
  "metar.windGusting":
    "Vent du {direction} degrés à {knots} nœuds, rafales à {gust}.",
  "metar.calm": "Calme.",
  "metar.station": "Observation en surface",
  "metar.source": "Source : NOAA Aviation Weather Center.",
  "metar.zoom": "Rapprochez-vous pour voir les modèles de station.",
  "popup.tropicalBasin": "Tropical",
  "popup.outlookTitle": "Perspective {basin}",
  "popup.twoDay": "Risque sur deux jours {chance} ({risk})",
  "popup.sevenDay": "Risque sur sept jours {chance} ({risk})",
  "popup.unknown": "inconnu",
  "popup.nhc": "Source : NOAA National Hurricane Center",
  "popup.sustained": "{category}, {knots} nœuds soutenus",
  "popup.advisory": "Bulletin {number}",
  "popup.tropicalSystem": "Système tropical",

  "update.notInstalled":
    "La version que vous avez continue de fonctionner. Réessayez depuis Diagnostic.",
  "update.notInstalledTitle": "La mise à jour ne s'est pas installée",
  "update.upToDate": "OpenRadar est à jour",
  "update.available": "OpenRadar {version} est disponible",
  "update.installFrom": "Installez-la depuis Diagnostics.",
  "update.checkFailed": "La recherche de mise à jour a échoué.",
  "update.notOffered": "La mise à jour n'est plus offerte.",
  "export.radar": "Radar",
  "export.volumeLate":
    "Le volume d'une image n'est pas arrivé à temps ; l'image précédente a été enregistrée.",
  "export.hrrr": "HRRR, à {minutes} min",
  "export.saved": "{name} enregistré",
  "export.downloads": "Regardez dans votre dossier de téléchargements.",
  "export.show": "Afficher",
  "export.failed": "L'exportation a échoué",
  "export.imageFailed": "L'image n'a pas pu être exportée",
  "export.imageFailedBody":
    "La carte est toujours à l'écran. Réessayez une fois qu'elle a fini de se dessiner.",
  "export.loopFailed": "La boucle n'a pas pu être exportée",
  "export.nothingWritten": "Rien n'a été écrit.",
  "export.noCanvas": "Cet affichage ne peut pas produire une exportation.",
  "export.notEncoded": "L'image n'a pas pu être encodée.",
  "export.noVideo": "Cette version ne peut pas enregistrer de vidéo.",
  "export.noMp4":
    "Cette version n'a pas d'encodeur H.264, elle ne peut donc pas écrire de MP4.",
  "export.mp4Reordered":
    "L'encodeur H.264 de cette machine réordonne les images, que cette version ne peut pas empaqueter. L'export WebM fonctionne toujours.",
  "export.mp4Missing":
    "Pas d'encodeur H.264 ici. Le WebM ci-dessus fonctionne toujours.",
  "export.noFrames": "Il n'y a aucune image à enregistrer.",
  "export.tooLarge": "L'enregistrement dépasse 20 Mo.",
  "export.empty": "L'enregistrement est ressorti vide.",
  "export.slowPath": "Enregistrement de la boucle par la voie lente",
  "export.slowPathBody":
    "Cette version ne peut pas encoder la vidéo directement, alors la boucle est enregistrée pendant qu'elle joue. Cela prendra à peu près le temps de la boucle elle-même.",
  "watch.whyEvent": "Une alerte {event}, cotée {severity}.",
  "watch.whyThreshold":
    "Vous avez demandé à être averti à partir de {minSeverity}.",
  "watch.whyDistance":
    "Elle est arrivée à {miles} {unit} de votre point, dans les {radius} {unit} que vous surveillez.",
  "watch.whyUpgraded":
    "Vous avez déjà été averti de celle-ci. Le bureau a relevé la menace de dommages depuis.",
  "watch.testHeadline": "Alerte de test",
  "watch.quiet": "Heures de silence",
  "watch.home": "Domicile",
  "catchUp.title": "Pendant votre absence",
  "catchUp.away":
    "OpenRadar est resté fermé {away}. Voici ce que le relevé garde de cette période, aux lieux que vous avez nommés.",
  "catchUp.awayHours": "{hours, plural, one {# heure} other {# heures}}",
  "catchUp.awayDays": "{days, plural, one {# jour} other {# jours}}",
  "catchUp.quiet": "Rien ne s'est passé chez vous pendant votre absence.",
  "catchUp.more":
    "Il y en a {count, plural, one {# autre} other {# autres}} dans votre relevé.",
  "catchUp.line": "{place} · {when}",
  "catchUp.dismiss": "Merci",
  "catchUp.open": "Ouvrir le relevé",
  "catchUp.setting": "Me dire ce qui s'est passé pendant mon absence",
  "catchUp.settingDetail":
    "Lu dans votre propre relevé au lancement, après quelques heures d'absence. Rien n'est demandé à un service pour y répondre, et chaque ligne porte l'heure à laquelle cela est arrivé.",
  "recap.credits":
    "Fait à partir de votre propre relevé. Relevés de {sources}. Créé avec OpenRadar.",
  "recap.title": "Votre année de météo",
  "recap.note":
    "Fait ici, à partir de votre propre relevé, et jamais de quoi que ce soit recueilli à votre sujet.",
  "recap.period": "Du {from} au {to}",
  "recap.coveredWhole":
    "Votre relevé couvre {period, plural, one {le seul jour} other {les {period} jours}}.",
  "recap.began":
    "La plus ancienne chose que votre relevé garde encore date du {when}, ce qui remonte {days, plural, one {# jour} other {# jours}} sur ces {period, plural, one {# jour} other {# jours}}. Avant cela rien n'est conservé, ce qui ne veut pas dire qu'il ne s'est rien passé.",
  "recap.counted":
    "{alerts, plural, one {# alerte} other {# alertes}} et {observations, plural, one {# observation} other {# observations}}.",
  "recap.days":
    "Quelque chose a été noté sur {days, plural, one {# jour} other {# jours}}. Un jour sans rien était un jour calme ou un jour où l'application était fermée, et le relevé ne fait pas la différence.",
  "recap.busiest":
    "Le jour le plus chargé a été le {when}, avec {rows, plural, one {# enregistrement} other {# enregistrements}}.",
  "recap.place":
    "{place} : {alerts, plural, one {# alerte} other {# alertes}}, {observations, plural, one {# observation} other {# observations}}.",
  "recap.placesHidden":
    "Sur {count, plural, one {# lieu} other {# lieux}}, non nommés ici.",
  "recap.includePlaces": "Mettre les noms des lieux sur l'image",
  "recap.includePlacesDetail":
    "Désactivé par défaut. Où vous habitez n'a pas à figurer sur une image.",
  "recap.save": "L'enregistrer comme image",
  "recap.empty": "Il n'y a encore rien de cette période dans votre relevé.",
  "recap.span": "Sur combien de temps",
  "recap.spanDays":
    "{days, plural, one {Le dernier jour} other {Les # derniers jours}}",
  "recap.spanYear": "La dernière année",
  "journal.countShown":
    "{shown} sur {count, plural, one {# ligne} other {# lignes}}",
  "curiosity.title": "Un endroit qui vaut le détour",
  "curiosity.dismiss": "Fermer",
  "curiosity.setting": "Laisser la carte garder des choses à trouver",
  "curiosity.settingDetail":
    "Un petit ensemble de lieux réels où le temps a marqué l'histoire, chacun avec le service qui a publié le récit. Rien ne les signale et rien n'est compté ; on en trouve un en allant regarder cette partie du monde.",
  "curiosity.found": "Les lieux que vous avez trouvés",
  "curiosity.foundEmpty": "Rien de trouvé pour l'instant.",
  "curiosity.forget": "Les oublier",
  "figures.title": "Ce que garde votre relevé",
  "figures.note":
    "Compté à partir du fichier de cette machine, et de nulle part ailleurs. Rien ici n'est une série ni un objectif, et rien n'en est jamais annoncé.",
  "figures.rows":
    "Entre le {from} et le {to}, votre relevé a gardé {rows, plural, one {# ligne} other {# lignes}} : {alerts, plural, one {# alerte} other {# alertes}} et {observations, plural, one {# observation} other {# observations}}.",
  "figures.places":
    "Sur cette période il connaît {places, plural, one {# lieu que vous avez nommé} other {# lieux que vous avez nommés}}.",
  "figures.period":
    "Quelque chose a été noté sur {days, plural, one {# de ces jours} other {# de ces jours}}.",
  "figures.paused":
    "Rien de nouveau n'est ajouté : le relevé est désactivé. Ce qui est là reste jusqu'à ce que vous l'effaciez.",
  "figures.off": "Le relevé est désactivé, il n'y a donc rien à compter.",
  "settings.journalWriting": "Noter ce que le temps fait chez vous",
  "settings.journalWritingDetail":
    "Le désactiver arrête les nouvelles lignes à partir de maintenant. Cela n'efface pas ce qui est déjà là ; c'est le bouton ci-dessous qui le fait.",
  "nearby.nameCell": "Comment vous appelez l'orage {id}",
  "nearby.nameCellPlaceholder": "Donnez-lui un nom",
  "journal.namedCellPassed":
    "{name}, l'orage que le radar appelait {id}, est passé à {distance}",
  "calm.setting": "Une façon plus calme de le lire",
  "calm.settingDetail":
    "Baisse le ton de l'application, jamais celui du temps. Les alertes arrivent au même moment, par le même chemin, dans les couleurs que publie le service. Ce qui se tait, c'est le décor autour : les accents, l'habillage saisonnier, les effets. Les couches de probabilité démarrent éteintes et reviennent d'une pression.",
  "calm.advice.tornado":
    "Descendez à l'étage le plus bas, au centre du bâtiment, loin des fenêtres. Prenez de quoi vous couvrir la tête.",
  "calm.advice.thunderstorm":
    "Rentrez et quittez la terrasse. Éloignez-vous des fenêtres jusqu'à ce que ce soit passé.",
  "calm.advice.flood":
    "Gagnez un terrain plus haut. N'engagez pas la voiture dans l'eau sur une route, quel que soit son aspect.",
  "calm.advice.winter":
    "Restez chez vous si vous le pouvez. Si vous devez sortir, dites à quelqu'un où vous allez et prenez des vêtements chauds.",
  "calm.advice.tropical":
    "Suivez ce que disent les autorités locales. Si elles ont dit de partir, partez maintenant.",
  "calm.advice.heat":
    "Restez à l'abri du soleil, buvez de l'eau, et prenez des nouvelles de qui vit seul.",
  "calm.advice.fire":
    "Soyez prêt à partir. Gardez ensemble vos clés, votre téléphone et vos médicaments.",
  "calm.advice.general":
    "Lisez ce que dit le service dans l'alerte elle-même et suivez ce que vous disent les autorités locales.",
  "calm.advice.tsunami":
    "Gagnez les hauteurs ou éloignez-vous le plus possible de la côte, à pied si les routes sont encombrées. Ne descendez pas et n'attendez pas de voir l'eau.",
  "calm.advice.evacuate":
    "Partez maintenant, par l'itinéraire indiqué par les autorités locales. Prenez vos clés, votre téléphone et vos médicaments.",
  "calm.advice.shelterInPlace":
    "Rentrez, fermez portes et fenêtres, et coupez ce qui fait entrer l'air de dehors. Restez-y jusqu'à ce qu'on vous dise que c'est fini.",
  "calm.advice.civil":
    "Faites exactement ce que disent les autorités locales, et faites-le tout de suite.",
  "calm.advice.surf":
    "Restez hors de l'eau et à l'écart des rochers et des jetées. Ces vagues emportent les gens depuis la terre ferme.",
  "calm.what": "Ce qu'il faut faire",
  "postcard.notOfficial":
    "Créé avec OpenRadar. Ce n'est pas un produit officiel ni une source d'alertes : c'est le service qui les émet.",
  "postcard.title": "Envoyez-la à quelqu'un",
  "postcard.note":
    "Une carte composée plutôt que l'image simple. L'heure, les crédits et cette ligne figurent sur chacune, quoi que vous écriviez :",
  "postcard.caption": "Écrivez quelque chose dessus",
  "postcard.captionPlaceholder":
    "De la grêle grosse comme des billes, et plus de courant depuis neuf heures.",
  "postcard.includePlace": "Mettre le nom du lieu",
  "postcard.save": "Enregistrer la carte",
  "postcard.size.square": "Carrée",
  "postcard.size.wide": "Large",
  "postcard.size.tall": "Haute",
  "postcard.sizeLabel": "Format",
  "ambientScreen.age":
    "{source} · {minutes, plural, one {# minute} other {# minutes}}",
  "ambientScreen.setting": "Vue plein écran pour un second moniteur",
  "ambientScreen.settingDetail":
    "La carte sans rien d'autre dessus, une horloge et ce qu'elle montre. La boucle continue et ralentit quand personne ne touche à rien pendant un moment, pour qu'un écran laissé allumé la nuit ne demande pas une image par minute. Une alerte là où vous surveillez la referme et rend l'espace de travail.",
  "ambientScreen.leave": "Quitter la vue plein écran",
  "ambientScreen.idle": "Y entrer seule après",
  "ambientScreen.idleOff": "Jamais",
  "ambientScreen.idleMinutes":
    "{minutes, plural, one {# minute} other {# minutes}}",
  "command.ambientScreen": "Vue plein écran",
  "glance.waiting": "En attente de la carte.",
  "glance.picture": "La carte telle que l'espace de travail l'a dessinée",
  "glance.warning": "Une alerte est en cours là où vous surveillez",
  "glance.quiet": "Rien en cours là où vous surveillez",
  "glance.updated": "À {when}",
  "glance.setting": "Une petite fenêtre qui reste où vous la mettez",
  "glance.settingDetail":
    "Le lieu que vous surveillez, s'il y a une alerte, et une image fixe de la carte. Elle montre ce que l'espace de travail a déjà dessiné plutôt que de le redessiner, la laisser ouverte ne coûte donc presque rien. Elle s'ouvre depuis la zone de notification.",
  "glance.onTop": "Garder la petite fenêtre au-dessus de tout",
  "tray.menuOpen": "Ouvrir OpenRadar",
  "tray.menuGlance": "Petite fenêtre",
  "tray.menuQuit": "Quitter",
  "tray.quiet": "OpenRadar",
  "tray.warning": "OpenRadar : une alerte est en cours la ou vous surveillez",
  "tray.unreachable": "OpenRadar : la surveillance n'atteint pas le service",
  "autostart.setting": "Démarrer avec Windows",
  "autostart.settingDetail":
    "S'ouvre dans la zone de notification à l'ouverture de session, pour que les lieux surveillés le soient dès que la machine est allumée.",
  "autostart.needsTray":
    "Nécessite l'icône de la zone de notification, puisque c'est là que ça s'ouvre.",
  "autostart.unavailable":
    "Cette version ne peut pas interroger Windows sur le démarrage automatique.",
  "tray.setting": "Mettre une icône dans la zone de notification",
  "tray.settingDetail":
    "L'icône dit une chose : s'il y a une alerte à un lieu que vous avez nommé. La désactiver la retire, elle ne la cache pas.",
  "tray.closeToTray":
    "Fermer la fenêtre la laisse dans la zone de notification",
  "tray.closeToTrayDetail":
    "Désactivé, parce qu'une application qui continue après qu'on l'a fermée est une application qu'on désinstalle. Activé, l'icône est le chemin du retour.",
  "wallpaper.setting": "Mettre la vue actuelle sur le bureau",
  "wallpaper.settingDetail":
    "Une image composée de la carte derrière ce sur quoi vous travaillez, avec l'heure, la source et son propre âge inscrits dessus, actualisée à l'intervalle que vous choisissez. Elle écrit un fichier dans le dossier de l'application et nulle part ailleurs, et la désactiver remet votre fond d'écran. Windows seulement pour l'instant.",
  "wallpaper.every": "À quelle fréquence",
  "wallpaper.never": "Jamais",
  "wallpaper.everyMinutes":
    "{minutes, plural, one {Chaque minute} other {Toutes les # minutes}}",
  "wallpaper.unavailable":
    "C'est une affaire Windows pour l'instant, il n'y a donc rien à activer ici.",
  "wallpaper.failed": "Le fond d'écran n'a pas pu être écrit",
  "wallpaper.failedDetail":
    "Votre propre fond d'écran est intact. OpenRadar réessaiera au prochain tour.",
  "wallpaper.age":
    "{minutes, plural, one {il y a # minute} other {il y a # minutes}}",
  "journal.title": "Votre registre",
  "journal.count": "{count, plural, one {# ligne} other {# lignes}}",
  "journal.note":
    "Ce que le temps a fait aux lieux que vous avez nommés. Uniquement des lieux nommés, uniquement des observations et des événements, et jamais rien sur votre usage de l'application. Conservé {days, plural, one {# jour} other {# jours}} ou {size} Mo, selon ce qui s'épuise en premier, le plus ancien partant d'abord, avec jusqu'à {pictures} Mo d'images à côté. Cela reste sur cette machine et ne figure pas dans le rapport de diagnostic.",
  "journal.empty": "Rien de consigné pour le moment.",
  "journal.desktopOnly": "Le registre est tenu par l'application de bureau.",
  "journal.row": "{source}, {when} · {obtained}",
  "journal.export": "Enregistrer le registre dans un fichier",
  "journal.clear": "Tout supprimer",
  "journal.undated": "une heure non précisée",
  "journal.rowRemoved": "Ligne supprimée",
  "journal.undoBody": "Les images ne reviennent pas, seulement les lignes.",
  "journal.cleared": "Registre supprimé",
  "journal.failed": "Le registre n'a pas pu être écrit.",
  "journal.saved": "Registre enregistré",
  "journal.sourceNws": "NWS",
  "journal.obtainedWatch":
    "une alerte qui a atteint un endroit que vous surveillez",
  "journal.obtainedStation":
    "un rapport de station près d'un endroit que vous surveillez",
  "journal.search": "Chercher dans le relevé",
  "journal.kind": "De quel type",
  "journal.kindAny": "Alertes et observations",
  "journal.kindAlert": "Alertes",
  "journal.kindObservation": "Observations",
  "journal.since": "Jusqu'où en arrière",
  "journal.sinceAny": "Tout ce qui est conservé",
  "journal.sinceDays":
    "{days, plural, one {Le dernier jour} other {Les # derniers jours}}",
  "journal.noneMatch": "Rien dans le relevé ne correspond à cela.",
  "journal.picture": "La carte au moment où {text} a été noté",
  "journal.noteLabel": "Ce dont vous vous souvenez",
  "journal.notePlaceholder":
    "De la grêle grosse comme des billes, et le courant a sauté à neuf heures.",
  "journal.noteAdd": "Écrire quelque chose",
  "journal.noteEdit": "Modifier ce que vous avez écrit",
  "journal.noteSave": "Le garder",
  "journal.noteDiscard": "Le laisser tel quel",
  "journal.removeRow": "Supprimer cette ligne",
  "journal.exportHeading": "Ce que le temps a fait chez vous",
  "journal.obtainedCells":
    "un orage suivi passant près d'un lieu que vous surveillez",
  "journal.cellPassed": "L'orage suivi {id} est passé à {distance}",
  "watch.goHome": "Revenir chez soi",
  "watch.atPlace": "À {place}.",
  "watch.atPlaces": "À {places}.",
  "watch.quietDetail":
    "Retenir les alertes ordinaires pendant la nuit. Tout ce qui atteint la gravité que vous choisissez passe quand même.",
  "watch.quietFrom": "De",
  "watch.quietUntil": "À",
  "watch.quietOverride": "Toujours me réveiller pour",
  "watch.sendTest": "Envoyer une alerte de test",
  "watch.sendTestDetail":
    "Lève une notification inoffensive, et la tonalité si elle est active, pour que vous sachiez à quoi vous attendre.",
  "watch.testSent": "Alerte de test envoyée",
  "watch.testSentBody":
    "Si rien n'est apparu, Windows retient peut-être les notifications de cette application.",
  "watch.alert": "Alerte météo",
  "watch.here": "là où vous surveillez",
  "watch.milesAway": "à {miles} {unit} du point que vous surveillez",
  "watch.body": "{headline} {where}.",
  "watch.failed": "La surveillance n'atteint pas le service",
  "watch.failedBody":
    "Trois vérifications de suite ont échoué, donc une alerte là où vous surveillez pourrait ne pas arriver. Elle continue d'essayer.",
  "watch.recovered": "La surveillance atteint de nouveau le service",
  "watch.recoveredBody":
    "Les vérifications répondent de nouveau. Rien de toujours en cours n'a été manqué.",
  "watch.lastChecked": "Vérifié il y a {age}",
  "watch.notReaching": "Les vérifications échouent depuis {age}",
  "guidance.gfs": "GFS",
  "guidance.ecmwf": "ECMWF",
  "guidance.icon": "ICON",
  "guidance.gem": "GEM",
  "guidance.noModels": "Choisissez au moins un modèle.",
  "guidance.keepTwo":
    "Gardez au moins deux modèles choisis pour une comparaison utile.",
  "guidance.failed": "Le service d'orientation {answer}.",
  "tides.stationsFailed": "La liste des stations de marée n'a pas pu être lue.",
  "tides.failed": "Le service des marées {answer}.",
  "surge.category1": "Catégorie 1",
  "surge.category2": "Catégorie 2",
  "surge.category3": "Catégorie 3",
  "surge.category4": "Catégorie 4",
  "surge.category5": "Catégorie 5",
  "surge.upTo": "jusqu'à {depth}",
  "surge.over": "plus de {depth}",

  "layer.surge": "Risque d'onde de tempête",
  "layers.surgeDetail":
    "Jusqu'où l'eau pourrait monter avec un ouragan de cette force",
  "layers.surgeCategory": "Force de l'ouragan",
  "layers.surgeNote":
    "Ce n'est pas une prévision. La NOAA a simulé des milliers d'ouragans sur chaque tronçon de côte et a gardé la pire montée d'eau de chacun, à marée haute. Pour une tempête qui s'en vient vraiment, lisez le National Hurricane Center.",
  "keywords.surge": "onde submersion cote eau ouragan",

  "guidance.eyebrow": "Orientation des modèles",
  "guidance.title": "Orientation",
  "guidance.models": "Modèles",
  "guidance.model": "Modèle",
  "guidance.temperature": "Température",
  "guidance.precipitation": "Précipitations",
  "guidance.wind": "Vent",
  "guidance.loading": "Lecture des modèles",
  "guidance.failedTitle": "Les modèles n'ont pas pu être lus",
  "guidance.unknown": "La demande d'orientation a échoué.",
  "guidance.noValue": "—",
  "guidance.compare": "Comparer avec la sortie d'hier",
  "guidance.compareDetail":
    "Ce que chaque modèle disait de ces mêmes heures il y a un jour, et de combien il a bougé depuis",
  "guidance.runAt":
    "{model} a tourné pour la dernière fois {when}, il y a {hours} h",
  "guidance.runUnknown":
    "{model} n'a pas dit quand il a tourné la dernière fois",
  "guidance.runStale": "· plus vieux que son propre horaire",
  "guidance.noPrevious": "aucune sortie antérieure",
  "guidance.agree": "ils s'entendent, en {unit}",
  "guidance.disagree": "ils divergent, en {unit}",
  "guidance.note":
    "Chaque colonne est la sortie d'un seul modèle pour le milieu de la carte, et non un mélange. Là où ils divergent, aucun ne sait encore.",
  "tides.eyebrow": "Station de marée la plus proche",
  "tides.title": "Marées",
  "tides.loading": "Recherche de la station la plus proche",
  "tides.inlandTitle": "Aucune station près de cette vue",
  "tides.inlandBody":
    "La plus proche est à plus de {distance}, ce qui ne dit rien de l'eau ici.",
  "tides.failedTitle": "La marée n'a pas pu être lue",
  "tides.unknown": "La demande de marée a échoué.",
  "tides.stationWithState": "{name}, {state}",
  "tides.distance": "à {miles} {unit} du milieu de la carte",
  "tides.rising": "montante",
  "tides.falling": "descendante",
  "tides.high": "Haute",
  "tides.low": "Basse",
  "tides.noneLeft": "Plus rien dans les trois prochains jours.",
  "tides.note":
    "Prédictions de la NOAA CO-OPS, en pieds au-dessus du niveau des plus basses mers, affichées dans votre fuseau horaire. L'onde de tempête s'ajoute par-dessus, alors une tempête qui arrive à marée haute monte plus loin.",
  "panel.guidance": "Orientation",
  "panel.sounding": "Radiosondage",
  "keywords.sounding":
    "skew-t skewt hodographe raob ballon air altitude cape cisaillement inversion",
  "panel.tides": "Marées",
  "keywords.guidance": "modeles ensemble comparer gfs ecmwf",
  "keywords.tides": "maree haute basse cote eau",

  "radar.unavailable": "Radar temporairement indisponible",
  "radar.requestFailed": "La demande au radar a échoué",
  "radar.waiting": "En attente du radar",
  "radar.budgetReached": "Trop de demandes, on patiente un moment",
  "radar.noFrames": "Aucune image n'a été publiée.",
  "radar.noProvider": "Aucune source radar n'a répondu.",
  "radar.noTimes": "Aucune heure radar n'a été publiée.",
  "radar.rainviewerEmpty": "RainViewer n'a retourné aucune image utilisable.",
  "radar.requestFailedShort": "La demande a échoué.",
  "radar.noRun": "La prévision n'a pas encore publié de nouvelle sortie.",
  "radar.archive": "Archive radar de l'Iowa State",
  "replay.title": "Reprise de {name} {year}",
  "replay.atLandfall":
    "Radar d'archive autour de l'arrivée sur les terres. Fermez pour revenir au direct.",
  "replay.atClosest":
    "Radar d'archive autour de son approche la plus proche. Fermez pour revenir au direct.",
  "app.dualPaneOpened": "Double volet ouvert",
  "app.dualPaneClosed": "Double volet fermé",
  "app.settingsNotSaved": "Les réglages n'ont pas été enregistrés",
  "app.preparing": "Préparation de la carte",
  "app.settingsNotSavedBody":
    "La fenêtre actuelle se sert quand même de vos changements.",
  "app.savedView": "Vue enregistrée",
  "popup.importedShape": "Forme importée",
  "popup.openProduct": "Ouvrir le produit officiel",
  "pairing.rainfall": "Montrer la pluie tombée",
  "pairing.rainfallDay": "Montrer la pluie de la journée",
  "pairing.velocity": "Montrer le vent dans l'orage",
  "pairing.hail": "Montrer la taille de la grêle",
  "pairing.precipType": "Montrer ce qui tombe",
  "pairing.surge": "Montrer l'onde de tempête",
  "pairing.smoke": "Montrer les feux et la fumée",
  "pairing.shown": "{layer} est allumée",
  "pairing.shownBody":
    "Allumée pour expliquer l'alerte. Rien d'autre n'a changé.",
  "map.label": "Carte météo interactive",
  "weather.incomplete": "La prévision est arrivée avec des morceaux manquants.",
  "route.noRoad": "Aucune route ne relie ces deux endroits.",
  "wind.noDraw":
    "La couche de vent n'a pas pu être dessinée sur cette carte graphique.",
  "tool.drawHint": "Cliquez la carte pour tracer un chemin",
  "tool.startHint": "Choisissez le point de départ",
  "tool.endHint": "Choisissez le point d'arrivée",
  "tool.inspectAt": "{lat}°, {lon}° · zoom {zoom}",
  "tool.gateValue": "{value} {unit}",
  "tool.gateLive": "du balayage en cours, {when}",
  "tool.gateFrom": "du balayage de {when}",
  "tool.beamHeight": "faisceau à {height} au-dessus du radar, angle {tilt}°",
  "tool.classified": "{class} selon la classification du radar",
  "tool.pathPoints":
    "{count, plural, one {# point} other {# points}} sur le tracé",
  "tool.rangeResult": "{distance}",
  "tool.inspectHint": "Cliquez la carte pour inspecter un point",
  "tool.sectionStartHint":
    "Cliquez une extrémité de la coupe, à portée du radar",
  "tool.sectionEndHint": "Cliquez l'autre extrémité de la coupe",
  "tool.sectionTaken": "Découpe du volume le long de la ligne",
};
