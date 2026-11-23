FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest standalone yt-dlp & Deno JS runtime for YouTube extraction
RUN curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
    && chmod +x /usr/local/bin/yt-dlp \
    && ARCH="$(uname -m)" \
    && if [ "$ARCH" = "aarch64" ]; then DENO_ARCH="aarch64"; else DENO_ARCH="x86_64"; fi \
    && curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}-unknown-linux-gnu.zip" \
    && unzip -o /tmp/deno.zip -d /usr/local/bin/ \
    && rm -f /tmp/deno.zip \
    && chmod +x /usr/local/bin/deno

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY templates ./templates
COPY static ./static

EXPOSE 7860

CMD ["sh", "-c", "gunicorn -w 1 --threads 8 --timeout 600 -b 0.0.0.0:${PORT:-7860} server:app"]
