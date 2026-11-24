# Bande V2

Application desktop native (macOS & Windows) pour extraire, découper et convertir des vidéos et playlists YouTube en audio ou en vidéo, localement et sans navigateur.

---

## Fonctionnalités

- **Audio** : `MP3`, `OGG`, `WAV` en accès direct + `FLAC`, `M4A`, `OPUS`, `AIFF`, `ALAC`, `AAC`, `WMA`, `AC3`. Choix du débit (`96` à `320 kbps`) ou échantillonnage sans perte (`44,1` / `48 kHz`).
- **Vidéo** : `MP4`, `WEBM`, `MKV` en accès direct + `MOV`, `AVI`, `M4V`, `TS`, `FLV`, `GIF`. Liste automatiquement toutes les qualités réelles proposées par la vidéo (`144p` jusqu'à `4K UHD 2160p`, `60 fps`, `HDR`).
- **Découpe & forme d'onde audio réelle** :
  - Tracé réel de la piste audio (`140` segments avec mise en cache).
  - Poignées de début et de fin glissables, déplacement global de la fenêtre de sélection, saisie exacte au format `MM:SS` / `HH:MM:SS` et boutons `− / + 1 s`.
  - Écoute directe de l'extrait sélectionné (macOS via `AVPlayer` avec lecture en boucle et marqueurs `I` / `O`), calage sur les chapitres YouTube.
  - Enchaînement d'extraits sans recharger le lien + file d'attente (`+ File` → `Tout exporter`).
- **Traitement son & fondus (optionnel)** :
  - Fondus d'entrée et de sortie configurables (`0 s` par défaut = désactivé).
  - Normalisation personnalisée en **LUFS** (`-24` à `-6 LUFS` + préréglages `-16`, `-14`, `-12`, `-9`), **Gain manuel** (`-12` à `+12 dB`), ou suppression de la piste audio (**vidéo muette**).
- **Tags & pochette intégrée (optionnel)** :
  - Édition du nom de fichier, titre, artiste et album.
  - Pochette embarquée (`MP3`, `M4A`, `FLAC`, `ALAC`) : miniature YouTube recadrée en carré, image locale ou studio de pochettes personnalisées (**Deezer**, **Studio**, **Duotone**, **Typo**).
- **Playlists YouTube** :
  - Chargement de la liste complète avec sélection par case à cocher, filtre par texte, export par lot en parallèle (jusqu'à 3 titres simultanés sur macOS) et regroupement optionnel en `.ZIP`.
- **Moteur V2 haute performance** :
  - **100 % natif** : SwiftUI / AppKit / AVFoundation sur macOS, Win32 C pur sur Windows (aucun Python, aucun serveur local, aucune WebView).
  - **Passe directe FFmpeg** : réutilise les flux analysés sans relancer `yt-dlp` à chaque extrait.
  - **Accélération matérielle** : `Apple VideoToolbox` + `AudioToolbox` sur macOS ; détection automatique `NVIDIA NVENC` / `AMD AMF` / `Intel QSV` (avec repli `x264`) sur Windows.

---

## Installation

### macOS (Apple Silicon — macOS 13+)

1. Ouvrez le dossier `V2/app Mac/`.
2. Glissez **`Bande.app`** dans votre dossier **Applications** (vous pouvez aussi l'épingler dans le Dock).
3. Lancez **Bande**.

> **Premier lancement (Gatekeeper)**
> L'application n'étant pas signée par un certificat Apple Developer payant, macOS peut afficher une alerte la première fois :
> - Faites **clic droit** sur `Bande.app` → **Ouvrir** → confirmez **Ouvrir**.
> - Si macOS bloque encore le lancement, allez dans **Réglages Système → Confidentialité et sécurité** et cliquez sur **Ouvrir quand même**, ou exécutez dans le Terminal :
>   ```bash
>   xattr -cr /Applications/Bande.app
>   ```

---

### Windows (Windows 10 / 11 — 64 bits)

1. Ouvrez le dossier `V2/app Windows/`.
2. Double-cliquez sur **`Bande-Setup.exe`**.
3. Choisissez le dossier d'installation (par défaut `%LOCALAPPDATA%\Bande` — **aucun droit administrateur requis**), cochez si souhaité la création du raccourci Bureau puis cliquez sur **Installer**.
4. À la fin de l'extraction, cliquez sur **Terminer** pour lancer **Bande**.

> **Premier lancement (Windows SmartScreen)**
> L'installateur n'étant pas signé par un certificat Authenticode commercial, Windows Defender SmartScreen peut afficher un écran bleu :
> - Cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**.

> **Désinstallation**
> Ouvrez **Paramètres Windows → Applications → Applications installées**, recherchez **Bande V2** et cliquez sur **Désinstaller** (ou lancez `Desinstaller.exe` dans le dossier d'installation).

---

## Mode d'emploi

### 1. Extraire ou découper une vidéo
1. Copiez un lien YouTube (`youtube.com/watch?v=…`, `youtu.be/…` ou Short).
2. Cliquez sur **Coller** (l'analyse démarre automatiquement) ou collez le lien puis cliquez sur **Analyser**.
3. **Choisissez la découpe** (facultatif) :
   - Glissez les poignées vermillon **Début** et **Fin** sur la forme d'onde audio, ou ajustez au clavier / via `−` et `+`.
   - Sur macOS, cliquez sur **Lire l'extrait** pour écouter votre sélection avant export, et utilisez **I · Début ici** / **O · Fin ici** pour poser les bornes en cours d'écoute.
4. **Choisissez les paramètres** dans le panneau de droite :
   - Sortie **Audio** ou **Vidéo**.
   - Format principal (`MP3`, `OGG`, `WAV` ou `MP4`, `WEBM`, `MKV`) ou déroulez **Autres formats**.
   - Qualité (débit audio ou résolution vidéo réelle).
   - Ouvrez si besoin **Traitement son & fondus** et **Tags & pochette**.
5. Cliquez sur **Télécharger**. Le fichier est enregistré directement dans votre dossier de destination (`Téléchargements` par défaut, modifiable depuis la barre supérieure).
6. Pour extraire d'autres passages de la même vidéo, déplacez simplement les bornes et relancez **Télécharger** (ou empilez plusieurs découpes avec **`+ File`** puis **`Tout exporter`**).

### 2. Exporter une playlist
1. Collez un lien de playlist YouTube (`youtube.com/playlist?list=…`) puis cliquez sur **Analyser**.
   *(Si vous collez une vidéo issue d'une playlist, un bandeau vous propose de charger toute la playlist en un clic.)*
2. Cochez ou décochez les titres souhaités (double-clic sur une ligne sous Windows).
   - Sur macOS, le bouton **Découper** sur une ligne permet d'ouvrir ce titre seul dans le banc de découpe, puis de revenir à la playlist.
3. Choisissez le format, la qualité et l'option **Archive .ZIP** si souhaité, puis cliquez sur **Exporter la sélection**.

### 3. Retrouver vos fichiers
Chaque export terminé apparaît dans **Exportations de la session** avec son poids et sa durée de traitement :
- **macOS** : cliquez sur **Afficher dans le Finder** (ou **Reprendre bornes** pour recharger exactement la même découpe).
- **Windows** : sélectionnez la ligne et cliquez sur **Ouvrir dans l'Explorateur**.

---

## Contenu des paquets

Chaque application embarque ses propres binaires autonomes (aucune dépendance externe à installer) :
- `yt-dlp` (extraction des flux YouTube)
- `Deno` (résolution des défis JS YouTube)
- `FFmpeg` (découpe, encodage audio/vidéo, filtres DSP et pochettes)

## Dépannage

- **Vidéo indisponible ou privée** : les vidéos privées, supprimées, protégées par DRM ou les diffusions en direct en cours ne peuvent pas être extraites.
- **GIF limité à 30 secondes** : sélectionnez un extrait de 30 s maximum sur la barre de découpe avant de lancer un export GIF.
- **Échec soudain sur toutes les vidéos YouTube** : YouTube modifie régulièrement ses extracteurs. Remplacez simplement le binaire `yt-dlp` dans `Bande.app/Contents/Resources/bin/yt-dlp` (macOS) ou `%LOCALAPPDATA%\Bande\bin\yt-dlp.exe` (Windows) par la dernière release officielle de [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases).
