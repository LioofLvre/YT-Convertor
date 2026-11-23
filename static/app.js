/* ==========================================================================
   BANDE — Interactive Studio Deck Controller
   Real waveform, fades, custom LUFS/gain, Deezer-style covers & playlists
   ========================================================================== */

(function () {
  "use strict";

  const RECENT_KEY = "bande_recent_videos_v1";
  const THEME_KEY = "bande_theme_v1";

  const PLAYLIST_VIDEO_QUALITIES = [
    { height: 2160, label: "4K UHD (max)" },
    { height: 1440, label: "2K QHD (max)" },
    { height: 1080, label: "Full HD (max)" },
    { height: 720, label: "HD (max)" },
    { height: 480, label: "SD (max)" },
    { height: 360, label: "Bas (max)" },
  ];

  // Application State -------------------------------------------------------
  const state = {
    catalog: null,
    viewKind: "empty",        // "empty" | "video" | "playlist"
    video: null,
    playlist: null,
    playlistSelectedIds: new Set(),
    playlistFilter: "",
    mode: "audio",            // "audio" | "video"
    audioFormat: "mp3",
    videoFormat: "mp4",
    audioBitrate: "320",
    audioSampleRate: "48000",
    videoHeight: 1080,
    moreFormatsOpen: false,

    // Trim & Waveform
    trimStart: 0,
    trimEnd: 0,
    playhead: 0,
    isPlaying: false,
    waveBars: [],
    waveIsReal: false,

    // DSP (C & E)
    fadeIn: 0,
    fadeOut: 0,
    normMode: "off",          // "off" | "lufs" | "gain"
    targetLufs: -14,
    gainDb: 0,
    muteVideo: false,

    // Metadata & Cover Studio (D)
    coverMode: "none",        // "none" | "thumb" | "custom" | "upload"
    coverStyle: "deezer",     // "deezer" | "vinyl" | "duotone" | "typo"
    coverColor: "#D9481E",
    coverTagline: "",
    thumbImg: null,           // Loaded CORS-safe Image via /api/thumbnail
    uploadImg: null,          // User-uploaded Image

    // YouTube IFrame Player
    ytApiReady: false,
    ytPlayer: null,
    ytPlayerLoadedId: null,
    ytPlayerReady: false,
    ytPollTimer: null,

    // Jobs, Queue & Exports
    activeJobId: null,
    activeEventSource: null,
    queue: [],
    queueRunning: false,
    exports: [],
  };

  // DOM References ----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    statusLed: $("statusLed"),
    statusText: $("statusText"),
    themeToggle: $("themeToggle"),
    themeLabel: $("themeLabel"),
    probeForm: $("probeForm"),
    urlInput: $("urlInput"),
    clearUrlBtn: $("clearUrlBtn"),
    pasteBtn: $("pasteBtn"),
    probeBtn: $("probeBtn"),
    probeError: $("probeError"),
    emptyState: $("emptyState"),
    recentSection: $("recentSection"),
    recentList: $("recentList"),
    clearRecentBtn: $("clearRecentBtn"),
    loadingState: $("loadingState"),
    loadingMessage: $("loadingMessage"),
    workspace: $("workspace"),
    contextBanner: $("contextBanner"),
    contextBannerText: $("contextBannerText"),
    contextBannerBtn: $("contextBannerBtn"),
    videoTitle: $("videoTitle"),
    videoChannel: $("videoChannel"),
    videoDuration: $("videoDuration"),
    videoViewsWrap: $("videoViewsWrap"),
    videoViews: $("videoViews"),
    openOriginalLink: $("openOriginalLink"),
    videoStage: $("videoStage"),
    playlistStage: $("playlistStage"),
    playlistSelCount: $("playlistSelCount"),
    plSelectAllBtn: $("plSelectAllBtn"),
    plSelectNoneBtn: $("plSelectNoneBtn"),
    plFilterInput: $("plFilterInput"),
    playlistTrackList: $("playlistTrackList"),
    monitorFrame: $("monitorFrame"),
    videoThumb: $("videoThumb"),
    ytPlayerMount: $("ytPlayerMount"),
    monitorPlayOverlay: $("monitorPlayOverlay"),
    embedFallbackNotice: $("embedFallbackNotice"),
    trimStateTag: $("trimStateTag"),
    waveStatusTag: $("waveStatusTag"),
    loopSegmentCheck: $("loopSegmentCheck"),
    resetTrimBtn: $("resetTrimBtn"),
    trimRuler: $("trimRuler"),
    waveCanvas: $("waveCanvas"),
    chapterTicks: $("chapterTicks"),
    maskLeft: $("maskLeft"),
    maskRight: $("maskRight"),
    trimSelection: $("trimSelection"),
    playhead: $("playhead"),
    handleStart: $("handleStart"),
    handleEnd: $("handleEnd"),
    tipStart: $("tipStart"),
    tipEnd: $("tipEnd"),
    rulerScale: $("rulerScale"),
    playSegmentBtn: $("playSegmentBtn"),
    playSegmentIcon: $("playSegmentIcon"),
    playSegmentLabel: $("playSegmentLabel"),
    markInBtn: $("markInBtn"),
    markOutBtn: $("markOutBtn"),
    inputStart: $("inputStart"),
    inputEnd: $("inputEnd"),
    selectedDuration: $("selectedDuration"),
    chaptersBox: $("chaptersBox"),
    chaptersList: $("chaptersList"),
    modeButtons: document.querySelectorAll(".mode-btn"),
    formatActiveNote: $("formatActiveNote"),
    primaryFormats: $("primaryFormats"),
    toggleMoreFormats: $("toggleMoreFormats"),
    moreFormatsLabel: $("moreFormatsLabel"),
    moreFormatsSelectedBadge: $("moreFormatsSelectedBadge"),
    extendedFormats: $("extendedFormats"),
    qualityHeading: $("qualityHeading"),
    qualityEstimate: $("qualityEstimate"),
    qualityOptions: $("qualityOptions"),

    // DSP Accordion
    toggleDspPanel: $("toggleDspPanel"),
    dspPanelBody: $("dspPanelBody"),
    dspActiveBadge: $("dspActiveBadge"),
    muteVideoRow: $("muteVideoRow"),
    muteVideoCheck: $("muteVideoCheck"),
    audioDspControls: $("audioDspControls"),
    fadeInInput: $("fadeInInput"),
    fadeOutInput: $("fadeOutInput"),
    normValueReadout: $("normValueReadout"),
    lufsControlBox: $("lufsControlBox"),
    lufsSlider: $("lufsSlider"),
    gainControlBox: $("gainControlBox"),
    gainSlider: $("gainSlider"),

    // Metadata & Cover Accordion
    toggleMetaPanel: $("toggleMetaPanel"),
    metaPanelBody: $("metaPanelBody"),
    metaActiveBadge: $("metaActiveBadge"),
    singleMetaFields: $("singleMetaFields"),
    metaFilename: $("metaFilename"),
    metaTitle: $("metaTitle"),
    metaArtist: $("metaArtist"),
    metaAlbum: $("metaAlbum"),
    playlistCoverRow: $("playlistCoverRow"),
    playlistThumbCoverCheck: $("playlistThumbCoverCheck"),
    coverStudioBox: $("coverStudioBox"),
    coverCompatHint: $("coverCompatHint"),
    coverFileInput: $("coverFileInput"),
    coverEditorBox: $("coverEditorBox"),
    coverPreviewCanvas: $("coverPreviewCanvas"),
    customCoverControls: $("customCoverControls"),
    uploadCoverControls: $("uploadCoverControls"),
    pickCoverFileBtn: $("pickCoverFileBtn"),
    thumbCoverHint: $("thumbCoverHint"),
    coverTagline: $("coverTagline"),

    // Export & Progress
    exportSummary: $("exportSummary"),
    playlistZipRow: $("playlistZipRow"),
    playlistZipCheck: $("playlistZipCheck"),
    downloadBtn: $("downloadBtn"),
    downloadBtnText: $("downloadBtnText"),
    queueClipBtn: $("queueClipBtn"),
    jobProgressBox: $("jobProgressBox"),
    jobStage: $("jobStage"),
    jobPct: $("jobPct"),
    jobBar: $("jobBar"),
    jobDetail: $("jobDetail"),
    cancelJobBtn: $("cancelJobBtn"),
    jobError: $("jobError"),
    clipsSection: $("clipsSection"),
    queuePanel: $("queuePanel"),
    queueCount: $("queueCount"),
    queueList: $("queueList"),
    clearQueueBtn: $("clearQueueBtn"),
    runQueueBtn: $("runQueueBtn"),
    exportsPanel: $("exportsPanel"),
    exportsCount: $("exportsCount"),
    exportsList: $("exportsList"),
  };

  window.onYouTubeIframeAPIReady = function () {
    state.ytApiReady = true;
  };
  if (window.YT && window.YT.Player) {
    state.ytApiReady = true;
  }

  // Utilities ---------------------------------------------------------------
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function parseTime(str) {
    const cleaned = String(str || "").trim();
    if (!cleaned) return null;
    if (/^\d+(\.\d+)?$/.test(cleaned)) {
      return parseFloat(cleaned);
    }
    const parts = cleaned.split(":").map((p) => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
    if (nums.length === 2) return nums[0] * 60 + nums[1];
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace(".", ",")} Go`;
  }

  function formatViews(count) {
    if (!count || count <= 0) return "";
    return `${new Intl.NumberFormat("fr-FR").format(count)} vues`;
  }

  function setStatus(kind, text) {
    el.statusLed.className = `status-led${kind ? " " + kind : ""}`;
    el.statusText.textContent = text;
  }

  function isTrimmed() {
    if (state.viewKind !== "video" || !state.video || !state.video.duration) return false;
    return state.trimStart > 0.4 || state.trimEnd < state.video.duration - 0.4;
  }

  function getSelectedDuration() {
    if (!state.video) return 0;
    return Math.max(1, state.trimEnd - state.trimStart);
  }

  function getActiveFormatObj() {
    if (!state.catalog) return null;
    const list = state.mode === "audio" ? state.catalog.audio : state.catalog.video;
    const targetId = state.mode === "audio" ? state.audioFormat : state.videoFormat;
    return list.find((f) => f.id === targetId) || list[0];
  }

  function getActiveQualityValue() {
    if (state.mode === "audio") {
      const fmt = getActiveFormatObj();
      return fmt && fmt.lossless ? state.audioSampleRate : state.audioBitrate;
    }
    return String(state.videoHeight);
  }

  function getActiveQualityDisplay() {
    if (state.mode === "audio") {
      const fmt = getActiveFormatObj();
      if (fmt && fmt.lossless) {
        return state.audioSampleRate === "44100" ? "44,1 kHz" : "48 kHz";
      }
      return `${state.audioBitrate} kbps`;
    }
    const list = state.viewKind === "playlist" ? PLAYLIST_VIDEO_QUALITIES : (state.video?.video_qualities || []);
    const q = list.find((x) => x.height === state.videoHeight);
    return q ? `${q.height}p (${q.label})` : `${state.videoHeight}p`;
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    const n = parseInt(clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Real Audio Waveform Fetching & Rendering (B) ----------------------------
  async function loadRealWaveform(videoId) {
    if (!videoId) return;
    state.waveIsReal = false;
    state.waveBars = new Array(140).fill(0.14);
    el.waveStatusTag.textContent = "Forme d'onde…";
    el.waveStatusTag.classList.remove("hidden");
    drawWaveform();

    try {
      const resp = await fetch(`/api/waveform/${encodeURIComponent(videoId)}`);
      if (!resp.ok) throw new Error("waveform unavailable");
      const data = await resp.json();
      if (state.video && state.video.id === videoId && Array.isArray(data.peaks) && data.peaks.length) {
        state.waveBars = data.peaks;
        state.waveIsReal = true;
        el.waveStatusTag.textContent = "Onde audio réelle";
        drawWaveform();
      }
    } catch (_) {
      if (state.video && state.video.id === videoId) {
        el.waveStatusTag.classList.add("hidden");
      }
    }
  }

  function drawWaveform() {
    const canvas = el.waveCanvas;
    const rect = el.trimRuler.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const styles = getComputedStyle(document.documentElement);
    const inactiveCol = styles.getPropertyValue("--wave-inactive").trim();
    const activeCol = styles.getPropertyValue("--wave-active").trim();
    const accentCol = styles.getPropertyValue("--accent").trim();

    const duration = state.video?.duration || 1;
    const startRatio = state.trimStart / duration;
    const endRatio = state.trimEnd / duration;

    const bars = state.waveBars;
    if (!bars.length) return;
    const step = rect.width / bars.length;
    const barW = Math.max(1.2, step - 1.2);
    const midY = rect.height / 2;
    const maxH = rect.height * 0.74;

    for (let i = 0; i < bars.length; i++) {
      const ratio = (i + 0.5) / bars.length;
      const inside = ratio >= startRatio && ratio <= endRatio;
      const h = Math.max(3, bars[i] * maxH);
      ctx.fillStyle = inside ? activeCol : inactiveCol;
      ctx.fillRect(i * step, midY - h / 2, barW, h);
    }

    // Draw subtle visual fade-in / fade-out envelope ramps inside selection
    const activeMute = state.mode === "video" && state.muteVideo;
    if (!activeMute && (state.fadeIn > 0 || state.fadeOut > 0)) {
      const selX1 = startRatio * rect.width;
      const selX2 = endRatio * rect.width;
      const selW = selX2 - selX1;
      const selDur = Math.max(0.1, state.trimEnd - state.trimStart);

      ctx.save();
      ctx.strokeStyle = accentCol;
      ctx.lineWidth = 1.5;

      if (state.fadeIn > 0) {
        const fiW = Math.min(selW * 0.5, (state.fadeIn / selDur) * selW);
        ctx.fillStyle = "rgba(217, 72, 30, 0.12)";
        ctx.beginPath();
        ctx.moveTo(selX1, rect.height);
        ctx.lineTo(selX1, 0);
        ctx.lineTo(selX1 + fiW, 0);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(selX1, rect.height);
        ctx.lineTo(selX1 + fiW, 2);
        ctx.stroke();
      }

      if (state.fadeOut > 0) {
        const foW = Math.min(selW * 0.5, (state.fadeOut / selDur) * selW);
        ctx.fillStyle = "rgba(217, 72, 30, 0.12)";
        ctx.beginPath();
        ctx.moveTo(selX2, rect.height);
        ctx.lineTo(selX2, 0);
        ctx.lineTo(selX2 - foW, 0);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(selX2 - foW, 2);
        ctx.lineTo(selX2, rect.height);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Cover Art Studio Canvas Generator (D — Deezer / Studio / Duotone / Typo) -
  function loadProxiedThumbnail(url) {
    state.thumbImg = null;
    if (!url) {
      renderCoverCanvas();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      state.thumbImg = img;
      renderCoverCanvas();
    };
    img.onerror = () => {
      state.thumbImg = null;
      renderCoverCanvas();
    };
    img.src = `/api/thumbnail?url=${encodeURIComponent(url)}`;
  }

  function drawCoverCroppedImage(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function wrapCanvasLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = words[0];

    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
        if (lines.length === maxLines - 1) {
          // Put remaining words on last line and ellipsize if needed
          const rest = [current].concat(words.slice(i + 1)).join(" ");
          let trimmed = rest;
          while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
            trimmed = trimmed.slice(0, -1);
          }
          lines.push(trimmed === rest ? rest : `${trimmed.trim()}…`);
          return lines;
        }
      }
    }
    lines.push(current);
    return lines.slice(0, maxLines);
  }

  function renderCoverCanvas() {
    const canvas = el.coverPreviewCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const S = canvas.width; // 600x600 crisp cover canvas
    ctx.clearRect(0, 0, S, S);

    const title = (el.metaTitle.value || state.video?.title || "Sans titre").trim();
    const artist = (el.metaArtist.value || state.video?.channel || "").trim();
    const tagline = (el.coverTagline.value || el.metaAlbum.value || "BANDE").trim().toUpperCase();
    const color = state.coverColor || "#D9481E";

    if (state.coverMode === "thumb") {
      if (state.thumbImg) {
        drawCoverCroppedImage(ctx, state.thumbImg, 0, 0, S, S);
      } else {
        ctx.fillStyle = "#222220";
        ctx.fillRect(0, 0, S, S);
      }
      return;
    }

    if (state.coverMode === "upload") {
      if (state.uploadImg) {
        drawCoverCroppedImage(ctx, state.uploadImg, 0, 0, S, S);
      } else {
        ctx.fillStyle = "#eceae2";
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = "#6e6b63";
        ctx.font = '500 22px "IBM Plex Sans", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText("Aucune image choisie", S / 2, S / 2);
        ctx.textAlign = "left";
      }
      return;
    }

    if (state.coverMode !== "custom") return;

    // 1. DEEZER EDITORIAL STYLE
    if (state.coverStyle === "deezer") {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, S, S);

      // Bold Deezer-inspired geometric curves & acoustic blocks
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.11)";
      ctx.beginPath();
      ctx.arc(S * 0.88, S * 0.18, S * 0.44, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
      ctx.beginPath();
      ctx.arc(S * 0.1, S * 0.98, S * 0.56, 0, Math.PI * 2);
      ctx.fill();

      // Clean geometric equalizer pillar motif (top-left editorial mark)
      const bars = [14, 24, 18, 32, 20];
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      bars.forEach((bh, i) => {
        ctx.fillRect(42 + i * 11, 74 - bh, 7, bh);
      });
      ctx.restore();

      // Tagline top-left next to bars
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.font = '600 18px "IBM Plex Mono", monospace';
      ctx.fillText(tagline.slice(0, 18), 112, 69);

      // Circular or sharp framed thumbnail inset top-right
      if (state.thumbImg) {
        const thumbSize = 216;
        const tx = S - thumbSize - 42;
        const ty = 42;
        ctx.save();
        ctx.beginPath();
        ctx.arc(tx + thumbSize / 2, ty + thumbSize / 2, thumbSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        drawCoverCroppedImage(ctx, state.thumbImg, tx, ty, thumbSize, thumbSize);
        ctx.restore();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(tx + thumbSize / 2, ty + thumbSize / 2, thumbSize / 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bold display title bottom-left
      ctx.fillStyle = "#FFFFFF";
      ctx.font = '700 48px "IBM Plex Sans", sans-serif';
      const lines = wrapCanvasLines(ctx, title, S - 84, 3);
      const lineH = 56;
      const startY = S - 92 - (lines.length - 1) * lineH;
      lines.forEach((line, idx) => {
        ctx.fillText(line, 42, startY + idx * lineH);
      });

      // Artist line
      if (artist) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
        ctx.font = '500 22px "IBM Plex Sans", sans-serif';
        ctx.fillText(artist.slice(0, 42), 42, S - 42);
      }
      return;
    }

    // 2. STUDIO / SWISS VINYL SLEEVE
    if (state.coverStyle === "vinyl") {
      const darkSleeve = color === "#161614";
      ctx.fillStyle = darkSleeve ? "#161614" : "#F5F3EC";
      ctx.fillRect(0, 0, S, S);

      const inkCol = darkSleeve ? "#F2F0EA" : "#161614";
      const mutedCol = darkSleeve ? "#9B988E" : "#6D6A61";
      const accentBar = darkSleeve ? "#D9481E" : color;

      // Top accent rule & title
      ctx.fillStyle = accentBar;
      ctx.fillRect(36, 36, 18, 18);

      ctx.fillStyle = mutedCol;
      ctx.font = '600 16px "IBM Plex Mono", monospace';
      ctx.fillText(tagline.slice(0, 22), 68, 51);

      ctx.fillStyle = inkCol;
      ctx.font = '600 28px "IBM Plex Sans", sans-serif';
      const titleLines = wrapCanvasLines(ctx, title, S - 72, 2);
      titleLines.forEach((line, i) => {
        ctx.fillText(line, 36, 94 + i * 33);
      });

      // Centered square artwork window
      const boxY = 152;
      const boxSize = 360;
      const boxX = (S - boxSize) / 2;
      if (state.thumbImg) {
        drawCoverCroppedImage(ctx, state.thumbImg, boxX, boxY, boxSize, boxSize);
      } else {
        ctx.fillStyle = accentBar;
        ctx.fillRect(boxX, boxY, boxSize, boxSize);
      }
      ctx.strokeStyle = darkSleeve ? "rgba(255,255,255,0.22)" : "#D2CFC4";
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxSize, boxSize);

      // Bottom hairline & artist
      ctx.fillStyle = darkSleeve ? "#32312C" : "#D6D3C8";
      ctx.fillRect(36, S - 64, S - 72, 1.5);

      ctx.fillStyle = inkCol;
      ctx.font = '500 18px "IBM Plex Mono", monospace';
      ctx.fillText((artist || "YOUTUBE").slice(0, 32), 36, S - 32);

      ctx.fillStyle = accentBar;
      ctx.textAlign = "right";
      ctx.fillText(formatTime(getSelectedDuration()), S - 36, S - 32);
      ctx.textAlign = "left";
      return;
    }

    // 3. DUOTONE PRESSE
    if (state.coverStyle === "duotone") {
      if (state.thumbImg) {
        drawCoverCroppedImage(ctx, state.thumbImg, 0, 0, S, S);
        const imgData = ctx.getImageData(0, 0, S, S);
        const d = imgData.data;
        const [cr, cg, cb] = hexToRgb(color);
        // Deep ink shadow -> user swatch midtone -> warm light highlight
        const sr = Math.round(cr * 0.18);
        const sg = Math.round(cg * 0.18);
        const sb = Math.round(cb * 0.18);
        const hr = Math.min(255, Math.round(cr * 0.65 + 110));
        const hg = Math.min(255, Math.round(cg * 0.65 + 106));
        const hb = Math.min(255, Math.round(cb * 0.65 + 98));

        for (let i = 0; i < d.length; i += 4) {
          const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
          // Boost contrast cleanly
          const t = clamp((lum - 0.12) / 0.78, 0, 1);
          d[i] = Math.round(sr + (hr - sr) * t);
          d[i + 1] = Math.round(sg + (hg - sg) * t);
          d[i + 2] = Math.round(sb + (hb - sb) * t);
        }
        ctx.putImageData(imgData, 0, 0);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, S, S);
      }

      // Solid bottom editorial band
      const bandH = 176;
      ctx.fillStyle = "#141412";
      ctx.fillRect(0, S - bandH, S, bandH);
      ctx.fillStyle = color;
      ctx.fillRect(0, S - bandH, S, 6);

      ctx.fillStyle = "#F5F3EC";
      ctx.font = '700 36px "IBM Plex Sans", sans-serif';
      const lines = wrapCanvasLines(ctx, title, S - 64, 2);
      lines.forEach((line, i) => {
        ctx.fillText(line, 32, S - bandH + 58 + i * 42);
      });

      ctx.fillStyle = "#A8A59B";
      ctx.font = '500 19px "IBM Plex Mono", monospace';
      ctx.fillText((artist || tagline).slice(0, 38), 32, S - 28);
      return;
    }

    // 4. AFFICHE TYPOGRAPHIQUE (Pure Type)
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, S);

    // Top rule + tagline + Bande geometric slice
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.fillText(tagline.slice(0, 22), 40, 62);

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(S - 78, 42, 10, 26);
    ctx.fillRect(S - 62, 42, 8, 26);
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(S - 48, 42, 10, 26);

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(40, 88, S - 80, 2);

    // Massive stacked title
    ctx.fillStyle = "#FFFFFF";
    ctx.font = '700 62px "IBM Plex Sans", sans-serif';
    const bigLines = wrapCanvasLines(ctx, title, S - 80, 4);
    bigLines.forEach((line, i) => {
      ctx.fillText(line, 40, 184 + i * 72);
    });

    // Bottom artist + rule
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.fillRect(40, S - 84, S - 80, 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = '500 22px "IBM Plex Mono", monospace';
    ctx.fillText((artist || "BANDE AUDIO").slice(0, 34), 40, S - 42);
  }

  function getActiveCoverDataUrl() {
    if (state.mode !== "audio" || state.coverMode === "none") return null;
    if (state.coverMode === "upload" && !state.uploadImg) return null;
    const fmt = getActiveFormatObj();
    if (!fmt || !fmt.cover_ok) return null;
    renderCoverCanvas();
    try {
      return el.coverPreviewCanvas.toDataURL("image/png");
    } catch (_) {
      return null;
    }
  }

  // Theme & Recents ---------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeLabel.textContent = theme === "dark" ? "Clair" : "Sombre";
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
    if (state.viewKind === "video" && state.video) {
      requestAnimationFrame(drawWaveform);
    }
  }

  function initTheme() {
    let saved = "light";
    try {
      saved = localStorage.getItem(THEME_KEY) || "light";
    } catch (_) {}
    applyTheme(saved === "dark" ? "dark" : "light");
  }

  function loadRecents() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function saveRecent(item) {
    const list = loadRecents().filter((v) => v.url !== item.url);
    list.unshift({
      kind: item.kind || "video",
      id: item.id,
      url: item.url,
      title: item.title,
      meta: item.kind === "playlist" ? `${item.count} titres` : formatTime(item.duration),
    });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
    } catch (_) {}
    renderRecents();
  }

  function renderRecents() {
    const list = loadRecents();
    if (!list.length) {
      el.recentSection.classList.add("hidden");
      return;
    }
    el.recentSection.classList.remove("hidden");
    el.recentList.innerHTML = "";
    list.forEach((item) => {
      const li = document.createElement("li");
      li.className = "recent-item";
      li.innerHTML = `
        <span class="recent-item-title"></span>
        <span class="recent-item-meta"></span>
      `;
      li.querySelector(".recent-item-title").textContent = item.title;
      li.querySelector(".recent-item-meta").textContent = item.meta || formatTime(item.duration);
      li.addEventListener("click", () => {
        el.urlInput.value = item.url;
        updateClearUrlBtn();
        probeUrl(item.url);
      });
      el.recentList.appendChild(li);
    });
  }

  // YouTube Player Preview Sync ---------------------------------------------
  function destroyYtPlayer() {
    if (state.ytPollTimer) {
      clearInterval(state.ytPollTimer);
      state.ytPollTimer = null;
    }
    if (state.ytPlayer && typeof state.ytPlayer.destroy === "function") {
      try {
        state.ytPlayer.destroy();
      } catch (_) {}
    }
    state.ytPlayer = null;
    state.ytPlayerLoadedId = null;
    state.ytPlayerReady = false;
    state.isPlaying = false;
    el.ytPlayerMount.innerHTML = "";
    el.ytPlayerMount.classList.add("hidden");
    el.monitorPlayOverlay.classList.remove("hidden");
    el.embedFallbackNotice.classList.add("hidden");
    updatePlayButtonUI();
  }

  function ensureYtPlayer(autoplaySegment = false) {
    if (!state.video) return;
    if (state.ytPlayer && state.ytPlayerLoadedId === state.video.id && state.ytPlayerReady) {
      if (autoplaySegment) startSegmentPlayback();
      return;
    }
    if (!window.YT || !window.YT.Player) {
      setTimeout(() => ensureYtPlayer(autoplaySegment), 300);
      return;
    }

    el.monitorPlayOverlay.classList.add("hidden");
    el.ytPlayerMount.classList.remove("hidden");
    el.ytPlayerMount.innerHTML = '<div id="ytPlayerIframe"></div>';

    state.ytPlayerLoadedId = state.video.id;
    state.ytPlayerReady = false;

    state.ytPlayer = new window.YT.Player("ytPlayerIframe", {
      videoId: state.video.id,
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        start: Math.floor(state.trimStart),
      },
      events: {
        onReady: () => {
          state.ytPlayerReady = true;
          startYtPolling();
          if (autoplaySegment) startSegmentPlayback();
        },
        onStateChange: (ev) => {
          state.isPlaying = ev.data === window.YT.PlayerState.PLAYING;
          updatePlayButtonUI();
        },
        onError: () => {
          el.ytPlayerMount.classList.add("hidden");
          el.embedFallbackNotice.classList.remove("hidden");
          state.ytPlayerReady = false;
          state.isPlaying = false;
          updatePlayButtonUI();
        },
      },
    });
  }

  function startYtPolling() {
    if (state.ytPollTimer) clearInterval(state.ytPollTimer);
    state.ytPollTimer = setInterval(() => {
      if (!state.ytPlayer || !state.ytPlayerReady || typeof state.ytPlayer.getCurrentTime !== "function") return;
      const cur = state.ytPlayer.getCurrentTime();
      if (!Number.isFinite(cur)) return;
      state.playhead = clamp(cur, 0, state.video?.duration || cur);
      updatePlayheadPosition();

      if (state.isPlaying && state.playhead >= state.trimEnd - 0.12) {
        if (el.loopSegmentCheck.checked) {
          state.ytPlayer.seekTo(state.trimStart, true);
        } else {
          state.ytPlayer.pauseVideo();
          state.isPlaying = false;
          updatePlayButtonUI();
        }
      }
    }, 100);
  }

  function startSegmentPlayback() {
    if (!state.ytPlayer || !state.ytPlayerReady) {
      ensureYtPlayer(true);
      return;
    }
    if (state.isPlaying) {
      state.ytPlayer.pauseVideo();
      return;
    }
    if (state.playhead < state.trimStart || state.playhead >= state.trimEnd - 0.3) {
      state.ytPlayer.seekTo(state.trimStart, true);
      state.playhead = state.trimStart;
      updatePlayheadPosition();
    }
    state.ytPlayer.playVideo();
  }

  function seekPlayer(seconds) {
    state.playhead = clamp(seconds, 0, state.video?.duration || 0);
    updatePlayheadPosition();
    if (state.ytPlayer && state.ytPlayerReady && typeof state.ytPlayer.seekTo === "function") {
      state.ytPlayer.seekTo(state.playhead, true);
    }
  }

  function updatePlayButtonUI() {
    if (state.isPlaying) {
      el.playSegmentBtn.classList.add("playing");
      el.playSegmentLabel.textContent = "Pause";
      el.playSegmentIcon.innerHTML = '<rect x="2.5" y="2" width="2.5" height="8" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" fill="currentColor"/>';
    } else {
      el.playSegmentBtn.classList.remove("playing");
      el.playSegmentLabel.textContent = isTrimmed() ? "Lire l'extrait" : "Lire";
      el.playSegmentIcon.innerHTML = '<path d="M2.5 1.8L10 6L2.5 10.2V1.8Z" fill="currentColor"/>';
    }
  }

  // Trim Ruler UI & Pointer Mechanics ---------------------------------------
  function setTrimRange(start, end, options = {}) {
    if (!state.video) return;
    const dur = Math.max(1, state.video.duration);
    const minSpan = Math.min(1, dur);

    const s = clamp(start, 0, dur - minSpan);
    const e = clamp(end, s + minSpan, dur);

    state.trimStart = Math.round(s * 10) / 10;
    state.trimEnd = Math.round(e * 10) / 10;

    if (options.seekToStart) {
      seekPlayer(state.trimStart);
    } else if (state.playhead < state.trimStart || state.playhead > state.trimEnd) {
      state.playhead = state.trimStart;
    }

    renderTrimUI();
    renderQualities();
    renderExportSummary();
    if (state.coverMode === "custom" && state.coverStyle === "vinyl") {
      renderCoverCanvas();
    }
  }

  function updatePlayheadPosition() {
    if (!state.video || !state.video.duration) return;
    const pct = clamp((state.playhead / state.video.duration) * 100, 0, 100);
    el.playhead.style.left = `${pct}%`;
  }

  function renderTrimUI() {
    if (!state.video) return;
    const dur = Math.max(1, state.video.duration);
    const startPct = (state.trimStart / dur) * 100;
    const endPct = (state.trimEnd / dur) * 100;

    el.maskLeft.style.width = `${startPct}%`;
    el.maskRight.style.width = `${100 - endPct}%`;
    el.trimSelection.style.left = `${startPct}%`;
    el.trimSelection.style.width = `${endPct - startPct}%`;
    el.handleStart.style.left = `${startPct}%`;
    el.handleEnd.style.left = `${endPct}%`;

    el.tipStart.textContent = formatTime(state.trimStart);
    el.tipEnd.textContent = formatTime(state.trimEnd);

    if (document.activeElement !== el.inputStart) el.inputStart.value = formatTime(state.trimStart);
    if (document.activeElement !== el.inputEnd) el.inputEnd.value = formatTime(state.trimEnd);

    const selDur = getSelectedDuration();
    el.selectedDuration.textContent = formatTime(selDur);

    const trimmed = isTrimmed();
    el.trimStateTag.textContent = trimmed ? `Extrait · ${formatTime(selDur)}` : "Intégrale";
    el.trimStateTag.classList.toggle("active", trimmed);
    el.resetTrimBtn.disabled = !trimmed;

    updatePlayheadPosition();
    updatePlayButtonUI();
    drawWaveform();
    highlightActiveChapter();
  }

  function renderRulerScale() {
    if (!state.video) return;
    const dur = state.video.duration;
    const stops = 5;
    el.rulerScale.innerHTML = "";
    for (let i = 0; i <= stops; i++) {
      const span = document.createElement("span");
      span.textContent = formatTime((dur * i) / stops);
      el.rulerScale.appendChild(span);
    }
  }

  function renderChapters() {
    const chapters = state.video?.chapters || [];
    el.chapterTicks.innerHTML = "";
    el.chaptersList.innerHTML = "";

    if (!chapters.length) {
      el.chaptersBox.classList.add("hidden");
      return;
    }

    el.chaptersBox.classList.remove("hidden");
    const dur = Math.max(1, state.video.duration);

    chapters.forEach((ch, idx) => {
      if (ch.start > 0) {
        const tick = document.createElement("div");
        tick.className = "chapter-tick";
        tick.style.left = `${(ch.start / dur) * 100}%`;
        el.chapterTicks.appendChild(tick);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chapter-btn";
      btn.dataset.idx = String(idx);
      btn.innerHTML = `
        <span class="chapter-btn-time">${formatTime(ch.start)}</span>
        <span class="chapter-btn-name"></span>
      `;
      btn.querySelector(".chapter-btn-name").textContent = ch.title;
      btn.addEventListener("click", () => setTrimRange(ch.start, ch.end, { seekToStart: true }));
      el.chaptersList.appendChild(btn);
    });
  }

  function highlightActiveChapter() {
    const chapters = state.video?.chapters || [];
    if (!chapters.length) return;
    const buttons = el.chaptersList.querySelectorAll(".chapter-btn");
    buttons.forEach((btn, idx) => {
      const ch = chapters[idx];
      const match = Math.abs(state.trimStart - ch.start) < 0.8 && Math.abs(state.trimEnd - ch.end) < 0.8;
      btn.classList.toggle("active", match);
    });
  }

  function bindRulerInteractions() {
    function pointerToSec(clientX) {
      const rect = el.trimRuler.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return ratio * (state.video?.duration || 0);
    }

    function startDrag(kind, downEvent) {
      if (!state.video) return;
      downEvent.preventDefault();
      downEvent.stopPropagation();

      const startX = downEvent.clientX;
      const origStart = state.trimStart;
      const origEnd = state.trimEnd;
      const span = origEnd - origStart;
      const dur = state.video.duration;

      if (kind === "start") el.handleStart.classList.add("dragging");
      if (kind === "end") el.handleEnd.classList.add("dragging");

      function onMove(ev) {
        if (kind === "start") {
          const sec = pointerToSec(ev.clientX);
          setTrimRange(Math.min(sec, state.trimEnd - 1), state.trimEnd);
        } else if (kind === "end") {
          const sec = pointerToSec(ev.clientX);
          setTrimRange(state.trimStart, Math.max(sec, state.trimStart + 1));
        } else if (kind === "window") {
          const rect = el.trimRuler.getBoundingClientRect();
          const deltaSec = ((ev.clientX - startX) / rect.width) * dur;
          let ns = origStart + deltaSec;
          let ne = origEnd + deltaSec;
          if (ns < 0) {
            ns = 0;
            ne = span;
          }
          if (ne > dur) {
            ne = dur;
            ns = Math.max(0, dur - span);
          }
          setTrimRange(ns, ne);
        }
      }

      function onUp() {
        el.handleStart.classList.remove("dragging");
        el.handleEnd.classList.remove("dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (kind === "start" || kind === "window") seekPlayer(state.trimStart);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    el.handleStart.addEventListener("pointerdown", (e) => startDrag("start", e));
    el.handleEnd.addEventListener("pointerdown", (e) => startDrag("end", e));
    el.trimSelection.addEventListener("pointerdown", (e) => startDrag("window", e));

    el.trimRuler.addEventListener("pointerdown", (e) => {
      if (!state.video) return;
      if (e.target === el.handleStart || e.target === el.handleEnd || e.target === el.trimSelection) return;
      seekPlayer(pointerToSec(e.clientX));
    });

    [
      { node: el.handleStart, kind: "start" },
      { node: el.handleEnd, kind: "end" },
    ].forEach(({ node, kind }) => {
      node.addEventListener("keydown", (e) => {
        if (!state.video) return;
        const step = e.shiftKey ? 5 : 1;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (kind === "start") setTrimRange(state.trimStart - step, state.trimEnd, { seekToStart: true });
          else setTrimRange(state.trimStart, state.trimEnd - step);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (kind === "start") setTrimRange(state.trimStart + step, state.trimEnd, { seekToStart: true });
          else setTrimRange(state.trimStart, state.trimEnd + step);
        }
      });
    });

    el.inputStart.addEventListener("change", () => {
      const parsed = parseTime(el.inputStart.value);
      if (parsed === null) {
        el.inputStart.value = formatTime(state.trimStart);
        return;
      }
      setTrimRange(parsed, Math.max(state.trimEnd, parsed + 1), { seekToStart: true });
    });

    el.inputEnd.addEventListener("change", () => {
      const parsed = parseTime(el.inputEnd.value);
      if (parsed === null) {
        el.inputEnd.value = formatTime(state.trimEnd);
        return;
      }
      setTrimRange(Math.min(state.trimStart, Math.max(0, parsed - 1)), parsed);
    });

    document.querySelectorAll(".tc-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!state.video) return;
        const target = btn.dataset.target;
        const delta = Number(btn.dataset.delta);
        if (target === "start") setTrimRange(state.trimStart + delta, state.trimEnd, { seekToStart: true });
        else setTrimRange(state.trimStart, state.trimEnd + delta);
      });
    });

    window.addEventListener("resize", () => {
      if (state.viewKind === "video" && state.video) drawWaveform();
    });
  }

  // Playlist View Rendering (F) ---------------------------------------------
  function renderPlaylistTracks() {
    if (!state.playlist) return;
    const entries = state.playlist.entries || [];
    const q = state.playlistFilter.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            (e.title || "").toLowerCase().includes(q) ||
            (e.channel || "").toLowerCase().includes(q)
        )
      : entries;

    el.playlistSelCount.textContent = `${state.playlistSelectedIds.size} / ${entries.length}`;
    el.playlistTrackList.innerHTML = "";

    filtered.forEach((entry) => {
      const checked = state.playlistSelectedIds.has(entry.id);
      const li = document.createElement("li");
      li.className = "pl-track-row";
      li.innerHTML = `
        <input type="checkbox" ${checked ? "checked" : ""} aria-label="Sélectionner ${entry.title}">
        <span class="pl-idx mono">${String(entry.index).padStart(2, "0")}</span>
        <img class="pl-thumb" src="${entry.thumbnail}" alt="" loading="lazy">
        <div class="pl-info">
          <span class="pl-title"></span>
          <span class="pl-channel"></span>
        </div>
        <span class="pl-dur mono">${entry.duration ? formatTime(entry.duration) : "—"}</span>
        <button type="button" class="btn-subtle btn-cut-track">Découper</button>
      `;
      li.querySelector(".pl-title").textContent = entry.title;
      li.querySelector(".pl-channel").textContent = entry.channel || "";

      const cb = li.querySelector('input[type="checkbox"]');
      cb.addEventListener("change", () => {
        if (cb.checked) state.playlistSelectedIds.add(entry.id);
        else state.playlistSelectedIds.delete(entry.id);
        el.playlistSelCount.textContent = `${state.playlistSelectedIds.size} / ${entries.length}`;
        renderExportSummary();
      });

      li.querySelector(".btn-cut-track").addEventListener("click", () => {
        el.urlInput.value = entry.url;
        updateClearUrlBtn();
        probeUrl(entry.url, { keepPlaylistReturn: true });
      });

      el.playlistTrackList.appendChild(li);
    });

    renderExportSummary();
  }

  function showPlaylistView(playlistData) {
    destroyYtPlayer();
    state.playlist = playlistData;
    state.viewKind = "playlist";
    state.playlistFilter = "";
    el.plFilterInput.value = "";
    state.playlistSelectedIds = new Set((playlistData.entries || []).map((e) => e.id));

    el.videoTitle.textContent = playlistData.title;
    el.videoChannel.textContent = playlistData.channel || "Playlist YouTube";
    el.videoDuration.textContent = `${playlistData.count} vidéos`;
    el.videoViewsWrap.classList.add("hidden");
    el.openOriginalLink.href = playlistData.url;

    el.contextBanner.classList.add("hidden");
    el.videoStage.classList.add("hidden");
    el.playlistStage.classList.remove("hidden");
    el.queueClipBtn.classList.add("hidden");
    el.playlistZipRow.classList.remove("hidden");

    // Toggle metadata panel between single-video & playlist mode
    el.singleMetaFields.classList.add("hidden");
    el.coverStudioBox.classList.add("hidden");
    el.playlistCoverRow.classList.remove("hidden");

    el.loadingState.classList.add("hidden");
    el.emptyState.classList.add("hidden");
    el.workspace.classList.remove("hidden");

    if (state.videoFormat === "gif") state.videoFormat = "mp4";

    renderFormats();
    renderQualities();
    renderDspUI();
    renderMetaUI();
    renderPlaylistTracks();
    saveRecent(playlistData);
  }

  // Format, Quality, DSP & Cover UI Rendering -------------------------------
  function renderFormats() {
    if (!state.catalog) return;
    const list = state.mode === "audio" ? state.catalog.audio : state.catalog.video;
    const selectedId = state.mode === "audio" ? state.audioFormat : state.videoFormat;
    const primaries = list.filter((f) => f.primary);
    const extended = list.filter((f) => !f.primary && !(state.viewKind === "playlist" && f.id === "gif"));

    el.primaryFormats.innerHTML = "";
    primaries.forEach((fmt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `format-tile${fmt.id === selectedId ? " selected" : ""}`;
      btn.innerHTML = `
        <span class="format-tile-name">${fmt.label}</span>
        <span class="format-tile-sub">${fmt.detail}</span>
      `;
      btn.addEventListener("click", () => selectFormat(fmt.id));
      el.primaryFormats.appendChild(btn);
    });

    el.moreFormatsLabel.textContent =
      state.mode === "audio"
        ? `Autres formats audio (${extended.length})`
        : `Autres formats vidéo (${extended.length})`;

    const selectedExt = extended.find((f) => f.id === selectedId);
    if (selectedExt) {
      el.moreFormatsSelectedBadge.textContent = selectedExt.label;
      el.moreFormatsSelectedBadge.classList.remove("hidden");
    } else {
      el.moreFormatsSelectedBadge.classList.add("hidden");
    }

    el.extendedFormats.innerHTML = "";
    extended.forEach((fmt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `format-ext-btn${fmt.id === selectedId ? " selected" : ""}`;
      btn.innerHTML = `
        <span class="format-ext-id">${fmt.label}</span>
        <span class="format-ext-detail">${fmt.detail}</span>
      `;
      btn.addEventListener("click", () => selectFormat(fmt.id));
      el.extendedFormats.appendChild(btn);
    });

    el.extendedFormats.classList.toggle("hidden", !state.moreFormatsOpen);
    el.toggleMoreFormats.setAttribute("aria-expanded", String(state.moreFormatsOpen));

    const active = getActiveFormatObj();
    el.formatActiveNote.textContent = active ? `.${active.ext}` : "";
    renderMetaUI();
  }

  function selectFormat(fmtId) {
    if (state.mode === "audio") state.audioFormat = fmtId;
    else state.videoFormat = fmtId;
    renderFormats();
    renderQualities();
    renderExportSummary();
  }

  function estimateAudioSizeBytes(fmtObj, durationSec) {
    if (!durationSec) return 0;
    if (fmtObj.lossless) {
      const sr = Number(state.audioSampleRate) || 48000;
      const pcmBytes = sr * 2 * 2 * durationSec;
      return fmtObj.id === "flac" || fmtObj.id === "alac" ? pcmBytes * 0.58 : pcmBytes;
    }
    const kbps = Number(state.audioBitrate) || 192;
    return (kbps * 1000 / 8) * durationSec;
  }

  function renderQualities() {
    if (!state.catalog) return;
    if (state.viewKind === "empty") return;
    el.qualityOptions.innerHTML = "";

    const isPl = state.viewKind === "playlist";
    const selDur = !isPl && state.video ? getSelectedDuration() : 0;
    const totalDur = !isPl && state.video ? Math.max(1, state.video.duration) : 1;
    const ratio = clamp(selDur / totalDur, 0.01, 1);

    if (state.mode === "audio") {
      const fmt = getActiveFormatObj();
      el.qualityHeading.textContent = fmt.lossless ? "Échantillonnage (sans perte)" : "Débit audio (kbps)";
      const estBytes = !isPl ? estimateAudioSizeBytes(fmt, selDur) : 0;
      el.qualityEstimate.textContent = estBytes ? `~${formatBytes(estBytes)}` : "";

      const grid = document.createElement("div");
      grid.className = `audio-quality-grid${fmt.lossless ? " two-col" : ""}`;
      const items = fmt.lossless ? state.catalog.audio_sample_rates : state.catalog.audio_bitrates;
      const current = fmt.lossless ? state.audioSampleRate : state.audioBitrate;

      items.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `quality-chip${opt.value === current ? " selected" : ""}`;
        const displayMain = fmt.lossless ? opt.label : opt.value;
        btn.innerHTML = `
          <span class="quality-chip-main">${displayMain}</span>
          <span class="quality-chip-sub">${opt.tag}</span>
        `;
        btn.addEventListener("click", () => {
          if (fmt.lossless) state.audioSampleRate = opt.value;
          else state.audioBitrate = opt.value;
          renderQualities();
          renderExportSummary();
        });
        grid.appendChild(btn);
      });
      el.qualityOptions.appendChild(grid);
    } else {
      el.qualityHeading.textContent = isPl ? "Qualité vidéo maximale" : "Qualité vidéo disponible";
      const qualities = isPl ? PLAYLIST_VIDEO_QUALITIES : (state.video?.video_qualities || []);

      if (state.videoFormat === "gif" && !isPl) {
        const note = document.createElement("div");
        note.className = "gif-note";
        note.textContent = "Export GIF : 15 ips, largeur max 640 px. Sélectionnez un extrait de 30 secondes maximum.";
        el.qualityOptions.appendChild(note);
        el.qualityEstimate.textContent = "max 30s";
        return;
      }

      if (!qualities.length) {
        el.qualityEstimate.textContent = "";
        const empty = document.createElement("div");
        empty.className = "gif-note";
        empty.textContent = "Qualité par défaut de la source.";
        el.qualityOptions.appendChild(empty);
        return;
      }

      const selectedQ = qualities.find((q) => q.height === state.videoHeight) || qualities[0];
      state.videoHeight = selectedQ.height;
      const estBytes = !isPl && selectedQ.approx_bytes ? selectedQ.approx_bytes * ratio : 0;
      el.qualityEstimate.textContent = estBytes ? `~${formatBytes(estBytes)}` : "";

      const list = document.createElement("div");
      list.className = "video-quality-list";

      qualities.forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `vq-row${q.height === state.videoHeight ? " selected" : ""}`;
        const qEst = !isPl && q.approx_bytes ? formatBytes(q.approx_bytes * ratio) : "";
        const badges = [];
        if (q.fps && q.fps >= 48) badges.push(`<span class="vq-badge">${q.fps} fps</span>`);
        if (q.hdr) badges.push('<span class="vq-badge">HDR</span>');
        if (qEst) badges.push(`<span>~${qEst}</span>`);

        btn.innerHTML = `
          <span class="vq-left">
            <span class="vq-res">${q.height}p</span>
            <span class="vq-label">${q.label}</span>
          </span>
          <span class="vq-tags">${badges.join("")}</span>
        `;
        btn.addEventListener("click", () => {
          state.videoHeight = q.height;
          renderQualities();
          renderExportSummary();
        });
        list.appendChild(btn);
      });

      el.qualityOptions.appendChild(list);
    }
  }

  function renderDspUI() {
    const isVideo = state.mode === "video";
    el.muteVideoRow.classList.toggle("hidden", !isVideo);
    el.muteVideoCheck.checked = state.muteVideo;
    el.audioDspControls.classList.toggle("disabled", isVideo && state.muteVideo);

    el.fadeInInput.value = String(state.fadeIn);
    el.fadeOutInput.value = String(state.fadeOut);

    document.querySelectorAll('.mini-presets[data-fade-target="in"] .mini-chip').forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.val) === state.fadeIn);
    });
    document.querySelectorAll('.mini-presets[data-fade-target="out"] .mini-chip').forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.val) === state.fadeOut);
    });

    document.querySelectorAll("[data-norm]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.norm === state.normMode);
    });

    el.lufsControlBox.classList.toggle("hidden", state.normMode !== "lufs");
    el.gainControlBox.classList.toggle("hidden", state.normMode !== "gain");

    if (state.normMode === "lufs") {
      el.lufsSlider.value = String(state.targetLufs);
      el.normValueReadout.textContent = `${state.targetLufs.toFixed(1).replace(".", ",")} LUFS`;
      document.querySelectorAll("#lufsPresets .mini-chip").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.lufs) === state.targetLufs);
      });
    } else if (state.normMode === "gain") {
      el.gainSlider.value = String(state.gainDb);
      const sign = state.gainDb > 0 ? "+" : "";
      el.normValueReadout.textContent = `${sign}${state.gainDb.toFixed(1).replace(".", ",")} dB`;
      document.querySelectorAll("#gainPresets .mini-chip").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.gain) === state.gainDb);
      });
    } else {
      el.normValueReadout.textContent = "Original";
    }

    // Active summary badge on accordion header
    const tags = [];
    if (isVideo && state.muteVideo) {
      tags.push("Muet");
    } else {
      if (state.fadeIn > 0 || state.fadeOut > 0) tags.push(`Fondu ${state.fadeIn}/${state.fadeOut}s`);
      if (state.normMode === "lufs") tags.push(`${state.targetLufs} LUFS`);
      else if (state.normMode === "gain" && Math.abs(state.gainDb) >= 0.1) {
        tags.push(`${state.gainDb > 0 ? "+" : ""}${state.gainDb} dB`);
      }
    }
    if (tags.length) {
      el.dspActiveBadge.textContent = tags.join(" · ");
      el.dspActiveBadge.classList.remove("hidden");
    } else {
      el.dspActiveBadge.classList.add("hidden");
    }

    if (state.viewKind === "video" && state.video) drawWaveform();
    renderExportSummary();
  }

  function renderMetaUI() {
    const isPl = state.viewKind === "playlist";
    const fmt = getActiveFormatObj();
    const coverSupported = state.mode === "audio" && fmt && fmt.cover_ok;

    if (!isPl) {
      el.coverStudioBox.classList.toggle("hidden", state.mode !== "audio");
      el.coverCompatHint.textContent = coverSupported
        ? `Compatible ${fmt.label}`
        : `Dispo sur MP3 · M4A · FLAC · ALAC`;

      document.querySelectorAll("[data-cover]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cover === state.coverMode);
      });

      const showEditor = state.coverMode !== "none";
      el.coverEditorBox.classList.toggle("hidden", !showEditor);
      el.customCoverControls.classList.toggle("hidden", state.coverMode !== "custom");
      el.uploadCoverControls.classList.toggle("hidden", state.coverMode !== "upload");
      el.thumbCoverHint.classList.toggle("hidden", state.coverMode !== "thumb");

      document.querySelectorAll("[data-cstyle]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cstyle === state.coverStyle);
      });
      document.querySelectorAll(".swatch").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.color === state.coverColor);
      });

      if (showEditor) renderCoverCanvas();

      // Active badge
      const customFilename = el.metaFilename.value.trim();
      const customAlbum = el.metaAlbum.value.trim();
      const coverActive = state.mode === "audio" && state.coverMode !== "none";
      const badges = [];
      if (coverActive) badges.push(state.coverMode === "custom" ? `Pochette ${state.coverStyle}` : "Pochette");
      if (customFilename || customAlbum) badges.push("Tags");
      if (badges.length) {
        el.metaActiveBadge.textContent = badges.join(" · ");
        el.metaActiveBadge.classList.remove("hidden");
      } else {
        el.metaActiveBadge.classList.add("hidden");
      }
    } else {
      el.playlistCoverRow.classList.toggle("hidden", state.mode !== "audio");
      const active = state.mode === "audio" && el.playlistThumbCoverCheck.checked;
      el.metaActiveBadge.textContent = active ? "Miniatures" : "";
      el.metaActiveBadge.classList.toggle("hidden", !active);
    }
  }

  function renderExportSummary() {
    if (!state.catalog || state.viewKind === "empty") return;
    const fmt = getActiveFormatObj();
    const qText = state.mode === "video" && fmt.id === "gif" ? "640px · 15 ips" : getActiveQualityDisplay();

    const extras = [];
    if (state.mode === "video" && state.muteVideo) {
      extras.push("muet");
    } else {
      if (state.fadeIn > 0 || state.fadeOut > 0) extras.push(`fondu ${state.fadeIn}/${state.fadeOut}s`);
      if (state.normMode === "lufs") extras.push(`${state.targetLufs} LUFS`);
      else if (state.normMode === "gain" && Math.abs(state.gainDb) >= 0.1) {
        extras.push(`${state.gainDb > 0 ? "+" : ""}${state.gainDb} dB`);
      }
    }
    const extraStr = extras.length ? ` · ${extras.join(" · ")}` : "";

    if (state.viewKind === "playlist" && state.playlist) {
      const count = state.playlistSelectedIds.size;
      const zipTag = count > 1 && el.playlistZipCheck.checked ? " · Archive .ZIP" : "";
      el.exportSummary.textContent = `${fmt.label} · ${qText} · ${count} titre${count > 1 ? "s" : ""}${extraStr}${zipTag}`;
      el.downloadBtnText.textContent =
        count > 0 ? `Exporter la sélection (${count} ${count > 1 ? "titres" : "titre"})` : "Sélectionnez un titre";
      el.downloadBtn.disabled = count === 0 || Boolean(state.activeJobId);
      return;
    }

    if (!state.video) return;
    const trimmed = isTrimmed();
    const rangeText = trimmed
      ? `Extrait ${formatTime(state.trimStart)} → ${formatTime(state.trimEnd)} (${formatTime(getSelectedDuration())})`
      : `Durée intégrale (${formatTime(state.video.duration)})`;

    el.exportSummary.textContent = `${fmt.label} · ${qText} · ${rangeText}${extraStr}`;
    el.downloadBtnText.textContent = trimmed
      ? `Télécharger l'extrait (${fmt.label})`
      : `Télécharger en ${fmt.label}`;
    el.downloadBtn.disabled = Boolean(state.activeJobId);
  }

  // Probing a YouTube URL (Video or Playlist) -------------------------------
  async function probeUrl(rawUrl, options = {}) {
    const url = String(rawUrl || "").trim();
    if (!url) return;

    el.probeError.classList.add("hidden");
    el.jobError.classList.add("hidden");
    el.emptyState.classList.add("hidden");
    el.workspace.classList.add("hidden");
    el.loadingMessage.textContent = /playlist\?list=/i.test(url)
      ? "Lecture de la playlist YouTube…"
      : "Lecture des flux et des qualités disponibles sur YouTube…";
    el.loadingState.classList.remove("hidden");
    el.probeBtn.disabled = true;
    setStatus("warn", "Analyse…");

    destroyYtPlayer();

    try {
      const endpoint = options.forcePlaylist ? "/api/probe-playlist" : "/api/probe";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Impossible d'analyser ce lien.");

      if (data.kind === "playlist") {
        showPlaylistView(data);
        setStatus("", "Prêt");
        return;
      }

      // Single Video Mode
      state.viewKind = "video";
      state.video = data;
      if (!options.keepPlaylistReturn) {
        state.playlist = null;
      }
      state.trimStart = 0;
      state.trimEnd = Math.max(1, data.duration || 1);
      state.playhead = 0;

      // Pre-fill optional metadata fields cleanly
      el.metaFilename.value = "";
      el.metaTitle.value = data.title || "";
      el.metaArtist.value = data.channel || "";
      el.metaAlbum.value = "";

      const heights = (data.video_qualities || []).map((q) => q.height);
      if (heights.includes(1080)) state.videoHeight = 1080;
      else if (heights.length) state.videoHeight = heights[0];

      el.videoTitle.textContent = data.title;
      el.videoChannel.textContent = data.channel || "YouTube";
      el.videoDuration.textContent = formatTime(data.duration);
      if (data.view_count) {
        el.videoViews.textContent = formatViews(data.view_count);
        el.videoViewsWrap.classList.remove("hidden");
      } else {
        el.videoViewsWrap.classList.add("hidden");
      }
      el.openOriginalLink.href = data.url;
      el.videoThumb.src = data.thumbnail || "";

      // Context banner: either "Retour à la playlist" or "Charger la playlist complète"
      if (options.keepPlaylistReturn && state.playlist) {
        el.contextBannerText.textContent = `Extrait issu de la playlist « ${state.playlist.title} »`;
        el.contextBannerBtn.textContent = "← Retour à la playlist";
        el.contextBannerBtn.onclick = () => showPlaylistView(state.playlist);
        el.contextBanner.classList.remove("hidden");
      } else if (data.playlist_hint && data.playlist_hint.url) {
        el.contextBannerText.textContent = "Ce lien appartient à une playlist YouTube.";
        el.contextBannerBtn.textContent = "Charger toute la playlist";
        el.contextBannerBtn.onclick = () => probeUrl(data.playlist_hint.url, { forcePlaylist: true });
        el.contextBanner.classList.remove("hidden");
      } else {
        el.contextBanner.classList.add("hidden");
      }

      el.playlistStage.classList.add("hidden");
      el.videoStage.classList.remove("hidden");
      el.queueClipBtn.classList.remove("hidden");
      el.playlistZipRow.classList.add("hidden");

      el.singleMetaFields.classList.remove("hidden");
      el.playlistCoverRow.classList.add("hidden");

      el.loadingState.classList.add("hidden");
      el.workspace.classList.remove("hidden");

      renderRulerScale();
      renderChapters();
      renderFormats();
      renderQualities();
      renderDspUI();
      renderMetaUI();
      renderTrimUI();
      renderExportSummary();
      saveRecent(data);

      // Fire background real audio waveform extraction + CORS-safe cover thumbnail load
      loadRealWaveform(data.id);
      loadProxiedThumbnail(data.thumbnail);

      setStatus("", "Prêt");
    } catch (err) {
      el.loadingState.classList.add("hidden");
      if (state.viewKind !== "empty") el.workspace.classList.remove("hidden");
      else el.emptyState.classList.remove("hidden");
      el.probeError.textContent = err.message || "Erreur lors de l'analyse.";
      el.probeError.classList.remove("hidden");
      setStatus("", "Prêt");
    } finally {
      el.probeBtn.disabled = false;
    }
  }

  // Export & Conversion Execution -------------------------------------------
  function buildCurrentSpec() {
    const fmt = getActiveFormatObj();
    const trimmed = isTrimmed();
    return {
      url: state.video.url,
      title: el.metaTitle.value.trim() || state.video.title,
      artist: el.metaArtist.value.trim() || state.video.channel,
      album: el.metaAlbum.value.trim(),
      custom_filename: el.metaFilename.value.trim(),
      duration: state.video.duration,
      mode: state.mode,
      format: fmt.id,
      formatLabel: fmt.label,
      quality: getActiveQualityValue(),
      qualityDisplay: state.mode === "video" && fmt.id === "gif" ? "GIF" : getActiveQualityDisplay(),
      trim_start: trimmed ? state.trimStart : null,
      trim_end: trimmed ? state.trimEnd : null,
      fade_in: state.mode === "video" && state.muteVideo ? 0 : state.fadeIn,
      fade_out: state.mode === "video" && state.muteVideo ? 0 : state.fadeOut,
      audio_norm_mode: state.mode === "video" && state.muteVideo ? "off" : state.normMode,
      target_lufs: state.targetLufs,
      gain_db: state.gainDb,
      mute_video: state.mode === "video" ? state.muteVideo : false,
      cover_data_url: getActiveCoverDataUrl(),
    };
  }

  function triggerBrowserDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function runJobEndpoint(endpoint, bodyPayload, metaInfo) {
    return new Promise(async (resolve) => {
      el.jobError.classList.add("hidden");
      el.downloadBtn.disabled = true;
      el.queueClipBtn.disabled = true;
      el.jobProgressBox.classList.remove("hidden");
      el.jobStage.textContent = "Initialisation…";
      el.jobPct.textContent = "0%";
      el.jobBar.style.width = "0%";
      el.jobDetail.textContent = metaInfo.detail || "";

      setStatus("busy", "Conversion…");

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Impossible de lancer la conversion.");

        const jobId = data.job_id;
        state.activeJobId = jobId;

        const es = new EventSource(`/api/jobs/${jobId}/events`);
        state.activeEventSource = es;

        const finish = (ok, errMessage) => {
          es.close();
          state.activeEventSource = null;
          state.activeJobId = null;
          el.downloadBtn.disabled = false;
          el.queueClipBtn.disabled = false;
          if (!ok && errMessage) {
            el.jobError.textContent = errMessage;
            el.jobError.classList.remove("hidden");
          }
          if (!state.queueRunning) setStatus("", "Prêt");
          renderExportSummary();
          resolve(ok);
        };

        es.onmessage = (ev) => {
          const payload = JSON.parse(ev.data);
          el.jobStage.textContent = payload.stage || "Traitement…";
          const pct = Math.round(payload.progress || 0);
          el.jobPct.textContent = `${pct}%`;
          el.jobBar.style.width = `${pct}%`;

          if (payload.status === "done") {
            state.exports.unshift({
              id: jobId,
              videoId: metaInfo.videoId || null,
              filename: payload.filename,
              fileSize: payload.file_size,
              downloadUrl: payload.download_url,
              formatLabel: metaInfo.formatLabel,
              qualityDisplay: metaInfo.qualityDisplay,
              trimStart: metaInfo.trimStart ?? null,
              trimEnd: metaInfo.trimEnd ?? null,
              rangeLabel: metaInfo.rangeLabel || null,
            });
            renderClipsSection();
            triggerBrowserDownload(payload.download_url, payload.filename);
            setTimeout(() => {
              if (!state.activeJobId) el.jobProgressBox.classList.add("hidden");
            }, 1500);
            finish(true);
          } else if (payload.status === "error") {
            el.jobProgressBox.classList.add("hidden");
            finish(false, payload.error || "La conversion a échoué.");
          } else if (payload.status === "cancelled") {
            el.jobProgressBox.classList.add("hidden");
            finish(false, null);
          }
        };

        es.onerror = () => {
          el.jobProgressBox.classList.add("hidden");
          finish(false, "Connexion interrompue avec le serveur local.");
        };
      } catch (err) {
        el.jobProgressBox.classList.add("hidden");
        el.downloadBtn.disabled = false;
        el.queueClipBtn.disabled = false;
        el.jobError.textContent = err.message || "Erreur lors de la conversion.";
        el.jobError.classList.remove("hidden");
        setStatus("", "Prêt");
        resolve(false);
      }
    });
  }

  function runSingleExport(spec) {
    const detail =
      spec.trim_start !== null
        ? `${spec.formatLabel} · ${formatTime(spec.trim_start)} → ${formatTime(spec.trim_end)}`
        : `${spec.formatLabel} · Intégrale`;
    return runJobEndpoint("/api/jobs", spec, {
      detail,
      videoId: state.video?.id,
      formatLabel: spec.formatLabel,
      qualityDisplay: spec.qualityDisplay,
      trimStart: spec.trim_start,
      trimEnd: spec.trim_end,
    });
  }

  async function runPlaylistExport() {
    if (!state.playlist || state.activeJobId) return;
    const selected = (state.playlist.entries || []).filter((e) => state.playlistSelectedIds.has(e.id));
    if (!selected.length) return;

    const fmt = getActiveFormatObj();
    const qVal = getActiveQualityValue();
    const qDisp = getActiveQualityDisplay();
    const useZip = el.playlistZipCheck.checked && selected.length > 1;

    if (useZip || selected.length === 1) {
      const payload = {
        items: selected,
        playlist_title: state.playlist.title,
        mode: state.mode,
        format: fmt.id,
        quality: qVal,
        fade_in: state.mode === "video" && state.muteVideo ? 0 : state.fadeIn,
        fade_out: state.mode === "video" && state.muteVideo ? 0 : state.fadeOut,
        audio_norm_mode: state.mode === "video" && state.muteVideo ? "off" : state.normMode,
        target_lufs: state.targetLufs,
        gain_db: state.gainDb,
        mute_video: state.mode === "video" ? state.muteVideo : false,
        embed_thumb_cover: state.mode === "audio" && el.playlistThumbCoverCheck.checked,
        force_zip: useZip,
      };
      await runJobEndpoint("/api/batch-jobs", payload, {
        detail: `${fmt.label} · ${selected.length} titre${selected.length > 1 ? "s" : ""}`,
        formatLabel: useZip ? `ZIP · ${fmt.label}` : fmt.label,
        qualityDisplay: qDisp,
        rangeLabel: `${selected.length} titre${selected.length > 1 ? "s" : ""}`,
      });
    } else {
      // Export each selected track individually in sequence
      state.queueRunning = true;
      for (const item of selected) {
        if (!state.queueRunning) break;
        const spec = {
          url: item.url,
          title: item.title,
          artist: item.channel || "",
          album: state.playlist.title || "",
          duration: item.duration || 0,
          mode: state.mode,
          format: fmt.id,
          formatLabel: fmt.label,
          quality: qVal,
          qualityDisplay: qDisp,
          trim_start: null,
          trim_end: null,
          fade_in: state.mode === "video" && state.muteVideo ? 0 : state.fadeIn,
          fade_out: state.mode === "video" && state.muteVideo ? 0 : state.fadeOut,
          audio_norm_mode: state.mode === "video" && state.muteVideo ? "off" : state.normMode,
          target_lufs: state.targetLufs,
          gain_db: state.gainDb,
          mute_video: state.mode === "video" ? state.muteVideo : false,
          cover_url: state.mode === "audio" && el.playlistThumbCoverCheck.checked ? item.thumbnail : null,
        };
        const ok = await runSingleExport(spec);
        if (!ok) break;
      }
      state.queueRunning = false;
      setStatus("", "Prêt");
    }
  }

  // Multi-Clip Queue & Session Exports --------------------------------------
  function addCurrentToQueue() {
    if (state.viewKind !== "video" || !state.video) return;
    const spec = buildCurrentSpec();
    if (spec.format === "gif") {
      const dur = spec.trim_start !== null ? spec.trim_end - spec.trim_start : state.video.duration;
      if (dur > 30) {
        el.jobError.textContent = "Sélectionnez un extrait de 30 secondes maximum pour l'export GIF.";
        el.jobError.classList.remove("hidden");
        return;
      }
    }
    el.jobError.classList.add("hidden");
    state.queue.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, spec });
    renderClipsSection();
  }

  async function processQueue() {
    if (state.queueRunning || !state.queue.length) return;
    state.queueRunning = true;
    el.runQueueBtn.disabled = true;

    while (state.queue.length && state.queueRunning) {
      const next = state.queue.shift();
      renderClipsSection();
      const ok = await runSingleExport(next.spec);
      if (!ok) break;
    }

    state.queueRunning = false;
    el.runQueueBtn.disabled = false;
    setStatus("", "Prêt");
    renderClipsSection();
  }

  function renderClipsSection() {
    const hasQueue = state.queue.length > 0;
    const hasExports = state.exports.length > 0;

    el.clipsSection.classList.toggle("hidden", !hasQueue && !hasExports);
    el.queuePanel.classList.toggle("hidden", !hasQueue);
    el.exportsPanel.classList.toggle("hidden", !hasExports);

    if (hasQueue) {
      el.queueCount.textContent = String(state.queue.length);
      el.queueList.innerHTML = "";
      state.queue.forEach((item) => {
        const s = item.spec;
        const range =
          s.trim_start !== null
            ? `${formatTime(s.trim_start)} → ${formatTime(s.trim_end)}`
            : "Intégrale";
        const li = document.createElement("li");
        li.className = "clip-row";
        li.innerHTML = `
          <div class="clip-main">
            <span class="clip-format">${s.formatLabel} · ${s.qualityDisplay}</span>
            <span class="clip-range">${range}</span>
            <span class="clip-name"></span>
          </div>
          <div class="clip-actions">
            <button type="button" class="btn-subtle btn-recall">Voir bornes</button>
            <button type="button" class="link-danger btn-remove">Retirer</button>
          </div>
        `;
        li.querySelector(".clip-name").textContent = s.title;
        li.querySelector(".btn-recall").addEventListener("click", () => {
          if (state.video && state.video.url === s.url) {
            setTrimRange(s.trim_start ?? 0, s.trim_end ?? state.video.duration, { seekToStart: true });
          }
        });
        li.querySelector(".btn-remove").addEventListener("click", () => {
          state.queue = state.queue.filter((q) => q.id !== item.id);
          renderClipsSection();
        });
        el.queueList.appendChild(li);
      });
    }

    if (hasExports) {
      el.exportsCount.textContent = String(state.exports.length);
      el.exportsList.innerHTML = "";
      state.exports.forEach((exp) => {
        const range =
          exp.rangeLabel ||
          (exp.trimStart !== null ? `${formatTime(exp.trimStart)} → ${formatTime(exp.trimEnd)}` : "Intégrale");
        const canReselect = Boolean(exp.videoId && state.video && state.video.id === exp.videoId);
        const li = document.createElement("li");
        li.className = "clip-row";
        li.innerHTML = `
          <div class="clip-main">
            <span class="clip-format">${exp.formatLabel} · ${exp.qualityDisplay}</span>
            <span class="clip-range">${range}</span>
            <span class="clip-name"></span>
            <span class="clip-size">${formatBytes(exp.fileSize)}</span>
          </div>
          <div class="clip-actions">
            ${canReselect ? '<button type="button" class="btn-subtle btn-reselect">Reprendre bornes</button>' : ""}
            <a class="btn-subtle" href="${exp.downloadUrl}" download>Télécharger</a>
          </div>
        `;
        li.querySelector(".clip-name").textContent = exp.filename || "";
        const resBtn = li.querySelector(".btn-reselect");
        if (resBtn) {
          resBtn.addEventListener("click", () => {
            if (state.video && state.video.id === exp.videoId) {
              setTrimRange(exp.trimStart ?? 0, exp.trimEnd ?? state.video.duration, { seekToStart: true });
            }
          });
        }
        el.exportsList.appendChild(li);
      });
    }
  }

  // Event Bindings & Bootstrap ----------------------------------------------
  function updateClearUrlBtn() {
    el.clearUrlBtn.classList.toggle("hidden", !el.urlInput.value.trim());
  }

  function bindAccordion(toggleBtn, bodyEl) {
    toggleBtn.addEventListener("click", () => {
      const open = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", String(!open));
      bodyEl.classList.toggle("hidden", open);
      if (!open && bodyEl === el.metaPanelBody && state.coverMode !== "none") {
        renderCoverCanvas();
      }
    });
  }

  async function init() {
    initTheme();
    renderRecents();
    bindRulerInteractions();
    bindAccordion(el.toggleDspPanel, el.dspPanelBody);
    bindAccordion(el.toggleMetaPanel, el.metaPanelBody);

    try {
      const resp = await fetch("/api/formats");
      state.catalog = await resp.json();
    } catch (_) {
      setStatus("warn", "Serveur hors ligne");
    }

    el.themeToggle.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });

    el.urlInput.addEventListener("input", updateClearUrlBtn);
    el.urlInput.addEventListener("paste", () => {
      setTimeout(() => {
        updateClearUrlBtn();
        const val = el.urlInput.value.trim();
        if (/youtube\.com|youtu\.be/i.test(val)) probeUrl(val);
      }, 20);
    });

    el.clearUrlBtn.addEventListener("click", () => {
      el.urlInput.value = "";
      updateClearUrlBtn();
      el.urlInput.focus();
    });

    el.pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          el.urlInput.value = text.trim();
          updateClearUrlBtn();
          probeUrl(text.trim());
        }
      } catch (_) {
        el.urlInput.focus();
      }
    });

    el.probeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      probeUrl(el.urlInput.value);
    });

    el.clearRecentBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(RECENT_KEY);
      } catch (_) {}
      renderRecents();
    });

    // Playlist controls
    el.plSelectAllBtn.addEventListener("click", () => {
      if (!state.playlist) return;
      (state.playlist.entries || []).forEach((e) => state.playlistSelectedIds.add(e.id));
      renderPlaylistTracks();
    });

    el.plSelectNoneBtn.addEventListener("click", () => {
      state.playlistSelectedIds.clear();
      renderPlaylistTracks();
    });

    el.plFilterInput.addEventListener("input", () => {
      state.playlistFilter = el.plFilterInput.value;
      renderPlaylistTracks();
    });

    el.playlistZipCheck.addEventListener("change", renderExportSummary);
    el.playlistThumbCoverCheck.addEventListener("change", renderMetaUI);

    // Transport & Trim
    el.monitorPlayOverlay.addEventListener("click", () => ensureYtPlayer(true));
    el.playSegmentBtn.addEventListener("click", () => startSegmentPlayback());

    el.markInBtn.addEventListener("click", () => {
      if (!state.video) return;
      const t = state.playhead;
      setTrimRange(t, Math.max(state.trimEnd, t + 1));
    });

    el.markOutBtn.addEventListener("click", () => {
      if (!state.video) return;
      const t = state.playhead;
      setTrimRange(Math.min(state.trimStart, Math.max(0, t - 1)), Math.max(1, t));
    });

    el.resetTrimBtn.addEventListener("click", () => {
      if (!state.video) return;
      setTrimRange(0, state.video.duration, { seekToStart: true });
    });

    // Output Mode & Format Accordion
    el.modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (mode === state.mode) return;
        state.mode = mode;
        state.moreFormatsOpen = false;
        el.modeButtons.forEach((b) => {
          const active = b.dataset.mode === mode;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", String(active));
        });
        renderFormats();
        renderQualities();
        renderDspUI();
        renderMetaUI();
        renderExportSummary();
      });
    });

    el.toggleMoreFormats.addEventListener("click", () => {
      state.moreFormatsOpen = !state.moreFormatsOpen;
      el.extendedFormats.classList.toggle("hidden", !state.moreFormatsOpen);
      el.toggleMoreFormats.setAttribute("aria-expanded", String(state.moreFormatsOpen));
    });

    // DSP: Fades, Custom LUFS / Gain & Mute
    el.fadeInInput.addEventListener("input", () => {
      state.fadeIn = clamp(parseFloat(el.fadeInInput.value) || 0, 0, 15);
      renderDspUI();
    });
    el.fadeOutInput.addEventListener("input", () => {
      state.fadeOut = clamp(parseFloat(el.fadeOutInput.value) || 0, 0, 15);
      renderDspUI();
    });

    document.querySelectorAll(".mini-presets[data-fade-target]").forEach((group) => {
      const target = group.dataset.fadeTarget;
      group.querySelectorAll(".mini-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const v = Number(chip.dataset.val);
          if (target === "in") state.fadeIn = v;
          else state.fadeOut = v;
          renderDspUI();
        });
      });
    });

    document.querySelectorAll("[data-norm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.normMode = btn.dataset.norm;
        renderDspUI();
      });
    });

    el.lufsSlider.addEventListener("input", () => {
      state.targetLufs = parseFloat(el.lufsSlider.value);
      renderDspUI();
    });
    document.querySelectorAll("#lufsPresets .mini-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.targetLufs = Number(btn.dataset.lufs);
        renderDspUI();
      });
    });

    el.gainSlider.addEventListener("input", () => {
      state.gainDb = parseFloat(el.gainSlider.value);
      renderDspUI();
    });
    document.querySelectorAll("#gainPresets .mini-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.gainDb = Number(btn.dataset.gain);
        renderDspUI();
      });
    });

    el.muteVideoCheck.addEventListener("change", () => {
      state.muteVideo = el.muteVideoCheck.checked;
      renderDspUI();
    });

    // Metadata & Cover Designer
    [el.metaFilename, el.metaTitle, el.metaArtist, el.metaAlbum, el.coverTagline].forEach((inp) => {
      inp.addEventListener("input", () => {
        renderMetaUI();
      });
    });

    document.querySelectorAll("[data-cover]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.coverMode = btn.dataset.cover;
        renderMetaUI();
      });
    });

    document.querySelectorAll("[data-cstyle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.coverStyle = btn.dataset.cstyle;
        renderMetaUI();
      });
    });

    document.querySelectorAll(".swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.coverColor = btn.dataset.color;
        renderMetaUI();
      });
    });

    el.pickCoverFileBtn.addEventListener("click", () => el.coverFileInput.click());
    el.coverFileInput.addEventListener("change", () => {
      const file = el.coverFileInput.files && el.coverFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          state.uploadImg = img;
          renderCoverCanvas();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    // Main Download / Queue / Cancel
    el.downloadBtn.addEventListener("click", () => {
      if (state.activeJobId) return;
      if (state.viewKind === "playlist") {
        runPlaylistExport();
      } else if (state.viewKind === "video" && state.video) {
        runSingleExport(buildCurrentSpec());
      }
    });

    el.queueClipBtn.addEventListener("click", addCurrentToQueue);
    el.runQueueBtn.addEventListener("click", processQueue);
    el.clearQueueBtn.addEventListener("click", () => {
      state.queue = [];
      renderClipsSection();
    });

    el.cancelJobBtn.addEventListener("click", async () => {
      state.queueRunning = false;
      if (state.activeJobId) {
        try {
          await fetch(`/api/jobs/${state.activeJobId}`, { method: "DELETE" });
        } catch (_) {}
      }
    });

    // Global studio shortcuts
    window.addEventListener("keydown", (e) => {
      if (state.viewKind !== "video" || !state.video) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        startSegmentPlayback();
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setTrimRange(state.playhead, Math.max(state.trimEnd, state.playhead + 1));
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        setTrimRange(Math.min(state.trimStart, Math.max(0, state.playhead - 1)), Math.max(1, state.playhead));
      }
    });
  }

  // Native Desktop Hook (called by macOS Swift app when a file finishes saving)
  window.bandeNotifyDownloadSaved = function (filename, fullPath) {
    const existing = document.getElementById("desktopToast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "desktopToast";
    toast.className = "desktop-toast";
    toast.innerHTML = `
      <span class="desktop-toast-dot"></span>
      <span class="desktop-toast-msg"></span>
      <button type="button" class="btn-subtle desktop-toast-reveal">Afficher dans le Finder</button>
    `;
    toast.querySelector(".desktop-toast-msg").textContent = `Enregistré : ${filename}`;
    toast.querySelector(".desktop-toast-reveal").addEventListener("click", () => {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bande) {
        window.webkit.messageHandlers.bande.postMessage({ action: "reveal", path: fullPath });
      }
      toast.remove();
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 9000);
  };

  init();
})();
