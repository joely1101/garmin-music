# ⌚ Garmin Music Studio (Windows 桌面離線專用版)

專為 **Windows 使用者與 Garmin 智慧手錶跑者/運動愛好者** 設計的本機桌面音樂管理工具。
無需在電腦上安裝 Python 或 Node.js，下載免安裝綠色執行檔即可直接開箱使用！

支援一鍵下載 YouTube 音訊、Podcast 節目標籤，內建 Windows 檔案總管風格之樹狀分類管理、音訊試聽迷你播放器、曲目重新命名，並透過 USB 一鍵直傳 Garmin 手錶原生音樂磁碟（自動產生手錶相容之 `.m3u8` 播放清單）。

---

## 🚀 立即下載使用 (無需安裝環境)

前往本專案的 [Releases 頁面](../../releases) 下載最新版本的：
- **`GarminMusicStudio-Windows-x64.zip`**

### 使用方式：
1. 解壓縮 `GarminMusicStudio-Windows-x64.zip` 至電腦任意資料夾（例如 `D:\GarminMusicStudio\`）。
2. 雙擊執行 **`GarminMusicStudio.exe`**。
3. 程式啟動後會自動開啟瀏覽器管理介面（預設為 `http://127.0.0.1:8090`），開始使用！

---

## ✨ 核心特色與功能

### 1. ⌚ Garmin 手錶原生相容與自動偵測
- **智慧磁碟偵測**：進入「手錶路徑與設定」，點擊「自動偵測」即可搜尋電腦內掛載的 Garmin 手錶或 `Music` 資料夾；亦支援手動指定目錄。
- **自動產生手錶播放清單 (`.m3u8`)**：歌曲複製到手錶後，會自動在手錶根目錄產生對應的 `.m3u8` 清單。手錶拔除 USB 後，進入手錶「音樂」選單選擇「播放清單」即可直接播放整包歌曲。
- **自訂多選播放清單**：可在手錶歌曲列表中跨目錄勾選多首喜愛曲目，一鍵建立自訂播放清單（如「馬拉松配速清單」）。

### 2. 💻 電腦音樂庫（Windows 檔案總管樹狀風格）
- **清楚的階層樹狀視圖**：採用 Windows 檔案總管經典資料夾圖示與階層延伸導引線，歌曲相對於目錄清晰縮排，不再有繁複干擾的底線。
- **目錄單層管理**：直觀管理音樂分類（如 `輕鬆跑`、`音樂`、`重訓`），支援自訂新增目錄與一鍵整目錄同步至手錶。
- **歌曲與檔案重新命名 (✏️)**：可隨時修改電腦端或手錶端的歌曲名稱，程式會自動同步更新實體 `.mp3` 檔名與 ID3 Tag 標籤，手錶螢幕即時顯示正確名稱。

### 3. 🎵 側邊欄迷你音樂播放器
- 點擊任一歌曲即可於左下角播放試聽，緊貼手錶連線狀態上方，版面精巧不遮擋。
- 具備 **時間進度條（可點擊/拖曳至特定時間）** 與完整五大控制按鍵：
  1. ⏮️ **上一首**
  2. ⏯️ **播放 / 暫停**
  3. ⏭️ **下一首**
  4. ⏩ **快轉 10 秒 (`+10s`)**
  5. ⚡ **倍速循環切換 (`1x` / `1.2x` / `1.5x`)**：快聽長篇音訊與 Podcast 更方便。

### 4. 📥 YouTube 音樂與 Podcast 快速下載
- **YouTube 專用規格轉碼**：輸入 YouTube / YouTube Music 網址，背景自動以 `yt-dlp` 及 `ffmpeg` 下載並轉碼為 Garmin 手錶最佳規格（192kbps、44.1kHz Stereo、ID3v2.3）。支援整張專輯/播放清單批次下載。
- **Podcast 單集瀏覽與下載**：內建 Apple iTunes Podcast 搜尋器，輸入節目名稱即可直接瀏覽單集並指定儲存目錄下載。

---

## 🛠️ 本機開發與手動打包說明

如果您希望自行修改原始碼或於本地進行編譯打包：

### 1. 必備環境
- Python 3.12+ (64-bit)
- Node.js 20+ 與 npm
- Git

### 2. 前端開發與建置
```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. 後端依賴安裝
```bash
pip install -r backend/requirements.txt
pip install pyinstaller yt-dlp mutagen feedparser uvicorn fastapi pydantic
```

### 4. 準備 FFmpeg 執行檔
將 Windows 版本的 `ffmpeg.exe` 與 `ffprobe.exe` 放置於根目錄下的 `bin/` 目錄：
```
bin/
├── ffmpeg.exe
└── ffprobe.exe
```

### 5. 使用 PyInstaller 打包單一執行檔
```bash
pyinstaller --clean GarminMusicStudio.spec
```
編譯完成後，免安裝執行檔將位於 `dist/GarminMusicStudio.exe`。

---

## 🤖 GitHub Actions 自動化建置發布 (CI/CD)

本分支已內建 GitHub Actions 自動化工作流程 (`.github/workflows/build-exe.yml`)：

當您建立並推送版號標籤（如 `v1.0.0`）至 GitHub 時：
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions 會自動在 Windows 虛擬環境中：
1. 編譯前端 React SPA (`npm run build`)
2. 下載官方最新版 FFmpeg 工具鏈
3. 安裝 Python 依賴並透過 PyInstaller 打包出獨立的 `GarminMusicStudio.exe`
4. 自動打包為 `GarminMusicStudio-Windows-x64.zip` 並直接發布至 GitHub Releases 供使用者下載！

您也可以在 GitHub 專案頁面的 **Actions** 頁籤中手動點擊 **「Run workflow」** 即時觸發打包。
