---
title: Bande
emoji: ✂️
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
---

# Bande — Version Web Optimisée

Version web prête à déployer (**7 fichiers au total, ~100 Ko**, aucune dépendance superflue) avec 100 % des fonctionnalités :

- Audio (**MP3, OGG, WAV** + FLAC, M4A, OPUS, AIFF, ALAC, AAC, WMA, AC3) & Vidéo (**MP4, WEBM, MKV** + MOV, AVI, M4V, TS, FLV, GIF)
- Qualités réelles (`144p` → `4K UHD 2160p`), forme d'onde audio réelle, découpe & file d'extraits
- Fondus entrée/sortie configurables (`0` par défaut), normalisation LUFS / gain dB / vidéo muette
- Tags éditables & studio de pochettes (Miniature, Deezer, Studio, Duotone, Typo, image locale)
- Playlists YouTube avec sélection par titre et export `.ZIP`

## Déploiement rapide (24h/24, Mac éteint)

### 1. Hugging Face Spaces (Gratuit, 16 Go RAM)
1. Créez un Space **Docker (Blank)** sur huggingface.co/spaces.
2. Glissez les **7 fichiers** de ce dossier `site web/` dans le Space.
3. Le build installe automatiquement `FFmpeg`, `yt-dlp`, `Deno`, `Flask` et `Gunicorn` sur le port `7860`.

### 2. Railway / Render / Fly.io / VPS Docker
```bash
docker build -t bande-web .
docker run -p 7860:7860 bande-web
```

### Optionnel : cookies YouTube (si un hébergeur cloud est filtré par YouTube)
Si YouTube demande une authentification depuis l'IP du serveur, ajoutez une variable secrète `YT_COOKIES_B64` contenant votre `cookies.txt` encodé en base64 :
```bash
base64 -i cookies.txt | tr -d '\n'
```
