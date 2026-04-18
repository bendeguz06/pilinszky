FROM nvidia/cuda:13.1.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    WORKSPACE_DIR=/workspace/pilinszky \
    BACKEND_DIR=/workspace/pilinszky/backend \
    VENV_DIR=/workspace/venv \
    PYTHONUNBUFFERED=1 \
    COQUI_TOS_AGREED=1

WORKDIR /workspace

# System dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3.12 \
        python3.12-venv \
        python3-pip \
        ca-certificates \
        ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Ensure python3 points to 3.12
RUN ln -sf /usr/bin/python3.12 /usr/bin/python3

# --- Dependency layer (cached unless requirements change) ---
WORKDIR $BACKEND_DIR

COPY requirements.txt requirements-local.txt ./

ENV PATH="$VENV_DIR/bin:$PATH"

RUN python3 -m venv "$VENV_DIR" && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --timeout 300 \
        -r requirements.txt \
        -r requirements-local.txt

# --- Application code  ---
COPY . .

# Entrypoint
COPY docker-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh

EXPOSE 8000

CMD ["/usr/local/bin/backend-entrypoint.sh"]
