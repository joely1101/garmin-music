# 階段 1: 建置前端 (Node.js)
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# 階段 2: 後端與執行環境 (Python + FFmpeg)
FROM python:3.11-slim

# 安裝系統相依：ffmpeg、curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安裝 Python 相依套件
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# 複製後端程式碼
COPY backend/ ./backend/

# 複製前端編譯產物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 建立音樂儲存目錄
RUN mkdir -p /app/backend/music

ENV PYTHONUNBUFFERED=1

EXPOSE 8090

WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
