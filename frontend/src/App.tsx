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
  X,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileMusic,
  ListMusic,
  Edit2,
  SkipBack,
  SkipForward,
  FastForward,
  FolderSearch
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Download State
  const [ytUrl, setYtUrl] = useState('');
  const [downloadFolder, setDownloadFolder] = useState('音樂');
  const [downloadPlaylist, setDownloadPlaylist] = useState(false);
  const [downloadTasks, setDownloadTasks] = useState<Record<string, DownloadTask>>({});
  const [isDownloading, setIsDownloading] = useState(false);

  // Tree View Collapse State (folder name -> isCollapsed)
  const [collapsedLocalFolders, setCollapsedLocalFolders] = useState<Record<string, boolean>>({});
  const [collapsedWatchFolders, setCollapsedWatchFolders] = useState<Record<string, boolean>>({});

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

  // Watch Custom Playlist Modal
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [customPlaylistName, setCustomPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  // Rename Modal State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ idOrRelPath: string; currentTitle: string; isWatch: boolean } | null>(null);
  const [newTitleInput, setNewTitleInput] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Custom Path Input & Disk Browser Modal State
  const [customPathInput, setCustomPathInput] = useState('');
  const [showDiskBrowserModal, setShowDiskBrowserModal] = useState(false);
  const [availableDrives, setAvailableDrives] = useState<{ path: string; label: string; is_mtp?: boolean }[]>([]);
  const [currentBrowserPath, setCurrentBrowserPath] = useState('');
  const [parentBrowserPath, setParentBrowserPath] = useState<string | null>(null);
  const [browserSubfolders, setBrowserSubfolders] = useState<{ name: string; path: string }[]>([]);
  const [loadingBrowser, setLoadingBrowser] = useState(false);

  // Initial Load & Heartbeat
  useEffect(() => {
    fetchFolders();
    fetchLocalTracks();
    fetchWatchStatus();
    const interval = setInterval(fetchDownloadTasks, 2500);

    // 每 3 秒發送一次心跳給後端，保持伺服器運行
    const sendHeartbeat = () => {
      fetch('/api/system/heartbeat', { method: 'POST' }).catch(() => {});
    };
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 3000);

    // 當分頁/視窗從背景切換回前景時，立刻發送心跳並刷新下載任務
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        sendHeartbeat();
        fetchDownloadTasks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 視窗關閉時通知後端安全退出（若有下載任務進行中，後端會自動忽略並繼續完成）
    const handlePageHide = () => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/system/shutdown');
      }
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      clearInterval(interval);
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
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
    }
    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      handlePlayNext();
    };
    const handleError = () => {
      setIsPlaying(false);
      setPlayingTrackId(null);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [localTracks, playingTrackId]);

  const handlePlayAudio = (trackId: string) => {
    if (!audioRef.current) return;
    if (playingTrackId === trackId && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (playingTrackId === trackId && !isPlaying) {
      audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.src = `/api/tracks/${trackId}/stream`;
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.play().catch(console.error);
      setPlayingTrackId(trackId);
      setIsPlaying(true);
    }
  };

  const handleTogglePlayPause = () => {
    if (!audioRef.current || !playingTrackId) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handlePlayPrev = () => {
    if (!playingTrackId || filteredLocalTracks.length === 0) return;
    const currentIndex = filteredLocalTracks.findIndex(t => t.id === playingTrackId);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredLocalTracks.length - 1;
    const prevTrack = filteredLocalTracks[prevIndex];
    if (prevTrack) {
      handlePlayAudio(prevTrack.id);
    }
  };

  const handlePlayNext = () => {
    if (!playingTrackId || filteredLocalTracks.length === 0) return;
    const currentIndex = filteredLocalTracks.findIndex(t => t.id === playingTrackId);
    const nextIndex = (currentIndex + 1) % filteredLocalTracks.length;
    const nextTrack = filteredLocalTracks[nextIndex];
    if (nextTrack) {
      handlePlayAudio(nextTrack.id);
    }
  };

  const handleSeek = (newTime: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleForward10 = () => {
    if (!audioRef.current) return;
    const target = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 10);
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleCycleSpeed = () => {
    const speeds = [1, 1.2, 1.5];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackRate(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
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

        // 自動清除已完成或失敗單集的下載中狀態
        setDownloadingEpUrls(prev => {
          if (prev.length === 0) return prev;
          const remaining = prev.filter(epUrl => {
            const task = (Object.values(data) as any[]).find((t: any) => t.url === epUrl);
            if (!task) return true; // 尚未建立任務
            return task.status === 'processing' || task.status === 'queued';
          });
          return remaining.length === prev.length ? prev : remaining;
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------- Sync Actions ----------------
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

  const handleOpenFolderModal = async () => {
    setShowDiskBrowserModal(true);
    setLoadingBrowser(true);
    try {
      const res = await fetch('/api/system/drives');
      if (res.ok) {
        const data = await res.json();
        const drives = data.drives || [];
        setAvailableDrives(drives);
        // 若當前有路徑且有效，直接載入該路徑；否則預設載入第一個磁碟槽或 C:\
        const initPath = customPathInput.trim() || (drives[0]?.path ?? 'C:\\');
        await loadBrowserPath(initPath);
      } else {
        const err = await res.json().catch(() => ({ detail: '無法取得磁碟列表' }));
        alert(`讀取磁碟槽失敗: ${err.detail || res.statusText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`載入磁碟機失敗: ${e.message}`);
    } finally {
      setLoadingBrowser(false);
    }
  };

  const loadBrowserPath = async (targetPath: string) => {
    if (!targetPath) return;
    setLoadingBrowser(true);
    try {
      const res = await fetch(`/api/system/folders?path=${encodeURIComponent(targetPath)}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentBrowserPath(data.current_path);
        setParentBrowserPath(data.parent_path);
        setBrowserSubfolders(data.subfolders || []);
      } else {
        const err = await res.json().catch(() => ({ detail: '無法存取該目錄' }));
        alert(`無法存取該目錄: ${err.detail || '權限不足或路徑不存在'}`);
      }
    } catch (e: any) {
      alert(`讀取目錄失敗: ${e.message}`);
    } finally {
      setLoadingBrowser(false);
    }
  };

  const handleSelectFolderModal = async (path: string) => {
    setCustomPathInput(path);
    setShowDiskBrowserModal(false);
    try {
      await fetch('/api/watch/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      await fetchWatchStatus();
      alert(`已成功選擇手錶目錄：${path}`);
    } catch (e: any) {
      alert(`套用失敗: ${e.message}`);
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
          download_playlist: downloadPlaylist
        })
      });
      if (res.ok) {
        setYtUrl('');
        fetchDownloadTasks();
        setTimeout(fetchLocalTracks, 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`下載任務建立失敗: ${err.detail || res.statusText}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`下載連線失敗: ${e.message || '請確認後端服務是否正常'}`);
    } finally {
      setIsDownloading(false);
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
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      alert('目錄名稱僅限一層，不可包含路徑斜線 (/) 或 (\\)');
      return;
    }
    try {
      const res = await fetch(`/api/folders?folder_name=${encodeURIComponent(trimmed)}`, {
        method: 'POST'
      });
      if (res.ok) {
        setNewFolderName('');
        setShowFolderModal(false);
        await fetchFolders();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || '建立目錄失敗');
      }
    } catch (e: any) {
      alert(`連線失敗: ${e.message}`);
    }
  };

  const handleCreateWatchPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customPlaylistName.trim();
    if (!trimmed) return;
    if (selectedWatchTracks.length === 0) {
      alert('請先在手錶列表中勾選歌曲');
      return;
    }

    setCreatingPlaylist(true);
    try {
      const res = await fetch('/api/watch/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          rel_paths: selectedWatchTracks,
          watch_path: watchStatus.active_watch?.path
        })
      });
      if (res.ok) {
        setCustomPlaylistName('');
        setShowPlaylistModal(false);
        setSyncMessage(`✅ 成功建立手錶播放清單：${trimmed}.m3u8（含 ${selectedWatchTracks.length} 首歌曲）`);
        await fetchWatchTracks();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || '建立播放清單失敗');
      }
    } catch (e: any) {
      alert(`連線失敗: ${e.message}`);
    } finally {
      setCreatingPlaylist(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };
  const handleRefreshLocal = async () => {
    setLoadingLocal(true);
    try {
      await fetch('/api/scan', { method: 'POST' }).catch(() => {});
      await fetchFolders();
      await fetchLocalTracks();
    } finally {
      setLoadingLocal(false);
    }
  };

  // ---------------- Rename Track ----------------
  const handleOpenRename = (idOrRelPath: string, currentTitle: string, isWatch: boolean) => {
    setRenameTarget({ idOrRelPath, currentTitle, isWatch });
    setNewTitleInput(currentTitle);
    setShowRenameModal(true);
  };

  const handleSubmitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !newTitleInput.trim()) return;
    const trimmed = newTitleInput.trim();

    setRenaming(true);
    try {
      if (renameTarget.isWatch) {
        // 手錶重新命名
        const res = await fetch('/api/watch/tracks/rename', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rel_path: renameTarget.idOrRelPath,
            new_title: trimmed,
            watch_path: watchStatus.active_watch?.path
          })
        });
        if (res.ok) {
          setShowRenameModal(false);
          await fetchWatchTracks();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.detail || '重新命名失敗');
        }
      } else {
        // 電腦本地重新命名
        const res = await fetch(`/api/tracks/${renameTarget.idOrRelPath}/rename`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_title: trimmed })
        });
        if (res.ok) {
          setShowRenameModal(false);
          await fetchLocalTracks();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.detail || '重新命名失敗');
        }
      }
    } catch (e: any) {
      alert(`操作異常: ${e.message}`);
    } finally {
      setRenaming(false);
    }
  };

  // ---------------- Batch / Single Track Delete ----------------
  const handleDeleteLocalTracks = async (trackIds: string[]) => {
    if (trackIds.length === 0) return;
    const confirmText = trackIds.length === 1 
      ? '確定要從電腦刪除這首歌曲嗎？' 
      : `確定要從電腦刪除選取的 ${trackIds.length} 首歌曲嗎？`;
    if (!confirm(confirmText)) return;

    try {
      const res = await fetch('/api/tracks/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: trackIds })
      });
      if (res.ok) {
        setSelectedLocalTracks(prev => prev.filter(id => !trackIds.includes(id)));
        if (playingTrackId && trackIds.includes(playingTrackId)) {
          audioRef.current?.pause();
          setIsPlaying(false);
          setPlayingTrackId(null);
        }
        await fetchLocalTracks();
      } else {
        alert('刪除失敗');
      }
    } catch (e: any) {
      alert(`刪除異常: ${e.message}`);
    }
  };

  const handleSyncSpecificTracksToWatch = async (trackIds: string[]) => {
    if (trackIds.length === 0) return;
    if (!watchStatus.connected) {
      alert('未偵測到手錶磁碟，請先以 USB 連接 Garmin 手錶，或在設定中指定手錶路徑');
      return;
    }

    setSyncingToWatch(true);
    setSyncMessage(`正在同步 ${trackIds.length} 首歌曲至手錶...`);

    try {
      const res = await fetch('/api/watch/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track_ids: trackIds,
          watch_path: watchStatus.active_watch?.path
        })
      });

      if (res.ok) {
        const result = await res.json();
        setSyncMessage(`✅ 同步完成！成功複製: ${result.copied_count} 首, 略過(已存在): ${result.skipped_count} 首`);
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

  const handleDeleteSpecificWatchTracks = async (relPaths: string[]) => {
    if (relPaths.length === 0) return;
    const confirmText = relPaths.length === 1
      ? '確定要從手錶中刪除這首歌曲嗎？'
      : `確定要從手錶中刪除選取的 ${relPaths.length} 首歌曲嗎？`;
    if (!confirm(confirmText)) return;

    setDeletingFromWatch(true);
    try {
      const res = await fetch('/api/watch/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rel_paths: relPaths,
          watch_path: watchStatus.active_watch?.path
        })
      });

      if (res.ok) {
        setSelectedWatchTracks(prev => prev.filter(p => !relPaths.includes(p)));
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
      <aside className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col justify-between shrink-0 overflow-hidden">
        {/* 上半部：Logo、選單、分類目錄 */}
        <div className="flex-1 overflow-y-auto min-h-0">
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
              <span>手錶同步管理</span>
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
              <span>Podcast 下載</span>
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
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={handleRefreshLocal}
                  disabled={loadingLocal}
                  className="hover:text-orange-400 flex items-center transition p-0.5"
                  title="重新整理電腦音樂庫"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${loadingLocal ? 'animate-spin text-orange-400' : ''}`} />
                </button>
                <button 
                  onClick={() => setShowFolderModal(true)}
                  className="hover:text-orange-400 flex items-center transition p-0.5"
                  title="新增目錄"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
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

        {/* 下半部固定區：播放器資訊緊貼於 Garmin 手錶連線狀態上方 */}
        <div className="shrink-0 flex flex-col justify-end">
          {/* 播放器資訊小卡 (歌曲播放中或已選曲時顯示於 Garmin 手錶狀態正上方) */}
          {playingTrackId && (() => {
            const activeTrack = localTracks.find(t => t.id === playingTrackId);
            if (!activeTrack) return null;

            return (
              <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur space-y-2.5 animate-fadeIn">
                {/* 曲目資訊 */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center shrink-0">
                    <Music2 className={`w-4 h-4 text-orange-400 ${isPlaying ? 'animate-pulse' : ''}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate" title={activeTrack.title}>
                      {activeTrack.title}
                    </p>
                    <p className="text-[10px] text-neutral-400 truncate">
                      {activeTrack.artist || 'Unknown Artist'}
                    </p>
                  </div>
                </div>

                {/* 時間滑桿 (進度條) */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    step="0.5"
                    value={currentTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                {/* 5 個操作控制按鍵 */}
                <div className="flex items-center justify-between pt-0.5">
                  {/* 1. 前一首 */}
                  <button
                    onClick={handlePlayPrev}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                    title="上一首"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  {/* 2. 暫停 / 播放 */}
                  <button
                    onClick={handleTogglePlayPause}
                    className="w-8 h-8 rounded-full bg-orange-600 hover:bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-950/40 transition"
                    title={isPlaying ? "暫停" : "播放"}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>

                  {/* 3. 下一首 */}
                  <button
                    onClick={handlePlayNext}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
                    title="下一首"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>

                  {/* 4. 前進 10 秒 */}
                  <button
                    onClick={handleForward10}
                    className="px-1.5 py-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition flex items-center gap-0.5"
                    title="快轉 10 秒"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-mono">+10s</span>
                  </button>

                  {/* 5. 循環倍速 (1x, 1.2x, 1.5x) */}
                  <button
                    onClick={handleCycleSpeed}
                    className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-orange-400 hover:text-orange-300 font-mono text-[11px] font-bold border border-neutral-700 transition"
                    title="切換播放速度 (1x / 1.2x / 1.5x)"
                  >
                    {playbackRate}x
                  </button>
                </div>
              </div>
            );
          })()}

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
      </div>
      </aside>

      {/* ---------------- 2. 主作業內容區域 ---------------- */}
      <main className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden">
        
        {/* 頂部操作/狀態橫列 */}
        <header className="h-16 border-b border-neutral-800 px-6 flex items-center justify-between shrink-0 bg-neutral-950/80 backdrop-blur">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white tracking-wide">
              {activeTab === 'manager' && '手錶音樂同步管理 (Garmin Music)'}
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
          
          {/* TAB 1: 音樂同步管理 (電腦上層、手錶下層) */}
          {activeTab === 'manager' && (
            <div className="flex flex-col gap-5 h-full overflow-hidden">
              
              {/* === 上方欄：電腦本地音樂庫 === */}
              <div className="flex-1 min-h-0 bg-neutral-900/60 border border-neutral-800 rounded-xl flex flex-col overflow-hidden shadow-sm">
                
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

                    {/* 重新整理電腦曲庫按鈕 */}
                    <button
                      onClick={handleRefreshLocal}
                      className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition"
                      title="重新整理電腦音樂庫"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    {/* 新增目錄按鈕 */}
                    <button
                      onClick={() => setShowFolderModal(true)}
                      className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition text-xs flex items-center gap-1"
                      title="新增音樂分類目錄"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-orange-400" />
                      <span>新增目錄</span>
                    </button>
                  </div>
                </div>

                {/* 全選與多選操作工具列 */}
                <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
                  <div className="flex items-center gap-3">
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

                  {/* 多選批量操作按鍵 */}
                  {selectedLocalTracks.length > 0 && (
                    <div className="flex items-center gap-2 animate-fadeIn">
                      <button
                        disabled={syncingToWatch || !watchStatus.connected}
                        onClick={() => handleSyncSpecificTracksToWatch(selectedLocalTracks)}
                        className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
                        title="將選取歌曲全部複製到手錶"
                      >
                        {syncingToWatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        <span>複製到手錶 ({selectedLocalTracks.length})</span>
                      </button>
                      <button
                        onClick={() => handleDeleteLocalTracks(selectedLocalTracks)}
                        className="px-2.5 py-1 bg-red-500/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition"
                        title="將選取歌曲從電腦刪除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>刪除 ({selectedLocalTracks.length})</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 電腦歌曲樹狀選單列表 (僅一層目錄展開/縮合) */}
                <div className="flex-1 overflow-y-auto">
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
                    // 分組顯示樹狀選單
                    (() => {
                      const groups: Record<string, LocalTrack[]> = {};
                      filteredLocalTracks.forEach(t => {
                        const folder = t.folder || '音樂';
                        if (!groups[folder]) groups[folder] = [];
                        groups[folder].push(t);
                      });

                      return Object.entries(groups).map(([folderName, folderTracks]) => {
                        const isCollapsed = !!collapsedLocalFolders[folderName];
                        const folderTrackIds = folderTracks.map(t => t.id);
                        const isFolderAllSelected = folderTrackIds.length > 0 && folderTrackIds.every(id => selectedLocalTracks.includes(id));

                        return (
                          <div key={folderName} className="border-b border-neutral-800/50 last:border-b-0">
                            {/* Windows 檔案總管風格 - 目錄資料夾節點 */}
                            <div 
                              onClick={() => setCollapsedLocalFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }))}
                              className="px-2 py-1.5 hover:bg-neutral-800/60 rounded flex items-center justify-between cursor-pointer transition select-none group"
                            >
                              <div className="flex items-center gap-1.5">
                                {/* 展開/縮合箭頭 */}
                                <span className="p-0.5 text-neutral-400 hover:text-white">
                                  {isCollapsed ? (
                                    <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-neutral-300" />
                                  )}
                                </span>

                                {/* 目錄全選勾選框 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isFolderAllSelected) {
                                      setSelectedLocalTracks(prev => prev.filter(id => !folderTrackIds.includes(id)));
                                    } else {
                                      setSelectedLocalTracks(prev => Array.from(new Set([...prev, ...folderTrackIds])));
                                    }
                                  }}
                                  className="text-neutral-400 hover:text-white p-0.5"
                                  title="勾選整目錄歌曲"
                                >
                                  {isFolderAllSelected ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-orange-500" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-neutral-600" />
                                  )}
                                </button>

                                {/* 經典黃色檔案總管資料夾圖示 */}
                                {isCollapsed ? (
                                  <Folder className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                                ) : (
                                  <FolderOpen className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                                )}

                                <span className="font-medium text-xs text-neutral-200">{folderName}</span>
                                <span className="text-[11px] text-neutral-500">({folderTracks.length})</span>
                              </div>

                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                                <span className="text-[10px] text-neutral-500">
                                  {isCollapsed ? '展開' : '收合'}
                                </span>
                              </div>
                            </div>

                            {/* 目錄下的歌曲清單 (縮合時隱藏) - 清楚縮排 + 樹狀延伸導引線 */}
                            {!isCollapsed && (
                              <div className="ml-5 pl-4 border-l border-neutral-800 space-y-0.5 my-0.5">
                                {folderTracks.map(track => {
                                  const isSelected = selectedLocalTracks.includes(track.id);
                                  const isSyncedOnWatch = watchTracks.some(wt => wt.filename === `${track.title}.mp3` || wt.title === track.title);

                                  return (
                                    <div
                                      key={track.id}
                                      onClick={() => {
                                        setSelectedLocalTracks(prev =>
                                          isSelected ? prev.filter(id => id !== track.id) : [...prev, track.id]
                                        );
                                      }}
                                      className={`px-2 py-1.5 rounded flex items-center justify-between text-xs hover:bg-neutral-800/50 cursor-pointer transition select-none group ${
                                        isSelected ? 'bg-orange-500/10 text-orange-200' : 'text-neutral-300'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 pr-3">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedLocalTracks(prev =>
                                              isSelected ? prev.filter(id => id !== track.id) : [...prev, track.id]
                                            );
                                          }}
                                          className="text-neutral-400 hover:text-white shrink-0 p-0.5"
                                        >
                                          {isSelected ? (
                                            <CheckSquare className="w-3.5 h-3.5 text-orange-500" />
                                          ) : (
                                            <Square className="w-3.5 h-3.5 text-neutral-600" />
                                          )}
                                        </button>

                                        {/* 音訊檔案圖示 */}
                                        <FileMusic className="w-3.5 h-3.5 text-neutral-400 shrink-0" />

                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handlePlayAudio(track.id);
                                          }}
                                          className="w-5 h-5 rounded bg-neutral-800/80 hover:bg-orange-600 text-neutral-300 hover:text-white flex items-center justify-center shrink-0 transition"
                                          title={playingTrackId === track.id && isPlaying ? "暫停" : "試聽"}
                                        >
                                          {playingTrackId === track.id && isPlaying ? (
                                            <Pause className="w-2.5 h-2.5" />
                                          ) : (
                                            <Play className="w-2.5 h-2.5 ml-0.5" />
                                          )}
                                        </button>

                                        <div className="min-w-0 flex items-center gap-2">
                                          <span className={`font-medium truncate ${isSelected ? 'text-orange-300' : 'text-neutral-200'}`}>
                                            {track.title}
                                          </span>
                                          {track.artist && track.artist !== 'Unknown Artist' && (
                                            <span className="text-[11px] text-neutral-500 truncate hidden sm:inline">
                                              - {track.artist}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* 單曲獨立操作按鈕：複製到手錶 / 編輯 / 刪除 */}
                                      <div className="flex items-center gap-2.5 shrink-0 text-neutral-400 text-[11px]">
                                        {isSyncedOnWatch ? (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            手錶已存
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-800/80 text-neutral-500">
                                            未同步
                                          </span>
                                        )}
                                        <span className="w-14 text-right font-mono text-[11px] text-neutral-500">
                                          {(track.size / (1024 * 1024)).toFixed(1)} MB
                                        </span>

                                        <div className="flex items-center gap-1 pl-1">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenRename(track.id, track.title, false);
                                            }}
                                            className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
                                            title="編輯歌名/檔案名稱"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleSyncSpecificTracksToWatch([track.id]);
                                            }}
                                            disabled={syncingToWatch || !watchStatus.connected}
                                            className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-orange-600 text-neutral-300 hover:text-white disabled:opacity-40 transition text-[10px] flex items-center gap-1"
                                            title="單曲複製到手錶"
                                          >
                                            <ArrowRight className="w-3 h-3" />
                                            <span>複製</span>
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteLocalTracks([track.id]);
                                            }}
                                            className="p-1 rounded hover:bg-red-600/80 text-neutral-400 hover:text-white transition"
                                            title="從電腦刪除"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()
                  )}
                </div>
              </div>

              {/* === 下方欄：手錶儲存庫 (Garmin Watch Pane) === */}
              <div className="flex-1 min-h-0 bg-neutral-900/60 border border-neutral-800 rounded-xl flex flex-col overflow-hidden shadow-sm">
                
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

                    <button
                      onClick={fetchWatchTracks}
                      className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition"
                      title="重新整理手錶清單"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 全選與多選操作工具列 */}
                <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
                  <div className="flex items-center gap-3">
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

                    {watchPlaylists.length > 0 && (
                      <span className="text-[11px] text-neutral-500">
                        {watchPlaylists.length} 個手錶播放清單 (.m3u8)
                      </span>
                    )}
                  </div>

                  {/* 手錶多選批量操作按鍵 */}
                  {selectedWatchTracks.length > 0 && (
                    <div className="flex items-center gap-2 animate-fadeIn">
                      <button
                        disabled={!watchStatus.connected}
                        onClick={() => {
                          setCustomPlaylistName('');
                          setShowPlaylistModal(true);
                        }}
                        className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs font-medium flex items-center gap-1.5 transition shadow-sm"
                        title="將選取的歌曲建立成手錶播放清單 (.m3u8)"
                      >
                        <ListMusic className="w-3.5 h-3.5" />
                        <span>建立播放清單 ({selectedWatchTracks.length})</span>
                      </button>

                      <button
                        disabled={deletingFromWatch || !watchStatus.connected}
                        onClick={() => handleDeleteSpecificWatchTracks(selectedWatchTracks)}
                        className="px-2.5 py-1 bg-red-500/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/30 rounded text-xs font-medium flex items-center gap-1.5 transition"
                        title="將選取歌曲從手錶刪除"
                      >
                        {deletingFromWatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        <span>從手錶刪除 ({selectedWatchTracks.length})</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 手錶歌曲樹狀選單列表 (僅一層目錄展開/縮合) */}
                <div className="flex-1 overflow-y-auto">
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
                      <span className="text-xs text-neutral-600 mt-1">從左側選取歌曲並點擊「複製到手錶」</span>
                    </div>
                  ) : (
                    // 分組顯示手錶樹狀選單
                    (() => {
                      const groups: Record<string, WatchTrack[]> = {};
                      filteredWatchTracks.forEach(t => {
                        const folder = t.folder || '音樂';
                        if (!groups[folder]) groups[folder] = [];
                        groups[folder].push(t);
                      });

                      return Object.entries(groups).map(([folderName, folderTracks]) => {
                        const isCollapsed = !!collapsedWatchFolders[folderName];
                        const folderRelPaths = folderTracks.map(t => t.rel_path);
                        const isFolderAllSelected = folderRelPaths.length > 0 && folderRelPaths.every(p => selectedWatchTracks.includes(p));

                        return (
                          <div key={folderName} className="border-b border-neutral-800/50 last:border-b-0">
                            {/* Windows 檔案總管風格 - 手錶目錄資料夾節點 */}
                            <div 
                              onClick={() => setCollapsedWatchFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }))}
                              className="px-2 py-1.5 hover:bg-neutral-800/60 rounded flex items-center justify-between cursor-pointer transition select-none group"
                            >
                              <div className="flex items-center gap-1.5">
                                {/* 展開/縮合箭頭 */}
                                <span className="p-0.5 text-neutral-400 hover:text-white">
                                  {isCollapsed ? (
                                    <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-neutral-300" />
                                  )}
                                </span>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isFolderAllSelected) {
                                      setSelectedWatchTracks(prev => prev.filter(p => !folderRelPaths.includes(p)));
                                    } else {
                                      setSelectedWatchTracks(prev => Array.from(new Set([...prev, ...folderRelPaths])));
                                    }
                                  }}
                                  className="text-neutral-400 hover:text-white p-0.5"
                                  title="勾選整目錄手錶歌曲"
                                >
                                  {isFolderAllSelected ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-orange-500" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-neutral-600" />
                                  )}
                                </button>

                                {/* 經典黃色檔案總管資料夾圖示 */}
                                {isCollapsed ? (
                                  <Folder className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                                ) : (
                                  <FolderOpen className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                                )}

                                <span className="font-medium text-xs text-neutral-200">{folderName}</span>
                                <span className="text-[11px] text-neutral-500">({folderTracks.length})</span>
                              </div>

                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                                <span className="text-[10px] text-neutral-500">
                                  {isCollapsed ? '展開' : '收合'}
                                </span>
                              </div>
                            </div>

                            {/* 手錶目錄下的歌曲清單 (縮合時隱藏) - 清楚縮排 + 樹狀延伸導引線 */}
                            {!isCollapsed && (
                              <div className="ml-5 pl-4 border-l border-neutral-800 space-y-0.5 my-0.5">
                                {folderTracks.map(track => {
                                  const isSelected = selectedWatchTracks.includes(track.rel_path);

                                  return (
                                    <div
                                      key={track.rel_path}
                                      onClick={() => {
                                        setSelectedWatchTracks(prev =>
                                          isSelected ? prev.filter(p => p !== track.rel_path) : [...prev, track.rel_path]
                                        );
                                      }}
                                      className={`px-2 py-1.5 rounded flex items-center justify-between text-xs hover:bg-neutral-800/50 cursor-pointer transition select-none group ${
                                        isSelected ? 'bg-orange-500/10 text-orange-200' : 'text-neutral-300'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 pr-3">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedWatchTracks(prev =>
                                              isSelected ? prev.filter(p => p !== track.rel_path) : [...prev, track.rel_path]
                                            );
                                          }}
                                          className="text-neutral-400 hover:text-white shrink-0 p-0.5"
                                        >
                                          {isSelected ? (
                                            <CheckSquare className="w-3.5 h-3.5 text-orange-500" />
                                          ) : (
                                            <Square className="w-3.5 h-3.5 text-neutral-600" />
                                          )}
                                        </button>

                                        {/* 音訊檔案圖示 */}
                                        <FileMusic className="w-3.5 h-3.5 text-neutral-400 shrink-0" />

                                        <div className="min-w-0 flex items-center gap-2">
                                          <span className={`font-medium truncate ${isSelected ? 'text-orange-300' : 'text-neutral-200'}`}>
                                            {track.title}
                                          </span>
                                          {track.artist && track.artist !== 'Unknown Artist' && (
                                            <span className="text-[11px] text-neutral-500 truncate hidden sm:inline">
                                              - {track.artist}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* 手錶歌曲單曲操作：編輯 / 刪除 */}
                                      <div className="flex items-center gap-2.5 shrink-0 text-neutral-400 text-[11px]">
                                        <span className="w-14 text-right font-mono text-[11px] text-neutral-500">
                                          {(track.size / (1024 * 1024)).toFixed(1)} MB
                                        </span>

                                        <div className="flex items-center gap-1 pl-1">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenRename(track.rel_path, track.title, true);
                                            }}
                                            className="p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
                                            title="編輯手錶歌名/檔案名稱"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteSpecificWatchTracks([track.rel_path]);
                                            }}
                                            disabled={deletingFromWatch}
                                            className="p-1 rounded hover:bg-red-600/80 text-neutral-400 hover:text-white transition"
                                            title="從手錶刪除"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()
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

                  <div className="flex items-center gap-2 pt-1">
                    <input 
                      type="checkbox" 
                      id="dlPlaylistCheck" 
                      checked={downloadPlaylist}
                      onChange={(e) => setDownloadPlaylist(e.target.checked)}
                      className="rounded bg-neutral-950 border-neutral-800 text-orange-600 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="dlPlaylistCheck" className="text-xs text-neutral-300 cursor-pointer">
                      若為播放清單或整張專輯，下載全部歌曲 (預設僅下載單曲)
                    </label>
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
            <div className="h-full flex flex-col gap-4 max-w-5xl mx-auto">
              {/* 搜尋列與目標下載目錄選擇 */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <form onSubmit={handlePodcastSearch} className="flex gap-2 flex-1">
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
                    className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition flex items-center gap-2 shrink-0"
                  >
                    {searchingPodcast ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    <span>搜尋</span>
                  </button>
                </form>

                {/* 下載目錄選擇 */}
                <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 px-3.5 py-2 rounded-xl shrink-0">
                  <Folder className="w-4 h-4 text-orange-400 shrink-0" />
                  <span className="text-xs text-neutral-400 whitespace-nowrap">儲存目錄:</span>
                  <select
                    value={downloadFolder}
                    onChange={(e) => setDownloadFolder(e.target.value)}
                    className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-orange-500"
                  >
                    {folders.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

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
                    可手動輸入手錶音樂資料夾路徑，或點選「手動選擇目錄」開啟目錄導覽選取。
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-medium text-neutral-300">
                    手錶 Music 資料夾路徑
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="手動輸入路徑（例如 D:\garmin\music 或 E:\GARMIN\Music）"
                      value={customPathInput}
                      onChange={(e) => setCustomPathInput(e.target.value)}
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 font-mono"
                    />
                    <button
                      onClick={handleOpenFolderModal}
                      className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-lg text-sm font-medium flex items-center gap-1.5 transition shrink-0"
                      title="開啟目錄瀏覽視窗手動選取資料夾"
                    >
                      <FolderSearch className="w-4 h-4 text-orange-400" />
                      <span>手動選擇目錄</span>
                    </button>
                    <button
                      onClick={handleSaveWatchPath}
                      disabled={!customPathInput.trim()}
                      className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition shrink-0"
                    >
                      儲存設定
                    </button>
                  </div>
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

      {/* 建立手錶自訂播放清單彈窗 */}
      {showPlaylistModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-orange-400" />
                <span>建立手錶播放清單 (.m3u8)</span>
              </h3>
              <button onClick={() => setShowPlaylistModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateWatchPlaylist} className="space-y-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">
                  播放清單名稱（手錶選單將顯示此名稱）
                </label>
                <input
                  type="text"
                  placeholder="例如：馬拉松配速清單、每日精選..."
                  value={customPlaylistName}
                  onChange={(e) => setCustomPlaylistName(e.target.value)}
                  autoFocus
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1.5">
                  已選取手錶內的 {selectedWatchTracks.length} 首歌曲加入此播放清單。
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPlaylistModal(false)}
                  className="px-4 py-1.5 bg-neutral-800 text-neutral-300 rounded-lg text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!customPlaylistName.trim() || creatingPlaylist}
                  className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {creatingPlaylist && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>建立清單</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯歌名/檔案名稱彈窗 */}
      {showRenameModal && renameTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 max-w-sm w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-orange-400" />
                <span>重新命名{renameTarget.isWatch ? '手錶' : '電腦'}歌曲檔案</span>
              </h3>
              <button onClick={() => setShowRenameModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitRename} className="space-y-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">
                  歌曲名稱 / 檔案名稱 (.mp3)
                </label>
                <input
                  type="text"
                  placeholder="請輸入新名稱"
                  value={newTitleInput}
                  onChange={(e) => setNewTitleInput(e.target.value)}
                  autoFocus
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1.5">
                  將自動同步修改實體檔案名及 ID3 標籤中的歌曲標題。
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="px-4 py-1.5 bg-neutral-800 text-neutral-300 rounded-lg text-xs"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newTitleInput.trim() || renaming}
                  className="px-4 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {renaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>儲存修改</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              <div>
                <input
                  type="text"
                  placeholder="例如：重訓音樂、輕鬆跑、Podcast..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500"
                />
                <p className="text-[11px] text-neutral-500 mt-1.5">
                  提示：目錄結構限定為一層，不可輸入子目錄路徑（/ 或 \）。
                </p>
              </div>
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

      {/* 瀏覽磁碟目錄彈窗 (Web 原生導覽器，100% 穩定零卡頓) */}
      {showDiskBrowserModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-xl w-full flex flex-col max-h-[85vh] shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderSearch className="w-5 h-5 text-orange-500" />
                <h3 className="text-base font-bold text-white">選取手錶音樂資料夾</h3>
              </div>
              <button 
                onClick={() => setShowDiskBrowserModal(false)} 
                className="text-neutral-400 hover:text-white transition p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 磁碟機 / MTP 裝置快捷選單 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-neutral-400 font-medium shrink-0">切換磁碟 / 裝置：</span>
              {availableDrives.map((d) => (
                <button
                  key={d.path}
                  onClick={() => loadBrowserPath(d.path)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
                    currentBrowserPath.startsWith(d.path)
                      ? 'bg-orange-600/20 border-orange-500 text-orange-300'
                      : 'bg-neutral-800/80 border-neutral-700/80 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {d.is_mtp ? (
                    <Watch className="w-3.5 h-3.5 text-orange-400" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5" />
                  )}
                  <span>{d.label}</span>
                </button>
              ))}
            </div>

            {/* 目前路徑展示與直接輸入 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={currentBrowserPath}
                onChange={(e) => setCurrentBrowserPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    loadBrowserPath(currentBrowserPath);
                  }
                }}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-orange-500"
                placeholder="目前路徑（可直接修改或按 Enter 前往）"
              />
              <button
                type="button"
                onClick={() => loadBrowserPath(currentBrowserPath)}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-lg text-xs font-medium transition shrink-0"
              >
                前往
              </button>
            </div>

            {/* 資料夾瀏覽列表 */}
            <div className="flex-1 overflow-y-auto border border-neutral-800 rounded-xl bg-neutral-950/60 p-2 min-h-[260px] space-y-1">
              {loadingBrowser ? (
                <div className="h-full flex items-center justify-center py-16 text-neutral-500 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                  <span className="text-xs">讀取目錄中...</span>
                </div>
              ) : (
                <>
                  {/* 上一層目錄 */}
                  {parentBrowserPath && (
                    <button
                      onClick={() => loadBrowserPath(parentBrowserPath)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-800 text-xs text-neutral-400 flex items-center gap-2 transition"
                    >
                      <ChevronRight className="w-4 h-4 rotate-180 text-neutral-500" />
                      <span>.. 返回上一層目錄</span>
                    </button>
                  )}

                  {/* 子資料夾清單 */}
                  {browserSubfolders.length === 0 ? (
                    <div className="py-12 text-center text-xs text-neutral-600">
                      此資料夾內沒有其他子資料夾
                    </div>
                  ) : (
                    browserSubfolders.map((folder) => {
                      const isMusic = folder.name.toLowerCase() === 'music' || folder.name.toLowerCase() === 'garmin';
                      return (
                        <div
                          key={folder.path}
                          className="flex items-center justify-between group px-3 py-2 rounded-lg hover:bg-neutral-800/80 transition"
                        >
                          <button
                            onClick={() => loadBrowserPath(folder.path)}
                            className="flex items-center gap-2 text-left flex-1 truncate text-xs text-neutral-200 group-hover:text-white"
                          >
                            <Folder className={`w-4 h-4 shrink-0 ${isMusic ? 'text-orange-400' : 'text-neutral-400'}`} />
                            <span className="truncate">{folder.name}</span>
                          </button>
                          <button
                            onClick={() => handleSelectFolderModal(folder.path)}
                            className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-orange-600/80 hover:bg-orange-500 text-white rounded text-xs transition shrink-0 ml-2"
                          >
                            選取此資料夾
                          </button>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
              <span className="text-[11px] text-neutral-500">
                點擊資料夾名稱可進入子目錄，點右側按鍵或下方按鍵套用。
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiskBrowserModal(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFolderModal(currentBrowserPath)}
                  disabled={!currentBrowserPath}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-medium transition"
                >
                  選取目前目錄
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
