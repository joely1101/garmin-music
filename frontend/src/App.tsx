import React, { useState, useEffect, useRef } from 'react';
import { 
  UploadCloud, 
  Trash2, 
  Play, 
  Pause, 
  Radio, 
  Download, 
  Watch, 
  Loader2,
  ListMusic,
  Folder,
  FolderPlus,
  Settings,
  LogIn,
  LogOut,
  KeyRound,
  Globe,
  CheckSquare,
  Square,
  ChevronRight,
  ArrowLeft,
  Volume2
} from 'lucide-react';

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  bitrate: number;
  size: number;
  rel_path: string;
  folder: string;
  sync_enabled: number;
}

interface DownloadTask {
  status: string;
  progress: string;
  title: string;
  error?: string;
}

export default function App() {
  // Navigation & Views ('folder' | 'playlist' | 'garmin_sync')
  const [activeTab, setActiveTab] = useState<'tracks' | 'download' | 'settings'>('tracks');
  const [viewMode, setViewMode] = useState<'folder' | 'playlist' | 'garmin_sync'>('folder');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Authentication State (預設未登入，強制要求登入驗證)
  const [currentUser, setCurrentUser] = useState<string | null>(() => localStorage.getItem('garmin_user'));
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Password Modification State
  const [newPassword, setNewPassword] = useState('');
  const [changePwdMsg, setChangePwdMsg] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);

  // Server URL Override (For Reverse Proxy / Handheld App)
  const [serverUrl, setServerUrl] = useState<string>(() => localStorage.getItem('garmin_server_url') || window.location.origin);
  const [isEditingServerUrl, setIsEditingServerUrl] = useState(false);
  const [tempServerUrl, setTempServerUrl] = useState(serverUrl);

  // Data State
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [, setIsLoadingTracks] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);

  // Audio Player State
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Downloader State
  const [downloadUrl, setDownloadUrl] = useState('');
  const [targetFolder, setTargetFolder] = useState('1116');
  const [downloadPlaylist, setDownloadPlaylist] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [tasks, setTasks] = useState<{ [key: string]: DownloadTask }>({});

  const apiBase = serverUrl.replace(/\/+$/, '');

  // Helper fetch with Server URL
  const apiFetch = (path: string, options?: RequestInit) => {
    const fullPath = path.startsWith('http') ? path : `${apiBase}${path}`;
    return fetch(fullPath, options);
  };

  // Fetch Tracks & Folders (只有在已登入時呼叫)
  const fetchFolders = async () => {
    if (!currentUser) return;
    try {
      const res = await apiFetch('/api/folders');
      if (res.ok) {
        const data = await res.json();
        setFolders(data);
        if (data.length > 0 && !data.includes(targetFolder)) {
          setTargetFolder(data[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTracks = async () => {
    if (!currentUser) return;
    try {
      setIsLoadingTracks(true);
      const res = await apiFetch('/api/tracks');
      if (res.ok) {
        const data = await res.json();
        setTracks(data);
      }
    } catch (err) {
      console.error('Failed to load tracks', err);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const fetchTasks = async () => {
    if (!currentUser) return;
    try {
      const res = await apiFetch('/api/download/tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchFolders();
      fetchTracks();
      const interval = setInterval(fetchTasks, 3000);
      return () => clearInterval(interval);
    }
  }, [serverUrl, currentUser]);

  // Auth Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.username);
        localStorage.setItem('garmin_user', data.username);
        setLoginPassword('');
      } else {
        const data = await res.json();
        setAuthError(data.detail || '帳號或密碼錯誤');
      }
    } catch (err) {
      setAuthError('無法連線到伺服器');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('garmin_user');
    setTracks([]);
    setFolders([]);
  };

  // Change Password Handler
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) return;
    setIsChangingPwd(true);
    setChangePwdMsg('');
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: currentUser || 'admin', 
          password: newPassword.trim() 
        }),
      });
      if (res.ok) {
        setChangePwdMsg('密碼修改成功！手錶端請同步使用新密碼。');
        setNewPassword('');
      } else {
        setChangePwdMsg('修改密碼失敗');
      }
    } catch (err) {
      setChangePwdMsg('連線錯誤');
    } finally {
      setIsChangingPwd(false);
    }
  };

  // Sync Checkbox Toggle
  const handleToggleSync = async (track: Track) => {
    const nextState = track.sync_enabled === 1 ? 0 : 1;
    // Optimistic UI update
    setTracks(tracks.map(t => t.id === track.id ? { ...t, sync_enabled: nextState } : t));
    try {
      await apiFetch(`/api/tracks/${track.id}/sync?enabled=${nextState === 1}`, { method: 'POST' });
    } catch (err) {
      fetchTracks();
    }
  };

  // Batch Folder Sync Toggle
  const handleBatchFolderSync = async (folder: string, enable: boolean) => {
    setTracks(tracks.map(t => t.folder === folder ? { ...t, sync_enabled: enable ? 1 : 0 } : t));
    try {
      await apiFetch(`/api/folders/${encodeURIComponent(folder)}/batch-sync?enabled=${enable}`, { method: 'POST' });
    } catch (err) {
      fetchTracks();
    }
  };

  // Playback Handler
  const handlePlay = (track: Track) => {
    if (currentTrack?.id === track.id) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play();
        setIsPlaying(true);
      }
    } else {
      setCurrentTrack(track);
      setIsPlaying(true);
      if (audioRef.current) {
        audioRef.current.src = `${apiBase}/rest/stream.view?id=${track.id}&u=${encodeURIComponent(currentUser || 'admin')}&p=admin`;
        audioRef.current.play();
      }
    }
  };

  // Delete Handler
  const handleDelete = async (trackId: string) => {
    if (!window.confirm('確定要從伺服器刪除這首歌曲嗎？')) return;
    try {
      const res = await apiFetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
      if (res.ok) {
        setTracks(tracks.filter(t => t.id !== trackId));
        if (currentTrack?.id === trackId) {
          audioRef.current?.pause();
          setCurrentTrack(null);
          setIsPlaying(false);
        }
      }
    } catch (err) {
      alert('刪除失敗');
    }
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const folder = newFolderName.trim();
    if (!folder) return;
    try {
      const res = await apiFetch(`/api/folders?folder_name=${encodeURIComponent(folder)}`, { method: 'POST' });
      if (res.ok) {
        setNewFolderName('');
        setShowNewFolderModal(false);
        fetchFolders();
        setTargetFolder(folder);
      }
    } catch (err) {
      alert('建立目錄失敗');
    }
  };

  // File Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const uploadFolder = selectedFolder || (folders.length > 0 ? folders[0] : '1116');
    setIsUploading(true);
    for (let i = 0; i < files.length; i++) {
      const formData = new FormData();
      formData.append('file', files[i]);
      formData.append('folder', uploadFolder);
      try {
        await apiFetch('/api/tracks/upload', {
          method: 'POST',
          body: formData,
        });
      } catch (err) {
        console.error('Upload error', err);
      }
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchTracks();
  };

  // Download Handler
  const handleStartDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!downloadUrl.trim()) return;
    
    setIsSubmittingDownload(true);
    try {
      const res = await apiFetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: downloadUrl.trim(),
          target_folder: targetFolder,
          download_playlist: downloadPlaylist 
        }),
      });
      if (res.ok) {
        setDownloadUrl('');
        fetchTasks();
      }
    } catch (err) {
      alert('無法發送下載請求');
    } finally {
      setIsSubmittingDownload(false);
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // ------------------ 如果未登入，顯示全屏登入介面 ------------------
  if (!currentUser) {
    return (
      <div className="flex flex-col min-h-screen max-w-md mx-auto bg-neutral-950 text-neutral-100 justify-center p-6 border-x border-neutral-900 shadow-2xl">
        <div className="bg-neutral-900/80 p-6 rounded-3xl border border-neutral-800 space-y-5">
          <div className="flex flex-col items-center text-center space-y-2">
            <img src="/favicon.svg" alt="Garmin Music Logo" className="w-14 h-14 drop-shadow-lg" />
            <h1 className="text-lg font-bold">Garmin Music 登入</h1>
            <p className="text-xs text-neutral-400">請輸入管理者帳號與密碼 (與手錶設定相同)</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3 pt-2">
            <div>
              <label className="text-[11px] text-neutral-400 font-semibold">帳號 (Username)</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="預設: admin"
                className="w-full mt-1 px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 font-semibold">密碼 (Password)</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="預設: admin"
                className="w-full mt-1 px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {authError && <p className="text-xs text-rose-500 font-medium text-center">{authError}</p>}

            <button 
              type="submit"
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-98 shadow-md shadow-rose-600/30"
            >
              <LogIn className="w-4 h-4" />
              <span>驗證並登入</span>
            </button>
          </form>

          {/* 伺服器網址確認 */}
          <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-500 text-center">
            伺服器端點: <span className="font-mono text-neutral-400">{serverUrl}</span>
          </div>
        </div>
      </div>
    );
  }

  // Filtered tracks for current view
  const visibleTracks = viewMode === 'garmin_sync'
    ? tracks.filter(t => t.sync_enabled === 1)
    : viewMode === 'folder' && selectedFolder
    ? tracks.filter(t => t.folder === selectedFolder)
    : tracks;

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto bg-neutral-950 text-neutral-100 shadow-2xl relative border-x border-neutral-900 pb-28">
      {/* 隱藏原生 Audio 標籤 */}
      <audio 
        ref={audioRef} 
        onEnded={() => setIsPlaying(false)} 
        onPause={() => setIsPlaying(false)} 
        onPlay={() => setIsPlaying(true)} 
      />

      {/* Top Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-neutral-950/85 px-4 py-3.5 border-b border-neutral-900 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="Garmin Music Logo" className="w-8 h-8 drop-shadow-md" />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold tracking-tight">Garmin Music</h1>
              <span className="text-[10px] px-1.5 py-0.2 bg-rose-500/10 text-rose-400 font-mono rounded border border-rose-500/20">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 font-mono tracking-wider truncate max-w-[150px]">
              USER: {currentUser}
            </p>
          </div>
        </div>

        {/* Action Group */}
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            multiple 
            accept=".mp3" 
            className="hidden" 
          />
          <button 
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 disabled:opacity-50 shadow-md shadow-rose-600/20"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
            <span>上傳</span>
          </button>

          <button 
            onClick={handleLogout}
            className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-xl hover:bg-neutral-900 transition"
            title="登出"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 overflow-y-auto">
        {/* Tab 1: 曲庫與目錄管理 (Tracks) */}
        {activeTab === 'tracks' && (
          <div className="space-y-3.5">
            {/* View Mode Switch (目錄模式 / 歌單模式 / 手錶歌單) */}
            <div className="flex items-center justify-between bg-neutral-900/60 p-1.5 rounded-2xl border border-neutral-800/80">
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => { setViewMode('folder'); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                    viewMode === 'folder' 
                      ? 'bg-rose-600 text-white shadow-sm' 
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>目錄模式</span>
                </button>
                <button 
                  onClick={() => { setViewMode('playlist'); setSelectedFolder(null); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                    viewMode === 'playlist' 
                      ? 'bg-rose-600 text-white shadow-sm' 
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                  <span>歌單模式</span>
                </button>
                <button 
                  onClick={() => { setViewMode('garmin_sync'); setSelectedFolder(null); }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                    viewMode === 'garmin_sync' 
                      ? 'bg-rose-600 text-white shadow-sm' 
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Watch className="w-3.5 h-3.5" />
                  <span>手錶歌單</span>
                </button>
              </div>

              {viewMode === 'folder' && !selectedFolder && (
                <button 
                  onClick={() => setShowNewFolderModal(true)}
                  className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-lg hover:bg-neutral-800 transition"
                  title="建立新目錄"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 新建資料夾彈窗 */}
            {showNewFolderModal && (
              <form onSubmit={handleCreateFolder} className="p-3 bg-neutral-900 rounded-2xl border border-neutral-800 space-y-2">
                <span className="text-xs font-semibold text-neutral-300">建立新目錄</span>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="輸入目錄名稱 (例如: 2026Hits)"
                    className="flex-1 px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs focus:outline-none focus:border-rose-500"
                  />
                  <button type="submit" className="px-3 py-1.5 bg-rose-600 text-white text-xs rounded-xl font-semibold">建立</button>
                  <button type="button" onClick={() => setShowNewFolderModal(false)} className="px-2 py-1.5 text-neutral-500 text-xs">取消</button>
                </div>
              </form>
            )}

            {/* 1. 手錶歌單模式頂部說明提示 */}
            {viewMode === 'garmin_sync' && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center justify-between">
                <span>此處僅顯示打勾、會推送到手錶的歌曲 ({visibleTracks.length} 首)</span>
                <button 
                  onClick={() => {
                    tracks.forEach(t => {
                      if (t.sync_enabled === 1) handleToggleSync(t);
                    });
                  }}
                  className="text-[11px] underline text-rose-400 hover:text-rose-200"
                >
                  清空手錶歌單
                </button>
              </div>
            )}

            {/* 2. 目錄模式下的根目錄導覽 (Folder List) */}
            {viewMode === 'folder' && !selectedFolder && (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider px-1">
                  檔案夾清單 (點入瀏覽)
                </span>
                {folders.map(folder => {
                  const folderTracks = tracks.filter(t => t.folder === folder);
                  const syncedCount = folderTracks.filter(t => t.sync_enabled === 1).length;
                  return (
                    <div 
                      key={folder}
                      onClick={() => setSelectedFolder(folder)}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-neutral-900/40 border border-neutral-900/80 hover:bg-neutral-900 cursor-pointer transition active:scale-98"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                          <Folder className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-neutral-200">{folder}</p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {folderTracks.length} 首歌曲 • {syncedCount} 首已排入同步
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-neutral-600" />
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. 歌曲列表 (歌單模式 / 目錄進入 / 手錶歌單) */}
            {(viewMode !== 'folder' || selectedFolder) && (
              <div className="space-y-2">
                {/* 麵包屑 / 目錄快速操作 */}
                {selectedFolder && (
                  <div className="flex items-center justify-between py-1 px-1">
                    <button 
                      onClick={() => setSelectedFolder(null)}
                      className="flex items-center gap-1 text-xs text-rose-400 font-semibold hover:underline"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>返回目錄</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleBatchFolderSync(selectedFolder, true)}
                        className="text-[11px] text-neutral-400 hover:text-white"
                      >
                        全選同步
                      </button>
                      <span className="text-neutral-700">|</span>
                      <button 
                        onClick={() => handleBatchFolderSync(selectedFolder, false)}
                        className="text-[11px] text-neutral-400 hover:text-white"
                      >
                        取消全選
                      </button>
                    </div>
                  </div>
                )}

                {/* 歌曲列表 */}
                {visibleTracks.length === 0 ? (
                  <div className="py-12 text-center text-neutral-600 text-xs">
                    {viewMode === 'garmin_sync' ? '手錶歌單目前是空的，請至目錄或歌單模式將歌曲打勾！' : '這個目錄目前沒有任何 MP3 檔案'}
                  </div>
                ) : (
                  visibleTracks.map(track => {
                    const isCurrent = currentTrack?.id === track.id;
                    const isSynced = track.sync_enabled === 1;
                    return (
                      <div 
                        key={track.id}
                        className={`flex items-center justify-between p-3 rounded-2xl border transition ${
                          isCurrent 
                            ? 'bg-neutral-900 border-rose-500/50 shadow-sm shadow-rose-500/10' 
                            : 'bg-neutral-900/40 border-neutral-900/80 hover:bg-neutral-900'
                        }`}
                      >
                        {/* Sync Checkbox */}
                        <button 
                          onClick={() => handleToggleSync(track)}
                          className="mr-2 text-neutral-500 hover:text-rose-400 transition"
                          title={isSynced ? '已啟用手錶同步 (點擊取消)' : '點擊啟用手錶同步'}
                        >
                          {isSynced ? (
                            <CheckSquare className="w-5 h-5 text-rose-500" />
                          ) : (
                            <Square className="w-5 h-5 text-neutral-600" />
                          )}
                        </button>

                        {/* Play Button & Info */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <button 
                            onClick={() => handlePlay(track)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition active:scale-90 ${
                              isCurrent && isPlaying
                                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                                : 'bg-neutral-800 text-neutral-300 hover:text-white'
                            }`}
                          >
                            {isCurrent && isPlaying ? (
                              <Pause className="w-4 h-4 fill-current" />
                            ) : (
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-semibold truncate ${isCurrent ? 'text-rose-400' : 'text-neutral-200'}`}>
                              {track.title}
                            </p>
                            <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                              {viewMode !== 'folder' && <span className="text-amber-500/80 mr-1.5 font-mono">[{track.folder}]</span>}
                              {track.artist} • {formatDuration(track.duration)}
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 pl-2">
                          <button 
                            onClick={() => handleDelete(track.id)}
                            className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg transition hover:bg-neutral-800 active:scale-95"
                            title="刪除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: 音訊下載 (Download - YouTube & Podcast) */}
        {activeTab === 'download' && (
          <div className="space-y-4">
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-rose-500" />
                <h2 className="text-sm font-bold text-neutral-200">YouTube Music / Podcast 下載</h2>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                貼上 YouTube 影片/音樂網址或 Podcast RSS 鏈結，系統將自動以 320k MP3 存入指定的資料夾中。
              </p>

              <form onSubmit={handleStartDownload} className="space-y-2.5 pt-1">
                {/* 儲存目錄選擇 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400 shrink-0">存放目錄:</span>
                  <select 
                    value={targetFolder}
                    onChange={(e) => setTargetFolder(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-neutral-950 border border-neutral-800 text-xs rounded-xl text-neutral-200 focus:outline-none focus:border-rose-500"
                  >
                    {folders.map(f => (
                      <option key={f} value={f}>📁 {f}</option>
                    ))}
                  </select>
                </div>

                <input 
                  type="text" 
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://music.youtube.com/... 或 RSS..." 
                  className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-rose-500 transition"
                />

                <div className="flex items-center gap-2 px-1">
                  <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={downloadPlaylist}
                      onChange={(e) => setDownloadPlaylist(e.target.checked)}
                      className="rounded border-neutral-800 bg-neutral-900 text-rose-500 focus:ring-rose-500/20"
                    />
                    <span>若為合輯 / 播放清單，下載整張清單</span>
                  </label>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmittingDownload || !downloadUrl.trim()}
                  className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50 shadow-md shadow-rose-600/20"
                >
                  {isSubmittingDownload ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>開始抓取並轉為 MP3</span>
                </button>
              </form>
            </div>

            {/* 下載任務清單 */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider px-1">
                背景任務進度
              </span>

              {Object.keys(tasks).length === 0 ? (
                <div className="p-4 rounded-2xl bg-neutral-900/30 border border-neutral-900 text-center text-xs text-neutral-600">
                  尚無下載中或排程的任務
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(tasks).map(([tid, task]) => (
                    <div key={tid} className="p-3 rounded-2xl bg-neutral-900/50 border border-neutral-900 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-neutral-300 truncate max-w-[220px]">
                          {task.title || '處理中...'}
                        </span>
                        <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                          task.status === 'completed' 
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50' 
                            : task.status === 'failed'
                            ? 'bg-rose-950/80 text-rose-400 border border-rose-800/50'
                            : 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500 truncate">
                        {task.progress}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: 伺服器與 Garmin 認證設定 (Settings) */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            {/* 1. Server URL 自訂設定 (支援反向代理 / 跨網域存取) */}
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-sky-400" />
                <h2 className="text-sm font-bold text-neutral-200">伺服器連線網址 (Server URL)</h2>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                若有架設 Nginx / Cloudflare 反向代理，或在手機 App (APK) 啟動時需要指定連線端點，可在此修改：
              </p>

              {isEditingServerUrl ? (
                <div className="space-y-2 pt-1">
                  <input 
                    type="text" 
                    value={tempServerUrl} 
                    onChange={(e) => setTempServerUrl(e.target.value)}
                    placeholder="https://music.example.com"
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs font-mono"
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        setServerUrl(tempServerUrl.trim());
                        localStorage.setItem('garmin_server_url', tempServerUrl.trim());
                        setIsEditingServerUrl(false);
                      }}
                      className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-semibold"
                    >
                      儲存變更
                    </button>
                    <button 
                      onClick={() => {
                        setTempServerUrl(serverUrl);
                        setIsEditingServerUrl(false);
                      }}
                      className="px-3 py-1.5 text-neutral-400 text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-2xl bg-neutral-950 border border-neutral-800">
                  <span className="text-xs font-mono text-neutral-200 truncate mr-2">{serverUrl}</span>
                  <button 
                    onClick={() => setIsEditingServerUrl(true)}
                    className="text-xs text-rose-400 hover:underline shrink-0"
                  >
                    變更網址
                  </button>
                </div>
              )}
            </div>

            {/* 2. 修改密碼 (Web 與手錶共用) */}
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h2 className="text-sm font-bold text-neutral-200">修改密碼 (手錶與網頁共用)</h2>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                目前登入帳號：<span className="text-rose-400 font-mono font-semibold">{currentUser}</span>。在此修改密碼後，手錶連線密碼亦需同步更新。
              </p>

              <form onSubmit={handleChangePassword} className="space-y-2.5 pt-1">
                <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-semibold">新密碼 (New Password)</label>
                  <input 
                    type="password" 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="請輸入新密碼..."
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
                {changePwdMsg && (
                  <p className={`text-xs ${changePwdMsg.includes('成功') ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {changePwdMsg}
                  </p>
                )}
                <button 
                  type="submit"
                  disabled={isChangingPwd || !newPassword.trim()}
                  className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50"
                >
                  {isChangingPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  <span>確認修改密碼</span>
                </button>
              </form>
            </div>

            {/* 3. Garmin 連線資訊摘要 */}
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <Watch className="w-5 h-5 text-emerald-400" />
                <h2 className="text-sm font-bold text-neutral-200">Garmin 手錶 App 設定摘要</h2>
              </div>
              <div className="space-y-1.5 text-xs text-neutral-300">
                <p>• <b>Server URL:</b> <span className="font-mono text-emerald-400">{serverUrl}</span></p>
                <p>• <b>Username:</b> <span className="font-mono text-emerald-400">{currentUser}</span></p>
                <p>• <b>Password:</b> 您的設定密碼 (預設 admin)</p>
                <p>• <b>Sync 機制:</b> 只有打勾的歌曲才會列入手錶的同步清單中。</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Bottom Mini Player */}
      {currentTrack && (
        <div className="fixed bottom-16 left-0 right-0 max-w-md mx-auto px-3 z-30 pointer-events-none">
          <div className="bg-neutral-900/95 backdrop-blur-lg border border-neutral-800 p-2.5 rounded-2xl shadow-xl flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shrink-0">
                <Volume2 className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate text-neutral-100">{currentTrack.title}</p>
                <p className="text-[11px] truncate text-neutral-400">{currentTrack.artist}</p>
              </div>
            </div>

            <button 
              onClick={() => handlePlay(currentTrack)}
              className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition active:scale-95 shadow-md shadow-rose-600/30 shrink-0 ml-2"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-neutral-950/90 backdrop-blur-md border-t border-neutral-900 flex items-center justify-around py-2.5 z-40">
        <button 
          onClick={() => setActiveTab('tracks')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'tracks' ? 'text-rose-500 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-[10px]">曲庫管理</span>
        </button>

        <button 
          onClick={() => setActiveTab('download')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'download' ? 'text-rose-500 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Download className="w-5 h-5" />
          <span className="text-[10px]">音訊下載</span>
        </button>

        <button 
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'settings' ? 'text-rose-500 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px]">系統設定</span>
        </button>
      </nav>
    </div>
  );
}
