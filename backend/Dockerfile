FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y python3.11 python3.11-venv && \
    python3.11 -m ensurepip --upgrade && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3.11 -m pip install --no-cache-dir --timeout 300 -r requirements.txt

ENV COQUI_TOS_AGREED=1

COPY . .

CMD ["python3.11", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
