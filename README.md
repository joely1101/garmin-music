# 🎵 Garmin Music Server & Mobile Web Suite

一個專為 **Garmin 手錶（相容 Subsonic / Navidrome API）** 量身打造的現代化音樂串流、下載與管理伺服器。內建專為手機操作優化的極簡響應式 Web GUI，並支援一鍵下載 YouTube Music 與 Podcast RSS 轉為高品質 320k MP3 離線存入手錶。

---

## ✨ 核心特色

1. **相容 Subsonic / Navidrome API (`/rest/*`)**：
   * 完美支援 Garmin 手錶端開源 App（如 [YuMusic Garmin Music App](https://github.com/isyuricunha/yumusic-garmin-music-app)）。
   * 內建符合 Garmin Connect IQ 要求的高相容 HTTP 回應標頭（`Content-Length`、`audio/mpeg`）。
2. **目錄分層管理與單曲手錶同步控制**：
   * **目錄模式**：檔案依資料夾分類（如 `1116`），支援單一資料夾快速全選/取消手錶同步。
   * **歌單模式**：平鋪瀏覽全庫歌曲。
   * **手錶歌單**：獨立分頁僅列出有勾選推送到手錶的曲目，手錶容量一目了然。
3. **YouTube Music & Podcast 轉 MP3 下載器**：
   * 支援輸入 YouTube / YouTube Music 網址（可選擇下載整張合輯或僅當前單曲）。
   * 支援輸入 Podcast RSS 訂閱連結自動抓取最新單集音訊。
   * 背景透過 `yt-dlp` 與 `ffmpeg` 自動轉碼為標準 320kbps MP3。
4. **手機導向 (Mobile-First) 現代極簡 GUI**：
   * 底部導航欄與浮動音樂迷你播放器，手機瀏覽器體驗如原生 App。
   * 支援打包為原生 Android APK（透過 Capacitor）。
5. **使用者認證與密碼修改**：
   * 支援 Web 端與 Garmin 手錶共用同一組帳號密碼（預設 `admin` / `admin`）。
   * 內建全屏登入防護，並可在「系統設定」隨時修改密碼。
6. **自訂 Server URL**：
   * 支援 Nginx、Caddy 或 Cloudflare 反向代理網址切換。

---

## 🚀 Docker Compose 快速部署

### 1. 建立 `docker-compose.yml`
您可以直接使用 Docker Hub 官方釋出的映像檔 `joely1101/garmin-music:latest`，無需本機編譯：

```yaml
version: '3.8'

services:
  garmin-music:
    image: joely1101/garmin-music:latest
    container_name: garmin-music-server
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      # 持久化音樂檔案與資料庫
      - ./data/music:/app/backend/music
      - ./data/music.db:/app/backend/music.db
    environment:
      - TZ=Asia/Taipei
```

### 2. 啟動服務
在 `docker-compose.yml` 同級目錄執行：

```bash
docker compose pull && docker compose up -d
```

服務啟動後，開啟瀏覽器即可訪問 Web 管理後台：
👉 **`http://<您的伺服器IP>:8090`**

### 3. 資料持久化路徑
音樂檔案與資料庫會自動掛載於本機 `./data/` 目錄：
* `./data/music/`：存放所有音樂目錄與 MP3 音訊檔。
* `./data/music.db`：SQLite 資料庫（存放曲庫中繼資料、手錶同步勾選狀態與使用者密碼）。

---

## 🛠️ GitHub Actions 自動化 CI/CD
本專案已整合 GitHub Actions 工作流程（`.github/workflows/docker-publish.yml`）：
* 只要對 `main` 分支有程式碼推送（Push），將自動觸發多架構建置，並即時發佈最新 Docker Image 至 **Docker Hub: `joely1101/garmin-music:latest`**。
* **GitHub Repository Secrets 設定需求**：
  若要啟用自動推送，請在您的 GitHub 儲存庫 `Settings` -> `Secrets and variables` -> `Actions` 新增：
  1. `DOCKERHUB_USERNAME`: 您的 Docker Hub 帳號（`joely1101`）
  2. `DOCKERHUB_TOKEN`: 您的 Docker Hub Access Token

---

## ⌚ Garmin 手錶端設定與同步完整指引

本伺服器完美相容 **YuMusic** 手錶 App。請依照以下步驟在 Garmin 手錶上下載安裝並進行 Wi-Fi 同步：

### 第一步：在手錶上安裝 YuMusic App
1. 手機打開 **Garmin Connect IQ Store** App（可在 iOS App Store 或 Google Play 下載）。
2. 在商店搜尋欄中輸入 **`YuMusic`**（或搜尋作者 `isyuricunha`）。
3. 點擊 **下載 / 安裝**，將 App 同步安裝到您的 Garmin 手錶上。

### 第二步：設定伺服器連線資訊
1. 打開手機上的 **Garmin Connect** 或 **Connect IQ** App。
2. 進入 **我的裝置 (My Devices)** -> **我的應用程式 / 音樂** -> 點擊 **YuMusic** -> 選擇 **設定 (Settings)**。
3. 填入連線參數：
   * **Server URL**：輸入您的伺服器網址（例如 `http://192.168.1.100:8090`，若有反向代理請填寫 `https://music.yourdomain.com`）。
   * **Username**：`admin`（或您自訂的使用者名稱）。
   * **Password**：`admin`（或您在網頁設定中修改的新密碼）。
   * **Max Bitrate**：建議選擇 `320`（與後端轉碼品質相符）。
   * **Legacy Authentication**：保持關閉（預設關閉即可支援標準 Token 認證）。
4. 點擊 **儲存 (Save)**。

### 第三步：挑選歌曲並在手錶上同步
1. **在 Web 管理介面挑選歌曲**：
   * 用手機或電腦瀏覽器打開 `http://<您的IP>:8090` 並登入。
   * 在「曲庫管理」中，將您希望推送到手錶的歌曲打勾（可切換到「手錶歌單」確認挑選列表）。
2. **手錶 Wi-Fi 同步**：
   * 確保手錶已連上 Wi-Fi 網路（手錶設定 -> Wi-Fi）。
   * 在手錶上長按或開啟音樂控制項，將音樂來源切換為 **YuMusic**。
   * 進入選單點選 **Update Downloads (更新同步)**。
   * 手錶將自動連接 Wi-Fi 並向伺服器拉取您打勾的歌曲清單，依序下載 MP3 檔案至手錶本機儲存空間中。
3. **開始聆聽**：
   * 配對藍牙耳機至手錶後，即可在跑步或運動時離線聽歌，無需攜帶手機！

---

## 📱 本地手動啟動開發環境

若要在本地（如 WSL Ubuntu / Linux 環境）直接執行：

### 1. 後端啟動 (FastAPI)
```bash
# 進入後端目錄
cd backend

# 安裝 Python 相依
pip install -r requirements.txt

# 啟動伺服器 (埠號 8090)
python -m uvicorn main:app --host 0.0.0.0 --port 8090
```

### 2. 前端構建 (React + Vite + Tailwind)
```bash
# 進入前端目錄
cd frontend

# 安裝 Node 套件
npm install

# 編譯前端靜態檔案 (供後端掛載)
npm run build
```

---

## 📄 License
MIT License
