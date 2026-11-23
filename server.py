import base64
import gzip
import json
import math
import mimetypes
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, urlparse

from flask import Flask, Response, jsonify, render_template, request, send_file, stream_with_context

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

IS_WINDOWS = sys.platform == "win32"
BASE_DIR = Path(__file__).resolve().parent
LOCAL_BIN_DIR = BASE_DIR / "bin"
EXE_SUFFIX = ".exe" if IS_WINDOWS else ""
SUBPROC_FLAGS = 0x08000000 if IS_WINDOWS else 0


def resolve_binary(name: str) -> str:
    local_candidate = LOCAL_BIN_DIR / f"{name}{EXE_SUFFIX}"
    if local_candidate.exists():
        return str(local_candidate)
    found = shutil.which(f"{name}{EXE_SUFFIX}") or shutil.which(name)
    return found or f"{name}{EXE_SUFFIX}"


YT_DLP_BIN = resolve_binary("yt-dlp")
FFMPEG_BIN = resolve_binary("ffmpeg")
FFMPEG_LOCATION = str(Path(FFMPEG_BIN).parent) if Path(FFMPEG_BIN).is_absolute() else None

WORK_ROOT = Path(tempfile.gettempdir()) / "bande_yt_web"
WORK_ROOT.mkdir(parents=True, exist_ok=True)

# Optional YouTube cookies support for cloud deployments (YT_COOKIES_B64 or YT_COOKIES_FILE)
COOKIES_PATH: Optional[str] = None
if os.environ.get("YT_COOKIES_FILE") and Path(os.environ["YT_COOKIES_FILE"]).is_file():
    COOKIES_PATH = os.environ["YT_COOKIES_FILE"]
elif os.environ.get("YT_COOKIES_B64"):
    try:
        cookie_file = WORK_ROOT / "cookies.txt"
        cookie_file.write_bytes(base64.b64decode(os.environ["YT_COOKIES_B64"]))
        COOKIES_PATH = str(cookie_file)
    except Exception:
        COOKIES_PATH = None

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 86400


@app.after_request
def compress_and_cache(response: Response) -> Response:
    # Cache static assets cleanly
    if request.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "public, max-age=86400")
    # Lightweight gzip compression for HTML/CSS/JS/JSON responses (skip SSE & binary downloads)
    if (
        response.status_code == 200
        and not response.direct_passthrough
        and "gzip" in (request.headers.get("Accept-Encoding") or "").lower()
        and response.mimetype in ("text/html", "text/css", "application/javascript", "text/javascript", "application/json")
        and "Content-Encoding" not in response.headers
    ):
        data = response.get_data()
        if len(data) > 1024:
            gz = gzip.compress(data, compresslevel=6)
            response.set_data(gz)
            response.headers["Content-Encoding"] = "gzip"
            response.headers["Content-Length"] = str(len(gz))
            response.headers["Vary"] = "Accept-Encoding"
    return response


# ---------------------------------------------------------------------------
# Format catalog
# ---------------------------------------------------------------------------

AUDIO_FORMATS: List[Dict[str, Any]] = [
    {"id": "mp3", "label": "MP3", "detail": "LAME · Universel", "primary": True, "lossless": False, "cover_ok": True, "ext": "mp3", "mime": "audio/mpeg"},
    {"id": "ogg", "label": "OGG", "detail": "Vorbis · Ouvert", "primary": True, "lossless": False, "cover_ok": False, "ext": "ogg", "mime": "audio/ogg"},
    {"id": "wav", "label": "WAV", "detail": "PCM · Sans perte", "primary": True, "lossless": True, "cover_ok": False, "ext": "wav", "mime": "audio/wav"},
    {"id": "flac", "label": "FLAC", "detail": "Compressé · Sans perte", "primary": False, "lossless": True, "cover_ok": True, "ext": "flac", "mime": "audio/flac"},
    {"id": "m4a", "label": "M4A", "detail": "AAC · Conteneur Apple", "primary": False, "lossless": False, "cover_ok": True, "ext": "m4a", "mime": "audio/mp4"},
    {"id": "opus", "label": "OPUS", "detail": "Haut rendement", "primary": False, "lossless": False, "cover_ok": False, "ext": "opus", "mime": "audio/opus"},
    {"id": "aiff", "label": "AIFF", "detail": "PCM · Studio macOS", "primary": False, "lossless": True, "cover_ok": False, "ext": "aiff", "mime": "audio/aiff"},
    {"id": "alac", "label": "ALAC", "detail": "Apple Lossless (M4A)", "primary": False, "lossless": True, "cover_ok": True, "ext": "m4a", "mime": "audio/mp4"},
    {"id": "aac", "label": "AAC", "detail": "Flux audio brut", "primary": False, "lossless": False, "cover_ok": False, "ext": "aac", "mime": "audio/aac"},
    {"id": "wma", "label": "WMA", "detail": "Windows Media", "primary": False, "lossless": False, "cover_ok": False, "ext": "wma", "mime": "audio/x-ms-wma"},
    {"id": "ac3", "label": "AC3", "detail": "Dolby Digital", "primary": False, "lossless": False, "cover_ok": False, "ext": "ac3", "mime": "audio/ac3"},
]

VIDEO_FORMATS: List[Dict[str, Any]] = [
    {"id": "mp4", "label": "MP4", "detail": "H.264 / AAC · Universel", "primary": True, "ext": "mp4", "mime": "video/mp4"},
    {"id": "webm", "label": "WEBM", "detail": "VP9 / Opus · Web", "primary": True, "ext": "webm", "mime": "video/webm"},
    {"id": "mkv", "label": "MKV", "detail": "Matroska · Flux natif", "primary": True, "ext": "mkv", "mime": "video/x-matroska"},
    {"id": "mov", "label": "MOV", "detail": "QuickTime · H.264", "primary": False, "ext": "mov", "mime": "video/quicktime"},
    {"id": "avi", "label": "AVI", "detail": "MPEG-4 / MP3", "primary": False, "ext": "avi", "mime": "video/x-msvideo"},
    {"id": "m4v", "label": "M4V", "detail": "Vidéo Apple", "primary": False, "ext": "m4v", "mime": "video/x-m4v"},
    {"id": "ts", "label": "TS", "detail": "MPEG Transport", "primary": False, "ext": "ts", "mime": "video/mp2t"},
    {"id": "flv", "label": "FLV", "detail": "Flash Video", "primary": False, "ext": "flv", "mime": "video/x-flv"},
    {"id": "gif", "label": "GIF", "detail": "Séquence animée", "primary": False, "ext": "gif", "mime": "image/gif"},
]

AUDIO_FORMAT_MAP = {f["id"]: f for f in AUDIO_FORMATS}
VIDEO_FORMAT_MAP = {f["id"]: f for f in VIDEO_FORMATS}

AUDIO_BITRATES = [
    {"value": "320", "label": "320 kbps", "tag": "Max"},
    {"value": "256", "label": "256 kbps", "tag": "Haute"},
    {"value": "192", "label": "192 kbps", "tag": "Standard"},
    {"value": "128", "label": "128 kbps", "tag": "Léger"},
    {"value": "96", "label": "96 kbps", "tag": "Compact"},
]

AUDIO_SAMPLE_RATES = [
    {"value": "48000", "label": "48 kHz", "tag": "Studio"},
    {"value": "44100", "label": "44,1 kHz", "tag": "CD"},
]

QUALITY_LABELS = {
    4320: "8K UHD",
    2160: "4K UHD",
    1440: "2K QHD",
    1080: "Full HD",
    720: "HD",
    480: "SD",
    360: "Bas",
    240: "Très bas",
    144: "Minimal",
}

PROBE_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
PLAYLIST_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
AUDIO_STREAM_CACHE: Dict[str, Tuple[float, str, float]] = {}
WAVEFORM_CACHE: Dict[str, Tuple[float, List[float]]] = {}
PROBE_TTL_SEC = 600
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
JOB_RETENTION_SEC = 1800


def get_subprocess_env() -> Dict[str, str]:
    env = os.environ.copy()
    if LOCAL_BIN_DIR.exists():
        env["PATH"] = f"{LOCAL_BIN_DIR}{os.pathsep}{env.get('PATH', '')}"
    return env


def yt_base_cmd() -> List[str]:
    cmd = [YT_DLP_BIN]
    if FFMPEG_LOCATION:
        cmd += ["--ffmpeg-location", FFMPEG_LOCATION]
    if COOKIES_PATH:
        cmd += ["--cookies", COOKIES_PATH]
    return cmd


def run_hidden(cmd: List[str], **kwargs: Any) -> subprocess.CompletedProcess:
    if SUBPROC_FLAGS:
        kwargs.setdefault("creationflags", SUBPROC_FLAGS)
    return subprocess.run(cmd, **kwargs)


def popen_hidden(cmd: List[str], **kwargs: Any) -> subprocess.Popen:
    if SUBPROC_FLAGS:
        kwargs.setdefault("creationflags", SUBPROC_FLAGS)
    return subprocess.Popen(cmd, **kwargs)


def is_valid_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.netloc or "").lower().split(":")[0]
    return host in {
        "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
        "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
    }


def inspect_playlist_url(url: str) -> Tuple[bool, Optional[str]]:
    parsed = urlparse(url.strip())
    qs = parse_qs(parsed.query)
    list_id = (qs.get("list") or [None])[0]
    path = (parsed.path or "").rstrip("/").lower()
    if path == "/playlist" and list_id:
        return True, list_id
    if list_id and not list_id.startswith("RD"):
        return False, list_id
    return False, None


def sanitize_filename(name: str, max_len: int = 90) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", name or "video").strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip(". ")
    return (cleaned or "media")[:max_len].strip()


def format_tc_filename(sec: float) -> str:
    total = max(0, int(round(sec)))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}h{m:02d}m{s:02d}s" if h > 0 else f"{m:02d}m{s:02d}s"


def format_tc_ytdlp(sec: float) -> str:
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def parse_ffmpeg_time(timestr: str) -> Optional[float]:
    m = re.match(r"(\d+):(\d+):(\d+(?:\.\d+)?)", timestr.strip())
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None


def cleanup_old_jobs() -> None:
    now = time.time()
    to_remove = []
    with JOBS_LOCK:
        for job_id, job in JOBS.items():
            if job["status"] in ("done", "error", "cancelled") and (now - job["updated_at"] > JOB_RETENTION_SEC):
                to_remove.append((job_id, job.get("work_dir")))
        for job_id, _ in to_remove:
            JOBS.pop(job_id, None)
    for _, work_dir in to_remove:
        if work_dir and Path(work_dir).exists():
            shutil.rmtree(work_dir, ignore_errors=True)


def extract_qualities(formats: List[Dict[str, Any]], duration: float) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[str]]:
    audio_streams = [
        f for f in formats
        if f.get("acodec") and f.get("acodec") != "none" and (not f.get("vcodec") or f.get("vcodec") == "none")
    ]
    best_audio_abr, best_audio_size, best_audio_asr = 0.0, 0, 48000
    light_audio_url: Optional[str] = None
    light_audio_abr = 1e9

    for a in audio_streams:
        abr = float(a.get("abr") or 0)
        if abr > best_audio_abr:
            best_audio_abr = abr
            best_audio_size = int(a.get("filesize") or a.get("filesize_approx") or 0)
            if a.get("asr"):
                best_audio_asr = int(a["asr"])
        u = a.get("url") or ""
        proto = (a.get("protocol") or "").lower()
        if u.startswith("http") and "m3u8" not in proto and "dash" not in proto:
            score_abr = abr if abr > 0 else 999.0
            if score_abr < light_audio_abr:
                light_audio_abr = score_abr
                light_audio_url = u

    by_height: Dict[int, Dict[str, Any]] = {}
    for f in formats:
        vcodec = f.get("vcodec")
        height = f.get("height")
        if not vcodec or vcodec == "none" or not height:
            continue
        try:
            h = int(height)
        except (TypeError, ValueError):
            continue
        if h < 100:
            continue

        fps = round(float(f.get("fps") or 30))
        is_hdr = str(f.get("dynamic_range") or "SDR").upper() != "SDR"
        vsize = int(f.get("filesize") or f.get("filesize_approx") or 0)
        if vsize == 0 and f.get("tbr") and duration:
            vsize = int((float(f["tbr"]) * 1000 / 8) * duration)
        est = vsize + (best_audio_size if f.get("acodec") in (None, "none") else 0)

        prev = by_height.get(h)
        if prev is None:
            by_height[h] = {
                "height": h,
                "width": int(f.get("width") or round(h * 16 / 9)),
                "fps": fps,
                "hdr": is_hdr,
                "label": QUALITY_LABELS.get(h, f"{h}p"),
                "approx_bytes": est,
                "has_h264": "avc" in vcodec.lower() or "h264" in vcodec.lower(),
            }
        else:
            prev["fps"] = max(prev["fps"], fps)
            prev["hdr"] = prev["hdr"] or is_hdr
            prev["has_h264"] = prev["has_h264"] or ("avc" in vcodec.lower() or "h264" in vcodec.lower())
            if prev["approx_bytes"] < est < 20 * 1024 ** 3:
                prev["approx_bytes"] = est

    return (
        sorted(by_height.values(), key=lambda x: x["height"], reverse=True),
        {"max_abr": round(best_audio_abr) if best_audio_abr else 128, "sample_rate": best_audio_asr},
        light_audio_url,
    )


def pick_best_thumbnail(info: Dict[str, Any]) -> str:
    thumbs = info.get("thumbnails") or []
    best_url = info.get("thumbnail") or ""
    best_score = -1
    for t in thumbs:
        url = t.get("url") or ""
        if not url or not url.startswith("http"):
            continue
        score = int(t.get("width") or 0) * int(t.get("height") or 0)
        if "maxresdefault" in url:
            score += 10_000_000
        elif "hq720" in url:
            score += 5_000_000
        elif ".jpg" in url:
            score += 500_000
        if score > best_score:
            best_score = score
            best_url = url
    return best_url


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"ok": True, "platform": sys.platform})


@app.route("/api/formats", methods=["GET"])
def api_formats():
    return jsonify({
        "audio": AUDIO_FORMATS,
        "video": VIDEO_FORMATS,
        "audio_bitrates": AUDIO_BITRATES,
        "audio_sample_rates": AUDIO_SAMPLE_RATES,
    })


@app.route("/api/thumbnail", methods=["GET"])
def api_thumbnail_proxy():
    url = str(request.args.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL manquante."}), 400
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    allowed = ("i.ytimg.com", "img.youtube.com", "i9.ytimg.com", "lh3.googleusercontent.com")
    if parsed.scheme not in ("http", "https") or not any(host == h or host.endswith("." + h) for h in allowed):
        return jsonify({"error": "Hôte d'image non autorisé."}), 403
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return Response(resp.read(), mimetype=resp.headers.get("Content-Type") or "image/jpeg", headers={"Cache-Control": "public, max-age=3600"})
    except Exception as exc:
        return jsonify({"error": f"Impossible de charger la miniature : {exc}"}), 502


@app.route("/api/waveform/<video_id>", methods=["GET"])
def api_waveform(video_id: str):
    if not re.match(r"^[A-Za-z0-9_-]{6,20}$", video_id):
        return jsonify({"error": "Identifiant vidéo invalide."}), 400
    cached = WAVEFORM_CACHE.get(video_id)
    if cached and (time.time() - cached[0] < 3600):
        return jsonify({"video_id": video_id, "peaks": cached[1]})

    stream_entry = AUDIO_STREAM_CACHE.get(video_id)
    stream_url, duration = (stream_entry[1], stream_entry[2]) if (stream_entry and time.time() - stream_entry[0] < 3600) else (None, 0.0)
    if not stream_url:
        try:
            proc = run_hidden(
                yt_base_cmd() + ["-g", "-f", "worstaudio/bestaudio", "--no-playlist", "--no-warnings", f"https://www.youtube.com/watch?v={video_id}"],
                env=get_subprocess_env(), capture_output=True, text=True, timeout=20,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                stream_url = proc.stdout.strip().splitlines()[0]
        except Exception:
            stream_url = None
    if not stream_url:
        return jsonify({"error": "Flux audio indisponible."}), 404

    sr = 120 if duration > 1200 else 250
    cmd = [FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-reconnect", "1", "-reconnect_streamed", "1", "-i", stream_url, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "pipe:1"]
    try:
        proc = run_hidden(cmd, env=get_subprocess_env(), capture_output=True, timeout=35)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Délai dépassé."}), 504

    raw = proc.stdout
    num_samples = len(raw) // 2
    if proc.returncode != 0 or num_samples < 32:
        return jsonify({"error": "Forme d'onde indisponible."}), 422

    samples = struct.unpack(f"<{num_samples}h", raw[: num_samples * 2])
    bucket_count = 140
    step = num_samples / bucket_count
    raw_levels: List[float] = []
    for i in range(bucket_count):
        s_idx = int(i * step)
        e_idx = max(s_idx + 1, int((i + 1) * step))
        chunk = samples[s_idx:e_idx]
        if not chunk:
            raw_levels.append(0.0)
            continue
        peak = max(abs(x) for x in chunk) / 32768.0
        rms = math.sqrt(sum(x * x for x in chunk) / len(chunk)) / 32768.0
        raw_levels.append(0.55 * rms + 0.45 * peak)

    sorted_levels = sorted(raw_levels)
    ref = sorted_levels[min(len(sorted_levels) - 1, int(len(sorted_levels) * 0.97))] or max(sorted_levels) or 1.0
    peaks = [round(min(1.0, max(0.06, v / ref)), 3) for v in raw_levels]
    WAVEFORM_CACHE[video_id] = (time.time(), peaks)
    return jsonify({"video_id": video_id, "peaks": peaks})


def probe_playlist_internal(url: str) -> Tuple[Optional[Dict[str, Any]], Optional[str], int]:
    cached = PLAYLIST_CACHE.get(url)
    if cached and (time.time() - cached[0] < PROBE_TTL_SEC):
        return cached[1], None, 200
    try:
        proc = run_hidden(yt_base_cmd() + ["--flat-playlist", "-J", "--no-warnings", url], env=get_subprocess_env(), capture_output=True, text=True, timeout=35)
    except subprocess.TimeoutExpired:
        return None, "L'analyse de la playlist a pris trop de temps.", 504
    except Exception as exc:
        return None, f"Erreur playlist : {exc}", 500
    if proc.returncode != 0 or not proc.stdout.strip():
        return None, "Playlist introuvable, privée ou vide.", 422
    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None, "Réponse inattendue.", 500

    entries = []
    for idx, item in enumerate(info.get("entries") or [], start=1):
        if not item:
            continue
        vid_id = item.get("id")
        title = str(item.get("title") or "").strip()
        if not vid_id or title in ("[Private video]", "[Deleted video]"):
            continue
        thumbs = item.get("thumbnails") or []
        thumb = (thumbs[0].get("url") if thumbs else "") or f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
        entries.append({
            "index": idx, "id": vid_id, "url": f"https://www.youtube.com/watch?v={vid_id}",
            "title": title or f"Vidéo {idx}",
            "channel": item.get("channel") or item.get("uploader") or info.get("channel") or "",
            "duration": float(item.get("duration") or 0), "thumbnail": thumb,
        })
    if not entries:
        return None, "Aucune vidéo exploitable dans cette playlist.", 422

    result = {
        "kind": "playlist", "id": info.get("id") or "", "url": info.get("webpage_url") or url,
        "title": info.get("title") or "Playlist YouTube",
        "channel": info.get("channel") or info.get("uploader") or "",
        "count": len(entries), "entries": entries,
    }
    PLAYLIST_CACHE[url] = (time.time(), result)
    return result, None, 200


@app.route("/api/probe-playlist", methods=["POST"])
def api_probe_playlist():
    cleanup_old_jobs()
    url = str((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not url or not is_valid_youtube_url(url):
        return jsonify({"error": "Lien de playlist YouTube invalide."}), 400
    result, err, code = probe_playlist_internal(url)
    return (jsonify({"error": err}), code) if err else jsonify(result)


@app.route("/api/probe", methods=["POST"])
def api_probe():
    cleanup_old_jobs()
    url = str((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not url:
        return jsonify({"error": "Veuillez coller un lien YouTube."}), 400
    if not is_valid_youtube_url(url):
        return jsonify({"error": "Ce lien ne correspond pas à une adresse YouTube valide."}), 400

    is_pure_pl, pl_id = inspect_playlist_url(url)
    if is_pure_pl:
        result, err, code = probe_playlist_internal(url)
        return (jsonify({"error": err}), code) if err else jsonify(result)

    cached = PROBE_CACHE.get(url)
    if cached and (time.time() - cached[0] < PROBE_TTL_SEC):
        return jsonify(cached[1])

    try:
        proc = run_hidden(yt_base_cmd() + ["-J", "--no-playlist", "--no-warnings", url], env=get_subprocess_env(), capture_output=True, text=True, timeout=35)
    except subprocess.TimeoutExpired:
        return jsonify({"error": "L'analyse a pris trop de temps."}), 504
    except Exception as exc:
        return jsonify({"error": f"Impossible de lancer l'analyse : {exc}"}), 500

    if proc.returncode != 0 or not proc.stdout.strip():
        lines = (proc.stderr or "").strip().splitlines()
        detail = lines[-1] if lines else "Vidéo introuvable ou inaccessible."
        if "Private video" in detail:
            detail = "Cette vidéo est privée et ne peut pas être extraite."
        elif "Video unavailable" in detail:
            detail = "Cette vidéo n'est pas disponible."
        elif "Sign in" in detail or "age" in detail.lower():
            detail = "Cette vidéo nécessite une authentification YouTube (configurez YT_COOKIES_B64 sur le serveur si besoin)."
        return jsonify({"error": detail}), 422

    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return jsonify({"error": "Réponse inattendue."}), 500
    if info.get("is_live"):
        return jsonify({"error": "Les directs en cours ne peuvent pas être convertis."}), 422

    duration = float(info.get("duration") or 0)
    qualities, audio_info, light_audio_url = extract_qualities(info.get("formats") or [], duration)
    vid_id = info.get("id")
    if vid_id and light_audio_url:
        AUDIO_STREAM_CACHE[vid_id] = (time.time(), light_audio_url, duration)

    chapters = [
        {"title": str(ch.get("title") or "").strip() or "Chapitre", "start": float(ch["start_time"]), "end": float(ch["end_time"])}
        for ch in (info.get("chapters") or [])
        if ch.get("start_time") is not None and ch.get("end_time") is not None and ch["end_time"] > ch["start_time"]
    ]
    result = {
        "kind": "video", "id": vid_id, "url": info.get("webpage_url") or url,
        "title": info.get("title") or "Sans titre",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": duration, "thumbnail": pick_best_thumbnail(info),
        "view_count": info.get("view_count"), "upload_date": info.get("upload_date"),
        "chapters": chapters, "video_qualities": qualities, "audio_info": audio_info,
        "playlist_hint": {"id": pl_id, "url": f"https://www.youtube.com/playlist?list={pl_id}"} if pl_id else None,
    }
    PROBE_CACHE[url] = (time.time(), result)
    return jsonify(result)


# ---------------------------------------------------------------------------
# FFmpeg Helpers & Job Execution
# ---------------------------------------------------------------------------

def probe_media_info(file_path: Path) -> Tuple[str, str, float]:
    proc = run_hidden([FFMPEG_BIN, "-hide_banner", "-i", str(file_path)], env=get_subprocess_env(), capture_output=True, text=True)
    out = proc.stderr or ""
    v = re.search(r"Stream #\d+:\d+.*?: Video:\s*([a-zA-Z0-9_]+)", out)
    a = re.search(r"Stream #\d+:\d+.*?: Audio:\s*([a-zA-Z0-9_]+)", out)
    d = re.search(r"Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)", out)
    return (v.group(1).lower() if v else "", a.group(1).lower() if a else "", (parse_ffmpeg_time(d.group(1)) if d else 0.0) or 0.0)


def prepare_cover_file(work_dir: Path, cover_data_url: Optional[str], cover_url: Optional[str]) -> Optional[Path]:
    raw_path: Optional[Path] = None
    if cover_data_url and isinstance(cover_data_url, str) and cover_data_url.startswith("data:image/"):
        try:
            header, b64 = cover_data_url.split(",", 1)
            img_bytes = base64.b64decode(b64)
            if len(img_bytes) > 8 * 1024 * 1024:
                return None
            raw_path = work_dir / f"cover_raw.{'png' if 'png' in header else 'jpg'}"
            raw_path.write_bytes(img_bytes)
        except Exception:
            return None
    elif cover_url and isinstance(cover_url, str) and cover_url.startswith("http"):
        try:
            req = urllib.request.Request(cover_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw_path = work_dir / "cover_raw.img"
                raw_path.write_bytes(resp.read())
        except Exception:
            return None
    if not raw_path or not raw_path.exists():
        return None
    out_cover = work_dir / "cover.jpg"
    vf = "crop=min(iw\\,ih):min(iw\\,ih),scale=1000:1000:flags=lanczos"
    proc = run_hidden([FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_path), "-vf", vf, "-q:v", "2", str(out_cover)], env=get_subprocess_env(), capture_output=True)
    raw_path.unlink(missing_ok=True)
    return out_cover if (proc.returncode == 0 and out_cover.exists() and out_cover.stat().st_size > 0) else None


def build_audio_filter_chain(actual_duration: float, fade_in: float, fade_out: float, audio_norm_mode: str, target_lufs: float, gain_db: float) -> Optional[str]:
    filters: List[str] = []
    if audio_norm_mode == "lufs":
        filters.append(f"loudnorm=I={max(-24.0, min(-5.0, float(target_lufs))):.1f}:TP=-1.5:LRA=11")
    elif audio_norm_mode == "gain" and abs(gain_db) >= 0.1:
        filters.append(f"volume={max(-18.0, min(18.0, float(gain_db))):+.1f}dB")
    fi = max(0.0, min(30.0, float(fade_in or 0.0)))
    fo = max(0.0, min(30.0, float(fade_out or 0.0)))
    if actual_duration > 0:
        fi = min(fi, actual_duration * 0.5)
        fo = min(fo, max(0.0, actual_duration - fi))
    if fi >= 0.05:
        filters.append(f"afade=t=in:st=0:d={fi:.2f}")
    if fo >= 0.05 and actual_duration > 0.2:
        filters.append(f"afade=t=out:st={max(0.0, actual_duration - fo):.3f}:d={fo:.2f}")
    return ",".join(filters) if filters else None


def build_audio_ffmpeg_args(src_path: Path, out_path: Path, fmt_id: str, quality: str, title: str, artist: str, album: str, af_chain: Optional[str], cover_path: Optional[Path]) -> List[str]:
    use_cover = bool(cover_path and cover_path.exists() and AUDIO_FORMAT_MAP[fmt_id].get("cover_ok"))
    args = ["-i", str(src_path)] + (["-i", str(cover_path), "-map", "0:a:0", "-map", "1:v:0"] if use_cover else ["-vn"])
    if af_chain:
        args += ["-af", af_chain]
    br = quality if quality in ("320", "256", "192", "128", "96") else "192"
    sr = quality if quality in ("48000", "44100") else "48000"

    if fmt_id == "mp3":
        args += ["-c:a", "libmp3lame", "-b:a", f"{br}k", "-id3v2_version", "3"]
        if use_cover:
            args += ["-c:v", "mjpeg", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
    elif fmt_id == "ogg":
        args += ["-c:a", "libvorbis", "-b:a", f"{br}k"]
    elif fmt_id == "wav":
        args += ["-c:a", "pcm_s16le", "-ar", sr]
    elif fmt_id == "flac":
        args += ["-c:a", "flac", "-ar", sr] + (["-c:v", "mjpeg", "-disposition:v:0", "attached_pic"] if use_cover else [])
    elif fmt_id == "m4a":
        args += ["-c:a", "aac", "-b:a", f"{br}k", "-movflags", "+faststart"] + (["-c:v", "mjpeg", "-disposition:v:0", "attached_pic"] if use_cover else [])
    elif fmt_id == "opus":
        args += ["-c:a", "libopus", "-b:a", f"{br}k"]
    elif fmt_id == "aiff":
        args += ["-c:a", "pcm_s16be", "-ar", sr]
    elif fmt_id == "alac":
        args += ["-c:a", "alac", "-ar", sr, "-movflags", "+faststart"] + (["-c:v", "mjpeg", "-disposition:v:0", "attached_pic"] if use_cover else [])
    elif fmt_id == "aac":
        args += ["-c:a", "aac", "-b:a", f"{br}k", "-f", "adts"]
    elif fmt_id == "wma":
        args += ["-c:a", "wmav2", "-b:a", f"{br}k"]
    elif fmt_id == "ac3":
        args += ["-c:a", "ac3", "-b:a", f"{br}k"]
    else:
        args += ["-c:a", "libmp3lame", "-b:a", "192k"]

    if fmt_id != "aac":
        if title:
            args += ["-metadata", f"title={title}"]
        if artist:
            args += ["-metadata", f"artist={artist}"]
        if album:
            args += ["-metadata", f"album={album}"]
    args.append(str(out_path))
    return args


def build_video_ffmpeg_args(src_path: Path, out_path: Path, fmt_id: str, title: str, artist: str, af_chain: Optional[str], mute_video: bool) -> List[str]:
    vcodec, acodec, _ = probe_media_info(src_path)
    args = ["-i", str(src_path)]
    if fmt_id == "gif":
        return args + ["-vf", "fps=15,scale=min(640\\,iw):-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer", "-loop", "0", str(out_path)]

    need_re = bool(af_chain) and not mute_video
    if fmt_id in ("mp4", "mov", "m4v"):
        args += ["-c:v", "copy"] if vcodec == "h264" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
        args += ["-an"] if mute_video else (["-c:a", "copy"] if not need_re and acodec in ("aac", "") else ((["-af", af_chain] if af_chain else []) + ["-c:a", "aac", "-b:a", "192k"]))
        args += ["-movflags", "+faststart"]
    elif fmt_id == "webm":
        args += ["-c:v", "copy"] if vcodec in ("vp9", "vp8", "av1") else ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-deadline", "realtime", "-cpu-used", "5"]
        args += ["-an"] if mute_video else (["-c:a", "copy"] if not need_re and acodec in ("opus", "vorbis", "") else ((["-af", af_chain] if af_chain else []) + ["-c:a", "libopus", "-b:a", "128k"]))
    elif fmt_id == "mkv":
        args += ["-c:v", "copy"] + (["-an"] if mute_video else (["-c:a", "copy"] if not need_re else ["-af", af_chain, "-c:a", "aac", "-b:a", "192k"]))
    elif fmt_id == "avi":
        args += ["-c:v", "mpeg4", "-q:v", "4"] + (["-an"] if mute_video else ((["-af", af_chain] if af_chain else []) + ["-c:a", "libmp3lame", "-b:a", "192k"]))
    elif fmt_id == "flv":
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p"] + (["-an"] if mute_video else ((["-af", af_chain] if af_chain else []) + ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"])) + ["-f", "flv"]
    elif fmt_id == "ts":
        args += (["-c:v", "copy"] if vcodec == "h264" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"])
        args += (["-an"] if mute_video else (["-c:a", "copy"] if not need_re and acodec in ("aac", "mp3", "") else ((["-af", af_chain] if af_chain else []) + ["-c:a", "aac", "-b:a", "192k"]))) + ["-f", "mpegts"]
    else:
        args += ["-c", "copy"]

    if fmt_id in ("mp4", "mkv", "mov", "m4v", "webm"):
        if title:
            args += ["-metadata", f"title={title}"]
        if artist:
            args += ["-metadata", f"artist={artist}"]
    args.append(str(out_path))
    return args


def update_job(job_id: str, **fields: Any) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(fields)
            job["updated_at"] = time.time()


def is_job_cancelled(job_id: str) -> bool:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return not job or job.get("cancelled", False)


def run_ffmpeg_with_progress(job_id: str, cmd: List[str], expected_duration: float, progress_start: float, progress_end: float, stage_label: str) -> Tuple[int, str]:
    proc = popen_hidden([FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"] + cmd, env=get_subprocess_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id]["proc"] = proc
    stderr_lines: List[str] = []
    err_thread = threading.Thread(target=lambda: [stderr_lines.append(l.strip()) for l in proc.stderr], daemon=True)
    err_thread.start()
    for raw in proc.stdout:
        if is_job_cancelled(job_id):
            proc.terminate()
            break
        line = raw.strip()
        if line.startswith("out_time_us="):
            try:
                us = int(line.split("=", 1)[1])
                if expected_duration > 0 and us >= 0:
                    ratio = min(1.0, (us / 1_000_000.0) / expected_duration)
                    update_job(job_id, progress=round(progress_start + ratio * (progress_end - progress_start), 1), stage=stage_label)
            except ValueError:
                pass
    proc.wait()
    err_thread.join(timeout=2)
    return proc.returncode, "\n".join(stderr_lines[-8:])


def convert_single_media(job_id: str, work_dir: Path, params: Dict[str, Any], pct_floor: float = 0.0, pct_ceil: float = 100.0, stage_prefix: str = "") -> Tuple[Optional[Path], Optional[str], Optional[str]]:
    url, mode, fmt_id, quality = params["url"], params["mode"], params["format"], str(params["quality"])
    trim_start, trim_end = params.get("trim_start"), params.get("trim_end")
    total_duration = float(params.get("duration") or 0)
    title, artist, album = str(params.get("title") or "media"), str(params.get("artist") or ""), str(params.get("album") or "")
    custom_filename = str(params.get("custom_filename") or "").strip()

    span = pct_ceil - pct_floor
    dl_start, dl_end, ff_start, ff_end = pct_floor + span * 0.04, pct_floor + span * 0.65, pct_floor + span * 0.68, pct_floor + span * 0.98
    is_trimmed = trim_start is not None and trim_end is not None and trim_end > trim_start and (trim_start > 0.25 or (total_duration > 0 and trim_end < total_duration - 0.25))
    expected_duration = (trim_end - trim_start) if is_trimmed else total_duration

    fmt_meta = AUDIO_FORMAT_MAP[fmt_id] if mode == "audio" else VIDEO_FORMAT_MAP[fmt_id]
    ext = fmt_meta["ext"]
    base_name = sanitize_filename(custom_filename or title)
    suffix = []
    if is_trimmed:
        suffix.append(f"{format_tc_filename(trim_start)}-{format_tc_filename(trim_end)}")
    if mode == "video":
        if fmt_id != "gif":
            suffix.append(f"{quality}p")
        if params.get("mute_video"):
            suffix.append("muet")
    elif not fmt_meta.get("lossless"):
        suffix.append(f"{quality}k")
    if fmt_id == "alac":
        suffix.append("ALAC")
    final_filename = f"{base_name} [{', '.join(suffix)}].{ext}" if (suffix and not custom_filename) else f"{base_name}.{ext}"

    track_dir = work_dir / f"t_{uuid.uuid4().hex[:6]}"
    track_dir.mkdir(parents=True, exist_ok=True)
    if mode == "audio":
        yt_format = "bestaudio/best"
    else:
        max_h = int(quality) if quality.isdigit() else 1080
        if fmt_id in ("mp4", "mov", "m4v", "ts", "flv"):
            yt_format = f"bestvideo[height<={max_h}][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[height<={max_h}]+bestaudio/best[height<={max_h}]/best"
        elif fmt_id == "webm":
            yt_format = f"bestvideo[height<={max_h}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<={max_h}]+bestaudio/best[height<={max_h}]/best"
        else:
            yt_format = f"bestvideo[height<={max_h}]+bestaudio/best[height<={max_h}]/best"

    yt_cmd = yt_base_cmd() + ["--no-playlist", "--newline", "--concurrent-fragments", "4", "-f", yt_format, "-o", str(track_dir / "source.%(ext)s")]
    if is_trimmed:
        yt_cmd += ["--download-sections", f"*{format_tc_ytdlp(trim_start)}-{format_tc_ytdlp(trim_end)}", "--force-keyframes-at-cuts"]
    yt_cmd.append(url)

    update_job(job_id, status="downloading", progress=round(dl_start, 1), stage=f"{stage_prefix}Téléchargement…")
    proc = popen_hidden(yt_cmd, env=get_subprocess_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id]["proc"] = proc

    log_tail: List[str] = []
    for raw_line in proc.stdout:
        if is_job_cancelled(job_id):
            proc.terminate()
            return None, None, "CANCELLED"
        line = raw_line.strip()
        if not line:
            continue
        log_tail.append(line)
        if len(log_tail) > 25:
            log_tail.pop(0)
        pm = re.search(r"\[download\]\s+(\d+(?:\.\d+)?)%", line)
        if pm:
            update_job(job_id, progress=round(dl_start + (float(pm.group(1)) / 100.0) * (dl_end - dl_start), 1), stage=f"{stage_prefix}{'Téléchargement de l’extrait…' if is_trimmed else 'Téléchargement du flux…'}")
            continue
        tm = re.search(r"time=(\d+:\d+:\d+(?:\.\d+)?)", line)
        if tm and expected_duration > 0:
            sec = parse_ffmpeg_time(tm.group(1))
            if sec is not None:
                update_job(job_id, progress=round(dl_start + min(1.0, sec / expected_duration) * (dl_end - dl_start), 1), stage=f"{stage_prefix}Découpe et récupération…")
    proc.wait()
    if is_job_cancelled(job_id):
        return None, None, "CANCELLED"
    if proc.returncode != 0:
        return None, None, next((l for l in reversed(log_tail) if "ERROR:" in l), log_tail[-1] if log_tail else "Échec du téléchargement.")

    candidates = [p for p in track_dir.iterdir() if p.is_file() and p.name.startswith("source.") and not p.name.endswith((".part", ".ytdl"))]
    if not candidates:
        return None, None, "Aucun fichier média généré."
    src_path = max(candidates, key=lambda p: p.stat().st_size)

    _, _, probed_dur = probe_media_info(src_path)
    actual_dur = probed_dur if probed_dur > 0 else expected_duration
    af_chain = build_audio_filter_chain(actual_dur, float(params.get("fade_in") or 0), float(params.get("fade_out") or 0), str(params.get("audio_norm_mode") or "off"), float(params.get("target_lufs", -14.0)), float(params.get("gain_db") or 0))
    cover_path = prepare_cover_file(track_dir, params.get("cover_data_url"), params.get("cover_url")) if (mode == "audio" and fmt_meta.get("cover_ok") and (params.get("cover_data_url") or params.get("cover_url"))) else None

    update_job(job_id, status="converting", progress=round(ff_start, 1), stage=f"{stage_prefix}Conversion en {fmt_meta['label']}…")
    out_path = track_dir / f"output.{ext}"
    ff_args = build_audio_ffmpeg_args(src_path, out_path, fmt_id, quality, title, artist, album, af_chain, cover_path) if mode == "audio" else build_video_ffmpeg_args(src_path, out_path, fmt_id, title, artist, af_chain, bool(params.get("mute_video")))
    rc, ff_err = run_ffmpeg_with_progress(job_id, ff_args, actual_dur, ff_start, ff_end, f"{stage_prefix}Encodage {fmt_meta['label']}…")
    if is_job_cancelled(job_id):
        return None, None, "CANCELLED"
    if rc != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        return None, None, f"Erreur conversion {fmt_meta['label']} : {ff_err or 'échec ffmpeg'}"
    src_path.unlink(missing_ok=True)
    if cover_path:
        cover_path.unlink(missing_ok=True)
    return out_path, final_filename, None


def execute_job(job_id: str, params: Dict[str, Any]) -> None:
    work_dir = WORK_ROOT / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    update_job(job_id, work_dir=str(work_dir), status="downloading", progress=2.0, stage="Préparation du flux…")
    try:
        out_path, final_filename, err = convert_single_media(job_id, work_dir, params)
        if err == "CANCELLED":
            update_job(job_id, status="cancelled", stage="Annulé")
            return
        if err or not out_path or not final_filename:
            update_job(job_id, status="error", error=err or "Conversion impossible.", stage="Erreur")
            return
        fmt_meta = AUDIO_FORMAT_MAP[params["format"]] if params["mode"] == "audio" else VIDEO_FORMAT_MAP[params["format"]]
        update_job(job_id, status="done", progress=100.0, stage="Prêt", file_path=str(out_path), filename=final_filename, mime=fmt_meta["mime"], file_size=out_path.stat().st_size, download_url=f"/api/jobs/{job_id}/file")
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), stage="Erreur")


def execute_batch_job(job_id: str, params: Dict[str, Any]) -> None:
    work_dir = WORK_ROOT / job_id
    work_dir.mkdir(parents=True, exist_ok=True)
    items = params["items"]
    total = len(items)
    fmt_meta = AUDIO_FORMAT_MAP[params["format"]] if params["mode"] == "audio" else VIDEO_FORMAT_MAP[params["format"]]
    update_job(job_id, work_dir=str(work_dir), status="downloading", progress=1.0, stage=f"Playlist : 0 / {total}")
    completed, used_names, errors = [], {}, []
    try:
        for idx, item in enumerate(items):
            if is_job_cancelled(job_id):
                update_job(job_id, status="cancelled", stage="Annulé")
                return
            tp = {
                "url": item["url"], "title": item.get("title") or f"Titre {idx + 1}",
                "artist": item.get("channel") or "", "album": params.get("playlist_title") or "",
                "duration": float(item.get("duration") or 0), "mode": params["mode"],
                "format": params["format"], "quality": params["quality"],
                "fade_in": params.get("fade_in") or 0.0, "fade_out": params.get("fade_out") or 0.0,
                "audio_norm_mode": params.get("audio_norm_mode") or "off",
                "target_lufs": params.get("target_lufs", -14.0), "gain_db": params.get("gain_db") or 0.0,
                "mute_video": bool(params.get("mute_video")),
                "cover_url": item.get("thumbnail") if params.get("embed_thumb_cover") else None,
            }
            out_path, fname, err = convert_single_media(job_id, work_dir, tp, (idx / total) * 95.0, ((idx + 1) / total) * 95.0, f"[{idx + 1}/{total}] ")
            if err == "CANCELLED":
                update_job(job_id, status="cancelled", stage="Annulé")
                return
            if err or not out_path or not fname:
                errors.append(f"{tp['title']} : {err}")
                continue
            key = fname.lower()
            if key in used_names:
                used_names[key] += 1
                stem, _, ext = fname.rpartition(".")
                fname = f"{stem} ({used_names[key]}).{ext}"
            else:
                used_names[key] = 1
            completed.append((out_path, fname))
        if not completed:
            update_job(job_id, status="error", error=errors[0] if errors else "Aucun titre converti.", stage="Erreur")
            return
        if len(completed) == 1 and not params.get("force_zip"):
            p, fn = completed[0]
            update_job(job_id, status="done", progress=100.0, stage="Prêt", file_path=str(p), filename=fn, mime=fmt_meta["mime"], file_size=p.stat().st_size, download_url=f"/api/jobs/{job_id}/file")
            return
        update_job(job_id, status="converting", progress=97.0, stage=f"Archive ZIP ({len(completed)} fichiers)…")
        zip_path = work_dir / "playlist.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
            for p, fn in completed:
                zf.write(p, arcname=fn)
        zip_name = f"{sanitize_filename(params.get('playlist_title') or 'Playlist')} [{len(completed)} titres, {fmt_meta['label']}].zip"
        update_job(job_id, status="done", progress=100.0, stage=f"Prêt ({len(completed)}/{total})", file_path=str(zip_path), filename=zip_name, mime="application/zip", file_size=zip_path.stat().st_size, download_url=f"/api/jobs/{job_id}/file")
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), stage="Erreur")


def new_job_record(stage: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "job_id": job_id, "status": "queued", "progress": 0.0, "stage": stage, "error": None,
            "filename": None, "file_size": None, "download_url": None, "mime": None, "file_path": None,
            "work_dir": None, "cancelled": False, "proc": None, "created_at": time.time(), "updated_at": time.time(),
        }
    return job_id


@app.route("/api/jobs", methods=["POST"])
def api_create_job():
    cleanup_old_jobs()
    data = request.get_json(silent=True) or {}
    url = str(data.get("url") or "").strip()
    mode = str(data.get("mode") or "audio").lower()
    fmt_id = str(data.get("format") or ("mp3" if mode == "audio" else "mp4")).lower()
    if not is_valid_youtube_url(url) or mode not in ("audio", "video"):
        return jsonify({"error": "Paramètres invalides."}), 400
    if (mode == "audio" and fmt_id not in AUDIO_FORMAT_MAP) or (mode == "video" and fmt_id not in VIDEO_FORMAT_MAP):
        return jsonify({"error": f"Format non pris en charge : {fmt_id}"}), 400

    ts = float(data["trim_start"]) if data.get("trim_start") is not None else None
    te = float(data["trim_end"]) if data.get("trim_end") is not None else None
    if ts is not None and te is not None and (ts < 0 or te <= ts):
        return jsonify({"error": "Bornes de découpe invalides."}), 400
    if fmt_id == "gif" and ((te - ts) if (ts is not None and te is not None) else float(data.get("duration") or 0)) > 30:
        return jsonify({"error": "Pour un GIF animé, limitez l'extrait à 30 secondes maximum."}), 400

    job_id = new_job_record("En file…")
    params = {
        "url": url, "mode": mode, "format": fmt_id, "quality": str(data.get("quality") or ("320" if mode == "audio" else "1080")),
        "trim_start": ts, "trim_end": te, "duration": data.get("duration") or 0,
        "title": data.get("title") or "media", "artist": data.get("artist") or "", "album": data.get("album") or "",
        "custom_filename": data.get("custom_filename") or "",
        "fade_in": float(data.get("fade_in") or 0.0), "fade_out": float(data.get("fade_out") or 0.0),
        "audio_norm_mode": str(data.get("audio_norm_mode") or "off"),
        "target_lufs": float(data.get("target_lufs") if data.get("target_lufs") is not None else -14.0),
        "gain_db": float(data.get("gain_db") or 0.0), "mute_video": bool(data.get("mute_video")),
        "cover_data_url": data.get("cover_data_url"), "cover_url": data.get("cover_url"),
    }
    threading.Thread(target=execute_job, args=(job_id, params), daemon=True).start()
    return jsonify({"job_id": job_id, "status": "queued"})


@app.route("/api/batch-jobs", methods=["POST"])
def api_create_batch_job():
    cleanup_old_jobs()
    data = request.get_json(silent=True) or {}
    items = [it for it in (data.get("items") or []) if isinstance(it, dict) and is_valid_youtube_url(str(it.get("url") or ""))]
    mode = str(data.get("mode") or "audio").lower()
    fmt_id = str(data.get("format") or ("mp3" if mode == "audio" else "mp4")).lower()
    if not items or len(items) > 100 or fmt_id == "gif":
        return jsonify({"error": "Sélection de playlist invalide."}), 400
    job_id = new_job_record(f"En file ({len(items)} titres)…")
    params = {
        "items": items, "playlist_title": data.get("playlist_title") or "Playlist YouTube",
        "mode": mode, "format": fmt_id, "quality": str(data.get("quality") or ("320" if mode == "audio" else "1080")),
        "fade_in": float(data.get("fade_in") or 0.0), "fade_out": float(data.get("fade_out") or 0.0),
        "audio_norm_mode": str(data.get("audio_norm_mode") or "off"),
        "target_lufs": float(data.get("target_lufs") if data.get("target_lufs") is not None else -14.0),
        "gain_db": float(data.get("gain_db") or 0.0), "mute_video": bool(data.get("mute_video")),
        "embed_thumb_cover": bool(data.get("embed_thumb_cover")), "force_zip": bool(data.get("force_zip", True)),
    }
    threading.Thread(target=execute_batch_job, args=(job_id, params), daemon=True).start()
    return jsonify({"job_id": job_id, "status": "queued"})


def serialize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {k: job[k] for k in ("job_id", "status", "progress", "stage", "error", "filename", "file_size", "download_url")}


@app.route("/api/jobs/<job_id>", methods=["GET"])
def api_get_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return (jsonify(serialize_job(job)), 200) if job else (jsonify({"error": "Tâche introuvable."}), 404)


@app.route("/api/jobs/<job_id>/events", methods=["GET"])
def api_job_events(job_id: str):
    def generate():
        last = None
        while True:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    yield f"data: {json.dumps({'status': 'error', 'error': 'Tâche introuvable.'})}\n\n"
                    return
                payload = serialize_job(job)
            enc = json.dumps(payload, ensure_ascii=False)
            if enc != last:
                yield f"data: {enc}\n\n"
                last = enc
            if payload["status"] in ("done", "error", "cancelled"):
                return
            time.sleep(0.25)
    return Response(stream_with_context(generate()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/jobs/<job_id>", methods=["DELETE"])
def api_cancel_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Tâche introuvable."}), 404
        job["cancelled"] = True
        proc = job.get("proc")
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    return jsonify({"ok": True})


@app.route("/api/jobs/<job_id>/file", methods=["GET"])
def api_download_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job["status"] != "done" or not job.get("file_path"):
            return jsonify({"error": "Fichier indisponible."}), 404
        file_path = Path(job["file_path"])
        filename = job["filename"] or file_path.name
        mime = job.get("mime") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if not file_path.exists():
        return jsonify({"error": "Fichier expiré."}), 410
    ascii_fb = re.sub(r"[^\x20-\x7E]", "_", filename)
    resp = send_file(file_path, mimetype=mime, as_attachment=True, download_name=ascii_fb)
    resp.headers["Content-Disposition"] = f"attachment; filename=\"{ascii_fb}\"; filename*=UTF-8''{quote(filename)}"
    return resp


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "7860"))
    app.run(host=host, port=port, debug=False, threaded=True)
