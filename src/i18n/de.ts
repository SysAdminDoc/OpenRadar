/**
 * The workspace in German.
 *
 * Typed against `en.ts`, so this file cannot fall behind without the build
 * saying so. The app already draws the Deutscher Wetterdienst's composite and
 * its warnings, and the vocabulary follows the words those products use:
 * Warnung for a warning, Vorwarnung for a watch, Amt for the office that
 * issues them.
 *
 * German is a long language and this workspace is a dense one, so a label
 * takes the shortest word that is still the right word rather than the
 * literal translation of the English. "Elevationswinkel" is what a radar
 * person says for tilt; "Kartenmitte" is one word where English needs two.
 *
 * The safety copy is translated as carefully as the rest and no more
 * cautiously: this app is not a warning source in any language, and the
 * German says exactly that rather than softening it.
 *
 * A German reader gets metric units and comma decimals by default, which
 * `unitsForLanguage` and `locale` decide rather than anything in here.
 */
import type { Catalogue } from "./en";

export const de: Catalogue = {
  "export.eyebrow": "Nehmen Sie sie mit",
  "export.title": "Exportieren",
  "export.image": "Bild exportieren",
  "export.keys": "Legenden der Ebenen ins Bild setzen",
  "export.keysDetail":
    "{count, plural, one {Die Skala der einen abgestuften Ebene auf dem Bildschirm läuft am rechten Rand von allem entlang, was Sie speichern.} other {Die Skalen der # abgestuften Ebenen auf dem Bildschirm laufen am rechten Rand von allem entlang, was Sie speichern.}}",
  "export.loop": "Schleife exportieren (WebM)",
  "export.mp4": "Schleife exportieren (MP4)",
  "export.loopFrames": " ({count, plural, one {# Bild} other {# Bilder}})",
  "export.gif": "GIF exportieren",
  "export.gifFrames":
    " (letzte {count, plural, one {# Bild} other {# Bilder}})",
  "export.recording":
    "Bild {done} von {total} wird aufgezeichnet. Lassen Sie das Fenster im Vordergrund, solange es läuft.",
  "export.cardTitle": "Was in der Datei landet",
  "export.cardBody":
    "Die Karte genau so, wie sie jetzt ist, mit der Bildzeit, der Radarquelle und den Nachweisen in der Ecke.",
  "export.note":
    "Sie gehen direkt in Ihren Download-Ordner, und neben jeder liegt eine kleine JSON-Datei, die sagt, aus welcher Quelle jedes Bild stammt. Nichts wird hochgeladen.",
  "export.dataHeading": "Die Messwerte hinter dem Bild",
  "export.dataNote":
    "Ein Bild ist eine Farbe pro Zahl, und eine Farbe lässt sich nicht mit einem Regenmesser vergleichen. Diese schreiben stattdessen die Zahlen, jede mit einer JSON-Beilage, die Quelle, Zeit, Einheiten und alles nennt, was mit den Messwerten gemacht wurde. Farbtabellen und Anzeigeschwellen werden nicht angewendet.",
  "export.dataFile": "{label} als {format}",
  "export.dataRadar": "Radarwerte",
  "export.dataComposite": "MRMS-Komposit",
  "export.dataVolume": "Das Volumen selbst",
  "export.dataWritten": "{label} geschrieben",
  "export.dataWrittenBody":
    "{readings, plural, one {# Messwert} other {# Messwerte}}, {size}, unter {path}, mit einer Herkunftsdatei daneben.",
  "export.dataWrittenFileBody":
    "{size}, unter {path}, genau so, wie sie veröffentlicht wurde, mit einer Herkunftsdatei daneben.",
  "export.dataFailed": "Der Datenexport ist fehlgeschlagen",
  "export.dataNoView":
    "Die Karte hat noch keinen Ausschnitt, auf den das Gitter zugeschnitten werden könnte.",
  "dataExport.bytes": "{count, plural, one {# Byte} other {# Byte}}",
  "dataExport.kilobytes": "{count} kB",
  "dataExport.megabytes": "{count} MB",
  "dataExport.error.notDrawn":
    "Dieses Gitter ist nicht auf der Karte, also ist nichts dekodiert, was geschrieben werden könnte. Schalten Sie die Ebene ein und lassen Sie sie erst zeichnen.",
  "dataExport.error.noProduct": "Es gibt kein Produkt namens {product}.",
  "dataExport.error.nothingInView":
    "Der Ausschnitt enthält keinen Teil dieses Gitters.",
  "dataExport.error.tooLarge":
    "Das wären {count, plural, one {# Messwert} other {# Messwerte}} in einer Datei. Zoomen Sie hinein, damit der Export weniger abdeckt.",
  "dataExport.error.noFolder": "Es gibt keinen Ort für den Export.",
  "dataExport.error.notAVolume":
    "Das ist nicht der Name eines Volumens, das diese App gezeichnet hat.",
  "dataExport.error.write":
    "Der Export konnte nicht geschrieben werden: {reason}",
  "dataExport.error.gridUnknownProduct":
    "Es gibt kein Gitter namens {product}.",
  "dataExport.error.gridBadListing":
    "Die Liste der veröffentlichten Gitter konnte nicht gelesen werden.",
  "dataExport.error.gridNoFrames":
    "Es wurde noch kein {product}-Gitter veröffentlicht.",
  "dataExport.error.gridNotGrib": "Diese Datei ist kein GRIB2-Gitter.",
  "dataExport.error.gridUnreadable":
    "Dieses Gitter ist so gepackt, wie dieser Build es nicht liest.",
  "dataExport.error.gridNotDrawn": "Das Gitter konnte nicht gezeichnet werden.",
  "dataExport.error.unknown": "Der Export konnte nicht geschrieben werden.",
  "dataExport.error.gridHttpStatus": "Der Gitterdienst {answer}.",
  "dataExport.error.gridHttpUnreachable":
    "Das Gitter konnte nicht geholt werden. Prüfen Sie, ob dieser Rechner online ist.",
  "dataExport.error.gridHttpRefused":
    "OpenRadar wollte dieses Gitter nicht holen: die Adresse gehört nicht zu denen, die es erreichen darf.",
  "dataExport.error.gridHttpTooLarge":
    "Dieses Gitter ist größer, als OpenRadar auf einmal liest.",

  "search.eyebrow": "Einen Ort finden",
  "search.title": "Suche",
  "search.placeholder": "Stadt, Region oder Postleitzahl",
  "search.label": "Nach einem Ort suchen",
  "search.unavailable":
    "Die Ortssuche ist nicht verfügbar. Die Karte bleibt benutzbar.",
  "search.storms": "Stürme mit diesem Namen",
  "search.stormsMore":
    "{count, plural, one {Den anderen zeigen} other {Die anderen # zeigen}}",
  "search.stormsNote":
    "Aus dem Best-Track-Archiv, das mit der App ausgeliefert wird. Keiner davon ist ein Sturm, der gerade stattfindet.",
  "search.none": "Keine passenden Orte gefunden.",
  "search.note": "Ortssuche von Open-Meteo und GeoNames.",

  "alerts.eyebrow": "Vorwarnungen und Warnungen",
  "alerts.title": "Warnungen",
  "alerts.layerOffTitle": "Die Warnebene ist ausgeschaltet",
  "alerts.layerOffBody":
    "Schalten Sie sie wieder ein, um Vorwarnungen und Warnungen zu sehen.",
  "alerts.turnOn": "Wetterwarnungen einschalten",
  "alerts.area": "Umfasst {places}",
  "alerts.instruction": "Was das Amt zu tun rät:",
  "alerts.issued": "Ausgegeben {issued} · läuft ab {expires}",
  "alerts.unknownTime": "unbekannt",
  "alerts.openProduct": "Das amtliche Produkt öffnen",
  "alertType.tornado": "Jetzt Schutz suchen",
  "alertType.tornadoDetail":
    "Tornadowarnungen und -vorwarnungen, Tsunamiwarnungen, extremer Wind und die zivilen Notfälle: Gefahrstoffe, ein Kernkraftwerk, eine radiologische Gefahr, im Haus bleiben, sofort evakuieren",
  "alertType.thunderstorm": "Gewitter und Wind",
  "alertType.thunderstormDetail":
    "Warnungen vor schweren Gewittern und starkem Wind, Windhinweise, Staubstürme und die Windprodukte für die See",
  "alertType.flood": "Hochwasser",
  "alertType.floodDetail":
    "Sturzfluten und Flusshochwasser, Überflutung an Küste und Seeufer, hoher Wellengang und Brandungsrückströmung",
  "alertType.winter": "Winter und Kälte",
  "alertType.winterDetail":
    "Wintersturm, Blizzard, Eis und gefrierender Regen, Windchill, strenger Frost, Lawinen",
  "alertType.tropical": "Tropisch",
  "alertType.tropicalDetail":
    "Hurrikane und tropische Stürme, Sturmflut und die Warnungen vor Wind in Orkanstärke, die die Seewetterämter herausgeben",
  "alertType.fire": "Feuer",
  "alertType.fireDetail":
    "Waldbrandwarnungen, Vorwarnungen zur Brandwetterlage, dichter Rauch",
  "alertType.heat": "Hitze",
  "alertType.heatDetail": "Extreme Hitze und Hitzehinweise",
  "alertType.other": "Alles andere",
  "alertType.otherDetail":
    "Alles, was die Liste noch nie gesehen hat, damit ein neues Produkt auftaucht statt zu verschwinden",
  "layers.find": "Eine Ebene finden",
  "layers.findNone":
    "Hier heißt keine Ebene so. Die Befehlsleiste durchsucht den Rest der App.",
  "layers.order": "Welche Überlagerung obenauf liegt",
  "layers.orderDetail":
    "Warnungen bleiben immer über allem anderen, denn eine Warnung ist jemand, der Ihnen sagt, Sie sollen Schutz suchen",
  "layers.moveUp": "{layer} nach oben",
  "layers.moveDown": "{layer} nach unten",
  "layers.opacity": "Wie kräftig die Überlagerungen sind",
  "layers.smoothGrids": "Wie die landesweiten Gitter gezeichnet werden",
  "layers.smoothGridsDetail":
    "Eine Zelle des Mosaiks ist etwa einen Kilometer breit, herangezoomt also ein Quadrat einer Farbe neben dem Quadrat daneben",
  "layers.smoothGridsLabel": "Zwischen den Zellen lesen",
  "layers.smoothGridsNote":
    "Glättet die Felder, die das ganze Land abdecken, nicht die verstreuten wie Hagel und Rotation, und nie über Boden hinweg, den das Netz nicht erfasst hat. Die Messwerte, die ein Export schreibt, sind so oder so die Zellen selbst.",
  "layers.opacityDetail":
    "Jede für sich, damit eine Ebene abgeschwächt statt ausgeschaltet werden kann",
  "layers.opacityFor": "Wie kräftig {layer} ist",
  "layers.files": "Von Ihnen importierte Dateien",
  "layers.picturesCeiling":
    "{count, plural, one {# Bild} other {# Bilder}} in diesen Dateien. Die Karte zeichnet {drawn} auf einmal und lässt alle aus, die außerhalb ihres eigenen Zoom- oder Zeitbereichs liegen.",
  "layers.filesDetail":
    "Jede auf ihrem eigenen Schalter, die letzte der Liste obenauf gezeichnet",
  "layers.filesNone":
    "Noch nichts importiert. Ziehen Sie eine Placefile- oder GeoJSON-Datei auf das Upload-Feld.",
  "layers.fileShapes": "{count, plural, one {# Form} other {# Formen}}",
  "layers.fileShown": "{name} zeigen",
  "layers.fileRemove": "{name} entfernen",
  "layers.fileRemoved": "{name} von der Karte genommen",
  "layers.fileRemovedBody":
    "Rückgängig setzt sie wieder auf die Höhe, auf der sie gezeichnet war.",
  "capture.title": "Aufnahme-Layout",
  "capture.noAlerts": "Keine aktiven Warnungen im Ausschnitt",
  "replay.warningsUnavailable":
    "Das Warnarchiv hat nicht geantwortet, also stammt nur das Radar von diesem Tag.",
  "replay.warningsSome":
    "Einige der Hochwasserwarnungen für diese Wiedergabe konnten nicht geholt werden. Die übrigen sind gezeichnet.",
  "replay.warningsPartial":
    "Vor Oktober 2007 warnten die Ämter nach Landkreis, also haben nur einige dieser Stürme ein Polygon.",
  "replay.warningsNone":
    "Das Warnarchiv enthält vor 2002 keine Polygone, also wird keines gezeichnet.",
  "replay.warningsHistorical": "Warnungen, wie sie galten, {when}",
  "capture.leave": "Aufnahme-Layout verlassen",
  "alerts.kinds": "Arten von Warnung",
  "alerts.kindsDetail":
    "Wer eine abwählt, nimmt sie von der Karte und aus dieser Liste",
  "alerts.volume": "Wie laut",
  "alerts.volumeValue": "{percent}%",
  "alerts.previewNote":
    "Hören Sie, was eine Warnung tatsächlich tun wird, bevor sie es tut. Mit einem unten gewählten eigenen Ton spielen alle vier diesen ab.",
  "alerts.soundFile": "Einen eigenen Ton verwenden",
  "alerts.soundFileDetail":
    "Über seinen Ort gemerkt statt kopiert, damit eine Sicherung des Arbeitsbereichs ihn nicht verschluckt. Unter 2 MB, eine Datei vom Typ wav, mp3, ogg, flac oder m4a, und nach sechs Sekunden abgeschnitten. Er ersetzt alle vier Töne, damit ist die Schwere nicht mehr hörbar.",
  "alerts.soundFileChoose": "Eine Datei wählen",
  "alerts.soundFileClear": "Zurück zu den eingebauten Tönen",
  "alerts.soundFileRemoved": "Zurück zu den eingebauten Tönen",
  "alerts.soundFileRemovedBody":
    "Rückgängig kehrt zu der Tondatei zurück, die Sie gewählt haben.",
  "alerts.soundFileFailed": "Dieser Ton ließ sich nicht verwenden",
  "alerts.soundFile.name":
    "Es muss eine wav-, mp3-, ogg-, flac- oder m4a-Datei sein.",
  "alerts.soundFile.noAudio":
    "Dieser Rechner hat keine Audioausgabe, also kann darauf nichts abgespielt werden. Die Benachrichtigung kommt trotzdem an.",
  "alerts.soundFile.size": "Sie ist größer als 2 MB.",
  "alerts.soundFile.decode":
    "Sie ließ sich nicht als Audio lesen. Sie ist vielleicht verschoben worden, oder sie ist keine Tondatei.",
  "alerts.sound": "Einen Ton abspielen",
  "alerts.soundDetail":
    "Ein kurzer Ton, wenn eine neue oder hochgestufte Warnung den Ort erreicht, den Sie beobachten",
  "alerts.voice": "Vorlesen",
  "alerts.voiceDetail":
    "Dieselbe Warnung laut gesprochen, nach dem Ton, in den Stimmen, die Windows installiert hat",
  "alerts.impact.considerable": "erhebliche Schäden",
  "alerts.impact.destructive": "zerstörerisch",
  "alerts.impact.catastrophic": "katastrophal",
  "alerts.severity.extreme": "Extrem",
  "alerts.severity.severe": "Schwer",
  "alerts.severity.moderate": "Mäßig",
  "alerts.severity.minor": "Gering",
  "alerts.impactLine": "Das Amt hat diese als {tag} gekennzeichnet.",
  "alerts.impactBadge": "{tag}",
  "alerts.hailTo": "{size, plural, one {# Zoll} other {# Zoll}} Hagel",
  "alerts.hailToCm": "{size} cm Hagel",
  "alerts.noneTitle": "Keine aktiven Warnungen im Ausschnitt",
  "alerts.noneBody":
    "Verschieben Sie die Karte oder zoomen Sie heraus, um ein größeres Gebiet zu prüfen. Warnungen werden jede Minute aktualisiert.",
  "alerts.noteOff": "Solange die Ebene aus ist, wird nichts geholt.",
  "alerts.noteError": "Zeigt die letzte gute Liste. {error}",
  "alerts.noteFailed": "Es ist keine Liste angekommen. {error}",
  "alerts.noteChecked": "Vorwarnungen und Warnungen, geprüft {when}.",
  "alerts.noteArchived":
    "Die Warnungen, die in dem Moment auf dem Bildschirm in Kraft waren, aus dem Archiv der Iowa State University.",
  "alerts.noteLoading": "Vorwarnungen und Warnungen werden geladen.",
  "alerts.noteSafety":
    "Nutzen Sie für Entscheidungen über Leben und Sicherheit die amtlichen Warnungen.",

  "units.miles": "Meilen",
  "units.kilometres": "Kilometer",
  "units.mph": "mph",
  "units.feet": "ft",
  "units.inches": "Zoll",
  "units.inchesLong": "Zoll",
  "units.feetLong": "Fuß",
  "units.metresLong": "Meter",
  "units.mile": "mi",
  "history.trackPoint": "{kind} {knots} kn",
  "storm.status.TD": "Tropisches Tief",
  "storm.status.TS": "Tropischer Sturm",
  "storm.status.HU": "Hurrikan",
  "storm.status.EX": "Außertropisch",
  "storm.status.SD": "Subtropisches Tief",
  "storm.status.SS": "Subtropischer Sturm",
  "storm.status.LO": "Tief",
  "storm.status.WV": "Tropische Welle",
  "storm.status.DB": "Störung",
  "toast.settingsSaved": "Einstellungen gespeichert",
  "toast.settingsSavedBody": "In Ihren Download-Ordner geschrieben.",
  "toast.settingsSaveFailed":
    "Die Einstellungen konnten nicht gespeichert werden",
  "toast.settingsSaveFailedBody": "Es wurde nichts geschrieben.",
  "toast.settingsRestored": "Einstellungen wiederhergestellt",
  "toast.settingsRestoredBody":
    "Alles aus der Datei ist an seinem Platz: Ansichten, Ebenen, der beobachtete Ort und die Farbtabelle.",
  "toast.settingsRestoredPartly": "Einstellungen teilweise wiederhergestellt",
  "toast.settingsFromNewer":
    "Diese Datei wurde von einer neueren Version geschrieben, deshalb wurde alles ausgelassen, was sie kennt und diese hier nicht.",
  "toast.settingsUnread": "Nicht aus der Datei gelesen: {names}.",
  "toast.notABackup": "Das ist kein gesicherter Arbeitsbereich",
  "toast.notABackupBody":
    "Das Wiederherstellen aus einer Datei nimmt einen Arbeitsbereich, den Sie mit der Schaltfläche daneben gesichert haben. Es hat sich nichts geändert. Um eine Kartendatei oder eine Farbtabelle auf die Karte zu legen, nutzen Sie das Upload-Feld.",
  "toast.settingsBroken": "Diese Einstellungsdatei ließ sich nicht lesen",
  "toast.settingsBrokenBody":
    "Die Datei ließ sich nicht als Einstellungsdatei lesen, deshalb wurde nichts geändert. Sie wurde vielleicht bearbeitet oder nur zum Teil geschrieben.",
  "toast.workspaceInvalidTitle":
    "Die Einstellungsdatei wurde nicht wiederhergestellt",
  "toast.workspaceInvalid":
    "Diese Sicherung des Arbeitsbereichs ist unvollständig oder ungültig, deshalb wurde nichts geändert.",
  "settings.backup": "Sicherung",
  "settings.backupDetail":
    "Alles in eine Datei speichern und aus einer zurückholen",
  "settings.export": "Einstellungen in eine Datei speichern",
  "settings.import": "Aus einer Datei wiederherstellen",
  "settings.units": "Einheiten",
  "settings.unitsImperial": "Fuß und Fahrenheit",
  "settings.unitsMetric": "Meter und Celsius",
  "settings.clock": "Uhr",
  "settings.clockLocal": "Dieser Rechner",
  "settings.clockUtc": "UTC",
  "settings.clockDetail":
    "Jedes Wetterprodukt ist in UTC gestempelt, wer die Karte darin liest, spart sich das Umrechnen im Kopf",
  "settings.textSize": "Schriftgröße",
  "settings.textSizeDetail": "Alles im Arbeitsbereich, größer gezeichnet",
  "settings.language": "Sprache",
  "settings.languageNote": "Gilt sofort",
  "storage.title": "Auf der Festplatte behalten",
  "storage.format": "Karten- und Wetterdaten",
  "storage.detail":
    "Die App behält, was sie gezeichnet hat, damit ein Start ohne Netz auf der zuletzt gesehenen Ansicht öffnet. Sie leert sich selbst, während sie voll wird, und dies leert sie jetzt. Ihre Offline-Pakete und gespeicherten Wiedergaben liegen getrennt davon und bleiben unberührt.",
  "storage.desktopOnly":
    "In einem Browser wird nichts auf der Festplatte behalten.",
  "storage.held": "Jetzt belegt",
  "storage.unknown": "Nicht lesbar",
  "storage.reading": "Wird gelesen",
  "storage.clearedOffline":
    "{freed} sind wieder frei. Sie sind offline, damit ist auch die letzte Ansicht weg: die Karte bleibt leer, bis sie wieder einen Dienst erreicht.",
  "storage.clear": "Leeren",
  "storage.cleared": "Geleert",
  "storage.clearedBody":
    "{freed} sind wieder frei. Die Karte holt sich, was sie braucht, erneut.",
  "storage.clearFailed": "Der Zwischenspeicher ließ sich nicht leeren",
  "storage.clearFailedUnknown":
    "Der Grund kam nicht zurück. Im Protokoll steht, was der Befehl gesagt hat.",
  "packs.error.tooManyTiles":
    "Diese Region braucht {count, plural, one {# Kachel} other {# Kacheln}}, mehr als ein Paket fasst. Zoomen Sie hinein oder nehmen Sie weniger Zoomstufen.",
  "packs.error.diskCeiling":
    "Damit kämen die Pakete über das Speicherlimit, das Sie gesetzt haben. Löschen Sie eines oder heben Sie das Limit oben an.",
  "packs.error.notFound": "Dieses Paket ist nicht mehr da.",
  "packs.error.notReady":
    "Dieses Paket ist noch nicht fertig. Warten Sie, bis es durch ist, und versuchen Sie es erneut.",
  "packs.error.cancelled": "Der Download wurde abgebrochen.",
  "packs.error.corrupt":
    "Der Download kam nicht unversehrt an und wurde verworfen. Versuchen Sie es erneut.",
  "packs.error.refused": "OpenRadar konnte diese Anfrage nicht annehmen.",
  "packs.error.failed":
    "Auf diesem Rechner ist etwas schiefgegangen und der Download hat aufgehört. Im Diagnosefeld stehen die Einzelheiten.",
  "packs.error.pausedOnExit":
    "Der Download wurde angehalten, als OpenRadar geschlossen wurde.",
  "packs.error.httpStatus": "Der Kachelserver {answer}.",
  "packs.error.httpUnreachable":
    "Der Kachelserver war nicht erreichbar. Prüfen Sie, ob dieser Rechner online ist.",
  "packs.error.httpRefused":
    "OpenRadar wollte das nicht holen: die Adresse gehört nicht zu denen, die es erreichen darf.",
  "packs.error.httpTooLarge":
    "Eine Kachel kam größer zurück, als OpenRadar auf einmal liest.",
  "packs.title": "Offline-Einsatzpakete",
  "packs.format": "PMTiles",
  "packs.detail":
    "Speichern Sie die aktuelle Kartenregion als geprüftes PMTiles-Archiv. Downloads lassen sich anhalten und fortsetzen, und die Karte kann ein fertiges Paket ohne Netz nutzen.",
  "packs.desktopOnly": "Einsatzpakete gibt es in der Desktop-App.",
  "packs.defaultName": "Einsatzpaket",
  "packs.ceiling": "Speicherobergrenze für Pakete",
  "packs.used": "{used} von {limit} belegt",
  "packs.megabytes": "{count} MB",
  "packs.gigabytes": "{count} GB",
  "packs.name": "Name des Pakets",
  "packs.minZoom": "Kleinster Zoom",
  "packs.maxZoom": "Größter Zoom",
  "packs.estimate":
    "{count, plural, one {# Kachel} other {# Kacheln}}. Etwa {final}, wenn es fertig ist, und bis zu {temporary}, während es gebaut wird.",
  "packs.noRegion":
    "Schieben Sie die Karte auf die Region, die Sie speichern wollen.",
  "packs.wontFit":
    "Dieses Paket würde die eingestellte Speicherobergrenze überschreiten.",
  "packs.download": "Aktuelle Kartenregion herunterladen",
  "packs.started": "Download des Einsatzpakets gestartet",
  "packs.cancelled": "Einsatzpaket abgebrochen und seine Dateien entfernt",
  "packs.deleted": "Einsatzpaket gelöscht",
  "packs.deletedUndo": "{name} gelöscht",
  "packs.deletedUndoBody":
    "Rückgängig holt den Download zurück. Danach müsste er erneut geholt werden.",
  "packs.restored": "Einsatzpaket wiederhergestellt",
  "packs.paused": "Einsatzpaket angehalten",
  "packs.resumed": "Download des Einsatzpakets fortgesetzt",
  "packs.selected": "{name} wird als Offline-Grundkarte verwendet",
  "packs.offlineActive": "Ein lokales Einsatzpaket ist die aktive Grundkarte.",
  "packs.useOnline": "Online-Grundkarte verwenden",
  "packs.empty": "Es wurden noch keine Einsatzpakete vorbereitet.",
  "packs.status.queued": "In der Warteschlange",
  "packs.status.downloading": "Wird geladen",
  "packs.status.paused": "Angehalten",
  "packs.status.finalizing": "PMTiles werden geprüft",
  "packs.status.ready": "Offline bereit",
  "packs.status.failed": "Braucht Aufmerksamkeit",
  "packs.packMeta": "Zoom {min} bis {max} · {size}",
  "packs.progress":
    "{done} von {total, plural, one {# Kachel} other {# Kacheln}}, {percent}%",
  "packs.usePack": "Offline nutzen",
  "packs.pause": "Anhalten",
  "packs.resume": "Fortsetzen",
  "packs.cancel": "Abbrechen",
  "packs.delete": "Löschen",
  "packs.missing":
    "Von diesem Arbeitsbereich benannt, aber auf diesem Gerät nicht gespeichert",
  "packs.forget": "Verweis vergessen",

  "forecast.eyebrow": "Kartenmitte",
  "forecast.title": "Vorhersage",
  "forecast.loading": "Die neueste Vorhersage wird geladen",
  "forecast.failedTitle": "Die Vorhersage ist nicht verfügbar",
  "forecast.failedBody": "Radar und Karte laufen weiter.",
  "forecast.feelsLike": "Gefühlt {value}°",
  "forecast.wind": "{value} {unit} Wind",
  "forecast.rainNow": "{value} {unit} jetzt",
  "forecast.note":
    "Vorhersage von Open-Meteo. Prüfen Sie für Sicherheitsentscheidungen die amtlichen Warnungen.",
  "tropical.eyebrow": "National Hurricane Center",
  "tropical.title": "Tropisch",
  "tropical.layerOffTitle": "Die tropische Ebene ist ausgeschaltet",
  "tropical.layerOffBody":
    "Schalten Sie sie wieder ein, um Kegel, Zugbahnen und Ausblicke zu sehen.",
  "tropical.turnOn": "Tropisch einschalten",
  "tropical.strength": "{category} · {knots} kn",
  "tropical.pressure": " · {value} mb",
  "tropical.advisory": "Lagebericht {number} · {date}",
  "tropical.follow": "Folgen",
  "tropical.readAdvisory": "Den Lagebericht zu {name} lesen",
  "tropical.advisoryLink": "Lagebericht",
  "tropical.noneTitle": "Keine aktiven tropischen Wirbelstürme",
  "tropical.noneWithOutlook":
    "Die Gebiete, die der Ausblick beobachtet, stehen unten.",
  "tropical.noneAtAll": "Der Ausblick hat ebenfalls nichts unter Beobachtung.",
  "tropical.outlookTitle": "Ausblick {basin}",
  "tropical.twoDays": "Zwei Tage {chance} · {risk}",
  "tropical.sevenDays": "Sieben Tage {chance} · {risk}",
  "tropical.noteError": "Zeigt die letzten guten Produkte. {error}",
  "tropical.noteChecked": "NHC-Produkte, geprüft {when}.",
  "tropical.noteLoading": "NHC-Produkte werden geladen.",
  "tropical.noteSource":
    "Maßgeblich sind die amtlichen Lageberichte auf nhc.noaa.gov.",
  "almanac.title": "An diesem Datum",
  "almanac.note": "Aus dem, was schon auf diesem Rechner liegt",
  "almanac.storm": "{name} war ein {category}.",
  "almanac.track": "NOAA HURDAT2 Best Track",
  "almanac.show": "Die Zugbahn zeigen",
  "almanac.flyTo": "Bring mich hin",
  "settings.almanac": "An diesem Datum",
  "settings.almanacDetail":
    "Eine Karte in der Sturmgeschichte, die sagt, was das Wetter an diesem Datum in anderen Jahren getan hat, aus dem Archiv, das mit der App kommt. Sie erscheint nie, solange dort, wo Sie beobachten, eine Warnung gilt.",
  "history.eyebrow": "HURDAT2 Best Track",
  "history.title": "Sturmgeschichte",
  "history.placeholder": "Ian 2022",
  "history.searchLabel": "Vergangene Stürme nach Name oder Jahr suchen",
  "history.archiveStatus": "Das Sturmarchiv {answer}.",
  "history.unknownStorm": "Dieser Sturm steht nicht im Archiv.",
  "history.archiveDate": "{date} UTC",
  "history.failedTitle": "Das Sturmarchiv wurde nicht geladen",
  "history.failedBody":
    "Versuchen Sie es gleich erneut. Die Karte läuft weiter.",
  "history.peak": "{category} · Höchstwert {knots} kn",
  "history.ace":
    "ACE {ace} · {fixes, plural, one {# Fixpunkt} other {# Fixpunkte}} · {from} bis {to}",
  "history.liveRadar": "Live-Radar",
  "history.replayRadar": "Radar wiedergeben",
  "history.clear": "Zurücksetzen",
  "history.tooOld":
    "Das Radararchiv beginnt {year}, für diesen gibt es also nichts wiederzugeben. Die Zugbahn liegt weiter auf der Karte.",
  "history.outside":
    "Dieser Sturm blieb außerhalb des landesweiten Radarmosaiks, es gibt also nichts wiederzugeben. Die Zugbahn liegt weiter auf der Karte.",
  "history.basinAtlantic": "Atlantik",
  "history.basinPacific": "Ostpazifik",
  "history.result": "{basin} · {category} · ACE {ace}",
  "history.none":
    "Dazu passt nichts. Versuchen Sie einen Namen, ein Jahr oder beides.",
  "history.noteCount":
    "{count, plural, one {# Sturm} other {# Stürme}} zurück bis 1851, aus dem NOAA HURDAT2 Best Track.",
  "history.noteLoading": "Das Best-Track-Archiv wird geladen.",
  "history.noteReplay":
    "Eine Wiedergabe deckt drei Stunden vor und nach {moment} am {date} ab, aus dem Radararchiv der Iowa State University.",
  "history.landfall": "Landfall",
  "history.closestApproach": "seiner größten Annäherung",
  "history.noteReplaySource":
    "Wiedergaben stammen aus dem Radararchiv der Iowa State University.",
  "history.bundleHeading": "Wiedergabepaket",
  "history.bundleNote":
    "Ein Paket behält die Bilder dieser Wiedergabe und die Warnungen, die galten, Byte für Byte, mit ihren Adressen und Prüfsummen, damit es ohne Netz gleich abläuft. Die Ansicht, die Sie gerade sehen, kommt mit hinein, denn die Bilder, die es enthält, sind die, die diese Ansicht abdeckt.",
  "history.includeWorkspace": "Meinen Arbeitsbereich mitnehmen",
  "history.includeWorkspaceDetail":
    "Zuhause, beobachtete Orte, gespeicherte Ansichten und Einstellungen. Aus, solange Sie es nicht ankreuzen, jedes Mal.",
  "history.saveBundle": "Wiedergabepaket speichern",
  "history.openBundle": "Ein Wiedergabepaket öffnen",
  "bundle.replayLabel": "Wiedergabepaket",
  "bundle.openTitle": "Ein OpenRadar-Wiedergabepaket öffnen",
  "bundle.fileKind": "OpenRadar-Wiedergabepaket",
  "bundle.missingTiles":
    "{count, plural, one {# Kachel war} other {# Kacheln waren}} nicht im Paket.",
  "bundle.missingWarnings":
    "{count, plural, one {# Warnkanal war} other {# Warnkanäle waren}} nicht im Paket, seine Warnungen können also unvollständig sein.",
  "bundle.missingBoth":
    "{tiles, plural, one {# Kachel} other {# Kacheln}} und {warnings, plural, one {# Warnkanal} other {# Warnkanäle}} waren nicht im Paket.",
  "bundle.error.invalidRequest":
    "Diese Wiedergabe lässt sich nicht paketieren: {reason}.",
  "bundle.error.tooManyTiles":
    "Die Ansicht deckt über die Wiedergabe hinweg {count, plural, one {# Kachel} other {# Kacheln}} ab. Zoomen Sie hinein oder heraus, damit es weniger werden.",
  "bundle.error.tooManyDocuments":
    "Die Wiedergabe verlangt neben der Karte {count, plural, one {# Dokument} other {# Dokumente}}, mehr als ein Paket fasst.",
  "bundle.error.tooLarge": "Das Paket wäre größer als 256 MB.",
  "bundle.error.noFolder": "Es gibt keinen Ort für das Paket.",
  "bundle.error.write": "Das Paket konnte nicht geschrieben werden: {reason}",
  "bundle.error.read": "Das Paket konnte nicht gelesen werden: {reason}",
  "bundle.error.notABundle": "Diese Datei ist kein OpenRadar-Wiedergabepaket.",
  "bundle.error.newer":
    "Dieses Paket stammt von einem neueren OpenRadar. Aktualisieren Sie, um es zu öffnen.",
  "bundle.error.corrupt": "Dieses Paket ist beschädigt: {reason}",
  "bundle.error.noView": "Die Karte hat noch keine Ansicht zum Paketieren.",
  "bundle.error.noFrames":
    "Dieses Paket enthält keine Bilder, die dieser Build zeichnen kann.",
  "bundle.error.letGo":
    "Das offene Paket wurde losgelassen, die Karte ist also wieder auf dem Live-Radar.",
  "bundle.error.unknown": "Das Paket ließ sich nicht verarbeiten.",
  "route.eyebrow": "Wetter unterwegs",
  "route.title": "Route",
  "route.start": "Start",
  "route.startPlaceholder": "Dallas",
  "route.destination": "Ziel",
  "route.destinationPlaceholder": "Houston",
  "route.leaving": "Abfahrt",
  "route.plan": "Die Fahrt planen",
  "route.failedTitle": "Die Route ließ sich nicht planen",
  "route.failed": "Prüfen Sie die beiden Orte und versuchen Sie es erneut.",
  "route.placeMissing": "Einer dieser Orte war nicht zu finden.",
  "alerts.failed": "Der Wetterdienst {answer}.",
  "alerts.officeMissing":
    "{office} war nicht erreichbar, deshalb liegen die Warnungen von dort nicht auf der Karte.",
  "alerts.officeEccc": "Environment and Climate Change Canada",
  "alerts.officeDwd": "Deutscher Wetterdienst",
  "alerts.officeUnanswered": "das Amt hat nicht geantwortet",
  "earthquakes.failed": "Der USGS-Erdbebendienst {answer}.",
  "smoke.failed": "Die NOAA-Rauchanalyse {answer}.",
  "tropical.failed": "Das National Hurricane Center {answer}.",
  "wildfires.failed": "Der NIFC-Branddienst {answer}.",
  "hrrr.failed": "Das Vorhersageverzeichnis {answer}.",
  "provider.failed": "Der Radardienst {answer}.",
  "route.forecastFailed": "Die Vorhersage {answer}.",
  "search.failed": "Die Ortssuche {answer}.",
  "weather.failed": "Die Vorhersage {answer}.",
  "replay.archiveFailed": "Das Warnarchiv {answer}.",
  "kmz.notZip": "Diese Datei ist kein Zip-Archiv.",
  "kmz.noDecompressor": "Dieser Build kann kein Zip-Archiv entpacken.",
  "kmz.tooBigUnpacked":
    "Dieses Archiv entpackt sich auf mehr, als hier gelesen wird.",
  "kmz.tooBig": "Dieses Archiv ist größer, als hier gelesen wird.",
  "kmz.noKml": "Dieses Archiv enthält keine KML-Datei.",
  "kmz.truncated": "Dieses Archiv ist abgeschnitten.",
  "kmz.damaged": "Der Inhalt dieses Archivs ist beschädigt.",
  "kmz.notZipLayout": "Dieses Archiv ist nicht wie ein Zip aufgebaut.",
  "kmz.compression":
    "Dieses Archiv nutzt eine Komprimierung, die hier nicht gelesen wird.",
  "kml.notXml": "Diese Datei ließ sich nicht als XML lesen.",
  "kml.notKml": "Diese Datei ist kein KML-Dokument.",
  "export.encoderFailed":
    "Der Videoencoder dieses Rechners hat mitten in der Schleife aufgehört.",
  "metar.failed": "Das Aviation Weather Center {answer}.",
  "panel.vwp": "Windprofil",
  "keywords.vwp": "vad windprofil fahnen scherung hodograph",
  "vwp.eyebrow": "Velocity Azimuth Display",
  "vwp.title": "Windprofil",
  "vwp.loading": "Der Wind wird aus den Volumina gelesen",
  "vwp.failedTitle": "Das Windprofil ließ sich nicht lesen",
  "vwp.holdSite": "Das nächste Radar festhalten",
  "vwp.needsSite":
    "Halten Sie ein einzelnes Radar fest, dann liest dies dessen eigenen Wind, Höhe für Höhe.",
  "vwp.noData": "ND",
  "vwp.nothingToDraw":
    "In den Volumina kam kein Wind zurück, hier ist also noch nichts zu zeichnen.",
  "vwp.historical":
    "Das Windprofil liest die Volumina, die ein Standort jetzt veröffentlicht. Kehren Sie in die Gegenwart zurück, um es zu sehen.",
  "vwp.note":
    "Der Wind, in dem sich jede Höhe bewegt. Die meisten Säulen sind das Windprofil, das das Radar für dieses Volumen veröffentlicht, gelesen wie das Amt es geschrieben hat; ein Volumen, das es nicht aufbereitet hat, wird hier aus der eigenen Geschwindigkeit des Radars angepasst. Eine mit ND markierte Höhe ist eine, für die keines von beiden einstehen konnte, also eine Lücke und keine Windstille.",
  "vwp.sourceProduct": "Vom Radar selbst",
  "vwp.sourceFitted": "Hier angepasst",
  "vwp.columnLabel": "Wind nach Höhe für Volumen {volume}",
  "vwp.hodographLabel": "Hodograph des Windes nach Höhe",
  "layers.spcOutlookChoice": "Konvektiver Ausblick",
  "layers.spcOutlookChoiceDetail":
    "Welcher Tag, und ob das Risiko in Kategorien oder die Wahrscheinlichkeit einer Gefahr. Tag 3 bis 8 veröffentlichen eine Wahrscheinlichkeit ohne Aufteilung nach Gefahr.",
  "layers.spcDay": "Tag des Ausblicks",
  "layers.spcHazard": "Gefahr des Ausblicks",
  "layers.spcCategorical": "Kategorien",
  "layers.spcTornado": "Tornado",
  "layers.spcHail": "Hagel",
  "layers.spcWind": "Wind",
  "spc.significant":
    "Schraffiert: wo diese Gefahr bedeutend wäre, wenn sie eintritt",
  "spc.asIssued": "Der Ausblick, der über diesem Tag stand",
  "layer.lightningForecast": "Blitzwahrscheinlichkeit",
  "layer.lightningJump": "Blitzsprung",
  "layer.isothermReflectivity": "Reflektivität in Eishöhe",
  "keywords.lightningForecast": "",
  "keywords.lightningJump": "",
  "keywords.isothermReflectivity": "",
  "keywords.cappi": "",
  "layers.lightningForecastDetail":
    "Die Wahrscheinlichkeit, dass ein Blitz Boden trifft, den er noch nicht getroffen hat",
  "layers.lightningJumpDetail":
    "Wo die Blitzrate einer Zelle schneller gestiegen ist als ihre eigene Geschichte",
  "layers.isothermReflectivityDetail":
    "Reflektivität in der Höhe, in der die Luft kalt genug für Eis ist",
  "layers.lightningWindow": "Gemittelt über",
  "layers.lightningWindowDetail":
    "Alle vier sind eine Blitzrate, Sie können also zwischen ihnen wechseln und vergleichen",
  "layers.lightningForecastWindow": "Vorhersage für die nächsten",
  "layers.lightningForecastWindowDetail":
    "Eine Vorhersage, kein Einschlag. Sie deckt Boden ab, den noch nichts getroffen hat.",
  "layers.lightningJumpWindow": "Gezeigter Sprung",
  "layers.lightningJumpWindowDetail":
    "In Standardabweichungen. Bei zwei sagt die Schulung des Wetterdienstes, dass man hinschauen soll.",
  "layers.isothermLevel": "Abgetastet bei",
  "layers.isothermLevelDetailMinus10":
    "Wo Blitze in Gang kommen. Starkes Echo hier heißt, dass sich Ladung trennt.",
  "layers.isothermLevelDetailMinus20":
    "Tiefer im Eis. Starkes Echo hier geht mit Hagel und einem Sprung in der Blitzrate einher.",
  "lightningWindow.1m": "1 Min.",
  "lightningWindow.5m": "5 Min.",
  "lightningWindow.15m": "15 Min.",
  "lightningWindow.30m": "30 Min.",
  "lightningForecast.30m": "30 Min.",
  "lightningForecast.60m": "60 Min.",
  "lightningJump.now": "Jetzt",
  "lightningJump.max": "Letzte 5 Min.",
  "isothermLevel.minus10": "−10 °C",
  "isothermLevel.minus20": "−20 °C",
  "mrms.lightning1min": "Wolke-Boden-Blitze, 1 Min.",
  "mrms.lightning15min": "Wolke-Boden-Blitze, 15 Min.",
  "mrms.lightning30min": "Wolke-Boden-Blitze, 30 Min.",
  "mrms.lightningProbability30": "Blitzwahrscheinlichkeit in 30 Min.",
  "mrms.lightningProbability60": "Blitzwahrscheinlichkeit in 60 Min.",
  "mrms.lightningJump": "Blitzsprung",
  "mrms.lightningJumpMax": "Größter Blitzsprung, 5 Min.",
  "mrms.reflectivityMinus10c": "Reflektivität bei −10 °C",
  "mrms.reflectivityMinus20c": "Reflektivität bei −20 °C",
  "layers.spcDay3Probability": "Wahrscheinlichkeit",
  "watch.notificationsRefused":
    "Windows lässt OpenRadar keine Benachrichtigungen zeigen, deshalb können diese nur in der App erscheinen. Schalten Sie sie in den Windows-Einstellungen unter System, Benachrichtigungen ein.",
  "spc.hatchingMissing":
    "Der Ausblick ist ohne seine schraffierten bedeutenden Gebiete gezeichnet: dieser Teil hat nicht geantwortet. Wo eine Gefahr bedeutend wäre, ist nicht zu sehen.",
  "reports.fromService":
    "Die Sturmmeldungen kommen vom Wetterdienst statt aus dem üblichen Archiv, das nicht geantwortet hat.",
  "toast.sharedViewPartly":
    "Die geteilte Ansicht ist offen. Sie nannte ein Radar oder ein Produkt, das diese Version nicht hat, deshalb blieb dieser Teil, wie er war.",
  "service.busy": "ist ausgelastet",
  "service.notFound": "konnte es nicht finden",
  "service.tooMany": "wurde zu oft gefragt",
  "service.refused": "hat abgelehnt",
  "service.unexpected": "hat so geantwortet, dass es nicht zu lesen war",
  "service.unreachable": "Der Dienst war nicht erreichbar.",
  "service.unreadable":
    "Der Dienst hat so geantwortet, dass es nicht zu lesen war.",
  "service.failed": "Die Anfrage ist fehlgeschlagen.",
  "route.routerRefused": "Der Straßenrouter {answer}.",
  "route.straightOffer": "Stattdessen eine gerade Linie nehmen",
  "route.straightNote":
    "Kein Straßenverlauf: das ist die gerade Linie zwischen den beiden Orten, und die Zeiten darauf setzen gleichbleibende {speed} voraus. Das Wetter ist echt.",
  "route.summary": "{from} nach {to} · {miles} {unit} · {minutes} Min.",
  "route.miles": "{value} {unit}",
  "route.noValue": "—",
  "route.note":
    "Straßen von den Mitwirkenden von OpenStreetMap, unter der ODbL, über den Routing-Dienst der FOSSGIS. Wetter von Open-Meteo. Jeder Halt der Fahrt wird von einer einzigen Vorhersageanfrage abgedeckt, lassen Sie den Servern also zwischen den Versuchen einen Moment.",

  "storm.cat5": "Kategorie 5",
  "storm.cat4": "Kategorie 4",
  "storm.cat3": "Kategorie 3",
  "storm.cat2": "Kategorie 2",
  "storm.cat1": "Kategorie 1",
  "storm.tropicalStorm": "Tropischer Sturm",
  "storm.tropicalDepression": "Tropisches Tief",
  "weather.clear": "Klar",
  "weather.partlyCloudy": "Teils bewölkt",
  "weather.fog": "Nebel",
  "weather.rain": "Regen",
  "weather.snow": "Schnee",
  "weather.showers": "Schauer",
  "weather.snowShowers": "Schneeschauer",
  "weather.thunderstorms": "Gewitter",
  "weather.mixed": "Gemischte Verhältnisse",
  "time.utcSuffix": "Z",
  "time.justNow": "gerade eben",
  "age.minutes": "{count} Min.",
  "age.hours": "{count, plural, one {# Stunde} other {# Stunden}}",
  "age.days": "{count, plural, one {# Tag} other {# Tage}}",
  "time.ago": "vor {age}",
  "upload.eyebrow": "Lokale Daten",
  "upload.title": "Hochladen",
  "upload.dropTitle": "Eine Überlagerung oder eine Farbtabelle hinzufügen",
  "upload.dropChoose": "Eine Datei wählen",
  "upload.dropBody":
    "Wählen Sie eine lokale GeoJSON-Datei, eine GRLevelX-Placefile oder eine .pal-Farbtabelle. Es wird nichts an einen Server geschickt.",
  "upload.colours": "{count, plural, one {# Farbe} other {# Farben}}",
  "upload.forUnits": " · {units}",
  "upload.forReflectivity": " · Reflektivität",
  "upload.skipped": "{names} ausgelassen",
  "upload.savePalette": "Als Datei speichern",
  "upload.exportPalette": "Als Datei speichern: {name}",
  "upload.paletteSaved": "{name} gespeichert",
  "upload.paletteNotSaved": "Diese Tabelle ließ sich nicht speichern",
  "upload.clearPalette": "Entfernen",
  "upload.libraryHeading": "Ihre Farbtabellen",
  "upload.libraryBody":
    "Bis zu {count}. Eine Tabelle gilt für das eine, wofür sie sich ausgibt, deshalb können eine Reflektivitäts- und eine Geschwindigkeitsskala gleichzeitig aktiv sein.",
  "upload.useFor": "Für {unit} verwenden",
  "upload.inForce": "Gilt für {unit}",
  "upload.removePalette": "{name} entfernen",
  "upload.asSupplied":
    "So gezeichnet, wie geliefert. Mehr Kontrast ändert die eingebauten Verläufe und nie eine Tabelle, die Sie geladen haben.",
  "diagnostics.eyebrow": "OpenRadar v{version}",
  "diagnostics.title": "Diagnose",
  "diagnostics.renderer": "Kartenrenderer",
  "diagnostics.rendererReady": "Bereit",
  "diagnostics.rendererUnknown":
    "Die Grafikkarte hat ihren Namen nicht genannt",
  "diagnostics.rendererStarting": "Startet",
  "diagnostics.timeline": "Radar-Zeitleiste",
  "diagnostics.receiving": "{source} · empfängt Bilder",
  "diagnostics.live": "Live",
  "diagnostics.waiting": "Wartet auf Daten",
  "diagnostics.failing": "{error} ({count} hintereinander)",
  "diagnostics.frames":
    "{count, plural, one {# Bild} other {# Bilder}}, {when}",
  "diagnostics.answered": "Geantwortet {when}",
  "diagnostics.standingBy": "Bereit",
  "diagnostics.neverContacted": "noch nicht kontaktiert",
  "diagnostics.underAMinute": "vor weniger als einer Minute",
  "diagnostics.ago": "vor {age}",
  "diagnostics.recentEvents": "Letzte Ereignisse",
  "diagnostics.openLogs": "Protokollordner öffnen",
  "diagnostics.forget": "Quellenverlauf vergessen",
  "diagnostics.forgot": "Vergessen. Neue Berichte beginnen hier.",
  "diagnostics.forgotten": "Der Quellenverlauf ist vergessen",
  "diagnostics.forgottenBody":
    "Was jede Quelle heute auf diesem Rechner getan hat, ist weg. Nichts baut es wieder auf.",
  "diagnostics.report": "Einen Bericht kopieren und öffnen",
  "diagnostics.reportFailed": "Die Berichtsseite ließ sich nicht öffnen",
  "diagnostics.reportFailedDetail":
    "Der Block liegt in Ihrer Zwischenablage. Öffnen Sie das Fehlerformular auf der Projektseite und fügen Sie ihn ein.",
  "diagnostics.copy": "Für einen Fehlerbericht kopieren",
  "diagnostics.whatIsCopied":
    "Der Bericht enthält die App-Version, Renderer und Plattform dieses Rechners, welche Quellen geantwortet haben, was auf der Festplatte liegt und das letzte Protokoll. Koordinaten im Protokoll sind auf etwa einen Kilometer gerundet und Kontonamen sind aus Dateipfaden entfernt.",
  "diagnostics.includePlace":
    "Meinen beobachteten Ort mitnehmen, auf etwa einen Kilometer gerundet",
  "diagnostics.watchedPlace": "Beobachteter Ort",
  "diagnostics.copied": "Diagnose kopiert",
  "diagnostics.copiedBody":
    "Version, Renderer, welche Quellen geantwortet haben und das Ende des Protokolls. Keine Koordinaten feiner als etwa ein Kilometer und keine Ordnernamen.",
  "diagnostics.copyFailed": "Die Diagnose ließ sich nicht kopieren",
  "diagnostics.copyFailedBody":
    "Die Zwischenablage hat abgelehnt. Derselbe Text liegt im Protokollordner.",
  "diagnostics.nothingWrong": "Bisher ist nichts schiefgegangen.",
  "diagnostics.updateAvailable": "OpenRadar {version} ist da",
  "diagnostics.updateReady": "Startet in die neue Version neu",
  "diagnostics.updateDownloading": "Wird geladen, {percent}%",
  "diagnostics.updateChecking": "Sucht nach einer neueren Version",
  "diagnostics.updateFailed":
    "Die Suche nach Aktualisierungen ist fehlgeschlagen",
  "diagnostics.version": "OpenRadar v{version}",
  "diagnostics.updateFallbackNotes":
    "Installieren Sie sie, und OpenRadar startet darin neu.",
  "diagnostics.upToDate": "Das ist die neueste Version.",
  "diagnostics.updateSource":
    "Aktualisierungen werden von den eigenen Releases des Projekts geladen.",
  "diagnostics.install": "{version} installieren",
  "diagnostics.check": "Nach Aktualisierungen suchen",
  "diagnostics.privateTitle": "Von Haus aus privat",
  "diagnostics.privateBody":
    "Einstellungen und importierte Überlagerungen bleiben auf diesem Gerät.",
  "diagnostics.disclaimerTitle": "Hinweis zum Einsatz",
  "diagnostics.disclaimerBody":
    "Nutzen Sie für Entscheidungen über Leben und Sicherheit die amtlichen Warnungen und die örtlichen Behörden.",

  "product.reflectivity": "Reflektivität",
  "product.stormRelative": "Sturmrelative Geschwindigkeit",
  "radar.stormMotion": "Sturmzug",
  "radar.stormMotionRead": "Aus dem Sweep gelesen: {speed} aus {from}°",
  "radar.stormMotionGiven": "Ihre Angabe: {speed} aus {from}°",
  "radar.stormMotionNone": "Aus diesem Sweep ließ sich kein Zug lesen",
  "radar.stormMotionSpeed": "Geschwindigkeit ({unit})",
  "radar.stormMotionFrom": "Aus",
  "radar.stormMotionClear": "Stattdessen aus dem Sweep lesen",
  "radar.hailAir": "Luft, gegen die die Größe gelesen wurde",
  "radar.hailAirStandard":
    "Die Standardatmosphäre, weil keine Radiosondierung geladen ist",
  "radar.hailAirSounding": "Aus {source}",
  "radar.hailAirHeights":
    "Gefrierpunkt bei {freezing}, minus zwanzig bei {cold}",
  "product.velocity": "Geschwindigkeit",
  "product.spectrumWidth": "Spektralbreite",
  "product.differential": "Differentielle Reflektivität",
  "product.correlation": "Korrelationskoeffizient",
  "product.longRange": "Reflektivität große Reichweite",
  "product.azimuthalShear": "Azimutale Scherung",
  "product.rotation": "Rotation",
  "product.specificDifferentialPhase": "Spezifische differentielle Phase",
  "product.compositeReflectivity": "Komposit-Reflektivität",
  "product.echoTop": "Echo-Obergrenze",
  "product.vil": "Vertikal integriertes Flüssigwasser",
  "product.vilDensity": "VIL-Dichte",
  "product.hailSize": "Hagelkorngröße",
  "radar.eyebrow": "Radarprodukt",
  "radar.title": "Komposit-Radar",
  "radar.composite": "Komposit-Reflektivität",
  "radar.compositeDetail": "Zweistundenschleife aus der aktiven Quelle",
  "radar.opacity": "Deckkraft",
  "radar.speed": "Tempo",
  "radar.speedValue": "{count}/s",
  "radar.history": "Verlauf",
  "radar.minutes": "{count} Min.",
  "radar.show": "Radar zeigen",
  "radar.showDetail":
    "Die Grundkarte sichtbar lassen, wenn das Radar ausgeblendet ist",
  "radar.singleSite": "Einzelstandort aus der Nähe",
  "radar.singleSiteDetail":
    "Ab Zoom {zoom} ersetzt der eigene Level-II-Sweep des nächsten NEXRAD-Standorts das landesweite Mosaik",
  "radar.dealias": "Geschwindigkeit entfalten",
  "radar.live": "Volumen im Aufbau",
  "radar.liveDetail":
    "Zeichnet den Sweep, den das Radar gerade macht, über den zuletzt fertigen. Das fertige Bild ist bei der Veröffentlichung vier bis sechs Minuten alt; dieses ist über dem Sektor, den das Radar erreicht hat, Sekunden alt und überall sonst unverändert.",
  "radar.smooth": "Den Sweep glätten",
  "radar.dealiasTdwr":
    "Die Geschwindigkeit eines Flughafenradars kommt bereits entfaltet an, hier ist also nichts herauszunehmen.",
  "radar.smoothTdwr":
    "Die Produkte eines Flughafenradars kommen bereits gezeichnet an, es gibt also keine Gates, zwischen denen zu lesen wäre.",
  "radar.smoothDetail":
    "Zwischen den Gates lesen statt das nächste zu nehmen. Nur das Bild: abgefragte Messwerte und exportierte Zahlen sind die Gates selbst.",
  "radar.persistence": "Phosphor-Nachleuchten",
  "radar.persistenceDetail":
    "Blendet den fertigen Sweep hinter dem aus, den das Radar gerade macht, wie es ein Phosphorschirm tut. An den Messwerten ändert sich nichts; die Legende nennt das Alter der älteren Hälfte ebenso wie der neueren, denn ein verblasstes Bild ist älter als ein unverblasstes.",
  "radar.archiveBrowse": "Archive II",
  "radar.archiveBrowseDetail":
    "Ein lokales Volumen offline öffnen oder das öffentliche Archiv der NOAA nach Standort und UTC-Zeit fragen",
  "radar.openArchiveTitle": "Ein NEXRAD-Archive-II-Volumen öffnen",
  "radar.openArchive": "Lokale Archive-II-Datei öffnen",
  "radar.archiveStation": "NEXRAD-Standort",
  "radar.archiveStationPlaceholder": "KDMX",
  "radar.archiveTime": "UTC-Datum und -Zeit",
  "radar.loadArchive": "Volumen aus dem öffentlichen Archiv laden",
  "radar.archiveReading": "Das gewählte Volumen wird gelesen",
  "radar.archiveUnavailable": "Das gewählte Volumen ist nicht verfügbar.",
  "radar.localArchive": "Lokales Archive II",
  "radar.publicArchive": "Öffentliches Archive II",
  "radar.archiveCurrent": "{source}, {time}",
  "radar.returnRecent": "Zurück zum aktuellen Radar",
  "radar.dealiasDetail":
    "Ein Wind, der schneller ist als das Radar messen kann, schlägt um und wird gezeichnet, als wehe er andersherum. Dies setzt ihn zurück.",
  "radar.sweepLine": "{station} · {site} · {product} bei {tilt}° · {age}",
  "radar.columnSweepLine": "{station} · {site} · {product} · {age}",
  "radar.columnHistoricalSweepLine": "{station}, {site}, {product}, {time}",
  "radar.historicalSweepLine":
    "{station}, {site}, {product} bei {tilt} Grad, {time}",
  "radar.justIn": "gerade angekommen",
  "radar.age": "{age} alt",
  "radar.reading": "Das neueste Volumen von {station} wird gelesen.",
  "radar.nearestSite": "der nächste Standort",
  "radar.zoomIn":
    "Zoomen Sie über den Vereinigten Staaten über {zoom} hinaus, um einen Standort hereinzuholen.",
  "radar.product": "Produkt",
  "radar.productLabel": "Level-II-Produkt",
  "radar.classification": "Klassifikation",
  "radar.classificationLabel": "Produkt zur Hydrometeor-Klassifikation",
  "radar.classificationDetail":
    "Welches Level-III-Produkt die Ebene Hydrometeor-Klassifikation liest: den untersten Elevationswinkel oder den Hybrid-Scan, in den das ganze Volumen gelesen wird",
  "radar.error.unknownSite": "{station} ist kein NEXRAD-Standort.",
  "radar.error.notWsr88d":
    "{station} ist das Terminalradar eines Flughafens: es hat kein Level-II-Volumen zu lesen und kein Archiv.",
  "radar.error.noLongerListed":
    "{station} steht nicht mehr auf der Radarliste des Wetterdienstes. Es wurde vielleicht umbenannt oder aus dem Netz genommen; wählen Sie einen anderen Standort.",
  "radar.error.noVolume":
    "Für {station} wurde heute und gestern noch kein Radarvolumen veröffentlicht.",
  "radar.error.badListing": "Die Volumenliste ließ sich nicht lesen.",
  "radar.error.decode": "Das Volumen ließ sich nicht dekodieren: {reason}",
  "radar.error.noSweep":
    "{station} hat bei diesem Elevationswinkel keinen {product}-Sweep.",
  "radar.error.noStormMotion":
    "Der Wind bei {station} ließ sich nicht lesen, es ist also nichts aus dem Bild herauszunehmen.",
  "radar.error.encode": "Das Bild konnte nicht gezeichnet werden: {reason}",
  "radar.error.invalidTime": "{at} ist kein UTC-Datum mit Uhrzeit.",
  "radar.error.localRead": "Die gewählte Datei ließ sich nicht lesen: {reason}",
  "radar.error.localTooLarge": "Die gewählte Datei ist größer als 128 MB.",
  "radar.error.noSection":
    "{product} ist bereits eine Aussage über die ganze Säule, es gibt also keinen Schnitt zu nehmen.",
  "radar.error.outOfRange":
    "Beide Enden eines Querschnitts müssen in Reichweite von {station} liegen.",
  "radar.error.httpStatus": "Das Radararchiv {answer}.",
  "radar.error.httpUnreachable":
    "Das Radararchiv war nicht erreichbar. Prüfen Sie, ob dieser Rechner online ist.",
  "radar.error.httpRefused":
    "OpenRadar wollte das nicht holen: die Adresse gehört nicht zu denen, die es erreichen darf.",
  "radar.error.httpTooLarge":
    "Das Radararchiv hat mehr geschickt, als OpenRadar auf einmal liest.",
  "bundle.error.httpStatus": "Der Wiedergabedienst {answer}.",
  "bundle.error.httpUnreachable":
    "Die Wiedergabe konnte nicht geholt werden. Prüfen Sie, ob dieser Rechner online ist.",
  "bundle.error.httpRefused":
    "OpenRadar wollte das nicht holen: die Adresse gehört nicht zu denen, die es erreichen darf.",
  "bundle.error.httpTooLarge":
    "Die Wiedergabe hat mehr geschickt, als OpenRadar auf einmal liest.",
  "radar.error.unknown": "Der Radarstandort hat nicht geantwortet.",
  "radar.dealiasForced":
    "Die sturmrelative Geschwindigkeit muss zuerst entfalten, denn der Wind, den sie herausnimmt, wird vom Sweep abgelesen",
  "radar.threshold": "Ausblenden unter",
  "radar.thresholdMosaic": "Ausblenden unter, im Mosaik",
  "radar.thresholdMosaicDetail":
    "Das Mosaik ist das stärkste Echo irgendwo in der Säule, seine Zahlen laufen also höher als die eines einzelnen Elevationswinkels",
  "radar.thresholdOff": "Alles",
  "radar.thresholdValue": "{value} {unit}",
  "radar.thresholdDetail":
    "Alles Schwächere bleibt aus dem Bild, damit die Kerne für sich stehen",
  "radar.thresholdSpeed":
    "Die Geschwindigkeit wird danach ausgeblendet, wie schnell und nicht wohin, deshalb gehen beide Richtungen zusammen",
  "radar.tilt": "Elevationswinkel",
  "radar.tiltLabel": "Level-II-Elevationswinkel",
  "radar.site": "Standort",
  "radar.siteLabel": "Radarstandort",
  "radar.terminalRadars": "Terminalradare (TDWR)",
  "radar.siteInReach": "{station} · {place} · {distance}",
  "radar.sitesInReach": "Radare, die diesen Ausschnitt sehen",
  "radar.siteWithFault": "{site} ({reason})",
  "radar.faultNoRecentData": "seit {age} nichts empfangen",
  "radar.siteStopped": "{station} sendet nicht mehr",
  "radar.holdInstead": "Stattdessen {station} festhalten",
  "radar.faultOffline": "sendet nicht",
  "radar.faultStartUp": "Das Radar fährt hoch. Es sollte gleich zurück sein.",
  "radar.faultNotOperating":
    "Das Radar tastet nicht ab. Das Amt meldet es als {state}.",
  "radar.terminalLine":
    "Terminal-Doppler-Wetterradar, Reichweite {range} · {source}",
  "radar.terminalProducts":
    "Das Terminalradar eines Flughafens veröffentlicht nur Reflektivität und Geschwindigkeit, bis 48 Seemeilen, mit einer Reflektivität großer Reichweite bis 225. Die anderen Produkte bleiben nicht verfügbar, solange es festgehalten wird.",
  "radar.followMap": "Der Karte folgen",
  "radar.hold": "{station} festhalten",
  "radar.stationHeld": "{station}, {distance} von {home}, veröffentlicht.",
  "radar.stationQuiet":
    "{station}, {distance} von {home}. Seit {count} Min. nichts Neues.",
  "radar.opacityLabel": "Deckkraft des Radars",

  "command.group.layer": "Ebene",
  "command.group.product": "Radarprodukt",
  "command.group.style": "Kartentyp",
  "command.group.panel": "Feld",
  "command.group.tool": "Werkzeug",
  "command.group.layout": "Layout",
  "keywords.ambientScreen":
    "ambiente, zweiter monitor, bildschirm, vollbild, kiosk, wand",
  "keywords.capture": "",
  "keywords.home": "",
  "layer.probSevere": "Unwetterwahrscheinlichkeit",
  "layers.probSevereDetail":
    "Was ein Modell in der nächsten Stunde von jedem Sturm erwartet, also Hinweis und nicht Warnung",
  "probSevere.title": "Unwetterwahrscheinlichkeit",
  "probSevere.unread":
    "Die Unwetterwahrscheinlichkeiten ließen sich nicht lesen.",
  "probSevere.stale":
    "Der letzte Messwert ist über fünfzehn Minuten alt, er handelt also von Stürmen, die weitergezogen sind. Es wird nichts gezeichnet, bis ein frischer veröffentlicht ist.",
  "probSevere.headline":
    "{percent}% Wahrscheinlichkeit für Unwetter in der nächsten Stunde",
  "probSevere.kinds": "Hagel {hail}% · Wind {wind}% · Tornado {tornado}%",
  "probSevere.note":
    "Ein Modell, das Radar, Satellit und die Luft um den Sturm liest. Es ist keine Warnung, und eine kleine Zahl ist kein Versprechen.",
  "layer.stormCells": "Sturmzellen",
  "layers.stormCellsDetail":
    "Was der eigene Verfolgungsalgorithmus des Radars verfolgt, mit dem Weg jedes Sturms",
  "layer.classification": "Hydrometeor-Klassifikation",
  "layers.classificationDetail":
    "Was der eigene Algorithmus des festgehaltenen Standorts als fallend meldet: Regen, Schnee, Hagel oder dass er es nicht sagen kann",
  "hydrometeor.iceCrystals": "Eiskristalle",
  "hydrometeor.drySnow": "Trockener Schnee",
  "hydrometeor.wetSnow": "Nasser Schnee",
  "hydrometeor.graupel": "Graupel",
  "hydrometeor.rain": "Regen",
  "hydrometeor.heavyRain": "Starkregen",
  "hydrometeor.bigDrops": "Große Tropfen",
  "hydrometeor.hail": "Hagel",
  "hydrometeor.largeHail": "Großer Hagel",
  "hydrometeor.giantHail": "Riesiger Hagel",
  "hydrometeor.unknown": "Unbekannt",
  "classification.lowestTilt": "Unterster Winkel (N0H)",
  "classification.unread": "Die Klassifikation ließ sich nicht lesen.",
  "classification.hybridScan": "Hybrid-Scan (HHC)",
  "chrome.classificationNote":
    "Der eigene Algorithmus des Radars benennt, wonach seine dualpolarimetrischen Momente aussehen. Es ist keine Meldung vom Boden.",
  "layer.stormReports": "Sturmmeldungen",
  "layers.stormReportsDetail":
    "Was Menschen am Boden am letzten Tag tatsächlich gesehen haben: Hagel, Windschäden, Tornados, Überflutung",
  "keywords.stormReports": "lokale sturmmeldung bodenwahrheit spotter",
  "reports.serviceStatus": "Der Sturmmeldedienst {answer}.",
  "reports.measured": "{value} {unit}",
  "reports.reported": "Gemeldet {when}",
  "reports.reportedUnknown": "Meldezeit unbekannt",
  "reports.source": "Aus {source}",
  "layer.hailSwath": "Hagelzug",
  "layers.hailSwathDetail":
    "Der größte Hagel, den das Netz am vergangenen Tag irgendwo gesehen hat",
  "layer.echoTops": "Echo-Obergrenzen",
  "layers.echoTopsDetail":
    "Wie hoch der Sturm reicht, also wie hart er arbeitet",
  "layer.vil": "Flüssigwasser in der Höhe",
  "layers.vilDetail":
    "Wie viel Wasser die Säule trägt, wo Hagel sich zeigt, bevor er landet",
  "layer.precipRate": "Regenrate",
  "layers.precipRateDetail": "Wie stark es gerade herunterkommt",
  "layer.qpeHour": "Regen, letzte Stunde",
  "layers.qpeHourDetail": "Wie viel in der letzten Stunde gefallen ist",
  "layer.qpeDay": "Regen, letzter Tag",
  "layer.counties": "Landkreise",
  "layer.night": "Tag und Nacht",
  "layers.nightDetail":
    "Ein Schleier über die Hälfte der Welt, auf der die Sonne nicht steht, hier berechnet statt geholt. Er folgt dem Bild, das Sie ansehen, deshalb zeigt ein Zurückspulen oder die Wiedergabe eines alten Sturms, wo die Sonne damals stand, und er liegt unter allem anderen auf der Karte.",
  "layer.gaugeQpe": "Regen, an Messern korrigiert",
  "layer.unitStreamflow": "Modellierter Abfluss",
  "layer.ffgThreeHour": "Sturzflut-Richtwert, 3 h",
  "layer.ffgHour": "Sturzflut-Richtwert, 1 h",
  "layers.qpeDayDetail": "Wie viel seit dieser Zeit gestern gefallen ist",
  "counties.failed": "Die Landkreisgrenzen ließen sich nicht lesen.",
  "layers.countiesDetail":
    "Landkreis- und Staatsgrenzen, denn danach sind Warnungen und Sturmmeldungen formuliert",
  "layers.gaugeQpePeriod": "Wie weit zurück",
  "layers.gaugeQpeDetail":
    "Radarniederschlag, zurückgezogen auf das, was die meldenden Regenmesser tatsächlich aufgefangen haben. Näher an der Wahrheit als Radar allein, und überall dort, wo kein Messer steht, weiterhin eine Schätzung.",
  "layers.unitStreamflowDetail":
    "Was das Sturzflutmodell von jedem Quadratkilometer ablaufen lässt. Ein Modell des Bodens, keine Messung des Himmels.",
  "layers.ffgThreeHourDetail":
    "Dasselbe über drei Stunden, das Fenster, in dem sich eine langsamere Flut aufbaut",
  "layers.ffgHourDetail":
    "Wie sich die letzte Regenstunde zu dem verhält, was der Boden dort nach Angabe des Amtes aufnehmen kann. 100% heißt, der Regen hat es erreicht.",
  "layer.precipType": "Regen oder Schnee",
  "layers.precipTypeDetail":
    "Was nach Angabe des Netzes tatsächlich fällt, und nicht wie stark",
  "keywords.precipType": "schnee graupel gefrierend winter art",
  "layer.snowfall": "Schneehöhe",
  "layers.snowfallDetail":
    "Wie viel Schnee die landesweite Analyse als gefallen meldet, über den letzten Tag, zwei oder drei",
  "keywords.snowfall": "neuschnee summe hoehe zentimeter winter nohrsc",
  "snowfall.24h": "24 Stunden",
  "snowfall.48h": "48 Stunden",
  "snowfall.72h": "72 Stunden",
  "snowfall.band": "{low} bis {high}",
  "snowfall.bandTop": "{low} und mehr",
  "precipType.warmStratiform": "Regen",
  "precipType.coolStratiform": "Regen, kalt",
  "precipType.snow": "Schnee",
  "precipType.convection": "Konvektiver Regen",
  "precipType.hail": "Hagel",
  "precipType.tropicalStratiform": "Tropischer Regen",
  "precipType.tropicalConvection": "Tropischer konvektiver Regen",
  "chrome.precipTypeNote":
    "Die eigene Klassifikation des Netzes, aus Radar und Modelltemperatur zusammen, keine Meldung vom Boden",
  "layer.spcOutlooks": "Unwetterausblick",
  "layer.wpcExcessiveRain": "Ergiebiger Regen",
  "layer.wpcWinterSeverity": "Winterstürme, Schwere",
  "layers.spcOutlooksDetail":
    "Das Risiko schwerer Stürme heute nach dem Storm Prediction Center, in dessen eigenen Farben",
  "layers.wpcExcessiveRainDetail":
    "WPC-Ausblick für Regen, der stark genug für Sturzfluten ist",
  "layers.wpcWinterSeverityDetail":
    "WPC-Index dafür, was ein Wintersturm einem Ort antut, nicht wie viel fällt",
  "layers.wpcDay": "Für welchen Tag der Ausblick gilt",
  "layers.wssiDay": "Für welchen Tag der Index gilt",
  "layers.outlookDay": "Tag {day}",
  "layer.spcDiscussions": "Mesoskalige Besprechungen",
  "layers.spcDiscussionsDetail":
    "Worauf die Vorhersagenden gerade schauen, ein bis zwei Stunden vor jeder Warnung",
  "spc.serviceStatus": "Der Dienst des Storm Prediction Center {answer}.",
  "wpc.serviceStatus": "Der Dienst des Weather Prediction Center {answer}.",
  "wpc.eroTitle": "Ausblick auf ergiebigen Regen",
  "wpc.wssiTitle": "Schwereindex für Winterstürme",
  "wpc.validWindow": "Gültig {window}",
  "wpc.issued": "Ausgegeben {when}",
  "wpc.wssiNote":
    "Auswirkung statt Menge: was so viel Winterwetter diesem Ort antut.",
  "wpc.outlookNote":
    "Ein Ausblick, keine Warnung. Er sagt, was der Tag bringen kann, nicht was geschieht.",
  "spc.outlookDay": "Konvektiver Ausblick Tag {day}",
  "spc.validBetween": "Gültig {from} bis {to} UTC",
  "spc.guidanceNote":
    "Das ist ein Hinweis darauf, was geschehen kann, keine Warnung.",
  "spc.discussion": "Mesoskalige Besprechung",
  "spc.issued": "Ausgegeben {when}",
  "spc.issuedUnknown": "Ausgabezeit unbekannt",
  "layer.weatherAlerts": "Wetterwarnungen",
  "layer.earthquakes": "Erdbeben",
  "layer.wildfires": "Waldbrände",
  "layer.smoke": "Rauch",
  "layer.forecastSmoke": "Rauchvorhersage",
  "layer.metar": "Bodenbeobachtungen",
  "layer.tropical": "Tropisch",
  "layer.satellite": "Satellit",
  "satellite.geocolor": "GeoColor",
  "satellite.geocolorDetail":
    "Das Tageslichtbild, wie das Auge es sähe. Über Sturmoberseiten wird es nachts dunkel.",
  "satellite.geocolorLegend": "Eine Darstellung, keine Messung",
  "satellite.cleanIr": "Reines Infrarot",
  "satellite.cleanIrDetail":
    "Band 13, 10,3 µm. Die Temperatur von allem, dessen Oberseite der Satellit sieht, die um Mitternacht dasselbe zeigt wie mittags.",
  "satellite.cleanIrLegend":
    "Strahlungstemperatur, −92 bis +57 °C, eingefärbt von NASA GIBS",
  "satellite.redVisible": "Rot sichtbar",
  "satellite.redVisibleDetail":
    "Das sichtbare Halbkilometerband: der schärfste Blick auf eine Wolkenoberseite bei Tag, und nachts dunkel",
  "satellite.redVisibleLegend":
    "Zurückgeworfenes Sonnenlicht, deshalb wird es nachts dunkel",
  "satellite.airMass": "Luftmasse",
  "satellite.airMassDetail":
    "Wasserdampf und Ozon zusammen, dort zeigen sich ein Jetstream und ein trockener Einschub",
  "satellite.airMassLegend": "Eine Falschfarbenmischung, keine Temperatur",
  "satellite.dust": "Staub",
  "satellite.dustDetail":
    "Aufgewirbelter Staub und Asche, an ihrer Infrarotabsorption von Wolken unterschieden",
  "satellite.dustLegend": "Eine Falschfarbenmischung, keine Konzentration",
  "satellite.fireTemp": "Feuertemperatur",
  "satellite.fireTempDetail":
    "Die kurzwelligen Infrarotbänder, in denen eine heiße Feuerfront durch den Rauch hervortritt",
  "satellite.fireTempLegend":
    "Heißere Brände erscheinen heller; es ist kein Brandumriss",
  "satellite.east": "GOES-East",
  "satellite.west": "GOES-West",
  "satellite.himawari": "Himawari",
  "satellite.showing": "Zeigt {satellite}, der über diesem Ausschnitt steht.",
  "satellite.stepped":
    "Der neueste Zeitpunkt wurde nicht veröffentlicht, das hier ist also ein früherer.",
  "satellite.notThere":
    "{satellite} hat hier kein {band}, das hier ist also reines Infrarot.",
  "satellite.product": "Satellitenansicht",
  "layer.rotationTracks": "Rotationsspuren",
  "layer.azShear": "Azimutale Scherung",
  "layer.hail": "Hagelkorngröße",
  "layer.vilDensity": "Flüssigwasserdichte",
  "layer.shi": "Schwerer-Hagel-Index",
  "layer.posh": "Hagelwahrscheinlichkeit",
  "layer.vii": "Integriertes Eis",
  "layer.lightningDensity": "Blitzdichte",
  "layer.lightningFlashes": "Blitze",
  "lightning.unanswered": "Der Blitzkanal hat nicht geantwortet.",
  "layer.customOverlay": "Eigene Überlagerung",
  "panel.search": "Suche",
  "panel.alerts": "Warnungen",
  "panel.tropical": "Tropisch",
  "panel.history": "Sturmgeschichte",
  "panel.route": "Route",
  "panel.forecast": "Vorhersage",
  "panel.export": "Exportieren",
  "panel.upload": "Hochladen",
  "panel.layers": "Ebenen",
  "panel.mapType": "Kartentyp",
  "panel.settings": "Optionen",
  "panel.more": "Diagnose",
  "panel.radarProducts": "Radarprodukte",
  "panel.nearby": "Wetter in der Nähe",
  "keywords.nearby":
    "barrierefrei screenreader worte entfernung richtung stuerme nahe",
  "nearby.eyebrow": "Radar in Worten",
  "nearby.title": "Wetter in der Nähe",
  "nearby.intro":
    "Was Radar und Warnungen über einen Ort sagen, für jemanden, der nicht auf die Karte schaut.",
  "nearby.place": "Rund um",
  "nearby.placeCentre": "Die Kartenmitte",
  "nearby.warningsHeading": "Warnungen über diesem Ort",
  "nearby.noWarnings": "Keine Warnungen über diesem Ort.",
  "nearby.warningsOff":
    "Warnungen sind ausgeschaltet, es gibt also nichts aufzuzählen. Schalten Sie die Ebene ein, um zu hören, was diesen Ort abdeckt.",
  "nearby.warningsFailed":
    "Die Warnungen ließen sich nicht prüfen, deshalb kann hier nicht stehen, was diesen Ort abdeckt.",
  "nearby.warningsLoading": "Die Warnungen werden geprüft.",
  "nearby.warning": "{headline}.",
  "nearby.warningTagged": "{headline}, gekennzeichnet als {tag}.",
  "nearby.warningUntil": "Gilt bis {when}.",
  "nearby.cellsHeading": "Nächste Stürme",
  "nearby.lightningHeading": "Blitze bei Ihren Orten",
  "nearby.noCells":
    "Die Verfolgung folgt keinem Sturm in der Nähe dieses Ortes.",
  "nearby.cellsOff":
    "Sturmzellen sind ausgeschaltet, es gibt also nichts aufzuzählen. Schalten Sie die Ebene ein, um zu hören, was das Radar verfolgt.",
  "nearby.cellsUnavailable":
    "Die Sturmverfolgung wird aus dem Radar selbst gelesen, was nur der Desktop-Build tut.",
  "nearby.cellsLoading": "Die Verfolgung des Radars wird gelesen.",
  "nearby.cellsFailed":
    "Die Verfolgung des Radars ließ sich nicht lesen, deshalb kann hier nicht stehen, wem sie folgt.",
  "nearby.cellAt": "{id} liegt {distance} nach {direction}.",
  "nearby.cellMoving": "Zieht nach {direction} mit {speed}.",
  "nearby.cellNewlyFound": "Neu gefunden, hat also noch keine Spur.",
  "nearby.cellRotating": "Das Radar fand darin Rotation.",
  "nearby.source": "Von {station}, beobachtet {when}.",
  "nearby.nothing": "Gerade nichts in der Nähe von {place}.",
  "nearby.keysHeading": "Die Karte ohne Maus bewegen",
  "nearby.keysBody":
    "Mit Tab auf die Karte, dann bewegen die Pfeiltasten sie und Plus und Minus zoomen. Mit Umschalt und einer Pfeiltaste drehen oder neigen Sie sie. Nichts auf der Karte braucht Ziehen.",
  "nearby.announcement": "{headline}. {body}",
  "follow.went": "Zur {headline} gesprungen",
  "follow.wentBody":
    "Neuen Warnungen folgen ist an. Bewegen Sie die Karte, dann lässt es Sie eine Weile in Ruhe.",
  "follow.stop": "Nicht mehr folgen",
  "watch.followNew": "Zu neuen Warnungen springen",
  "watch.followNewDetail":
    "Nimmt die Karte zu einer Warnung mit, sobald sie einen beobachteten Ort erreicht. Wer die Karte selbst bewegt, hält den Flug an und den nächsten eine Weile auch.",
  "watch.showRings": "Den Radius auf der Karte zeigen",
  "watch.showRingsDetail":
    "Zeichnet um jeden beobachteten Ort einen Ring in der Entfernung, die seine Regeln nutzen, damit Sie sehen, welche Stürme darin liegen. In einem exportierten Bild weggelassen.",
  "nearby.north": "Norden",
  "nearby.northeast": "Nordosten",
  "nearby.east": "Osten",
  "nearby.southeast": "Südosten",
  "nearby.south": "Süden",
  "nearby.southwest": "Südwesten",
  "nearby.west": "Westen",
  "nearby.northwest": "Nordwesten",
  "tool.draw": "Zeichnen",
  "tool.range": "Entfernung",
  "tool.inspect": "Inspektor",
  "tool.section": "Querschnitt",
  "section.eyebrow": "Level-II-Volumen",
  "section.title": "Querschnitt",
  "section.cutting": "Das Volumen wird entlang der Linie geschnitten",
  "section.holdSite": "Das nächste Radar festhalten",
  "section.noSite":
    "Zoomen Sie über einen NEXRAD-Standort, um sein Volumen zu schneiden.",
  "section.noUnit": "keine Einheit",
  "section.imageAlt":
    "{product} von {station}, {distance} breit und {top} hoch, als Höhe über Entfernung gezeichnet",
  "section.caption": "{product} ({unit}) · {station}, {site}",
  "section.collected": "Volumen erfasst {when}",
  "section.cuts":
    "Aus Schnitten zwischen {low}° und {high}° gezeichnet, von {count} im Volumen",
  "section.noCuts": "Kein Schnitt dieses Volumens erreicht die Linie.",
  "section.gaps":
    "Leere Bänder sind Höhen, durch die kein Strahl ging, kein Wetter, das nicht da ist.",
  "section.unfolded": "Die Geschwindigkeit wurde vor dem Schnitt entfaltet.",
  "section.partlyUnfolded":
    "{share}% des Volumens, aus dem dieser Schnitt stammt, sind weiterhin gefaltet.",
  "section.palette": "Mit der geladenen Farbtabelle gezeichnet.",
  "keywords.hailSwath": "hagelzug spur letzter tag",
  "keywords.azShear": "azimutale scherung mesozyklone couplet rotation",
  "keywords.posh": "wahrscheinlichkeit schwerer hagel chance",
  "keywords.shi": "schwerer hagel index kinetische energie",
  "keywords.vilDensity": "vil dichte fluessigkeit pro meter hagel",
  "keywords.vii": "vertikal integriertes eis gefroren hagel",
  "keywords.echoTops": "echo obergrenzen hoehe aufwind",
  "keywords.vil": "vertikal integriertes fluessigwasser",
  "keywords.precipRate": "regenrate intensitaet",
  "keywords.qpeHour": "summe stunde niederschlag",
  "keywords.qpeDay": "summe tag niederschlag",
  "keywords.counties": "landkreis grenzen staatsgrenzen linien",
  "keywords.night": "nacht tag dunkel sonne terminator daemmerung",
  "keywords.gaugeQpe": "messer korrigiert summe multisensor",
  "keywords.unitStreamflow": "abfluss wasser flut",
  "keywords.ffgThreeHour": "sturzflut richtwert drei stunden quote",
  "keywords.ffgHour": "sturzflut richtwert stunde quote",
  "keywords.spcOutlooks": "konvektiver ausblick kategorie tag eins",
  "keywords.wpcExcessiveRain": "sturzflut niederschlag ausblick wpc ero",
  "keywords.wpcWinterSeverity":
    "wintersturm schwere index wssi schnee auswirkung",
  "keywords.spcDiscussions": "mesoskalige besprechung kurzfristig",
  "keywords.weatherAlerts": "",
  "keywords.stormCells": "",
  "keywords.classification": "",
  "keywords.probSevere": "",
  "keywords.earthquakes": "",
  "keywords.wildfires": "",
  "keywords.smoke": "dunst luftqualitaet fahne hms",
  "keywords.forecastSmoke": "",
  "keywords.metar": "metar station flughafen taupunkt windfahne beobachtung",
  "keywords.riverGauges":
    "fluss hochwasser pegel stand scheitel wasserstand hydrologie",
  "keywords.buoys":
    "boje welle duenung marin seegang offshore ndbc verankerung brandung",
  "keywords.cocorahs":
    "regen pluviometer hagel freiwillige cocorahs beobachter meldung",
  "keywords.tropical": "",
  "keywords.satellite": "",
  "keywords.rotationTracks": "",
  "keywords.hail": "",
  "keywords.lightningDensity": "",
  "keywords.lightningFlashes": "",
  "keywords.windLayer": "",
  "keywords.customOverlay": "",
  "keywords.search": "",
  "keywords.alerts": "",
  "keywords.tropicalPanel": "",
  "keywords.history": "",
  "keywords.route": "",
  "keywords.forecast": "",
  "keywords.export": "",
  "keywords.upload": "",
  "keywords.layers": "",
  "keywords.findLayer": "",
  "keywords.mapType": "",
  "keywords.settings": "",
  "keywords.more": "",
  "keywords.radarProducts": "",
  "keywords.draw": "",
  "keywords.range": "",
  "keywords.inspect": "",
  "keywords.reflectivity": "",
  "keywords.velocity": "",
  "keywords.spectrumWidth": "",
  "keywords.differential": "",
  "keywords.correlation": "",

  "style.auto": "Zum Thema passend",
  "style.autoDetail":
    "Dunkel unter dem dunklen Arbeitsbereich, hell unter dem hellen",
  "style.grayscale": "Graustufen",
  "style.grayscaleDetail": "Zurückhaltende Beschriftung",
  "style.roads": "Straßen",
  "style.roadsDetail": "Straßendetails",
  "style.aerial": "Luftbild",
  "style.aerialDetail": "USGS-Bilder, nur USA",
  "style.topography": "Topografie",
  "style.topographyDetail": "Gelände und Höhenlinien",
  "style.radarDark": "Radar dunkel",
  "style.radarDarkDetail": "Blendarmes Radar",
  "style.radarLight": "Radar hell",
  "style.radarLightDetail": "Helle Fläche",
  "style.daylight": "Tageslicht",
  "style.daylightDetail": "Hohe Sichtbarkeit",

  "mapType.eyebrow": "Grundkarte und Kamera",
  "mapType.title": "Kartentyp",
  "mapType.projection": "Kartenprojektion",
  "mapType.flat": "Flach",
  "mapType.globe": "Globus",
  "layers.eyebrow": "Sichtbare Informationen",
  "layers.groupHazards": "Warnungen und Gefahren",
  "layers.groupRadar": "Vom Radar",
  "layers.groupWater": "Regen und Überflutung",
  "layers.groupLightning": "Blitze",
  "layers.groupSky": "Himmel und Luft",
  "layers.groupReference": "Referenz",
  "layers.groupYours": "Ihre eigenen Dateien",
  "layers.stateFresh": "aktuell",
  "layers.stateFetching": "wird geprüft",
  "layers.stateStale": "alt",
  "layers.stateFailed": "antwortet nicht",
  "layers.stateWaiting": "wartet",
  "layers.title": "Ebenen",
  "layers.alertsDetail": "Amtliche Vorwarnungen und Warnungen",
  "layers.earthquakesDetail":
    "USGS-Ereignisse über Magnitude 2,5 am vergangenen Tag",
  "layers.wildfiresDetail":
    "NIFC-Umrisse, ab den hundert Acres, die die NIFC veröffentlicht",
  "layers.smokeDetail":
    "Die von Hand gezeichnete Analyse der NOAA, einmal am Tag",
  "layers.forecastSmokeDetail":
    "Wohin das HRRR-Modell den bodennahen Rauch erwartet, Stunde für Stunde entlang der Vorhersage",
  "layers.metarDetail": "Flughafenmeldungen, als Stationsmodelle",
  "layer.riverGauges": "Flusspegel",
  "layer.buoys": "Bojen",
  "layer.aviation": "Luftfahrtgefahren",
  "layers.aviationDetail":
    "SIGMETs, G-AIRMETs, Lagehinweise der Zentren und Pilotenmeldungen, vom Aviation Weather Center. Nicht für die Flugplanung: nutzen Sie ein amtliches Briefing.",
  "keywords.aviation":
    "luftfahrt sigmet airmet gairmet pirep turbulenz vereisung cwa flugzeug flug",
  "aviation.failed": "Das Aviation Weather Center {answer}.",
  "aviation.title": "{what}",
  "aviation.validBetween": "Gültig {from} bis {to}",
  "aviation.validAt": "Gültig ab {time}",
  "aviation.severity": "Schwere: {severity}",
  "aviation.freezingLevel": "Nullgradgrenze bei {high} ft",
  "aviation.feet": "{feet} ft",
  "aviation.sfc": "dem Boden",
  "aviation.fzl": "der Nullgradgrenze",
  "aviation.between": "{low} bis {high}",
  "aviation.upTo": "Bis {high}",
  "aviation.atLevel": "Gemeldet bei {high}",
  "aviation.from": "Ab {low} aufwärts",
  "aviation.notForFlight":
    "Nicht für die Flugplanung. Nutzen Sie ein amtliches Briefing.",
  "aviation.sigmets": "SIGMETs",
  "aviation.gairmets": "G-AIRMETs",
  "aviation.cwas": "Lagehinweise der Zentren",
  "aviation.pireps": "Pilotenmeldungen",
  "aviation.partial": "Ohne {missing} gezeichnet, was nicht geantwortet hat.",
  "layers.buoysDetail":
    "Was die verankerten Bojen messen: den Wind über dem Wasser, die See, auf der sie reiten, und den Druck darüber. Eine landesweite Datei alle zehn Minuten, ab Zoom 4.",
  "buoys.failed": "Das Bojennetz {answer}.",
  "buoys.station": "Boje {station}",
  "buoys.wind": "Wind",
  "buoys.windFrom": "{speed} aus {from}°",
  "buoys.gusting": ", Böen {speed}",
  "buoys.waves": "Wellen",
  "buoys.wavesAt": "{height} alle {seconds} Sek.",
  "buoys.pressure": "Druck",
  "buoys.water": "Wasser",
  "buoys.air": "Luft",
  "buoys.observed": "Gemessen um {time}",
  "layer.cocorahs": "Pluviometer von Freiwilligen",
  "layers.cocorahsDetail":
    "Was Menschen heute Morgen im eigenen Garten gemessen haben, und der Hagel, den sie gemeldet haben. Ein Bundesstaat auf einmal, ab Zoom 6.",
  "layer.airnow": "Luftqualität",
  "layers.airnowDetail":
    "Was die Messgeräte am Boden diese Stunde gemessen haben, mit dem Index der EPA. Eine Beobachtung, anders als die Rauchvorhersage daneben.",
  "keywords.airnow": "luft qualitaet aqi rauch ozon verschmutzung pm25 atmen",
  "airnow.failed": "Das Luftqualitätsnetz {answer}.",
  "airnow.area": "{area}, {state}",
  "airnow.index": "AQI {aqi}, {category}",
  "airnow.indexAlone": "AQI {aqi}",
  "airnow.parameter": "Schlimmster Schadstoff: {parameter}",
  "airnow.actionDay": "Aktionstag für die Luftqualität",
  "airnow.measuredOn": "Gemessen am {day} um {clock}",
  "airnow.measuredAlone": "Gemessen um {hour}",
  "layer.firms": "Feuererkennungen",
  "layers.firmsDetail":
    "Jedes Pixel, das ein Satellit am letzten Tag brennen sah, Stunden bevor jemand einen Umriss darum zieht. Ab Zoom 4.",
  "keywords.firms": "feuer hotspot viirs satellit erkennung firms brand",
  "firms.failed": "Die Feuererkennungen {answer}.",
  "firms.partial": "Ohne {satellites} gezeichnet, was nicht geantwortet hat.",
  "firms.detection": "Heißes Pixel, {satellite}",
  "firms.confidence": "Vertrauen: {confidence}",
  "firms.power": "Strahlt {power} MW ab",
  "firms.brightness": "Feuerkanal bei {brightness} K",
  "firms.seen": "Gesehen um {time}",
  "firms.note":
    "Ein heißes Pixel, kein bestätigtes Feuer. Fackeln, Öfen und Sonnenreflexe lassen eines ebenso aufleuchten.",
  "cocorahs.failed": "Das Netz der Freiwilligen {answer}.",
  "cocorahs.partial":
    "Keine Antwort für {states}, deshalb wird dort nichts gezeichnet.",
  "cocorahs.gauge": "Pluviometer {station}",
  "cocorahs.hailAt": "Hagel bei {station}",
  "cocorahs.total": "Regen: {depth}",
  "cocorahs.noTotal": "Gemeldet, ohne Summe",
  "cocorahs.largest": "Größtes Korn: {size}",
  "cocorahs.average": "Mittleres Korn: {size}",
  "cocorahs.duration":
    "Fiel {count, plural, one {# Minute} other {# Minuten}} lang",
  "cocorahs.observed":
    "Abgelesen um {when}, nach der Uhr der beobachtenden Person",
  "layers.riverGaugesDetail":
    "Was die Flüsse nahe dem Sturm jetzt anzeigen und was das Vorhersageamt von ihnen erwartet. Nur nahe Punkte, ab Zoom 7.",
  "rivers.observed": "Beobachtet {stage} um {when}",
  "rivers.forecast": "Vorhergesagt {stage} bis {when}",
  "rivers.noObservation": "Keine aktuelle Beobachtung von diesem Pegel.",
  "rivers.noForecast": "Keine aktuelle Vorhersage für diesen Pegel.",
  "rivers.timeUnknown": "eine ungenannte Zeit",
  "rivers.category": "In {category}m Hochwasser",
  "rivers.categoryNone": "Unter der Hochwassermarke",
  "rivers.categoryUnknown":
    "Dieser Pegel hat keine Hochwassermarken oder meldet keine.",
  "rivers.rising":
    "Das Amt erwartet, dass dieser schlimmer wird, als er jetzt ist.",
  "rivers.office": "Vorhergesagt von {office}",
  "rivers.flood.major": "schwere",
  "rivers.flood.moderate": "mäßige",
  "rivers.flood.minor": "geringe",
  "rivers.flood.action": "Handlungsmarke",
  "rivers.failed": "Der National Water Prediction Service {answer}.",
  "rivers.zoom": "Zoomen Sie hinein, um die Pegel nahe dem Sturm zu sehen.",
  "rivers.replay":
    "Flusspegel sind aktuell, deshalb werden sie zurückgehalten, solange eine Wiedergabe auf der Karte liegt.",
  "sounding.failed": "Das Höhenwetterarchiv {answer}.",
  "sounding.failedModel": "Das Modell {answer}.",
  "sounding.hereLabel": "Die Kartenmitte",
  "sounding.eyebrow": "Höhenwetter",
  "sounding.title": "Radiosondierung",
  "sounding.which": "Welche Sondierung",
  "sounding.observed": "Beobachtet",
  "sounding.forecast": "Vorhergesagt",
  "sounding.isObserved": "Ein Ballon, der aufgestiegen ist",
  "sounding.isForecast": "Die Schätzung eines Modells für eine Luftsäule",
  "sounding.where": "{place}, {when}",
  "sounding.loadingObserved": "Der nächste Ballon wird gesucht, {site}",
  "sounding.loadingForecast": "Das Modell wird nach dieser Säule gefragt",
  "sounding.noneObserved":
    "In den letzten zwei Tagen kein Ballon in der Nähe. Höhenwetteraufstiege gibt es zweimal am Tag an etwa neunzig Standorten, ein Ort weit weg von einem hat also nichts zu zeigen.",
  "sounding.noneForecast": "Das Modell hat für hier keine Säule.",
  "sounding.failedAny": "Die Sondierung ließ sich nicht lesen.",
  "sounding.failedTitle": "Die Sondierung ließ sich nicht lesen",
  "sounding.chartLabel": "Skew-T-log-P-Diagramm für {place}",
  "sounding.chartNote":
    "Temperatur und Taupunkt gegen den Druck. Die Isothermen neigen sich nach rechts, damit sich die beiden Kurven trennen; die dünnen Kurven dahinter sind Trockenadiabaten, Feuchtadiabaten und Mischungsverhältnis.",
  "sounding.hodographLabel": "Hodograph des Windes durch die Säule",
  "sounding.hodographNote":
    "Der Wind durch die untersten neun Kilometer, aufgetragen, wie er dreht. Die Ringe liegen zehn Knoten auseinander, die Einheit, in der ein Hodograph immer gezeichnet wird, und der Punkt ist der Boden.",
  "sounding.cape": "CAPE",
  "sounding.cin": "CIN",
  "sounding.lcl": "Wolkenuntergrenze (LCL)",
  "sounding.lfc": "LFC",
  "sounding.el": "Obergrenze (EL)",
  "sounding.shear6": "Scherung 0 bis 6 km",
  "sounding.freezing": "Nullgradgrenze",
  "sounding.water": "Niederschlagbares Wasser",
  "sounding.none": "Keine",
  "sounding.assumptions":
    "Hier gerechnet, nicht vom Amt: ein Paket vom Boden gehoben, trocken bis zu seinem Kondensationsniveau und darüber gesättigt, ohne Korrektur der virtuellen Temperatur. Ein anderes Programm mit einem Paket aus der Mischungsschicht oder mit dieser Korrektur gibt für dieselbe Luft eine andere Zahl.",
  "sounding.credit": "Aus {source}.",
  "sounding.mixingNote":
    "Linien des Mischungsverhältnisses, in Gramm je Kilogramm: {values}.",
  "layers.tropicalDetail": "NHC-Kegel, Zugbahnen und Entwicklungsausblicke",
  "layers.satelliteDetail":
    "Satellitenbilder unter dem Radar, von GOES-East, GOES-West oder Himawari, je nachdem, wer über dem Ausschnitt steht",
  "layers.rotationDetail":
    "MRMS-Azimutalscherung, aufsummiert über das von Ihnen gewählte Fenster",
  "layers.rotationPeriod": "Wie weit die Spur zurückreicht",
  "layers.azShearDetail":
    "MRMS-Azimutalscherung, wie sie gerade steht, nicht aufsummiert",
  "layers.azShearLevel": "Welche Schicht des Sturms gemessen wird",
  "rotationPeriod.30m": "30 Min.",
  "rotationPeriod.1h": "1 Stunde",
  "rotationPeriod.2h": "2 Stunden",
  "rotationPeriod.4h": "4 Stunden",
  "rotationPeriod.24h": "1 Tag",
  "azShearLevel.low": "0 bis 2 km",
  "azShearLevel.mid": "3 bis 6 km",
  "azShearLevel.midNote":
    "Über 10 hier durch ist nach der eigenen Lesart des Wetterdienstes eine tiefe Mesozyklone.",
  "azShearLevel.lowNote":
    "Die Schicht, aus der eine Tornadowarnung begründet wird, wo ein Couplet den Boden erreicht.",
  "layers.hailDetail": "MRMS-Schätzung der größten Hagelkorngröße",
  "layers.vilDensityDetail":
    "Flüssigwasser geteilt durch die Tiefe des Echos, das unterscheidet einen nassen Sturm von einem Hagelsturm",
  "layers.shiDetail":
    "Die kinetische Hagelenergie, aus der Wahrscheinlichkeit und Größe beide berechnet werden",
  "layers.poshDetail":
    "MRMS-Wahrscheinlichkeit, dass der Hagel am Boden schwer ist",
  "layers.viiDetail": "Wie viel Eis die Säule über der Nullgradgrenze trägt",
  "layers.lightningDensityDetail":
    "MRMS-Wolke-Boden-Blitze der letzten fünf Minuten",
  "layers.lightningFlashesDetail":
    "GOES-East-Gesamtblitze, Wolkenblitze eingeschlossen",
  "layers.wind": "Wind",
  "layers.windDetail": "Animierter GFS-Wind in zehn Metern",
  "layers.customDetail": "Lokaler GeoJSON-Arbeitsbereich",
  "mrms.rotation": "Rotationsspuren, letzte Stunde",
  "mrms.rotation30": "Rotationsspuren, letzte 30 Min.",
  "mrms.rotation120": "Rotationsspuren, letzte 2 Stunden",
  "mrms.rotation240": "Rotationsspuren, letzte 4 Stunden",
  "mrms.rotation1440": "Rotationsspuren, letzter Tag",
  "mrms.azShearLow": "Azimutale Scherung, 0 bis 2 km",
  "mrms.azShearMid": "Azimutale Scherung, 3 bis 6 km",
  "mrms.vilDensity": "Flüssigwasser je Meter Säule",
  "mrms.shi": "Schwerer-Hagel-Index",
  "mrms.posh": "Wahrscheinlichkeit schweren Hagels",
  "mrms.vii": "Vertikal integriertes Eis",
  "mrms.mesh": "Geschätzte größte Hagelkorngröße",
  "mrms.echoTops": "Echo-Obergrenzen",
  "mrms.vil": "Vertikal integriertes Flüssigwasser",
  "mrms.precipRate": "Regenrate",
  "mrms.qpeHour": "Regen der letzten Stunde",
  "mrms.qpeDay": "Regen des letzten Tages",
  "gaugeQpe.72h": "3 Tage",
  "gaugeQpe.24h": "1 Tag",
  "gaugeQpe.1h": "1 Stunde",
  "mrms.gaugeQpeThreeDay": "Regen der letzten drei Tage, an Messern korrigiert",
  "mrms.gaugeQpeDay": "Regen des letzten Tages, an Messern korrigiert",
  "mrms.gaugeQpeHour": "Regen der letzten Stunde, an Messern korrigiert",
  "mrms.unitStreamflow": "Modellierter Abfluss",
  "mrms.ffgThreeHour":
    "Regen gegen den Sturzflut-Richtwert, letzte drei Stunden",
  "mrms.ffgHour": "Regen gegen den Sturzflut-Richtwert, letzte Stunde",
  "mrms.hailSwath": "Größter Hagel des letzten Tages",
  "mrms.lightning": "Wolke-Boden-Blitze, 5 Min.",
  "mrms.precipType": "Niederschlagsart",
  "mrms.cappiReflectivity": "Zusammengeführte Reflektivität in einer Höhe",
  "mrms.cappiRhohv": "Zusammengeführte Korrelation in einer Höhe",
  "mrms.cappiZdr":
    "Zusammengeführte differentielle Reflektivität in einer Höhe",
  "layer.cappi": "Zusammengeführtes Gitter in einer Höhe",
  "layer.cappiDetail":
    "Eine Höhe des landesweiten Gitters, aus dem das Komposit gebaut ist, statt der ganzen Säule auf einmal. Wo der Hagelkern liegt, nicht wie groß der Hagel ist.",
  "layers.cappiField": "Welches Feld",
  "layers.cappiReflectivity": "Reflektivität",
  "layers.cappiCorrelation": "Korrelation",
  "layers.cappiDifferential": "Differentiell",
  "layers.cappiHeight": "Höhe",
  "layers.cappiNote":
    "Das Netz veröffentlicht diese in dreiunddreißig Höhen. Korrelation unter 0,8 ist meist kein Wetter: Vögel, Düppel oder von einem Tornado hochgerissene Trümmer.",

  "layers.note":
    "Jeder Schalter hier speichert sich beim Drücken. Warnungen kommen vom NWS, von ECCC und vom DWD, Erdbeben vom USGS und Brandumrisse von der NIFC.",
  "settings.eyebrow": "OpenRadar-Einstellungen",
  "settings.title": "Einstellungen",
  "settings.appearance": "Aussehen",
  "settings.reading": "Lesen",
  "settings.readingDetail": "Die Sprache, die Einheiten, die Uhr und die Größe",
  "settings.desktop": "Desktop",
  "settings.desktopDetail": "Fenster, die Taskleiste und der zweite Bildschirm",
  "settings.character": "Charakter",
  "settings.characterDetail":
    "Wie viel die App von sich aus sagt, und nichts davon, solange eine Warnung gilt",
  "settings.appliesNow": "Gilt sofort",
  "settings.systemColours":
    "Ihr System nutzt ein Kontrastthema, es wählt also die Farben. Hell und dunkel liegen bei ihm, solange das an ist.",
  "settings.theme": "Thema",
  "settings.dark": "Dunkel",
  "settings.light": "Hell",
  "settings.accent": "Akzentfarbe",
  "occasion.spring": "Frühling",
  "occasion.summer": "Sommer",
  "occasion.autumn": "Herbst",
  "occasion.midwinter": "Mittwinter",
  "occasion.notice":
    "Der Arbeitsbereich trägt die Jahreszeit. Auf der Karte hat sich nichts geändert.",
  "occasion.notThisYear": "Dieses Jahr nicht",
  "settings.ambient": "Wetter auf der Leiste",
  "settings.ambientDetail":
    "Regen, Schnee oder Nebel auf der Befehlsleiste, solange die Station nahe Ihrem beobachteten Ort das meldet. Nie über der Karte, und es hört auf, wenn die Meldung veraltet.",
  "settings.ambientSeen": "Zeichnet, was {station} um {when} gemeldet hat.",
  "settings.ambientQuiet":
    "Nichts zu zeichnen: keine Station in Ihrer Nähe meldet Wetter.",
  "settings.ambientNeedsWatch":
    "Es wird nichts gezeichnet, solange Sie keinen Ort beobachten: an diesem Ort wird das Wetter abgelesen.",
  "settings.ambientDropped":
    "Angehalten: dieses Fenster kam nicht mit, deshalb hat sich der Effekt selbst abgeschaltet. Schalten Sie ihn aus und wieder ein, um es erneut zu versuchen.",
  "settings.occasions": "Jahreszeitliches Aussehen",
  "settings.occasionsDetail":
    "Ein Wechsel des Akzents für ein paar Wochen im Jahr. Er erreicht die Karte nie und tritt zurück, solange dort, wo Sie beobachten, eine Warnung gilt.",
  "settings.accentDetail":
    "Die Farbe auf Überschriften, Schaltern und dem Fokusrahmen. Sie erreicht nie eine Radarskala, einen Warnumriss oder eine Sturmspur.",
  "settings.themeInForce": "{name} gilt über dem eingebauten Aussehen.",
  "settings.themeClear": "Zurück zum eingebauten Aussehen",
  "settings.themeRemoved": "{name} entfernt",
  "settings.themeRemovedBody":
    "Der Arbeitsbereich ist zurück beim eingebauten Aussehen.",
  "settings.themeNote":
    "Ziehen Sie eine Themendatei auf das Upload-Feld, um mehr als die Farbe zu ändern. Ein Thema erreicht den Arbeitsbereich rund um die Karte und nichts darauf.",
  "settings.radar": "Komposit-Radar",
  "settings.baseReflectivity": "Basisreflektivität",
  "settings.opacity": "Deckkraft",
  "settings.opacityLabel": "Deckkraft des Radars",
  "settings.animationSpeed": "Animationstempo",
  "settings.animationSpeedLabel": "Animationstempo des Radars",
  "settings.loopLength": "Länge der Schleife",
  "settings.siteLoopLength": "Länge der Standortschleife",
  "settings.loopLengthLabel": "Länge der Schleife in Minuten",
  "settings.siteLoopLengthLabel": "Länge der Standortschleife in Volumina",
  "settings.minutes": "{count} Min.",
  "settings.volumes": "{count, plural, one {# Volumen} other {# Volumina}}",
  "settings.futureRadar": "Zukunftsradar",
  "settings.futureRadarDetail":
    "Verlängert die Schleife mit der HRRR-Vorhersagereflektivität über den unteren achtundvierzig Staaten",
  "settings.showRadar": "Radar zeigen",
  "settings.showRadarDetail":
    "Die Grundkarte sichtbar lassen, wenn das Radar ausgeblendet ist",
  "cells.eyebrow": "Sturmzellen",
  "mrms.unanswered": "Die MRMS-Gitter haben nicht geantwortet.",
  "wind.unread": "Das Windfeld ließ sich nicht lesen.",
  "smoke.unanswered": "Die Rauchvorhersage ist nicht angekommen.",
  "snowfall.unanswered": "Die Schneeanalyse ist nicht angekommen.",
  "cells.unread": "Die Sturmzellen ließen sich nicht lesen.",
  "cells.arriving":
    "{id} erreicht den Ort, den Sie beobachten, in {count} Min.",
  "approach.title": "Sturm auf dem Weg nach {place}",
  "approach.titleHome": "Sturm auf dem Weg zu Ihnen",
  "approach.body":
    "Das Radar verfolgt {id} und erwartet ihn in etwa {count} Min. bei Ihnen. Das ist eine Spur, keine Warnung.",
  "approach.setting": "Sag mir, wenn ein Sturm hierher unterwegs ist",
  "approach.settingDetail":
    "Das Radar verfolgt jeden Sturm und rechnet aus, wann er einen von Ihnen beobachteten Ort erreicht. Das ist Rechnen an einem ziehenden Fleck, keine Warnung von irgendwem.",
  "approach.window": "Wie viel Vorlauf Sie wollen",
  "approach.windowMinutes": "{count} Min.",
  "approach.sound": "Dafür einen Ton abspielen",
  "approach.soundDetail":
    "Aus, weil eine Warnung schon einen macht und dies keine Warnung ist",
  "approach.needsCells": "Braucht die Ebene Sturmzellen, die sie verfolgt.",
  "approach.needsPlace":
    "Braucht einen Ort zum Beobachten, denn dorthin wäre ein Sturm unterwegs.",
  "approach.heading": "Unterwegs",
  "approach.row": "{id} erreicht {place} in etwa {count} Min.",
  "approach.rowSoon": "{id} erreicht {place} jetzt",
  "approach.note": "Das Radar verfolgt diese Stürme, das ist keine Warnung.",
  "lightningWatch.title": "Blitze nahe {place}",
  "lightningWatch.titleHome": "Blitze in Ihrer Nähe",
  "lightningWatch.body":
    "{count, plural, one {# Blitz} other {# Blitze}} innerhalb von {miles} {unit}. Der Satellit sieht Licht über der Wolke, dies ist also keine Meldung darüber, was den Boden erreicht hat.",
  "lightningWatch.quietTitle": "{place} ist seit einer halben Stunde ruhig",
  "lightningWatch.quietTitleHome": "Seit einer halben Stunde ruhig",
  "lightningWatch.quietBody":
    "Seit dreißig Minuten kein Blitz innerhalb des Radius.",
  "lightningWatch.setting":
    "Sag mir etwas über Blitze nahe einem beobachteten Ort",
  "lightningWatch.settingDetail":
    "Zählt die vom Satelliten gesehenen Blitze in einem Radius, den Sie setzen, und sagt, wann es losgeht und wann eine halbe Stunde Ruhe war",
  "lightningWatch.needsPlace":
    "Braucht einen Ort zum Beobachten, denn darum liegt der Radius.",
  "lightningWatch.radius": "Wie weit um jeden Ort",
  "lightningWatch.count": "Ab wie vielen Blitzen es der Rede wert ist",
  "lightningWatch.countFlashes":
    "{count, plural, one {# Blitz} other {# Blitze}}",
  "lightningWatch.sound": "Dafür einen Ton abspielen",
  "lightningWatch.soundDetail":
    "Aus, weil eine Warnung schon einen macht und dies keine Warnung ist",
  "lightningWatch.note":
    "Vom Satelliten erkannte Blitze, keine Meldungen von Einschlägen am Boden.",
  "melting.title": "Schmelzschicht",
  "melting.source": "Aus dem {tilt}°-Schnitt dieses Volumens selbst",
  "melting.band": "Um {peak}, zwischen {bottom} und {top} über dem Radar.",
  "melting.note":
    "Das helle Band, das das Radar sieht, dort wo Schnee zu Regen wird. Die Hagelkorngröße darüber wird gegen die Radiosondierung gerechnet und nicht dagegen.",
  "melting.noHighTilt":
    "Dieses Volumen hat keinen Schnitt, der steil genug wäre, sie abzulesen.",
  "melting.missingMoment":
    "Dem hohen Schnitt fehlt eines der drei Momente, die dies braucht.",
  "melting.nothingMelting":
    "Nichts in diesem Volumen sieht nach schmelzendem Schnee aus.",
  "jump.badge": "Sprung der Blitzrate bei {id}",
  "jump.rate": "Jetzt {rate} je Minute, um {time}.",
  "jump.note":
    "Ein Signal, dass der Sturm sich verstärkt, keine Warnung. Vom Satelliten erkannte Blitze, keine Meldungen von Einschlägen am Boden.",
  "gridWatch.hailTitle": "Hagel geschätzt nahe {place}",
  "gridWatch.hailTitleHome": "Hagel geschätzt in Ihrer Nähe",
  "gridWatch.hailBody":
    "Das Netz schätzt {reading} innerhalb von {miles} {unit}. Eine Schätzung aus der Energie des Sturms, keine Meldung von Hagel am Boden.",
  "gridWatch.hailQuietTitle":
    "{place} liegt seit einer halben Stunde unter der Größe",
  "gridWatch.hailQuietTitleHome": "Seit einer halben Stunde unter der Größe",
  "gridWatch.hailQuietBody":
    "Seit dreißig Minuten nichts dieser Größe im Radius geschätzt.",
  "gridWatch.rotationTitle": "Rotation nahe {place}",
  "gridWatch.rotationTitleHome": "Rotation in Ihrer Nähe",
  "gridWatch.rotationBody":
    "Das Netz führt eine Scherung von {reading} innerhalb von {miles} {unit} zusammen. Von den Radaren gemessene Scherung, kein Tornado und keine Meldung von einem.",
  "gridWatch.rotationQuietTitle": "{place} ist seit einer halben Stunde ruhig",
  "gridWatch.rotationQuietTitleHome": "Seit einer halben Stunde ruhig",
  "gridWatch.rotationQuietBody":
    "Seit dreißig Minuten keine so starke Scherung im Radius.",
  "gridWatch.shear":
    "{shear, plural, one {# Tausendstel je Sekunde} other {# Tausendstel je Sekunde}}",
  "gridWatch.hailSetting":
    "Sag mir etwas über Hagel nahe einem beobachteten Ort",
  "gridWatch.hailSettingDetail":
    "Beobachtet die Größe, die das Netz in einem von Ihnen gesetzten Radius schätzt, und sagt Bescheid, wenn sie Ihre Größe zum ersten Mal erreicht und wenn sie eine halbe Stunde darunter liegt",
  "gridWatch.rotationSetting":
    "Sag mir etwas über Rotation nahe einem beobachteten Ort",
  "gridWatch.rotationSettingDetail":
    "Dasselbe, für die Scherung, die das Netz in den untersten zwei Kilometern des Sturms zusammenführt",
  "gridWatch.needsPlace":
    "Braucht einen Ort zum Beobachten, denn darum liegt der Radius.",
  "gridWatch.desktopOnly":
    "Die Gitter dekodiert die Desktop-App, das ist also eines der Dinge, die ein Browser nicht kann.",
  "gridWatch.radius": "Wie weit um jeden Ort",
  "gridWatch.hailSize": "Die Größe, die der Rede wert ist",
  "gridWatch.rotationLevel": "Die Scherung, die der Rede wert ist",
  "gridWatch.sound": "Dafür einen Ton abspielen",
  "gridWatch.soundDetail":
    "Aus, weil eine Warnung schon einen macht und dies keine Warnung ist",
  "gridWatch.hailNote":
    "Eine Schätzung des Radars, keine Meldung von Hagel, den jemand gesehen hat. Sie fällt an einem warmen Tag höher aus und an einem kalten niedriger.",
  "gridWatch.rotationNote":
    "Scherung, aus den Radaren zusammengeführt, die den Sturm sehen konnten. Es ist kein Tornado, und zu befolgen ist weiterhin die Warnung.",
  "lightningWatch.chipSince": "Letzter Blitz vor {since}",
  "lightningWatch.chipClear": "Ruhig seit {since}",
  "lightningWatch.chipNearest": "Der nächste lag {distance} nach {direction}",
  "approach.none":
    "Nichts, was das Radar verfolgt, ist zu Ihren Orten unterwegs.",
  "cells.arrivingSoon":
    "{id} erreicht den Ort, den Sie beobachten, binnen einer Minute",
  "cells.nothingComing":
    "Nichts, was das Radar verfolgt, ist dorthin unterwegs",
  "cells.needsWatch":
    "Setzen Sie einen beobachteten Ort, um zu erfahren, wann ein Sturm ihn erreicht",
  "cells.rotating": "{id} hat Rotation in sich",
  "cells.none": "Das Radar verfolgt gerade keine Stürme",
  "cells.reading": "Die Sturmzellen werden gelesen",
  "cells.count": "{count} verfolgt",
  "settings.watchedArea": "Beobachtetes Gebiet",
  "settings.watchedAreaNote": "Warnungen nahe einem Ort",
  "settings.tellMe": "Sag mir etwas über Warnungen",
  "settings.tellMeDetail":
    "Einen Punkt beobachten, auch wenn die Karte woanders hinschaut",
  "settings.radius": "Radius",
  "settings.radiusValue": "{distance}",
  "settings.radiusLabel": "Beobachteter Radius, in {unit}",
  "settings.watchCentre": "Die Kartenmitte beobachten",
  "settings.homeName": "Wie Sie Ihr Zuhause nennen",
  "settings.placeName": "Ortsname",
  "settings.placeNumber": "Ort {number}",
  "settings.placeRadius": "Radius um {place}, in {unit}",
  "settings.placeSeverity": "Sag mir Bescheid ab",
  "settings.placeSeverityFor":
    "Die geringste Warnschwere, die bei {place} der Rede wert ist",
  "settings.removePlace": "{place} nicht mehr beobachten",
  "settings.placeRemoved": "{place} wird nicht mehr beobachtet",
  "settings.placeRemovedBody":
    "Rückgängig setzt den Ort mit seinen Einstellungen zurück.",
  "settings.addPlace": "Die Kartenmitte als Ort hinzufügen",
  "settings.placesFull":
    "Das sind alle {count, plural, one {# Ort} other {# Orte}}. Entfernen Sie einen, um woanders zu beobachten.",
  "settings.watching": "Beobachtet {lat}, {lon} auf Warnungen und Schlimmeres.",
  "settings.camera": "Wohin die Karte schaut",
  "settings.zoom": "Zoom",
  "settings.bearing": "Ausrichtung",
  "settings.pitch": "Neigung",
  "settings.center": "Mitte",
  "settings.reset": "Einstellungen zurücksetzen",

  "bar.label": "Kartenbefehle",
  "bar.compact": "Kompakte Befehle",
  "bar.nearbyShort": "In der Nähe",
  "bar.sectionShort": "Schnitt",
  "bar.mapTypeShort": "Kartentyp",
  "bar.soundingShort": "Sondierung",
  "bar.vwpShort": "Profil",
  "bar.uploadShort": "Hochladen",
  "bar.scrollUp": "Frühere Werkzeuge",
  "bar.scrollDown": "Mehr Werkzeuge",
  "bar.location": "Standort",
  "bar.locate": "Orten",
  "bar.commands": "Befehle",
  "welcome.detail":
    "Befehle durchsucht jedes Produkt, jeden Ort und jede Einstellung nach Namen. In Ebenen schalten Sie Radar, Warnungen, Blitze und den Rest ein und aus.",
  "opening.rain": "Regen",
  "opening.snow": "Schnee",
  "opening.fog": "Nebel",
  "opening.thunder": "ein Gewitter",
  "opening.weather": "{station} meldet {weather}, {when}.",
  "opening.weatherAndAir": "{station} meldet {weather} bei {degrees}°, {when}.",
  "opening.quiet": "{station} meldet, dass nichts fällt, {when}.",
  "opening.quietAndAir":
    "{station} meldet, dass nichts fällt, {degrees}°, {when}.",
  "opening.showAgain": "Die Begrüßung beim ersten Start erneut zeigen",
  "opening.showAgainDetail":
    "Die Eröffnungszeile und die Radarscheibe, die sich selbst zeichnet, noch einmal, jetzt",
  "bar.commandsDetail":
    "Jede Ebene, jedes Produkt und jedes Feld in einer Liste",
  "bar.dualPane": "Doppelt",
  "bar.share": "Teilen",
  "bar.toFlat": "Auf flache Karte wechseln",
  "bar.toGlobe": "Auf Globus wechseln",
  "bar.openPreset": "Voreinstellung {number} öffnen",
  "bar.savePreset": "Voreinstellung {number} speichern",
  "bar.history": "Verlauf",

  "palette.eyebrow": "Alles in einer Liste",
  "palette.title": "Befehle",
  "palette.placeholder": "Versuchen Sie meso, hagel oder export",
  "palette.label": "Jede Ebene, jedes Produkt und jedes Feld durchsuchen",
  "palette.on": " · an",
  "palette.off": " · aus",
  "palette.none": "Hier passt nichts dazu. Versuchen Sie ein kürzeres Wort.",
  "legend.hidden": "RADAR AUSGEBLENDET",
  "legend.smoothed": "Zwischen den Gates geglättet",
  "legend.partlyUnfolded": "{share}% noch gefaltet",
  "legend.scale": "{product} von {min} bis {max} {unit}",
  "timeline.label": "Radaranimation",
  "timeline.play": "Radaranimation abspielen",
  "timeline.pause": "Radaranimation anhalten",
  "timeline.frame": "Radarbild",
  "timeline.connecting": "Verbindung zum Radar",
  "timeline.frames":
    "{index} von {total, plural, one {# Radarbild} other {# Radarbildern}}",
  "timeline.forecastAt": "Vorhersage {time}",
  "timeline.hrrr": "HRRR-Lauf {init}, {lead} Min. voraus",
  "timeline.live": "live",
  "timeline.historical": "historisches Volumen",
  "timeline.goLive": "Auf live",
  "timeline.age": "{age} alt",
  "zoom.controls": "Bedienelemente der Karte",
  "zoom.resetNorth": "Norden und Neigung zurücksetzen",
  "zoom.in": "Hineinzoomen",
  "zoom.out": "Herauszoomen",

  "panel.close": "{title} schließen",
  "toast.dismiss": "Benachrichtigung schließen",
  "chrome.justIn": "gerade angekommen",
  "chrome.age": "{age} alt",
  "chrome.workspaceStatus": "Status des OpenRadar-Arbeitsbereichs",
  "chrome.workstation": "Wetterarbeitsplatz",
  "chrome.radarWorkspace": "Radar-Arbeitsbereich",
  "chrome.sourceHealthy": "Quelle in Ordnung",
  "chrome.sourceWaiting": "Quelle wartet",
  "chrome.sourceIssue": "Quelle braucht Aufmerksamkeit",
  "chrome.connecting": "Verbindung zum Radar",
  "chrome.updatedNow": "Gerade aktualisiert",
  "chrome.updatedAge": "Vor {age} aktualisiert",
  "chrome.updateFound": "{version} bereit",
  "chrome.standby": "Bereitschaft",
  "chrome.toolClear": "Zurücksetzen",
  "chrome.toolKeyboard":
    "Drücken Sie Eingabe oder Leertaste, um dieses Werkzeug in der Kartenmitte zu nutzen, oder Escape, um es wegzulegen.",
  "chrome.dwdComposite": "Deutsches Komposit",
  "chrome.rainRate": "Regenrate",
  "chrome.composite": "Komposit-Radar",
  "chrome.sweepProduct": "{station} {product}",
  "chrome.tilt": "{degrees}° WINKEL",
  "chrome.column": "GANZES VOLUMEN",
  "chrome.columnHistorical": "GANZES VOLUMEN, HISTORISCH",
  "chrome.columnLoop": "GANZES VOLUMEN · VOLUMEN {index} VON {count}, {time}",
  "chrome.columnLive": "GANZES VOLUMEN · LIVE, {seconds} SEK. ALT",
  "chrome.tiltHistorical": "{degrees}° WINKEL, HISTORISCH",
  "chrome.tiltLoop": "{degrees}° WINKEL · VOLUMEN {index} VON {count}, {time}",
  "chrome.levelTwoLate": "SEIT {age} NICHTS GEHÖRT",
  "chrome.tiltDealiased": "{degrees}° WINKEL · ENTFALTET",
  "chrome.nextPiece": "NÄCHSTES VOLUMEN IN {seconds} S",
  "chrome.volumeEnds": "ENDET {time}",
  "chrome.tiltLive": "{degrees}° WINKEL · LIVE, {seconds} SEK. ALT",
  "chrome.tiltLiveDealiased":
    "{degrees}° WINKEL · ENTFALTET · LIVE, {seconds} SEK. ALT",
  "chrome.liveProduct": "LIVE-PRODUKT",
  "chrome.behind": "DAHINTER, {count} MIN. ALT",
  "chrome.terminalRadar": "TDWR · {range}",
  "chrome.extraScales": "Weitere Produktskalen",
  "chrome.wind": "Wind",
  "chrome.windReduced":
    "Zurückgehalten, weil dieses Gerät um weniger Bewegung bittet.",
  "chrome.windAt10": "Wind in 10 m",
  "chrome.windNote":
    "Modellhinweis, keine Beobachtung. Die Teilchen zeigen Richtung und relative Geschwindigkeit.",
  "chrome.flashes": "Blitze",
  "chrome.now": "jetzt",
  "chrome.windowMinutes": "{count} Min.",
  "chrome.flashCount": "{count}{more} von {satellite}",
  "chrome.filesRead":
    " · {read} von {expected, plural, one {# Datei} other {# Dateien}}",
  "chrome.smokeAnalysed": "analysiert {when}",
  "chrome.forecastSmoke": "Rauchvorhersage",
  "chrome.forecastSmokeValid": "Gültig {time}.",
  "chrome.snowfall": "Schneehöhe",
  "chrome.snowfallValid": "Gültig {time}.",
  "chrome.snowfallNote":
    "Eine Analyse des Schnees, der schon am Boden liegt, keine Vorhersage dessen, was noch kommt.",
  "chrome.forecastSmokeNote":
    "Die Erwartung eines Modells zum bodennahen Rauch, nie über die Analyse oder über etwas Beobachtetes gezeichnet.",
  "forecastSmoke.label": "HRRR {hour} +{lead} h · Lauf {age} h alt",
  "chrome.smokeAnalysedUnknown": "Datum unbekannt",
  "chrome.flashNote":
    "Gesamtblitze, keine Einschlagsmeldung. Nutzen Sie für Entscheidungen über Leben und Sicherheit die amtlichen Warnungen.",
  "chrome.densityNote":
    "Wo Blitze waren, nicht wo der nächste sein wird. Nutzen Sie für Entscheidungen über Leben und Sicherheit die amtlichen Warnungen.",
  "chrome.layerUnit": "{label} ({unit})",
  "wind.label": "GFS {hour}{lead} · {age} h alt",
  "wind.lead": " +{hours} h",
  "wind.unknownHour": "unbekannt",

  "chrome.stale": "Radar ist veraltet · {age} alt",
  "watch.cannotSee":
    "Dieser Rechner hat seit {age} kein Netz, deshalb wird nichts beobachtet. Die Orte und die Einstellungen bleiben erhalten.",
  "chrome.offline": "Seit {age} offline · zeigt, was behalten wurde",
  "chrome.cached": "Zeigt die letzte Ansicht",
  "chrome.cachedAge": "Zeigt die letzte Ansicht · {age} alt",

  "gpu.eyebrow": "OpenRadar kann die Karte nicht zeichnen",
  "gpu.title": "Dieser Rechner hat kein WebGL2.",
  "gpu.body":
    "Die Karte wird auf der Grafikkarte gezeichnet, und dieses Fenster erreicht keine. Alles andere in OpenRadar hängt an der Karte, dahinter ist also nichts Nützliches zu zeigen.",
  "gpu.hint":
    "Meist ist die Hardwarebeschleunigung ausgeschaltet, es läuft eine virtuelle Maschine ohne Grafikdurchreichung oder eine Remotedesktop-Sitzung. Die Hardwarebeschleunigung wieder einzuschalten und OpenRadar erneut zu öffnen ist die Abhilfe.",
  "fatal.eyebrow": "OpenRadar hat das Fenster gerettet",
  "fatal.title": "Die Oberfläche konnte nicht fertig gezeichnet werden.",
  "fatal.reload": "OpenRadar neu laden",
  "fatal.resetLayoutNote":
    "Das Zurücksetzen des Layouts stellt Karte, Grundkarte, Schriftgröße, Akzentfarbe, Ebenenreihenfolge und Fenster so her, wie sie sich öffnen. Ihre beobachteten Orte, Farbtabellen, Offline-Pakete und gespeicherten Voreinstellungen bleiben unberührt.",
  "fatal.resetLayout": "Layout zurücksetzen",
  "fatal.copied": "Kopiert",
  "fatal.copyRefused": "Die Zwischenablage hat abgelehnt",
  "fatal.copy": "Diagnose kopieren",
  "panelChunk.loading": "Wird geöffnet",
  "panelChunk.loadingPanel": "{title} wird geöffnet",
  "panelChunk.eyebrow": "OpenRadar hat die Karte behalten",
  "panelChunk.failed":
    "Dieses Feld wird beim Öffnen heruntergeladen und ließ sich nicht holen. Die Karte und alles andere laufen weiter. Ein Neuladen von OpenRadar versucht es erneut.",
  "panelChunk.reload": "OpenRadar neu laden",
  "stage.secondary": "Zweite interaktive Wetterkarte",
  "stage.satelliteAge": " · {age} alt",
  "stage.satellite": "{satellite} {product}",
  "stage.compare": "Vergleichen",
  "stage.compareOffset": "Wie weit die zweite Karte hinterherläuft",
  "stage.compareUnavailable": "Nicht genug frühere Bilder",
  "stage.live": "Live",
  "stage.back": "{count} zurück",

  "toast.following": "Folgt {name}",
  "toast.theStorm": "dem Sturm",
  "toast.stormPreset": "Sturm",
  "toast.presetsFull":
    "Jeder Platz für Voreinstellungen ist belegt, diese Ansicht wurde also nicht behalten.",
  "toast.keptAs": "Als Voreinstellung {number} behalten.",
  "toast.globeOn": "Globusprojektion an",
  "toast.flatOn": "Flache Projektion an",
  "toast.cameraUnchanged":
    "Ihre Mitte, Ihr Zoom, Ihre Ausrichtung und Neigung sind unverändert.",
  "toast.noLocation": "Der Standort ist nicht verfügbar",
  "toast.searchInstead": "Die Suche kann die Karte weiterhin bewegen.",
  "toast.finding": "Ihr Standort wird gesucht",
  "toast.centeredOnYou": "Karte auf Ihren Standort zentriert",
  "toast.noPermission": "Die Standortfreigabe war nicht verfügbar",
  "toast.nothingChanged": "Es hat sich nichts geändert.",
  "toast.centeredOn": "Auf {name} zentriert",
  "toast.presetOpened": "{name} geöffnet",
  "toast.presetName": "Voreinstellung {number}",
  "toast.presetSaved": "Voreinstellung {number} gespeichert",
  "toast.undo": "Rückgängig",
  "toast.paletteCleared": "Farbtabelle entfernt",
  "toast.paletteClearedBody":
    "{name} ist aus dem Regal, und dieses Produkt ist zurück auf der eingebauten Skala.",
  "toast.paletteShelvedBody":
    "{name} ist aus dem Regal. Nichts auf der Karte hat sie genutzt.",
  "toast.paletteFull":
    "Ihre Farbtabellen sind mit {count} voll. Entfernen Sie eine, um Platz dafür zu schaffen.",
  "toast.replayStopped": "Wiedergabe angehalten",
  "toast.bundleSaving": "Das Wiedergabepaket wird gespeichert",
  "toast.bundleSaved": "Wiedergabepaket gespeichert",
  "toast.bundleSavedBody":
    "{entries, plural, one {# Datei} other {# Dateien}}, {size} MB, unter {path}.",
  "toast.bundleMissing":
    "{count} davon ließen sich nicht holen und sind im Paket aufgeführt.",
  "toast.bundleFailed": "Das Wiedergabepaket ist fehlgeschlagen",
  "toast.bundleOpened": "{label} wird aus einem Paket wiedergegeben",
  "toast.bundleOpenedBody":
    "{frames, plural, one {# Bild} other {# Bilder}}, behalten {made}. Dafür wird nichts geholt; das Paket antwortet.",
  "toast.bundleApplyWorkspace": "Seinen Arbeitsbereich übernehmen",
  "toast.bundleWorkspaceApplied": "Der Arbeitsbereich des Pakets gilt",
  "toast.bundleWorkspacePartly": "Der Arbeitsbereich des Pakets gilt teilweise",
  "toast.replayStoppedBody": "Die Karte ist zurück auf der Live-Schleife.",
  "toast.shareTitle": "OpenRadar-Ansicht",
  "toast.shared": "Kartenansicht geteilt",
  "toast.linkCopied": "Kartenlink kopiert",
  "toast.linkFailed": "Der Kartenlink ließ sich nicht kopieren",
  "toast.linkFailedBody":
    "Die Zwischenablage hat abgelehnt. Derselbe Link steht in der Adresse, die die Teilen-Schaltfläche baut.",
  "toast.show": "Zeigen",
  "toast.fileTooBig": "Die Datei ist größer als 5 MB.",
  "toast.paletteEmpty":
    "Diese Palette hat keine Farben, die diese Karte nutzen kann.",
  "toast.overlayEmpty": "Diese GeoJSON-Datei enthält keine Objekte.",
  "toast.paletteApplied": "{name} angewendet",
  "toast.themeApplied": "{name} ist jetzt das Aussehen",
  "toast.themeBody":
    "{count, plural, one {# Farbe} other {# Farben}} geändert. Am Radar, an den Warnungen und an den Skalen hat sich nichts geändert.",
  "toast.themeEmpty":
    "Diese Themendatei setzt nichts, was dieser Build versteht.",
  "toast.remove": "Entfernen",
  "toast.colours": "{count, plural, one {# Farbe} other {# Farben}}",
  "toast.forUnits": "für {units}",
  "toast.leftOut": "{names} ausgelassen",
  "toast.overlayLocal": "Die Überlagerung bleibt auf diesem Gerät.",
  "toast.placefileEmpty":
    "Diese Placefile hat nichts, was diese Karte zeichnen kann.",
  "toast.kmlEmpty": "Dieses KML enthält keine Formen.",
  "toast.shapes": "{count, plural, one {# Form} other {# Formen}}",
  "toast.refreshEvery":
    "sie bittet darum, alle {minutes} Min. aufgefrischt zu werden",
  "toast.truncated": "die Datei endete mitten in einer Form",
  "toast.notGeoJson":
    "Wählen Sie eine GeoJSON-Datei oder eine GRLevelX-Placefile.",
  "toast.tooManyFeatures":
    "Eine eigene Überlagerung kann bis zu 5.000 Objekte enthalten.",
  "toast.overlayAdded": "{name} hinzugefügt",
  "toast.overlayReplaced": "{name} ersetzt",
  "toast.overlaySetFull":
    "Sie haben bereits {count, plural, one {# Datei} other {# Dateien}} auf der Karte. Entfernen Sie eine in Ebenen und importieren Sie dann diese.",
  "toast.overlayFailed": "Die Überlagerung ließ sich nicht hinzufügen",
  "toast.unreadable": "Die Datei ließ sich nicht lesen.",
  "toast.watching": "Dieser Punkt wird beobachtet",
  "toast.placesFull": "Das sind alle Orte",
  "toast.placeAdded": "Beobachtet {place}",
  "toast.watchingDetail": "Warnungen in der Nähe werden Sie unterbrechen",
  "toast.logsFailed": "Der Protokollordner ließ sich nicht öffnen",
  "toast.logsDesktop": "Protokolle schreibt nur die Desktop-App.",
  "toast.settingsReset": "Einstellungen zurückgesetzt",
  "toast.sharedViewOpened": "Eine geteilte Ansicht geöffnet",

  "popup.alert": "Wetterwarnung",
  "popup.issued": "Ausgegeben {when}",
  "popup.expires": "Läuft ab {when}",
  "popup.alertSource": "Quelle: NWS {office}",
  "popup.alertSourceOffice": "Quelle: {office}",
  "popup.alertOffice": "Vorwarnungen und Warnungen",
  "popup.magnitude": "M {value} {place}",
  "popup.recorded": "Aufgezeichnet {when}",
  "popup.timeUnknown": "Zeit unbekannt",
  "popup.depth": "Tiefe {distance}",
  "popup.depthUnknown": "Tiefe unbekannt",
  "popup.usgs": "Quelle: USGS",
  "popup.wildfire": "Waldbrand",
  "popup.acres":
    "{acres, plural, one {# Acre} other {# Acres}}, {contained}% eingedämmt",
  "popup.sizeUnknown": "Größe unbekannt",
  "popup.perimeterUpdated": "Umriss aktualisiert {when}",
  "popup.perimeterUnknown": "Datum des Umrisses unbekannt",
  "popup.nifc": "Quelle: NIFC WFIGS",
  "smoke.light": "Leichter Rauch",
  "smoke.medium": "Mittlerer Rauch",
  "smoke.heavy": "Starker Rauch",
  "smoke.analysed": "Analysiert {when}.",
  "smoke.analysedUnknown": "Das Datum der Analyse steht nicht in der Datei.",
  "smoke.unreadable": "Die Rauchanalyse ließ sich nicht lesen.",
  "smoke.notKml":
    "Die Rauchanalyse war nicht das Dokument, das sie sein sollte.",
  "smoke.clear":
    "Die Auswertenden haben heute nirgends Rauch gefunden. Dies ist die Datei des Tages, und sie ist leer.",
  "smoke.note":
    "Von einer auswertenden Person der NOAA aus Satellitenbildern gezeichnet, einmal am Tag. Es ist, wo der Rauch war, nicht wie die Luft am Boden ist.",
  "metar.observed": "Beobachtet {when}.",
  "metar.observedUnknown": "Die Meldung trägt keine Zeit.",
  "metar.air": "{temp}{unit}, Taupunkt {dewp}{unit}.",
  "metar.wind": "Wind aus {direction} Grad mit {knots} kn.",
  "metar.windVariable": "Wind aus wechselnden Richtungen mit {knots} kn.",
  "metar.windVariableGusting":
    "Wind aus wechselnden Richtungen mit {knots} kn, Böen {gust}.",
  "metar.windGusting": "Wind aus {direction} Grad mit {knots} kn, Böen {gust}.",
  "metar.calm": "Windstill.",
  "metar.station": "Bodenbeobachtung",
  "metar.source": "Quelle: NOAA Aviation Weather Center.",
  "metar.zoom": "Zoomen Sie hinein, um die Stationsmodelle zu sehen.",
  "popup.tropicalBasin": "Tropisch",
  "popup.outlookTitle": "Ausblick {basin}",
  "popup.twoDay": "Zwei-Tage-Chance {chance} ({risk})",
  "popup.sevenDay": "Sieben-Tage-Chance {chance} ({risk})",
  "popup.unknown": "unbekannt",
  "popup.nhc": "Quelle: NOAA National Hurricane Center",
  "popup.sustained": "{category}, {knots} kn anhaltend",
  "popup.advisory": "Lagebericht {number}",
  "popup.tropicalSystem": "Tropisches System",

  "update.notInstalled":
    "Die Version, die Sie haben, läuft weiter. Versuchen Sie es erneut aus der Diagnose.",
  "update.notInstalledTitle": "Die Aktualisierung wurde nicht installiert",
  "update.upToDate": "OpenRadar ist auf dem neuesten Stand",
  "update.available": "OpenRadar {version} ist verfügbar",
  "update.installFrom": "Installieren Sie sie aus der Diagnose.",
  "update.checkFailed": "Die Suche nach Aktualisierungen ist fehlgeschlagen.",
  "update.notOffered": "Die Aktualisierung wird nicht mehr angeboten.",
  "export.radar": "Radar",
  "export.volumeLate":
    "Das Volumen für ein Bild kam nicht rechtzeitig an; gespeichert wurde das Bild davor.",
  "export.hrrr": "HRRR, {minutes} Min. voraus",
  "export.saved": "{name} gespeichert",
  "export.downloads": "Sehen Sie in Ihrem Download-Ordner nach.",
  "export.noRecord":
    "Das Bild ist gespeichert. Der Nachweis seiner Herkunft ließ sich nicht daneben schreiben.",
  "export.show": "Zeigen",
  "export.failed": "Der Export ist fehlgeschlagen",
  "export.imageFailed": "Das Bild ließ sich nicht exportieren",
  "export.imageFailedBody":
    "Die Karte ist weiter auf dem Bildschirm. Versuchen Sie es erneut, sobald sie fertig gezeichnet hat.",
  "export.loopFailed": "Die Schleife ließ sich nicht exportieren",
  "export.nothingWritten": "Es wurde nichts geschrieben.",
  "export.gifFailed": "Das GIF ließ sich auf diesem Rechner nicht schreiben.",
  "export.noCanvas": "Diese Anzeige kann keinen Export rendern.",
  "export.notEncoded": "Das Bild ließ sich nicht schreiben.",
  "export.noVideo": "Dieser Build kann kein Video aufzeichnen.",
  "export.noMp4":
    "Dieser Build hat keinen H.264-Encoder und kann daher kein MP4 schreiben.",
  "export.mp4Reordered":
    "Der H.264-Encoder dieses Rechners ordnet Bilder um, was dieser Build nicht verpacken kann. Der WebM-Export funktioniert weiterhin.",
  "export.mp4Missing":
    "Hier ist kein H.264-Encoder. Das WebM oben funktioniert weiterhin.",
  "export.noFrames": "Es gibt keine Bilder aufzuzeichnen.",
  "export.tooLarge": "Die Aufzeichnung ist größer als 20 MB geworden.",
  "export.empty": "Die Aufzeichnung ist leer geworden.",
  "export.slowPath": "Die Schleife wird auf dem langsamen Weg aufgezeichnet",
  "export.slowPathBody":
    "Dieser Build kann Video nicht direkt kodieren, deshalb wird die Schleife beim Abspielen aufgezeichnet. Es dauert etwa so lange wie die Schleife selbst.",
  "watch.whyEvent": "Eine Warnung vor {event}, eingestuft als {severity}.",
  "watch.whyThreshold":
    "Sie wollten ab {minSeverity} aufwärts Bescheid bekommen.",
  "watch.whyDistance":
    "Sie kam auf {miles} {unit} an Ihren Punkt heran, innerhalb der {radius} {unit}, die Sie beobachten.",
  "watch.whyUpgraded":
    "Sie wurden über diese schon einmal informiert. Das Amt hat seine Schadenseinschätzung seither angehoben.",
  "watch.testHeadline": "Testwarnung",
  "watch.quiet": "Ruhezeiten",
  "watch.home": "Zuhause",
  "catchUp.title": "Während Sie weg waren",
  "catchUp.away":
    "OpenRadar war {away} geschlossen. Das ist, was der Verlauf aus dieser Zeit an den von Ihnen genannten Orten hat.",
  "catchUp.awayHours": "{hours, plural, one {# Stunde} other {# Stunden}}",
  "catchUp.awayDays": "{days, plural, one {# Tag} other {# Tage}}",
  "catchUp.quiet":
    "An Ihren Orten ist nichts geschehen, während Sie weg waren.",
  "catchUp.more":
    "{count, plural, one {# weiterer steht} other {# weitere stehen}} in Ihrem Verlauf.",
  "catchUp.line": "{place} · {when}",
  "catchUp.dismiss": "Danke",
  "catchUp.open": "Den Verlauf öffnen",
  "catchUp.setting": "Sag mir, was passiert ist, während ich weg war",
  "catchUp.settingDetail":
    "Aus Ihrem eigenen Verlauf vorgelesen, bei einem Start nach ein paar Stunden Abwesenheit. Dafür wird nichts geholt, und jede Zeile trägt die Zeit, zu der es geschah.",
  "recap.credits":
    "Aus Ihrem eigenen Verlauf gebaut. Messwerte von {sources}. Gemacht mit OpenRadar.",
  "recap.title": "Ihr Wetterjahr",
  "recap.note":
    "Hier gebaut, aus Ihrem eigenen Verlauf, und nie aus etwas, das jemand über Sie gesammelt hat.",
  "recap.period": "{from} bis {to}",
  "recap.coveredWhole":
    "Ihr Verlauf deckt alle {period, plural, one {# Tag} other {# Tage}} ab.",
  "recap.began":
    "Das Älteste, was Ihr Verlauf noch enthält, ist von {when} und reicht {days, plural, one {# Tag} other {# Tage}} dieser {period, plural, one {# Tag} other {# Tage}} zurück. Davor ist nichts aufbewahrt, was nicht dasselbe ist, wie dass nichts geschehen wäre.",
  "recap.counted":
    "{alerts, plural, one {# Warnung} other {# Warnungen}} und {observations, plural, one {# Beobachtung} other {# Beobachtungen}}.",
  "recap.days":
    "An {days, plural, one {# Tag} other {# Tagen}} wurde etwas aufgezeichnet. Ein Tag ohne Eintrag war ein ruhiger Tag oder ein Tag, an dem die App zu war, und der Verlauf kann die beiden nicht unterscheiden.",
  "recap.busiest":
    "Am meisten los war {when}, mit {rows, plural, one {# Eintrag} other {# Einträgen}}.",
  "recap.place":
    "{place}: {alerts, plural, one {# Warnung} other {# Warnungen}}, {observations, plural, one {# Beobachtung} other {# Beobachtungen}}.",
  "recap.placesHidden":
    "Über {count, plural, one {# Ort} other {# Orte}} hinweg, hier nicht benannt.",
  "recap.includePlaces": "Die Ortsnamen auf das Bild setzen",
  "recap.includePlacesDetail":
    "Von Haus aus aus. Wo Sie wohnen, muss ein Bild nicht sagen.",
  "recap.save": "Als Bild speichern",
  "recap.empty": "Aus diesem Zeitraum steht noch nichts in Ihrem Verlauf.",
  "recap.span": "Wie lange",
  "recap.spanDays": "Die letzten {days, plural, one {Tag} other {# Tage}}",
  "recap.spanYear": "Das letzte Jahr",
  "journal.countShown":
    "{shown} von {count, plural, one {# Eintrag} other {# Einträgen}}",
  "curiosity.title": "Ein Ort, den zu kennen sich lohnt",
  "curiosity.dismiss": "Schließen",
  "curiosity.setting":
    "Die Karte darf Dinge bereithalten, die zu finden sich lohnen",
  "curiosity.settingDetail":
    "Eine kleine Auswahl echter Orte, an denen das Wetter Geschichte geschrieben hat, jeder mit dem Amt, das die Geschichte veröffentlicht hat. Nichts markiert sie und nichts wird gezählt; Sie finden einen, indem Sie in diesen Teil der Welt schauen.",
  "curiosity.found": "Orte, die Sie gefunden haben",
  "curiosity.foundEmpty": "Noch nichts gefunden.",
  "curiosity.forget": "Sie vergessen",
  "curiosity.forgotten": "Die von Ihnen gefundenen Orte sind vergessen",
  "curiosity.forgottenBody":
    "Nichts markiert sie auf der Karte, sie erneut zu finden heißt also, erneut hinzuschauen.",
  "figures.title": "Was Ihr Verlauf enthält",
  "figures.note":
    "Aus der Datei auf diesem Rechner gezählt, nirgends sonst. Nichts hier ist eine Serie oder ein Ziel, und nichts davon wird je angekündigt.",
  "figures.rows":
    "Zwischen {from} und {to} hat Ihr Verlauf {rows, plural, one {# Eintrag} other {# Einträge}} behalten: {alerts, plural, one {# Warnung} other {# Warnungen}} und {observations, plural, one {# Beobachtung} other {# Beobachtungen}}.",
  "figures.places":
    "Über diesen Zeitraum kennt er {places, plural, one {# Ort, den Sie benannt haben} other {# Orte, die Sie benannt haben}}.",
  "figures.period":
    "An {days, plural, one {# dieser Tage} other {# dieser Tage}} wurde etwas geschrieben.",
  "figures.paused":
    "Es kommt nichts Neues hinzu: der Verlauf ist ausgeschaltet. Was hier steht, bleibt, bis Sie es löschen.",
  "figures.off":
    "Der Verlauf ist ausgeschaltet, es gibt also nichts zu zählen.",
  "settings.journalWriting": "Aufschreiben, was das Wetter an Ihren Orten tut",
  "settings.journalWritingDetail":
    "Aus hält neue Einträge ab diesem Moment auf. Es löscht nicht, was schon da ist; das tut die Schaltfläche darunter.",
  "nearby.nameCell": "Wie Sie Sturm {id} nennen",
  "nearby.nameCellPlaceholder": "Geben Sie ihm einen Namen",
  "journal.namedCellPassed":
    "{name}, der Sturm, den das Radar {id} nannte, kam auf {distance} heran",
  "calm.setting": "Eine ruhigere Art, es zu lesen",
  "calm.settingDetail":
    "Dreht die App herunter, nie das Wetter. Warnungen kommen im selben Moment an, über denselben Weg, in den Farben, die das Amt veröffentlicht. Leiser wird das Beiwerk darum: die Akzente, das jahreszeitliche Aussehen, die Effekte. Ebenen mit Vorhersagewahrscheinlichkeiten starten ausgeschaltet und sind einen Druck von der Rückkehr entfernt.",
  "calm.advice.tornado":
    "Gehen Sie in das unterste Geschoss, in die Mitte des Gebäudes, weg von Fenstern. Nehmen Sie etwas mit, um den Kopf zu schützen.",
  "calm.advice.thunderstorm":
    "Gehen Sie hinein und bleiben Sie nicht auf der Veranda. Halten Sie sich von Fenstern fern, bis es vorbei ist.",
  "calm.advice.flood":
    "Gehen Sie auf höheres Gelände. Fahren Sie nicht in Wasser auf einer Straße, wie es auch aussieht.",
  "calm.advice.winter":
    "Bleiben Sie drinnen, wenn Sie können. Wenn Sie hinaus müssen, sagen Sie jemandem, wohin Sie gehen, und nehmen Sie warme Kleidung mit.",
  "calm.advice.tropical":
    "Folgen Sie dem, was Ihre örtlichen Behörden Ihnen sagen. Wenn sie gesagt haben, Sie sollen gehen, gehen Sie jetzt.",
  "calm.advice.heat":
    "Bleiben Sie aus der Sonne, trinken Sie Wasser und schauen Sie nach allen, die allein leben.",
  "calm.advice.fire":
    "Seien Sie bereit zu gehen. Halten Sie Schlüssel, Telefon und Medikamente beisammen.",
  "calm.advice.general":
    "Lesen Sie, was das Amt in der Warnung selbst sagt, und folgen Sie dem, was Ihre örtlichen Behörden Ihnen sagen.",
  "calm.advice.tsunami":
    "Kommen Sie auf hohes Gelände oder so weit landeinwärts wie möglich, zu Fuß, wenn die Straßen voll sind. Gehen Sie nicht hinunter und warten Sie nicht, um das Wasser zu sehen.",
  "calm.advice.evacuate":
    "Gehen Sie jetzt, auf dem Weg, den Ihre örtlichen Behörden genannt haben. Nehmen Sie Schlüssel, Telefon und Medikamente mit.",
  "calm.advice.shelterInPlace":
    "Gehen Sie hinein, schließen Sie Fenster und Türen und schalten Sie alles ab, was Luft von draußen hereinzieht. Bleiben Sie dort, bis Ihnen gesagt wird, dass es vorbei ist.",
  "calm.advice.civil":
    "Folgen Sie genau dem, was Ihre örtlichen Behörden Ihnen sagen, und tun Sie es jetzt.",
  "calm.advice.surf":
    "Bleiben Sie aus dem Wasser und weg von Felsen und Molen. Wellen wie diese ziehen Menschen von trockenem Boden hinein.",
  "calm.what": "Was zu tun ist",
  "postcard.notOfficial":
    "Gemacht mit OpenRadar. Kein amtliches Produkt und keine Quelle für Warnungen: das ist das Amt, das sie herausgibt.",
  "postcard.title": "Schicken Sie es jemandem",
  "postcard.note":
    "Eine gestaltete Karte statt des schlichten Bildes. Die Zeit, die Nachweise und diese Zeile stehen auf jeder davon, was immer Sie schreiben:",
  "postcard.caption": "Schreiben Sie etwas darauf",
  "postcard.captionPlaceholder":
    "Hagel so groß wie Murmeln, und seit neun kein Strom.",
  "postcard.includePlace": "Den Ortsnamen daraufsetzen",
  "postcard.save": "Die Postkarte speichern",
  "postcard.size.square": "Quadratisch",
  "postcard.size.wide": "Breit",
  "postcard.size.tall": "Hoch",
  "postcard.sizeLabel": "Form",
  "ambientScreen.age":
    "{source} · {minutes, plural, one {# Minute alt} other {# Minuten alt}}",
  "ambientScreen.setting": "Vollbildansicht für einen zweiten Monitor",
  "ambientScreen.settingDetail":
    "Die Karte und sonst nichts, eine Uhr, und was sie zeigt. Die Schleife läuft weiter und wird langsamer, wenn eine Weile niemand etwas angefasst hat, damit ein über Nacht laufender Bildschirm nicht jede Minute einen öffentlichen Dienst um ein Bild bittet. Eine Warnung dort, wo Sie beobachten, holt sie herunter und bringt den Arbeitsbereich zurück.",
  "ambientScreen.leave": "Die Vollbildansicht verlassen",
  "ambientScreen.awake": "Den Bildschirm anlassen, solange sie läuft",
  "ambientScreen.awakeUnavailable":
    "Vorerst nur Windows, hier gibt es also keinen Bildschirm zum Anlassen.",
  "ambientScreen.awakeDetail":
    "Windows schaltet einen Monitor nach seiner eigenen Zeit aus, was für eine Ansicht, die stehen bleiben soll, wenig nützt. Dies hält den Bildschirm nur an, solange die Vollbildansicht läuft, und gibt ihn frei, sobald Sie sie verlassen. Nur Windows.",
  "ambientScreen.idle": "Von selbst hineingehen nach",
  "ambientScreen.distance": "Gelesen aus",
  "ambientScreen.distanceDesk": "Schreibtischabstand",
  "ambientScreen.distanceNear": "Einen Schritt zurück",
  "ambientScreen.distanceRoom": "Quer durch einen kleinen Raum",
  "ambientScreen.distanceFar": "Quer durch einen großen Raum",
  "ambientScreen.idleOff": "Nie",
  "ambientScreen.idleMinutes":
    "{minutes, plural, one {# Minute} other {# Minuten}}",
  "command.ambientScreen": "Vollbildansicht",
  "glance.waiting": "Wartet auf die Karte.",
  "glance.picture":
    "Die Karte, wie der Arbeitsbereich sie zuletzt gezeichnet hat",
  "glance.warning": "Dort, wo Sie beobachten, gilt eine Warnung",
  "glance.quiet": "Dort, wo Sie beobachten, gilt nichts",
  "glance.updated": "Stand {when}",
  "glance.setting": "Ein kleines Fenster, das bleibt, wo Sie es hinstellen",
  "glance.settingDetail":
    "Der Ort, den Sie beobachten, ob dort eine Warnung gilt, und ein Standbild der Karte. Es zeigt, was der Arbeitsbereich schon gezeichnet hat, statt es erneut zu zeichnen, deshalb kostet es fast nichts, es offen zu lassen. Öffnen Sie es aus der Taskleiste.",
  "glance.onTop": "Das kleine Fenster über allem anderen halten",
  "tray.menuOpen": "OpenRadar öffnen",
  "tray.menuGlance": "Kleines Fenster",
  "tray.menuQuit": "Beenden",
  "tray.quiet": "OpenRadar",
  "tray.warning": "OpenRadar: dort, wo Sie beobachten, gilt eine Warnung",
  "tray.unreachable": "OpenRadar: die Beobachtung erreicht den Dienst nicht",
  "autostart.setting": "Mit Windows starten",
  "autostart.settingDetail":
    "Öffnet bei der Anmeldung in die Taskleiste, damit die Orte, die Sie beobachten, beobachtet werden, sobald der Rechner an ist",
  "autostart.needsTray":
    "Braucht das Taskleistensymbol, denn dorthin öffnet es.",
  "autostart.unavailable":
    "Dieser Build kann Windows nicht nach Autostart-Einträgen fragen.",
  "tray.setting": "Ein Symbol in die Taskleiste setzen",
  "tray.settingDetail":
    "Das Symbol sagt eines: ob an einem von Ihnen genannten Ort eine Warnung gilt. Ausschalten entfernt es, statt es zu verstecken.",
  "tray.closeToTray":
    "Das Fenster zu schließen lässt es in der Taskleiste weiterlaufen",
  "tray.closeToTrayDetail":
    "Aus, denn eine App, die nach dem Schließen weiterläuft, ist eine App, die Menschen deinstallieren. Ist es an, kommen Sie über das Taskleistensymbol zurück.",
  "wallpaper.setting": "Die aktuelle Ansicht auf den Desktop legen",
  "wallpaper.settingDetail":
    "Ein gestaltetes Bild der Karte hinter dem, woran Sie arbeiten, mit Zeit, Quelle und eigenem Alter eingebrannt, im Abstand aufgefrischt, den Sie wählen. Es schreibt eine Datei im eigenen Ordner der App und sonst nirgends, und Ausschalten legt Ihr eigenes Hintergrundbild zurück. Vorerst nur Windows.",
  "wallpaper.every": "Wie oft",
  "wallpaper.never": "Nie",
  "wallpaper.everyMinutes":
    "{minutes, plural, one {Jede Minute} other {Alle # Minuten}}",
  "wallpaper.unavailable":
    "Das ist vorerst eine Windows-Sache, hier gibt es also nichts einzuschalten.",
  "wallpaper.failed": "Das Hintergrundbild ließ sich nicht schreiben",
  "wallpaper.failedDetail":
    "Ihr eigenes Hintergrundbild ist unberührt. OpenRadar versucht es beim nächsten Durchgang erneut.",
  "wallpaper.age":
    "{minutes, plural, one {# Minute alt} other {# Minuten alt}}",
  "journal.title": "Ihr Verlauf",
  "journal.count": "{count, plural, one {# Eintrag} other {# Einträge}}",
  "journal.note":
    "Was das Wetter an den von Ihnen genannten Orten getan hat. Nur benannte Orte, nur Beobachtungen und Ereignisse, und nie etwas darüber, wie Sie die App genutzt haben. Aufbewahrt {days, plural, one {# Tag} other {# Tage}} oder {size} MB lang, was zuerst zu Ende geht, das Älteste zuerst, mit bis zu {pictures} MB Bildern daneben. Er bleibt auf diesem Rechner und steht nicht im Diagnosebericht.",
  "journal.empty": "Noch nichts aufgezeichnet.",
  "journal.desktopOnly": "Den Verlauf führt die Desktop-App.",
  "journal.row": "{source}, {when} · {obtained}",
  "journal.export": "Den Verlauf in eine Datei speichern",
  "journal.clear": "Alles davon löschen",
  "journal.undated": "eine ungenannte Zeit",
  "journal.rowRemoved": "Eintrag gelöscht",
  "journal.undoBody": "Die Bilder kommen nicht zurück, nur die Einträge.",
  "journal.cleared": "Verlauf gelöscht",
  "journal.failed": "Der Verlauf ließ sich nicht schreiben.",
  "journal.saved": "Verlauf gespeichert",
  "journal.sourceNws": "NWS",
  "journal.sourceEccc": "ECCC",
  "journal.sourceDwd": "DWD",
  "journal.obtainedWatch":
    "eine Warnung, die einen von Ihnen beobachteten Ort erreichte",
  "journal.obtainedStation":
    "eine Stationsmeldung nahe einem von Ihnen beobachteten Ort",
  "journal.search": "Den Verlauf durchsuchen",
  "journal.kind": "Welche Art",
  "journal.kindAny": "Warnungen und Beobachtungen",
  "journal.kindAlert": "Warnungen",
  "journal.kindObservation": "Beobachtungen",
  "journal.since": "Wie weit zurück",
  "journal.sinceAny": "Alles Aufbewahrte",
  "journal.sinceDays": "Die letzten {days, plural, one {Tag} other {# Tage}}",
  "journal.noneMatch": "Im Verlauf passt nichts dazu.",
  "journal.picture": "Die Karte, als {text} aufgezeichnet wurde",
  "journal.noteLabel": "Woran Sie sich dabei erinnern",
  "journal.notePlaceholder":
    "Hagel so groß wie Murmeln, und um neun ging der Strom aus.",
  "journal.noteAdd": "Etwas schreiben",
  "journal.noteEdit": "Das Geschriebene bearbeiten",
  "journal.noteSave": "Behalten",
  "journal.noteDiscard": "So lassen, wie es war",
  "journal.removeRow": "Diesen Eintrag löschen",
  "journal.exportHeading": "Was das Wetter an Ihren Orten getan hat",
  "journal.obtainedCells":
    "ein verfolgter Sturm, der an einem von Ihnen beobachteten Ort vorbeizog",
  "journal.cellPassed": "Verfolgter Sturm {id} kam auf {distance} heran",
  "watch.goHome": "Nach Hause",
  "watch.atPlace": "Bei {place}.",
  "watch.atPlaces": "Bei {places}.",
  "watch.quietDetail":
    "Hält gewöhnliche Warnungen über Nacht zurück. Alles ab der Schwere, die Sie wählen, kommt weiterhin durch.",
  "watch.quietFrom": "Von",
  "watch.quietUntil": "Bis",
  "watch.quietOverride": "Weck mich immer für",
  "watch.sendTest": "Eine Testwarnung senden",
  "watch.sendTestDetail":
    "Löst eine harmlose Benachrichtigung aus, und den Ton, falls er an ist, damit Sie wissen, was Sie erwartet",
  "watch.testSent": "Testwarnung gesendet",
  "watch.testSentBody":
    "Wenn nichts erschienen ist, hält Windows für diese App vielleicht Benachrichtigungen zurück.",
  "watch.alert": "Wetterwarnung",
  "watch.here": "dort, wo Sie beobachten",
  "watch.milesAway": "{miles} {unit} von dem Punkt, den Sie beobachten",
  "watch.body": "{headline} {where}.",
  "watch.failed": "Die Beobachtung erreicht den Dienst nicht",
  "watch.failedBody":
    "Drei Prüfungen hintereinander sind fehlgeschlagen, deshalb kommt eine Warnung dort, wo Sie beobachten, vielleicht nicht an. Es wird weiter versucht.",
  "watch.recovered": "Die Beobachtung erreicht den Dienst wieder",
  "watch.recoveredBody":
    "Die Prüfungen kommen zurück. Es wurde nichts verpasst, was noch gilt.",
  "watch.lastChecked": "Zuletzt geprüft vor {age}",
  "watch.notReaching": "Die Prüfungen schlagen seit {age} fehl",
  "guidance.gfs": "GFS",
  "guidance.ecmwf": "ECMWF",
  "guidance.icon": "ICON",
  "guidance.gem": "GEM",
  "guidance.noModels": "Wählen Sie mindestens ein Modell.",
  "guidance.keepTwo":
    "Lassen Sie mindestens zwei Modelle gewählt, damit ein Vergleich etwas bringt.",
  "guidance.failed": "Der Hinweisdienst {answer}.",
  "tides.stationsFailed": "Die Liste der Pegelstationen ließ sich nicht lesen.",
  "tides.failed": "Der Gezeitendienst {answer}.",
  "surge.category1": "Kategorie 1",
  "surge.category2": "Kategorie 2",
  "surge.category3": "Kategorie 3",
  "surge.category4": "Kategorie 4",
  "surge.category5": "Kategorie 5",
  "surge.upTo": "bis {depth}",
  "surge.over": "über {depth}",

  "layer.surge": "Sturmflutrisiko",
  "layers.surgeDetail":
    "Wie weit das Wasser bei einem Hurrikan dieser Stärke reichen könnte",
  "layers.surgeCategory": "Stärke des Hurrikans",
  "layers.snowfallWindow": "Abgedecktes Fenster",
  "layers.snowfallNote":
    "Gebaut aus dem, was Beobachtende und Messgeräte gemeldet haben, dazwischen aufgefüllt, und zweimal am Tag veröffentlicht. Es ist, was gefallen ist, nicht was vorhergesagt wird.",
  "layers.surgeNote":
    "Keine Vorhersage. Die NOAA hat Tausende simulierter Hurrikane an jedem Küstenabschnitt laufen lassen und das schlimmste Wasser jedes einzelnen behalten, bei Hochwasser. Für einen Sturm, der wirklich kommt, lesen Sie das National Hurricane Center.",
  "keywords.surge": "",

  "guidance.eyebrow": "Modellhinweise",
  "guidance.title": "Hinweise",
  "guidance.models": "Modelle",
  "guidance.model": "Modell",
  "guidance.temperature": "Temperatur",
  "guidance.precipitation": "Niederschlag",
  "guidance.wind": "Wind",
  "guidance.loading": "Die Modelle werden gelesen",
  "guidance.failedTitle": "Die Modelle ließen sich nicht lesen",
  "guidance.unknown": "Die Hinweisanfrage ist fehlgeschlagen.",
  "guidance.answeredFor": "Antwortet für {place}, gelesen vor {age}.",
  "guidance.refreshFailed":
    "Die Zahlen oben sind die letzten, die angekommen sind. {answer}",
  "guidance.noValue": "—",
  "guidance.compare": "Mit dem Lauf von gestern vergleichen",
  "guidance.compareDetail":
    "Was jedes Modell vor einem Tag über dieselben Stunden gesagt hat, und wie weit es sich seither bewegt hat",
  "guidance.runAt": "{model} lief zuletzt {when}, vor {hours} h",
  "guidance.runStale": "· älter als sein eigener Plan",
  "guidance.noPrevious": "kein früherer Lauf",
  "guidance.agree": "sie stimmen überein, in {unit}",
  "guidance.disagree": "sie sind sich uneins, in {unit}",
  "guidance.note":
    "Jede Spalte ist der eigene Lauf eines Modells für die Kartenmitte, keine Mischung aus ihnen. Wo sie sich uneins sind, weiß es keines von ihnen schon.",
  "tides.eyebrow": "Nächste Pegelstation",
  "tides.title": "Gezeiten",
  "tides.loading": "Die nächste Station wird gesucht",
  "tides.inlandTitle": "Keine Station nahe diesem Ausschnitt",
  "tides.inlandBody":
    "Die nächste liegt über {distance} entfernt, was über das Wasser hier nichts aussagt.",
  "tides.failedTitle": "Die Gezeiten ließen sich nicht lesen",
  "tides.noPredictions":
    "Diese Station veröffentlicht keine Gezeitenvorhersagen, für sie gibt es also nichts zu zeichnen. Versuchen Sie eine andere Station an der Küste.",
  "tides.unknown": "Die Gezeitenanfrage ist fehlgeschlagen.",
  "tides.stationWithState": "{name}, {state}",
  "tides.distance": "{miles} {unit} von der Kartenmitte",
  "tides.diurnal": "Hier gibt es ein Hoch- und ein Niedrigwasser am Tag",
  "tides.semidiurnal": "Hier gibt es zwei Hoch- und zwei Niedrigwasser am Tag",
  "tides.rising": "läuft auf",
  "tides.observed": "Gemessen {height}",
  "tides.observedAt": "Am Pegel, {time}",
  "tides.abovePrediction": "{height} über den vorhergesagten {predicted}",
  "tides.belowPrediction": "{height} unter den vorhergesagten {predicted}",
  "tides.falling": "läuft ab",
  "tides.high": "Hochwasser",
  "tides.low": "Niedrigwasser",
  "tides.noneLeft": "In den nächsten drei Tagen kommt nichts mehr.",
  "tides.note":
    "Vorhersagen von NOAA CO-OPS, in {unit} über dem mittleren niedrigeren Niedrigwasser, gezeigt in Ihrer eigenen Zeitzone. Eine Sturmflut reitet obendrauf, ein Sturm bei Hochwasser reicht also weiter.",
  "panel.guidance": "Hinweise",
  "panel.sounding": "Sondierung",
  "keywords.sounding":
    "skew-t skewt hodograph raob ballon hoehenwetter cape scherung inversion",
  "panel.tides": "Gezeiten",
  "keywords.guidance": "",
  "keywords.tides": "",

  "radar.unavailable": "Radar vorübergehend nicht verfügbar",
  "radar.requestFailed": "Die Radaranfrage ist fehlgeschlagen",
  "radar.waiting": "Wartet auf das Radar",
  "radar.budgetReached": "Zu oft gefragt, wartet einen Moment",
  "radar.noFrames": "Es wurden keine Bilder veröffentlicht.",
  "radar.noProvider": "Keine Radarquelle hat geantwortet.",
  "radar.noTimes": "Es wurden keine Radarzeiten veröffentlicht.",
  "radar.rainviewerEmpty":
    "Die Ausweichquelle für das Radar hat mit nichts Zeichenbarem geantwortet.",
  "radar.requestFailedShort": "Die Anfrage ist fehlgeschlagen.",
  "radar.noRun": "Die Vorhersage hat noch keinen neuen Lauf veröffentlicht.",
  "radar.archive": "Radararchiv der Iowa State University",
  "replay.title": "Wiedergabe von {name} {year}",
  "replay.atLandfall":
    "Archivradar rund um den Landfall. Schließen Sie es, um live zu gehen.",
  "replay.atClosest":
    "Archivradar rund um die größte Annäherung. Schließen Sie es, um live zu gehen.",
  "app.dualPaneOpened": "Doppelansicht geöffnet",
  "app.dualPaneClosed": "Doppelansicht geschlossen",
  "app.settingsNotSaved": "Die Einstellungen wurden nicht gespeichert",
  "app.preparing": "Die Karte wird vorbereitet",
  "app.settingsNotSavedBody":
    "Das aktuelle Fenster nutzt Ihre Änderungen weiterhin.",
  "app.settingsRestored": "Ihre Einstellungen wurden zurückgesetzt",
  "app.settingsRestoredBody":
    "Die Einstellungsdatei ließ sich nicht lesen, deshalb ist die letzte gute Kopie an ihre Stelle getreten. Alles, was seither geändert wurde, ist weg.",
  "app.settingsLocked": "Ihre Einstellungsdatei ist in Benutzung",
  "app.settingsLockedBody":
    "Die Einstellungsdatei ließ sich weder lesen noch beiseitelegen, deshalb hat dieses Fenster schlicht geöffnet und das nächste wird es auch. Schließen Sie, was die Datei offen hält, und starten Sie OpenRadar erneut.",
  "app.settingsUnreadable": "Ihre Einstellungen ließen sich nicht lesen",
  "app.settingsUnreadableBody":
    "Die Einstellungsdatei war beschädigt und es gab keine Kopie zum Zurückgehen, deshalb hat dieses Fenster schlicht geöffnet. Die Datei, die sich nicht lesen ließ, wurde aufbewahrt.",
  "app.startedPlain": "Nach zwei schlechten Starts schlicht geöffnet",
  "app.startedPlainBody":
    "OpenRadar hat seine letzten beiden Starts nicht zu Ende gebracht, deshalb sind Ihr Thema, das jahreszeitliche Aussehen, importierte Farbtabellen und die gespeicherte Ansicht für dieses Fenster ausgeschaltet. Ein Druck bringt sie zurück.",
  "app.startedPlainRestore": "Alles zurückbringen",
  "app.savedView": "Gespeicherte Ansicht",
  "popup.importedShape": "Importierte Form",
  "popup.openProduct": "Das amtliche Produkt öffnen",
  "pairing.rainfall": "Den gefallenen Regen zeigen",
  "pairing.rainfallDay": "Den Regen des Tages zeigen",
  "pairing.velocity": "Den Wind im Sturm zeigen",
  "pairing.hail": "Die Hagelkorngröße zeigen",
  "pairing.precipType": "Zeigen, was fällt",
  "pairing.surge": "Die Sturmflut zeigen",
  "pairing.smoke": "Feuer und Rauch zeigen",
  "pairing.shown": "{layer} ist an",
  "pairing.shownBody":
    "Eingeschaltet, um die Warnung zu erklären. Sonst hat sich nichts geändert.",
  "map.label": "Interaktive Wetterkarte",
  "weather.incomplete": "Die Vorhersage kam mit fehlenden Teilen zurück.",
  "route.noRoad": "Keine Straßenroute verbindet diese beiden Orte.",
  "wind.noDraw":
    "Die Windebene ließ sich auf dieser Grafikkarte nicht zeichnen.",
  "wind.noDrawBody":
    "Sie wurde ausgeschaltet. Sonst ist auf der Karte nichts betroffen, und der Schalter versucht es erneut.",
  "tool.drawHint": "Klicken Sie auf die Karte, um einen Pfad zu zeichnen",
  "tool.startHint": "Wählen Sie den Startpunkt",
  "tool.endHint": "Wählen Sie den Endpunkt",
  "tool.inspectAt": "{lat}°, {lon}° · Zoom {zoom}",
  "tool.gateValue": "{value} {unit}",
  "tool.gateLive": "aus dem Sweep, der gerade gemacht wird, {when}",
  "tool.gateFrom": "aus dem Sweep von {when}",
  "tool.beamHeight": "Strahl {height} über dem Radar bei {tilt}°",
  "tool.classified": "{class} nach der eigenen Klassifikation des Radars",
  "tool.pathPoints": "{count, plural, one {# Punkt} other {# Punkte}} im Pfad",
  "tool.rangeResult": "{distance}",
  "tool.inspectHint": "Klicken Sie auf die Karte, um einen Punkt abzufragen",
  "tool.sectionStartHint":
    "Klicken Sie auf ein Ende des Schnitts, in Reichweite des Radars",
  "tool.sectionEndHint": "Klicken Sie auf das andere Ende des Schnitts",
  "tool.sectionTaken": "Das Volumen wird entlang der Linie geschnitten",
  "notice.offline": "Dieser Rechner ist offline",
  "notice.offlineBody":
    "Die Karte zeigt, was sie behalten hat. Es kommt nichts Neues an, bis die Verbindung zurück ist.",
  "notice.online": "Wieder online",
  "notice.onlineBody": "Die Karte holt nach, was sie verpasst hat.",
  "notice.layerFailing": "{layer} zeichnet nicht mehr",
  "notice.layerFailingBody":
    "Der Dienst hat nicht geantwortet. Die Karte versucht es weiter.",
  "notice.layerBack": "{layer} zeichnet wieder",
  "notice.loopStalled": "Die Schleife ist stehen geblieben",
  "notice.loopBack": "Die Schleife läuft wieder",
  "map.popupClose": "Sprechblase schließen",
  "map.toggleAttribution": "Zeigen, wer diese Karte gemacht hat",
  "map.mapFeedback": "Ein Problem mit dieser Karte melden",
  "layers.movedUp": "{layer} über {other} verschoben",
  "layers.movedDown": "{layer} unter {other} verschoben",
};
