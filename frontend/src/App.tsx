import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, 
  Watch, 
  Loader2, 
  FolderPlus, 
  Trash2, 
  Play, 
  Pause, 
  RotateCw, 
  Search, 
  ArrowRight, 
  CheckSquare, 
  Square, 
  Mic, 
  HardDrive, 
  Music2,
  Settings,
  X
} from 'lucide-react';

interface LocalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  bitrate: number;
  size: number;
  rel_path: string;
  folder: string;
}

interface WatchTrack {
  filename: string;
  title: string;
  artist: string;
  duration: number;
  size: number;
  folder: string;
  rel_path: string;
  full_path: string;
}

interface WatchStatus {
  connected: boolean;
  active_watch?: {
    path: string;
    total_bytes: number;
    free_bytes: number;
    used_bytes: number;
    free_gb: number;
    total_gb: number;
    used_percent: number;
  };
  detected_drives: Array<{
    path: string;
    drive: string;
    label: string;
    total_bytes: number;
    free_bytes: number;
    used_bytes: number;
    is_custom: boolean;
  }>;
}

interface DownloadTask {
  status: string;
  progress: string;
  title: string;
  url?: string;
  error?: string;
}

interface PodcastSearchResult {
  id: string;
  title: string;
  artist: string;
  feedUrl: string;
  artwork?: string;
  trackCount: number;
}

interface PodcastEpisode {
  id: string;
  title: string;
  published: string;
  duration?: string;
  audio_url: string;
  summary?: string;
}

export default function App() {
  // Navigation / Sidebar
  const [activeTab, setActiveTab] = useState<'manager' | 'download_yt' | 'download_podcast' | 'settings'>('manager');

  // Watch State
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ connected: false, detected_drives: [] });
  const [watchTracks, setWatchTracks] = useState<WatchTrack[]>([]);
  const [watchPlaylists, setWatchPlaylists] = useState<string[]>([]);
  const [loadingWatch, setLoadingWatch] = useState(false);
  const [selectedWatchTracks, setSelectedWatchTracks] = useState<string[]>([]); // rel_paths
  const [watchFolderFilter, setWatchFolderFilter] = useState<string>('ALL');
  const [watchSearchQuery, setWatchSearchQuery] = useState('');

  // Local PC State
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedLocalFolder, setSelectedLocalFolder] = useState<string>('ALL');
  const [selectedLocalTracks, setSelectedLocalTracks] = useState<string[]>([]); // track_ids
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);

  // Sync / Operation Status
  const [syncingToWatch, setSyncingToWatch] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [deletingFromWatch, setDeletingFromWatch] = useState(false);

  // Player State
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Download State
  const [ytUrl, setYtUrl] = useState('');
  const [downloadFolder, setDownloadFolder] = useState('音樂');
  const [downloadTasks, setDownloadTasks] = useState<Record<string, DownloadTask>>({});
  const [isDownloading, setIsDownloading] = useState(false);

  // Podcast State
  const [podcastQuery, setPodcastQuery] = useState('');
  const [podcastResults, setPodcastResults] = useState<PodcastSearchResult[]>([]);
  const [searchingPodcast, setSearchingPodcast] = useState(false);
  const [selectedPodcast, setSelectedPodcast] = useState<PodcastSearchResult | null>(null);
  const [podcastEpisodes, setPodcastEpisodes] = useState<PodcastEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [downloadingEpUrls, setDownloadingEpUrls] = useState<string[]>([]);

  // Folder Modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Custom Path Input
  const [customPathInput, setCustomPathInput] = useState('');

  // Initial Load
  useEffect(() => {
    fetchFolders();
    fetchLocalTracks();
    fetchWatchStatus();
    const interval = setInterval(fetchDownloadTasks, 2500);
    return () => clearInterval(interval);
  }, []);

  // When watchStatus updates or connected, fetch watch tracks
  useEffect(() => {
    if (watchStatus.connected) {
      fetchWatchTracks();
    } else {
      setWatchTracks([]);
      setWatchPlaylists([]);
    }
  }, [watchStatus.connected, watchStatus.active_watch?.path]);

  // Audio Playback Handler
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setPlayingTrackId(null);
      };
      audioRef.current.onerror = () => {
        setIsPlaying(false);
        setPlayingTrackId(null);
      };
    }
  }, []);

  const handlePlayAudio = (trackId: string) => {
    if (!audioRef.current) return;
    if (playingTrackId === trackId && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.src = `/api/tracks/${trackId}/stream`;
      audioRef.current.play();
      setPlayingTrackId(trackId);
      setIsPlaying(true);
    }
  };

  // ---------------- API Calls ----------------
  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      if (res.ok) {
        const data = await res.json();
        setFolders(data);
        if (data.length > 0 && !data.includes(downloadFolder)) {
          setDownloadFolder(data[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLocalTracks = async () => {
    setLoadingLocal(true);
    try {
      const res = await fetch('/api/tracks');
      if (res.ok) {
        const data = await res.json();
        setLocalTracks(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLocal(false);
    }
  };

  const fetchWatchStatus = async () => {
    try {
      const res = await fetch('/api/watch/status');
      if (res.ok) {
        const data: WatchStatus = await res.json();
        setWatchStatus(data);
        if (data.active_watch?.path) {
          setCustomPathInput(data.active_watch.path);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWatchTracks = async () => {
    setLoadingWatch(true);
    try {
      const res = await fetch('/api/watch/tracks');
      if (res.ok) {
        const data = await res.json();
        setWatchTracks(data.tracks || []);
        setWatchPlaylists(data.playlists || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingWatch(false);
    }
  };

  const fetchDownloadTasks = async () => {
    try {
      const res = await fetch('/api/download/tasks');
      if (res.ok) {
        const data = await res.json();
        setDownloadTasks(data);
        const hasProcessing = Object.values(data).some((t: any) => t.status === 'processing' || t.status === 'queued');
        setIsDownloading(hasProcessing);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------- Sync Actions ----------------
  const handleSyncToWatch = async () => {
    if (selectedLocalTracks.length === 0) {
      alert('請先在左側勾選要複製到手錶的歌曲');
      return;
    }
    if (!watchStatus.connected) {
      alert('未偵測到手錶磁碟，請先以 USB 連接 Garmin 手錶，或在設定中指定手錶路徑');
      return;
    }

    setSyncingToWatch(true);
    setSyncMessage(`正在同步 ${selectedLocalTracks.length} 首歌曲至手錶...`);

    try {
      const res = await fetch('/api/watch/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_ids: selectedLocalTracks,
          watch_path: watchStatus.active_watch?.path
        })
      });

      if (res.ok) {
        const result = await res.json();
        setSyncMessage(`✅ 同步完成！成功複製: ${result.copied_count} 首, 略過(已存在): ${result.skipped_count} 首`);
        setSelectedLocalTracks([]);
        await fetchWatchTracks();
        await fetchWatchStatus();
      } else {
        const err = await res.json();
        setSyncMessage(`❌ 同步失敗: ${err.detail || '未知錯誤'}`);
      }
    } catch (e: any) {
      setSyncMessage(`❌ 傳輸異常: ${e.message}`);
    } finally {
      setSyncingToWatch(false);
      setTimeout(() => setSyncMessage(null), 6000);
    }
  };

  const handleDeleteFromWatch = async () => {
    if (selectedWatchTracks.length === 0) {
      alert('請先在右側勾選要從手錶刪除的歌曲');
      return;
    }

    if (!confirm(`確定要從手錶中刪除選取的 ${selectedWatchTracks.length} 首歌曲嗎？`)) {
      return;
    }

    setDeletingFromWatch(true);
    try {
      const res = await fetch('/api/watch/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rel_paths: selectedWatchTracks,
          watch_path: watchStatus.active_watch?.path
        })
      });

      if (res.ok) {
        setSelectedWatchTracks([]);
        await fetchWatchTracks();
        await fetchWatchStatus();
      } else {
        const err = await res.json();
        alert(`刪除失敗: ${err.detail || '未知錯誤'}`);
      }
    } catch (e: any) {
      alert(`刪除異常: ${e.message}`);
    } finally {
      setDeletingFromWatch(false);
    }
  };

  const handleSaveWatchPath = async () => {
    if (!customPathInput.trim()) return;
    try {
      const res = await fetch('/api/watch/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: customPathInput.trim() })
      });
      if (res.ok) {
        alert('手錶路徑設定成功！');
        await fetchWatchStatus();
      } else {
        const err = await res.json();
        alert(`設定失敗: ${err.detail}`);
      }
    } catch (e: any) {
      alert(`路徑錯誤: ${e.message}`);
    }
  };

  // ---------------- YouTube Download ----------------
  const handleStartDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) return;
    setIsDownloading(true);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: ytUrl.trim(),
          target_folder: downloadFolder,
          download_playlist: false
        })
      });
      if (res.ok) {
        setYtUrl('');
        fetchDownloadTasks();
        setTimeout(fetchLocalTracks, 3000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------- Podcast Search ----------------
  const handlePodcastSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podcastQuery.trim()) return;
    setSearchingPodcast(true);
    try {
      const res = await fetch(`/api/podcast/search?q=${encodeURIComponent(podcastQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setPodcastResults(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearchingPodcast(false);
    }
  };

  const handleSelectPodcastChannel = async (channel: PodcastSearchResult) => {
    setSelectedPodcast(channel);
    setLoadingEpisodes(true);
    try {
      const res = await fetch(`/api/podcast/episodes?feed_url=${encodeURIComponent(channel.feedUrl)}`);
      if (res.ok) {
        const data = await res.json();
        setPodcastEpisodes(data.episodes || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handleDownloadEpisode = async (ep: PodcastEpisode) => {
    setDownloadingEpUrls(prev => [...prev, ep.audio_url]);
    try {
      await fetch('/api/download/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: ep.audio_url,
          title: ep.title,
          artist: selectedPodcast?.artist || 'Podcast',
          target_folder: downloadFolder
        })
      });
      fetchDownloadTasks();
      setTimeout(fetchLocalTracks, 3000);
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------- Folder Creation ----------------
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch(`/api/folders?folder_name=${encodeURIComponent(newFolderName.trim())}`, {
        method: 'POST'
      });
      if (res.ok) {
        setNewFolderName('');
        setShowFolderModal(false);
        await fetchFolders();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Helper filters
  const filteredLocalTracks = localTracks.filter(t => {
    const matchFolder = selectedLocalFolder === 'ALL' || t.folder === selectedLocalFolder;
    const matchSearch = !localSearchQuery || 
      t.title.toLowerCase().includes(localSearchQuery.toLowerCase()) ||
      t.artist.toLowerCase().includes(localSearchQuery.toLowerCase());
    return matchFolder && matchSearch;
  });

  const filteredWatchTracks = watchTracks.filter(t => {
    const matchFolder = watchFolderFilter === 'ALL' || t.folder === watchFolderFilter;
    const matchSearch = !watchSearchQuery ||
      t.title.toLowerCase().includes(watchSearchQuery.toLowerCase()) ||
      t.artist.toLowerCase().includes(watchSearchQuery.toLowerCase());
    return matchFolder && matchSearch;
  });

  const watchFolders = Array.from(new Set(watchTracks.map(t => t.folder)));

  // Selected Size Calculation
  const selectedLocalBytes = localTracks
    .filter(t => selectedLocalTracks.includes(t.id))
    .reduce((acc, cur) => acc + cur.size, 0);

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 font-sans overflow-hidden select-none">
      
      {/* ---------------- 1. 桌面側邊導航欄 (Sidebar) ---------------- */}
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="p-5 border-b border-neutral-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-950/30">
              <Watch className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-wide text-white">Garmin Studio</h1>
              <p className="text-xs text-neutral-400">Windows Desktop Edition</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab('manager')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'manager'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-950/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>雙欄同步管理</span>
            </button>

            <button
              onClick={() => setActiveTab('download_yt')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'download_yt'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-950/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>YouTube 音樂下載</span>
            </button>

            <button
              onClick={() => setActiveTab('download_podcast')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'download_podcast'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-950/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>Podcast 節目訂閱</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'settings'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-950/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>手錶路徑與設定</span>
            </button>
          </nav>

          {/* 本地分類目錄快速清單 */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              <span>電腦分類目錄</span>
              <button 
                onClick={() => setShowFolderModal(true)}
                className="hover:text-orange-400 flex items-center gap-1 transition"
                title="新增目錄"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
              <button
                onClick={() => {
                  setSelectedLocalFolder('ALL');
                  setActiveTab('manager');
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition ${
                  selectedLocalFolder === 'ALL'
                    ? 'bg-neutral-800 text-orange-400 font-semibold'
                    : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                }`}
              >
                <span>全部歌曲</span>
                <span className="text-[11px] opacity-60">{localTracks.length}</span>
              </button>
              {folders.map(f => {
                const count = localTracks.filter(t => t.folder === f).length;
                return (
                  <button
                    key={f}
                    onClick={() => {
                      setSelectedLocalFolder(f);
                      setActiveTab('manager');
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition ${
                      selectedLocalFolder === f
                        ? 'bg-neutral-800 text-orange-400 font-semibold'
                        : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                    }`}
                  >
                    <span className="truncate pr-2">📁 {f}</span>
                    <span className="text-[11px] opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 手錶硬碟快速狀態小卡 */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${watchStatus.connected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-amber-500'}`} />
              <span className="text-xs font-medium text-neutral-300">
                {watchStatus.connected ? 'Garmin 手錶已連線' : '等待手錶 USB 連線'}
              </span>
            </div>
            <button 
              onClick={() => { fetchWatchStatus(); fetchWatchTracks(); }}
              className="text-neutral-400 hover:text-white transition p-1"
              title="重新偵測手錶"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {watchStatus.connected && watchStatus.active_watch && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span className="truncate max-w-[120px]">{watchStatus.active_watch.path}</span>
                <span>剩餘 {watchStatus.active_watch.free_gb} GB</span>
              </div>
              <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-orange-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, watchStatus.active_watch.used_percent)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- 2. 主作業內容區域 ---------------- */}
      <main className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden">
        
        {/* 頂部操作/狀態橫列 */}
        <header className="h-16 border-b border-neutral-800 px-6 flex items-center justify-between shrink-0 bg-neutral-950/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white tracking-wide">
              {activeTab === 'manager' && '雙欄音樂傳輸管理 (PC ⇄ Garmin)'}
              {activeTab === 'download_yt' && 'YouTube 音訊下載至本地電腦'}
              {activeTab === 'download_podcast' && 'Podcast 單集瀏覽與下載'}
              {activeTab === 'settings' && '手錶儲存路徑與進階設定'}
            </h2>
            {isDownloading && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                下載處理中...
              </span>
            )}
          </div>

          {/* 頂部手錶連線快捷狀態 */}
          <div className="flex items-center gap-3">
            {syncMessage && (
              <div className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-200 animate-fadeIn">
                {syncMessage}
              </div>
            )}
            
            <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-lg text-xs">
              <Watch className="w-4 h-4 text-orange-400" />
              <span className="text-neutral-300">
                {watchStatus.connected && watchStatus.active_watch
                  ? `${watchStatus.active_watch.path} (剩餘 ${watchStatus.active_watch.free_gb} GB)`
                  : '未偵測到手錶磁碟 (請插上 USB)'}
              </span>
            </div>
          </div>
        </header>

        {/* 內容區塊 */}
        <div className="flex-1 overflow-hidden p-6">
          
          {/* TAB 1: 雙欄同步管理主面板 (Dual Pane Manager) */}
          {activeTab === 'manager' && (
            <div className="grid grid-cols-[1fr,88px,1fr] gap-4 h-full">
              
              {/* === 左側欄：電腦本地音樂庫 === */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl flex flex-col overflow-hidden shadow-sm">
                
                {/* 欄位頂部工具列 */}
                <div className="p-3.5 border-b border-neutral-800 bg-neutral-900/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">💻 電腦音樂庫</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
                      {filteredLocalTracks.length} 首
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 分類下拉 */}
                    <select
                      value={selectedLocalFolder}
                      onChange={(e) => setSelectedLocalFolder(e.target.value)}
                      className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-orange-500"
                    >
                      <option value="ALL">全部目錄</option>
                      {folders.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>

                    {/* 搜尋框 */}
                    <div className="relative w-36">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-400" />
                      <input
                        type="text"
                        placeholder="搜尋歌名/歌手..."
                        value={localSearchQuery}
                        onChange={(e) => setLocalSearchQuery(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded-lg pl-8 pr-2.5 py-1.5 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 全選控制列 */}
                <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
                  <button
                    onClick={() => {
                      if (selectedLocalTracks.length === filteredLocalTracks.length) {
                        setSelectedLocalTracks([]);
                      } else {
                        setSelectedLocalTracks(filteredLocalTracks.map(t => t.id));
                      }
                    }}
                    className="flex items-center gap-2 hover:text-white transition"
                  >
                    {selectedLocalTracks.length > 0 && selectedLocalTracks.length === filteredLocalTracks.length ? (
                      <CheckSquare className="w-4 h-4 text-orange-500" />
                    ) : (
                      <Square className="w-4 h-4 text-neutral-500" />
                    )}
                    <span>全選 ({selectedLocalTracks.length}/{filteredLocalTracks.length})</span>
                  </button>

                  {selectedLocalTracks.length > 0 && (
                    <span className="text-orange-400 font-medium">
                      已選 {(selectedLocalBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                </div>

                {/* 歌曲表格列表 */}
                <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/40">
                  {loadingLocal ? (
                    <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-sm gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>載入本地歌曲中...</span>
                    </div>
                  ) : filteredLocalTracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-sm">
                      <Music2 className="w-8 h-8 stroke-1 mb-2 opacity-40" />
                      <span>尚未加入任何歌曲</span>
                      <button 
                        onClick={() => setActiveTab('download_yt')}
                        className="mt-2 text-xs text-orange-400 hover:underline"
                      >
                        前往下載 YouTube 音樂 ➔
                      </button>
                    </div>
                  ) : (
                    filteredLocalTracks.map(track => {
                      const isSelected = selectedLocalTracks.includes(track.id);
                      // 檢查手錶中是否已存在同名歌曲
                      const isSyncedOnWatch = watchTracks.some(wt => wt.filename === `${track.title}.mp3` || wt.title === track.title);

                      return (
                        <div
                          key={track.id}
                          onClick={() => {
                            setSelectedLocalTracks(prev =>
                              isSelected ? prev.filter(id => id !== track.id) : [...prev, track.id]
                            );
                          }}
                          className={`px-4 py-2.5 flex items-center justify-between text-xs hover:bg-neutral-800/50 cursor-pointer transition ${
                            isSelected ? 'bg-orange-500/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLocalTracks(prev =>
                                  isSelected ? prev.filter(id => id !== track.id) : [...prev, track.id]
                                );
                              }}
                              className="text-neutral-400 hover:text-white shrink-0"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-orange-500" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-600" />
                              )}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayAudio(track.id);
                              }}
                              className="w-6 h-6 rounded-full bg-neutral-800 hover:bg-orange-600 text-neutral-300 hover:text-white flex items-center justify-center shrink-0 transition"
                            >
                              {playingTrackId === track.id && isPlaying ? (
                                <Pause className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3 ml-0.5" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <p className={`font-medium truncate ${isSelected ? 'text-orange-300' : 'text-neutral-200'}`}>
                                {track.title}
                              </p>
                              <p className="text-[11px] text-neutral-500 truncate">
                                {track.artist} · <span className="text-neutral-400">📁 {track.folder}</span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-neutral-400 text-[11px]">
                            {isSyncedOnWatch ? (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                手錶已存
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-neutral-800 text-neutral-500">
                                未同步
                              </span>
                            )}
                            <span className="w-12 text-right">{(track.size / (1024 * 1024)).toFixed(1)} MB</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* === 中間傳輸控制軸 (Sync Control Column) === */}
              <div className="flex flex-col items-center justify-center gap-4 py-8">
                
                {/* 複製到手錶按鈕 */}
                <button
                  disabled={selectedLocalTracks.length === 0 || syncingToWatch || !watchStatus.connected}
                  onClick={handleSyncToWatch}
                  className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 shadow-xl transition-all ${
                    selectedLocalTracks.length > 0 && watchStatus.connected && !syncingToWatch
                      ? 'bg-gradient-to-br from-orange-500 to-amber-600 hover:scale-105 active:scale-95 text-white shadow-orange-950/50 cursor-pointer'
                      : 'bg-neutral-800 text-neutral-600 cursor-not-allowed opacity-50'
                  }`}
                  title="將選取歌曲複製到手錶"
                >
                  {syncingToWatch ? (
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                  ) : (
                    <>
                      <ArrowRight className="w-5 h-5" />
                      <span className="text-[10px] font-bold tracking-tight">複製 ➔</span>
                    </>
                  )}
                </button>

                {/* 從手錶移除按鈕 */}
                <button
                  disabled={selectedWatchTracks.length === 0 || deletingFromWatch || !watchStatus.connected}
                  onClick={handleDeleteFromWatch}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                    selectedWatchTracks.length > 0 && watchStatus.connected && !deletingFromWatch
                      ? 'bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 cursor-pointer active:scale-95'
                      : 'bg-neutral-900 text-neutral-700 border border-neutral-800 cursor-not-allowed opacity-40'
                  }`}
                  title="從手錶移除選取歌曲"
                >
                  {deletingFromWatch ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>

                <div className="text-center text-[10px] text-neutral-500 px-1">
                  <span>USB 高速寫入</span>
                  <br />
                  <span>自動建清單</span>
                </div>
              </div>

              {/* === 右側欄：手錶儲存庫 (Garmin Watch Pane) === */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl flex flex-col overflow-hidden shadow-sm">
                
                {/* 欄位頂部工具列 */}
                <div className="p-3.5 border-b border-neutral-800 bg-neutral-900/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">⌚ Garmin 手錶音樂庫</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
                      {filteredWatchTracks.length} 首
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 分類下拉 */}
                    <select
                      value={watchFolderFilter}
                      onChange={(e) => setWatchFolderFilter(e.target.value)}
                      className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-orange-500"
                    >
                      <option value="ALL">全部手錶目錄</option>
                      {watchFolders.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>

                    {/* 搜尋框 */}
                    <div className="relative w-36">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-400" />
                      <input
                        type="text"
                        placeholder="搜尋手錶歌曲..."
                        value={watchSearchQuery}
                        onChange={(e) => setWatchSearchQuery(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded-lg pl-8 pr-2.5 py-1.5 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 全選控制列 */}
                <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
                  <button
                    disabled={!watchStatus.connected}
                    onClick={() => {
                      if (selectedWatchTracks.length === filteredWatchTracks.length) {
                        setSelectedWatchTracks([]);
                      } else {
                        setSelectedWatchTracks(filteredWatchTracks.map(t => t.rel_path));
                      }
                    }}
                    className="flex items-center gap-2 hover:text-white transition disabled:opacity-40"
                  >
                    {selectedWatchTracks.length > 0 && selectedWatchTracks.length === filteredWatchTracks.length ? (
                      <CheckSquare className="w-4 h-4 text-orange-500" />
                    ) : (
                      <Square className="w-4 h-4 text-neutral-500" />
                    )}
                    <span>全選 ({selectedWatchTracks.length}/{filteredWatchTracks.length})</span>
                  </button>

                  <div className="flex items-center gap-3">
                    {watchPlaylists.length > 0 && (
                      <span className="text-[11px] text-neutral-500">
                        {watchPlaylists.length} 個手錶播放清單 (.m3u8)
                      </span>
                    )}
                    <button
                      onClick={fetchWatchTracks}
                      className="hover:text-white transition flex items-center gap-1 text-[11px]"
                      title="重新整理手錶清單"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>重新整理</span>
                    </button>
                  </div>
                </div>

                {/* 手錶歌曲列表 */}
                <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/40">
                  {!watchStatus.connected ? (
                    <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-sm gap-2">
                      <Watch className="w-10 h-10 stroke-1 text-amber-500/60 mb-1" />
                      <span className="font-medium text-neutral-300">尚未連接 Garmin 手錶</span>
                      <span className="text-xs text-neutral-500 max-w-xs text-center">
                        請以 USB 傳輸線連接手錶至電腦，或於左側設定指定手錶的 Music 資料夾路徑。
                      </span>
                    </div>
                  ) : loadingWatch ? (
                    <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-sm gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>掃描手錶歌曲中...</span>
                    </div>
                  ) : filteredWatchTracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-sm">
                      <Music2 className="w-8 h-8 stroke-1 mb-2 opacity-40" />
                      <span>手錶內目前沒有歌曲</span>
                      <span className="text-xs text-neutral-600 mt-1">從左側選取歌曲並點擊「複製 ➔」</span>
                    </div>
                  ) : (
                    filteredWatchTracks.map(track => {
                      const isSelected = selectedWatchTracks.includes(track.rel_path);

                      return (
                        <div
                          key={track.rel_path}
                          onClick={() => {
                            setSelectedWatchTracks(prev =>
                              isSelected ? prev.filter(p => p !== track.rel_path) : [...prev, track.rel_path]
                            );
                          }}
                          className={`px-4 py-2.5 flex items-center justify-between text-xs hover:bg-neutral-800/50 cursor-pointer transition ${
                            isSelected ? 'bg-orange-500/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedWatchTracks(prev =>
                                  isSelected ? prev.filter(p => p !== track.rel_path) : [...prev, track.rel_path]
                                );
                              }}
                              className="text-neutral-400 hover:text-white shrink-0"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-orange-500" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-600" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <p className={`font-medium truncate ${isSelected ? 'text-orange-300' : 'text-neutral-200'}`}>
                                {track.title}
                              </p>
                              <p className="text-[11px] text-neutral-500 truncate">
                                {track.artist} · <span className="text-neutral-400">📁 {track.folder}</span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-neutral-400 text-[11px]">
                            <span>{(track.size / (1024 * 1024)).toFixed(1)} MB</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: YouTube 下載 (Desktop Layout) */}
          {activeTab === 'download_yt' && (
            <div className="max-w-4xl mx-auto h-full flex flex-col">
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-sm mb-6">
                <h3 className="text-base font-bold text-white mb-2">下載 YouTube 音訊至電腦</h3>
                <p className="text-xs text-neutral-400 mb-5">
                  自動轉碼為 Garmin 手錶專用規格（192kbps、44.1kHz Stereo、ID3v2.3 標籤），保證手錶硬體即時播放。
                </p>

                <form onSubmit={handleStartDownload} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                      YouTube 影片或音樂網址
                    </label>
                    <input
                      type="text"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                        儲存目錄分類
                      </label>
                      <select
                        value={downloadFolder}
                        onChange={(e) => setDownloadFolder(e.target.value)}
                        className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 text-sm rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-orange-500"
                      >
                        {folders.map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-6">
                      <button
                        type="submit"
                        disabled={!ytUrl.trim() || isDownloading}
                        className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
                      >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span>開始下載與轉碼</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* 下載任務進度列表 */}
              <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl p-5 overflow-y-auto">
                <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">
                  下載任務狀態
                </h4>
                {Object.keys(downloadTasks).length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-8">目前無下載中或近期的任務</p>
                ) : (
                  <div className="space-y-2.5">
                    {Object.entries(downloadTasks).map(([tid, task]) => (
                      <div key={tid} className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-4">
                          <p className="font-medium text-neutral-200 truncate">{task.title}</p>
                          <p className="text-[11px] text-neutral-400 mt-0.5">{task.progress}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                          task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          task.status === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Podcast 下載 */}
          {activeTab === 'download_podcast' && (
            <div className="h-full flex flex-col gap-5 max-w-5xl mx-auto">
              {/* 搜尋列 */}
              <form onSubmit={handlePodcastSearch} className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="搜尋 Podcast 節目名稱（例如：股癌、百靈果、科技島讀...）"
                    value={podcastQuery}
                    onChange={(e) => setPodcastQuery(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searchingPodcast || !podcastQuery.trim()}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition flex items-center gap-2"
                >
                  {searchingPodcast ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span>搜尋</span>
                </button>
              </form>

              {/* Podcast 內容雙欄：左頻道、右單集 */}
              <div className="flex-1 grid grid-cols-3 gap-5 overflow-hidden">
                {/* 頻道列表 */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 overflow-y-auto space-y-2">
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">搜尋結果</h4>
                  {podcastResults.length === 0 ? (
                    <p className="text-xs text-neutral-500 text-center py-10">請輸入節目名稱搜尋</p>
                  ) : (
                    podcastResults.map(p => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPodcastChannel(p)}
                        className={`p-3 rounded-lg border cursor-pointer transition flex items-center gap-3 ${
                          selectedPodcast?.id === p.id 
                            ? 'bg-orange-500/10 border-orange-500/30' 
                            : 'bg-neutral-950 border-neutral-800/80 hover:border-neutral-700'
                        }`}
                      >
                        {p.artwork && (
                          <img src={p.artwork} alt={p.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-neutral-200 truncate">{p.title}</p>
                          <p className="text-[11px] text-neutral-500 truncate">{p.artist}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 單集列表 */}
                <div className="col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-4 overflow-y-auto flex flex-col">
                  <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
                    {selectedPodcast ? `${selectedPodcast.title} - 最新單集` : '單集清單'}
                  </h4>

                  {loadingEpisodes ? (
                    <div className="flex flex-col items-center justify-center flex-1 text-neutral-500 text-sm gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>載入單集中...</span>
                    </div>
                  ) : podcastEpisodes.length === 0 ? (
                    <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
                      請在左側點選一個 Podcast 節目查看單集
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {podcastEpisodes.map(ep => {
                        const isDownloadingEp = downloadingEpUrls.includes(ep.audio_url);
                        return (
                          <div key={ep.id} className="p-3.5 bg-neutral-950 border border-neutral-800/80 rounded-lg flex items-center justify-between gap-4 text-xs">
                            <div className="min-w-0">
                              <p className="font-medium text-neutral-200 line-clamp-1">{ep.title}</p>
                              <p className="text-[11px] text-neutral-500 mt-0.5">發布: {ep.published.slice(0, 16)}</p>
                            </div>
                            <button
                              disabled={isDownloadingEp}
                              onClick={() => handleDownloadEpisode(ep)}
                              className="px-3 py-1.5 bg-neutral-800 hover:bg-orange-600 disabled:opacity-50 text-neutral-200 hover:text-white rounded-lg text-xs flex items-center gap-1.5 shrink-0 transition"
                            >
                              {isDownloadingEp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                              <span>{isDownloadingEp ? '下載中' : '下載到電腦'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: 設定手錶磁碟與路徑 */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto h-full flex flex-col justify-start">
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-6">
                <div>
                  <h3 className="text-base font-bold text-white mb-1">手錶音樂磁碟路徑設定</h3>
                  <p className="text-xs text-neutral-400">
                    系統會自動偵測插入的 Garmin 手錶。若手錶掛載在特殊代號或自訂目錄，可在下方直接輸入手動指定。
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-medium text-neutral-300">
                    手錶 Music 資料夾路徑
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="例如 E:\GARMIN\Music 或 F:\Music"
                      value={customPathInput}
                      onChange={(e) => setCustomPathInput(e.target.value)}
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 font-mono"
                    />
                    <button
                      onClick={handleSaveWatchPath}
                      className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium transition"
                    >
                      儲存設定
                    </button>
                  </div>
                </div>

                {/* 偵測到的候選磁碟機 */}
                <div className="pt-2 border-t border-neutral-800">
                  <h4 className="text-xs font-semibold text-neutral-300 mb-2">自動掃描到的候選磁碟：</h4>
                  {watchStatus.detected_drives.length === 0 ? (
                    <p className="text-xs text-neutral-500">目前未掃描到包含 Music 的抽取式磁碟槽</p>
                  ) : (
                    <div className="space-y-2">
                      {watchStatus.detected_drives.map(d => (
                        <div key={d.path} className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-neutral-200">{d.label}</p>
                            <p className="text-neutral-500 font-mono text-[11px]">{d.path}</p>
                          </div>
                          <button
                            onClick={() => {
                              setCustomPathInput(d.path);
                              handleSaveWatchPath();
                            }}
                            className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition"
                          >
                            套用此磁碟
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 手錶規格提醒 */}
                <div className="p-4 bg-orange-950/20 border border-orange-800/30 rounded-lg text-xs space-y-1.5 text-neutral-300">
                  <p className="font-semibold text-orange-400">💡 Garmin 原生手錶播放提醒：</p>
                  <p>1. 本程式複製歌曲至手錶時，會自動在手錶建立以目錄為名的 <code className="text-orange-300">.m3u8</code> 播放清單。</p>
                  <p>2. 傳輸完畢拔除 USB 線後，手錶音樂選單點選 <strong>「播放清單 (Playlists)」</strong> 即可看到該目錄的一整包歌曲。</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* 新增目錄彈窗 */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">新增電腦音樂分類目錄</h3>
              <button onClick={() => setShowFolderModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                placeholder="例如：重訓音樂、輕鬆跑、Podcast..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-1.5 bg-neutral-800 text-neutral-300 rounded-lg text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
                >
                  建立目錄
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
