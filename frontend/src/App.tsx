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
  Volume2,
  Search,
  Mic,
  Calendar,
  Clock,
  RotateCw,
  Users,
  UserPlus,
  UserX,
  AlertCircle,
  Copy,
  Check
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
  user?: string;
}

interface DownloadTask {
  status: string;
  progress: string;
  title: string;
  url?: string;
  error?: string;
  user?: string;
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

interface PodcastChannelDetail {
  title: string;
  artist: string;
  artwork?: string;
  episodes: PodcastEpisode[];
}

interface UserInfo {
  username: string;
  role: string;
  email: string;
  created_at: string;
  has_custom_watch_password: boolean;
  track_count?: number;
}

declare global {
  interface Window {
    google?: any;
  }
}

export default function App() {
  // Navigation & Views ('tracks' | 'download' | 'podcast' | 'settings')
  const [activeTab, setActiveTab] = useState<'tracks' | 'download' | 'podcast' | 'settings'>('tracks');
  const [viewMode, setViewMode] = useState<'folder' | 'playlist' | 'garmin_sync'>('folder');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<string | null>(() => localStorage.getItem('garmin_user'));
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('garmin_token'));
  const [currentUserRole, setCurrentUserRole] = useState<string>(() => localStorage.getItem('garmin_role') || 'user');
  const [hasCustomWatchPwd, setHasCustomWatchPwd] = useState<boolean>(() => localStorage.getItem('garmin_has_watch_pwd') === 'true');
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Google OAuth Client ID
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [isEditingGoogleClientId, setIsEditingGoogleClientId] = useState(false);
  const [tempGoogleClientId, setTempGoogleClientId] = useState('');

  // Password Modification State
  const [newPassword, setNewPassword] = useState('');
  const [changePwdMsg, setChangePwdMsg] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);

  // Watch Dedicated Password Setting State (for Google login user)
  const [watchPassword, setWatchPassword] = useState('');
  const [watchPwdMsg, setWatchPwdMsg] = useState('');
  const [isSettingWatchPwd, setIsSettingWatchPwd] = useState(false);

  // Admin User Management State
  const [userList, setUserList] = useState<UserInfo[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole] = useState('user');
  const [adminUserMsg, setAdminUserMsg] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Server URL Override
  const [serverUrl, setServerUrl] = useState<string>(() => localStorage.getItem('garmin_server_url') || window.location.origin);
  const [isEditingServerUrl, setIsEditingServerUrl] = useState(false);
  const [tempServerUrl, setTempServerUrl] = useState(serverUrl);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Data State
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [, setIsLoadingTracks] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);

  // Audio Player State
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Downloader State (YouTube / Direct URL)
  const [downloadUrl, setDownloadUrl] = useState('');
  const [targetFolder, setTargetFolder] = useState('音樂');
  const [downloadPlaylist, setDownloadPlaylist] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [tasks, setTasks] = useState<{ [key: string]: DownloadTask }>({});

  // Podcast State
  const [podcastQuery, setPodcastQuery] = useState('');
  const [isSearchingPodcast, setIsSearchingPodcast] = useState(false);
  const [podcastResults, setPodcastResults] = useState<PodcastSearchResult[]>([]);
  const [selectedPodcast, setSelectedPodcast] = useState<PodcastSearchResult | null>(null);
  const [channelDetail, setChannelDetail] = useState<PodcastChannelDetail | null>(null);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [downloadingEpisodeUrls, setDownloadingEpisodeUrls] = useState<{ [key: string]: boolean }>({});

  const apiBase = serverUrl.replace(/\/+$/, '');

  // Helper fetch with Authorization Bearer header
  const apiFetch = (path: string, options?: RequestInit) => {
    const fullPath = path.startsWith('http') ? path : `${apiBase}${path}`;
    const headers = new Headers(options?.headers || {});
    if (authToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    return fetch(fullPath, { ...options, headers });
  };

  // Fetch Google Client ID
  const fetchGoogleClientId = async () => {
    try {
      const res = await apiFetch('/api/auth/google-client-id');
      if (res.ok) {
        const data = await res.json();
        setGoogleClientId(data.client_id || '');
        setTempGoogleClientId(data.client_id || '');
      }
    } catch (err) {
      console.error('Failed to load Google Client ID', err);
    }
  };

  useEffect(() => {
    fetchGoogleClientId();
  }, [serverUrl]);

  // Google Login button render
  const googleBtnContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentUser && googleClientId && window.google?.accounts?.id && googleBtnContainerRef.current) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: any) => {
          if (response.credential) {
            try {
              const res = await apiFetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential }),
              });
              if (res.ok) {
                const data = await res.json();
                setCurrentUser(data.username);
                setAuthToken(data.token);
                setCurrentUserRole(data.role);
                setHasCustomWatchPwd(data.has_custom_watch_password);
                localStorage.setItem('garmin_user', data.username);
                localStorage.setItem('garmin_token', data.token);
                localStorage.setItem('garmin_role', data.role);
                localStorage.setItem('garmin_has_watch_pwd', String(data.has_custom_watch_password));
              } else {
                const data = await res.json();
                setAuthError(data.detail || 'Google 登入失敗');
              }
            } catch (err) {
              setAuthError('Google 登入伺服器連線失敗');
            }
          }
        }
      });
      googleBtnContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: '100%',
        text: 'signin_with',
        shape: 'pill'
      });
    }
  }, [currentUser, googleClientId]);

  // Fetch Tracks & Folders
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

  // Fetch Admin Users
  const fetchUsers = async () => {
    if (currentUserRole !== 'admin') return;
    try {
      const res = await apiFetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUserList(data);
      }
    } catch (err) {
      console.error('Failed to load users', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchFolders();
      fetchTracks();
      if (currentUserRole === 'admin') {
        fetchUsers();
      }
      const interval = setInterval(fetchTasks, 3000);
      return () => clearInterval(interval);
    }
  }, [serverUrl, currentUser, currentUserRole]);

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
        setAuthToken(data.token);
        setCurrentUserRole(data.role);
        setHasCustomWatchPwd(data.has_custom_watch_password);
        localStorage.setItem('garmin_user', data.username);
        localStorage.setItem('garmin_token', data.token);
        localStorage.setItem('garmin_role', data.role);
        localStorage.setItem('garmin_has_watch_pwd', String(data.has_custom_watch_password));
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
    setAuthToken(null);
    setCurrentUserRole('user');
    setHasCustomWatchPwd(false);
    localStorage.removeItem('garmin_user');
    localStorage.removeItem('garmin_token');
    localStorage.removeItem('garmin_role');
    localStorage.removeItem('garmin_has_watch_pwd');
    setTracks([]);
    setFolders([]);
  };

  // Change Password Handler (for normal users)
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
        setHasCustomWatchPwd(true);
        localStorage.setItem('garmin_has_watch_pwd', 'true');
      } else {
        const data = await res.json();
        setChangePwdMsg(data.detail || '修改密碼失敗');
      }
    } catch (err) {
      setChangePwdMsg('連線錯誤');
    } finally {
      setIsChangingPwd(false);
    }
  };

  // Set Dedicated Watch Password (for Google email users)
  const handleSetWatchPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchPassword.trim()) return;
    setIsSettingWatchPwd(true);
    setWatchPwdMsg('');
    try {
      const res = await apiFetch('/api/user/set-watch-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: watchPassword.trim() })
      });
      if (res.ok) {
        setWatchPwdMsg('手錶連線密碼設定成功！請在手錶 App 輸入此密碼連線。');
        setWatchPassword('');
        setHasCustomWatchPwd(true);
        localStorage.setItem('garmin_has_watch_pwd', 'true');
      } else {
        const data = await res.json();
        setWatchPwdMsg(data.detail || '設定密碼失敗');
      }
    } catch (err) {
      setWatchPwdMsg('連線失敗');
    } finally {
      setIsSettingWatchPwd(false);
    }
  };

  // Admin Create User
  const handleAdminCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPassword.trim()) return;
    setIsCreatingUser(true);
    setAdminUserMsg('');
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newUserPassword.trim(),
          role: newUserRole,
          email: newUserEmail.trim()
        })
      });
      if (res.ok) {
        setAdminUserMsg(`使用者「${newUsername.trim()}」新增成功！已自動建立獨立曲庫目錄。`);
        setNewUsername('');
        setNewUserPassword('');
        setNewUserEmail('');
        fetchUsers();
      } else {
        const data = await res.json();
        setAdminUserMsg(data.detail || '新增失敗');
      }
    } catch (err) {
      setAdminUserMsg('連線失敗');
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Admin Delete User
  const handleAdminDeleteUser = async (targetUser: string) => {
    if (!window.confirm(`確定要刪除使用者「${targetUser}」嗎？這將一併刪除該用戶的所有歌曲與資料夾！`)) return;
    try {
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(targetUser)}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.detail || '刪除失敗');
      }
    } catch (err) {
      alert('連線失敗');
    }
  };

  // Admin Save Google Client ID
  const handleSaveGoogleClientId = async () => {
    try {
      const res = await apiFetch('/api/admin/settings/google-client-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: tempGoogleClientId.trim() })
      });
      if (res.ok) {
        setGoogleClientId(tempGoogleClientId.trim());
        setIsEditingGoogleClientId(false);
        alert('Google Client ID 已儲存！');
      } else {
        alert('儲存失敗');
      }
    } catch (err) {
      alert('連線失敗');
    }
  };

  // Sync Checkbox Toggle
  const handleToggleSync = async (track: Track) => {
    const nextState = track.sync_enabled === 1 ? 0 : 1;
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
        const streamUrl = `${apiBase}/api/tracks/${track.id}/stream${authToken ? `?token=${encodeURIComponent(authToken)}` : ''}`;
        audioRef.current.src = streamUrl;
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.play();
      }
    }
  };

  // 快轉 10 秒
  const handleForward10s = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(audioRef.current.duration || Infinity, audioRef.current.currentTime + 10);
    }
  };

  // 倍速切換：1 -> 1.2 -> 1.5 -> 1 循環
  const handleTogglePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.2 : playbackRate === 1.2 ? 1.5 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
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
      } else {
        alert('刪除失敗');
      }
    } catch (err) {
      alert('連線失敗');
    }
  };

  // Upload MP3
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const folder = selectedFolder || targetFolder || '音樂';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);
      try {
        await apiFetch('/api/tracks/upload', {
          method: 'POST',
          body: formData,
        });
      } catch (err) {
        console.error('Upload failed', file.name, err);
      }
    }
    setIsUploading(false);
    fetchFolders();
    fetchTracks();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const res = await apiFetch(`/api/folders?folder_name=${encodeURIComponent(newFolderName.trim())}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setFolders([...folders, data.folder]);
        setSelectedFolder(data.folder);
        setTargetFolder(data.folder);
        setNewFolderName('');
        setShowNewFolderModal(false);
      }
    } catch (err) {
      alert('建立資料夾失敗');
    }
  };

  // Delete Folder Handler
  const handleDeleteFolder = async (folderName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const songCount = tracks.filter(t => t.folder === folderName).length;
    const confirmMsg = songCount > 0 
      ? `確定要刪除目錄「${folderName}」嗎？\n⚠️ 該目錄內的 ${songCount} 首歌曲將會一併被徹底刪除！`
      : `確定要刪除空目錄「${folderName}」嗎？`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await apiFetch(`/api/folders/${encodeURIComponent(folderName)}`, { method: 'DELETE' });
      if (res.ok) {
        // 如果當前正在播放該目錄的歌曲，停止播放
        if (currentTrack && currentTrack.folder === folderName) {
          audioRef.current?.pause();
          setCurrentTrack(null);
          setIsPlaying(false);
        }
        if (selectedFolder === folderName) {
          setSelectedFolder(null);
        }
        fetchFolders();
        fetchTracks();
      } else {
        alert('刪除目錄失敗');
      }
    } catch (err) {
      alert('連線失敗');
    }
  };

  // Submit Downloader Job
  const handleSubmitDownload = async (e: React.FormEvent) => {
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
        })
      });
      if (res.ok) {
        setDownloadUrl('');
        fetchTasks();
      } else {
        alert('發送下載任務失敗');
      }
    } catch (err) {
      alert('無法發送下載請求');
    } finally {
      setIsSubmittingDownload(false);
    }
  };

  // Podcast Search Handler
  const handleSearchPodcast = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!podcastQuery.trim()) return;
    setIsSearchingPodcast(true);
    setSelectedPodcast(null);
    setChannelDetail(null);
    try {
      const res = await apiFetch(`/api/podcast/search?q=${encodeURIComponent(podcastQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setPodcastResults(data);
      } else {
        alert('搜尋 Podcast 失敗');
      }
    } catch (err) {
      alert('搜尋失敗，請檢查網路連線');
    } finally {
      setIsSearchingPodcast(false);
    }
  };

  // Select Podcast & Load Episodes
  const handleSelectPodcast = async (podcast: PodcastSearchResult) => {
    setSelectedPodcast(podcast);
    setIsLoadingEpisodes(true);
    try {
      const res = await apiFetch(`/api/podcast/episodes?feed_url=${encodeURIComponent(podcast.feedUrl)}`);
      if (res.ok) {
        const data = await res.json();
        setChannelDetail(data);
      } else {
        alert('無法讀取節目單集');
      }
    } catch (err) {
      alert('連線失敗');
    } finally {
      setIsLoadingEpisodes(false);
    }
  };

  // Download Single Episode
  const handleDownloadEpisode = async (ep: PodcastEpisode) => {
    const isAlreadyInTracks = tracks.some(t => t.title === ep.title);
    if (isAlreadyInTracks) {
      if (!window.confirm(`「${ep.title}」已在您的曲庫中，確定要重新下載嗎？`)) {
        return;
      }
    }

    setDownloadingEpisodeUrls(prev => ({ ...prev, [ep.audio_url]: true }));
    try {
      const res = await apiFetch('/api/download/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: ep.audio_url,
          title: ep.title,
          artist: channelDetail?.title || selectedPodcast?.title || 'Podcast',
          target_folder: targetFolder
        })
      });
      if (res.ok) {
        fetchTasks();
      } else {
        alert('加入下載排程失敗');
      }
    } catch (err) {
      alert('連線失敗');
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
            <img src="/favicon.svg" alt="Garmin Music Logo" className="w-[72px] h-[72px] drop-shadow-xl" />
            <h1 className="text-lg font-bold">Garmin Music 登入</h1>
            <p className="text-xs text-neutral-400">請輸入使用者帳號密碼，或使用 Google 認證登入</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3 pt-2">
            <div>
              <label className="text-[11px] text-neutral-400 font-semibold">帳號 (Username / Email)</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="例如: admin 或 使用者帳號"
                className="w-full mt-1 px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-neutral-400 font-semibold">密碼 (Password)</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="密碼"
                className="w-full mt-1 px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {authError && <p className="text-xs text-rose-500 font-medium text-center">{authError}</p>}

            <button 
              type="submit"
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-98 shadow-md shadow-rose-600/30"
            >
              <LogIn className="w-4 h-4" />
              <span>帳號密碼登入</span>
            </button>
          </form>

          {/* Google 登入分割線與容器 */}
          <div className="relative flex items-center justify-center pt-1">
            <div className="border-t border-neutral-800 w-full" />
            <span className="bg-neutral-900 px-3 text-[10px] text-neutral-500 uppercase tracking-widest absolute">或</span>
          </div>

          <div className="pt-2">
            {googleClientId ? (
              <div ref={googleBtnContainerRef} className="flex justify-center w-full min-h-[44px]" />
            ) : (
              <div className="p-3 bg-neutral-950/70 border border-dashed border-neutral-800 rounded-2xl text-center space-y-1">
                <p className="text-xs text-neutral-400 font-medium">尚未配置 Google Client ID</p>
                <p className="text-[10px] text-neutral-500">管理者登入後可在系統設定中配置，啟用一鍵 Google Email 登入</p>
              </div>
            )}
          </div>

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
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="Garmin Music Logo" className="w-[42px] h-[42px] drop-shadow-md" />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold tracking-tight">Garmin Music</h1>
              <span className={`text-[10px] px-1.5 py-0.2 font-mono rounded border ${
                currentUserRole === 'admin' 
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {currentUserRole === 'admin' ? 'ADMIN' : 'USER'}
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

      {/* Google 登入且尚未自訂手錶密碼的頂部貼心醒目提示 */}
      {!hasCustomWatchPwd && currentUser?.includes('@') && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-300">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">您是使用 Google 登入，請先設定一組手錶連線密碼！</span>
          </div>
          <button
            onClick={() => setActiveTab('settings')}
            className="px-2 py-1 bg-amber-500 text-black font-bold rounded-lg text-[11px] shrink-0 active:scale-95 transition"
          >
            前往設定
          </button>
        </div>
      )}

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

              {viewMode === 'folder' && (
                <button 
                  onClick={() => setShowNewFolderModal(true)}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
                  title="建立新目錄"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Modal: 建立新目錄 */}
            {showNewFolderModal && (
              <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl space-y-2">
                <p className="text-xs font-semibold text-neutral-300">建立個人專屬新目錄：</p>
                <form onSubmit={handleCreateFolder} className="flex gap-2">
                  <input 
                    type="text" 
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="目錄名稱 (如: Running, Workout)" 
                    className="flex-1 px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                  <button 
                    type="submit" 
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition active:scale-95"
                  >
                    建立
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setShowNewFolderModal(false)}
                    className="px-2 py-1.5 text-neutral-400 text-xs hover:text-white"
                  >
                    取消
                  </button>
                </form>
              </div>
            )}

            {/* Folder Mode: 目錄瀏覽列表 */}
            {viewMode === 'folder' && !selectedFolder && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
                  <span>我的音樂資料夾 ({folders.length})</span>
                </div>
                {folders.length === 0 ? (
                  <div className="p-8 text-center bg-neutral-900/30 rounded-3xl border border-neutral-900">
                    <Folder className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
                    <p className="text-xs text-neutral-400">目前尚無個人資料夾，請建立或上傳歌曲</p>
                  </div>
                ) : (
                  folders.map(folder => {
                    const count = tracks.filter(t => t.folder === folder).length;
                    const syncCount = tracks.filter(t => t.folder === folder && t.sync_enabled === 1).length;
                    return (
                      <div 
                        key={folder}
                        onClick={() => setSelectedFolder(folder)}
                        className="group flex items-center justify-between p-3.5 rounded-2xl bg-neutral-900/40 border border-neutral-900/80 hover:bg-neutral-900 cursor-pointer transition active:scale-98"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                          <div className="w-10 h-10 rounded-xl bg-neutral-800/80 flex items-center justify-center text-rose-400 shrink-0">
                            <Folder className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-neutral-200 truncate">{folder}</p>
                            <p className="text-[10px] text-neutral-400">
                              {count} 首歌 • {syncCount} 首同步到手錶
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => handleDeleteFolder(folder, e)}
                            className="p-2 text-neutral-600 hover:text-rose-400 hover:bg-neutral-800/80 rounded-xl transition active:scale-90"
                            title={`刪除目錄「${folder}」與其中全部歌曲`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-4 h-4 text-neutral-600" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Folder Mode (進入特定目錄內) 或 歌單模式 / 手錶歌單 */}
            {(viewMode !== 'folder' || selectedFolder) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
                  {viewMode === 'folder' && selectedFolder ? (
                    <button 
                      onClick={() => setSelectedFolder(null)}
                      className="flex items-center gap-1 text-rose-400 hover:underline font-semibold"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>返回目錄</span>
                    </button>
                  ) : (
                    <span>{viewMode === 'garmin_sync' ? '此處僅顯示打勾、會推送到手錶的歌曲' : '全部歌曲列表'} ({visibleTracks.length} 首)</span>
                  )}

                  {viewMode === 'folder' && selectedFolder && (
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
                      <span className="text-neutral-700">|</span>
                      <button 
                        onClick={() => handleDeleteFolder(selectedFolder)}
                        className="text-[11px] text-rose-500 hover:text-rose-400 flex items-center gap-0.5"
                        title="刪除當前整個目錄與所有歌曲"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>刪除此目錄</span>
                      </button>
                    </div>
                  )}

                  {viewMode === 'garmin_sync' && (
                    <button 
                      onClick={() => {
                        tracks.forEach(t => {
                          if (t.sync_enabled === 1) handleToggleSync(t);
                        });
                      }}
                      className="text-[11px] text-rose-400 hover:underline"
                    >
                      清空手錶歌單
                    </button>
                  )}
                </div>

                {/* 歌曲列表 */}
                {visibleTracks.length === 0 ? (
                  <div className="p-8 text-center bg-neutral-900/30 rounded-3xl border border-neutral-900">
                    <p className="text-xs text-neutral-400">目前尚無歌曲</p>
                  </div>
                ) : (
                  visibleTracks.map(track => {
                    const isTrackPlaying = currentTrack?.id === track.id && isPlaying;
                    return (
                      <div 
                        key={track.id} 
                        className={`flex items-center justify-between p-2.5 rounded-2xl border transition ${
                          currentTrack?.id === track.id 
                            ? 'bg-rose-950/20 border-rose-900/50' 
                            : 'bg-neutral-900/40 border-neutral-900/80 hover:bg-neutral-900'
                        }`}
                      >
                        {/* 左側：Sync 打勾方框 + 播放按鍵 */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                          <button 
                            onClick={() => handleToggleSync(track)}
                            className="p-1 text-neutral-500 hover:text-rose-400 transition shrink-0"
                            title={track.sync_enabled ? "已設定同步至手錶 (點擊取消)" : "尚未同步至手錶 (點擊加入)"}
                          >
                            {track.sync_enabled === 1 ? (
                              <CheckSquare className="w-4 h-4 text-rose-500" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>

                          <button 
                            onClick={() => handlePlay(track)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition active:scale-95 ${
                              isTrackPlaying 
                                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30' 
                                : 'bg-neutral-800 text-neutral-300 hover:text-white'
                            }`}
                          >
                            {isTrackPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate text-neutral-100">{track.title}</p>
                            <p className="text-[10px] text-neutral-400 truncate">
                              {track.folder && <span className="text-amber-500/80 mr-1.5 font-mono">[{track.folder}]</span>}
                              {track.artist} • {formatDuration(track.duration)}
                            </p>
                          </div>
                        </div>

                        {/* 右側：刪除操作 */}
                        <button 
                          onClick={() => handleDelete(track.id)}
                          className="p-1.5 text-neutral-600 hover:text-rose-400 rounded-lg hover:bg-neutral-800/60 transition shrink-0"
                          title="從伺服器刪除此歌曲"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: 音訊下載 (YouTube / Direct URL) */}
        {activeTab === 'download' && (
          <div className="space-y-4">
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-rose-500" />
                <h2 className="text-sm font-bold text-neutral-200">YouTube 音訊下載</h2>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                貼上 YouTube 影片或播放清單網址，自動轉換為 192kbps MP3 並下載至指定資料夾。
              </p>

              <form onSubmit={handleSubmitDownload} className="space-y-3 pt-1">
                <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-semibold">目標個人資料夾</label>
                  <select 
                    value={targetFolder} 
                    onChange={(e) => setTargetFolder(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                  >
                    {folders.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    {!folders.includes('音樂') && <option value="音樂">音樂 (預設)</option>}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-500 uppercase font-semibold">YouTube 網址</label>
                  <input 
                    type="text" 
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full mt-1 px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input 
                    type="checkbox" 
                    id="dlPlaylist" 
                    checked={downloadPlaylist}
                    onChange={(e) => setDownloadPlaylist(e.target.checked)}
                    className="rounded bg-neutral-950 border-neutral-800 text-rose-600 focus:ring-0"
                  />
                  <label htmlFor="dlPlaylist" className="text-xs text-neutral-300">
                    若為播放清單，下載全部歌曲 (預設僅下載單曲)
                  </label>
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmittingDownload || !downloadUrl.trim()}
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50 shadow-md shadow-rose-600/30"
                >
                  {isSubmittingDownload ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>開始下載至我的目錄</span>
                </button>
              </form>
            </div>

            {/* 下載任務狀態 */}
            {Object.keys(tasks).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-neutral-400 px-1">近期下載任務</h3>
                <div className="space-y-1.5">
                  {Object.entries(tasks).map(([tid, task]) => (
                    <div key={tid} className="p-3 rounded-2xl bg-neutral-900/40 border border-neutral-900 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-neutral-200 truncate max-w-[200px]">{task.title}</span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                          task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                          task.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                          'bg-amber-500/10 text-amber-400 animate-pulse'
                        }`}>
                          {task.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 font-mono">{task.progress}</p>
                      {task.error && <p className="text-[10px] text-rose-400">{task.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Podcast 探索與下載 */}
        {activeTab === 'podcast' && (
          <div className="space-y-4">
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic className="w-5 h-5 text-amber-500" />
                  <h2 className="text-sm font-bold text-neutral-200">Podcast 探索與下載</h2>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <span>存入:</span>
                  <select 
                    value={targetFolder} 
                    onChange={(e) => setTargetFolder(e.target.value)}
                    className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-amber-400 focus:outline-none"
                  >
                    {folders.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    {!folders.includes('音樂') && <option value="音樂">音樂</option>}
                  </select>
                </div>
              </div>

              {/* 搜尋列 */}
              <form onSubmit={handleSearchPodcast} className="flex gap-2 pt-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                  <input 
                    type="text" 
                    value={podcastQuery}
                    onChange={(e) => setPodcastQuery(e.target.value)}
                    placeholder="搜尋節目關鍵字 (如: 股惑仔, 百靈果, 敏迪選讀)..."
                    className="w-full pl-9 pr-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={isSearchingPodcast || !podcastQuery.trim()}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-xs transition active:scale-95 disabled:opacity-50"
                >
                  {isSearchingPodcast ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '搜尋'}
                </button>
              </form>
            </div>

            {/* 節目單集檢視 / 搜尋結果列表 */}
            {selectedPodcast ? (
              <div className="space-y-3">
                <button 
                  onClick={() => setSelectedPodcast(null)}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:underline font-semibold"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>返回搜尋結果</span>
                </button>

                <div className="p-3.5 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 flex items-center gap-3">
                  {selectedPodcast.artwork ? (
                    <img src={selectedPodcast.artwork} alt={selectedPodcast.title} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-neutral-800 flex items-center justify-center text-amber-400 shrink-0">
                      <Mic className="w-6 h-6" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-bold text-neutral-100 truncate">{selectedPodcast.title}</h3>
                    <p className="text-[11px] text-neutral-400 truncate">{selectedPodcast.artist}</p>
                    <p className="text-[10px] text-amber-500 mt-0.5">最新收錄 {channelDetail?.episodes.length || 0} 集</p>
                  </div>
                </div>

                {isLoadingEpisodes ? (
                  <div className="p-8 text-center bg-neutral-900/20 rounded-2xl flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                    <p className="text-xs text-neutral-400">正在解析節目單集列表...</p>
                  </div>
                ) : channelDetail?.episodes && channelDetail.episodes.length > 0 ? (
                  <div className="space-y-2">
                    {channelDetail.episodes.map(ep => {
                      const isSubmitting = downloadingEpisodeUrls[ep.audio_url];
                      const activeTask = Object.values(tasks).find(
                        t => (t.url === ep.audio_url || t.title === ep.title) && (t.status === 'processing' || t.status === 'queued')
                      );
                      const isTaskRunning = !!activeTask;
                      const isDownloaded = tracks.some(t => t.title === ep.title);
                      const isDisabled = isSubmitting || isTaskRunning || isDownloaded;

                      return (
                        <div key={ep.id} className="p-3 rounded-2xl bg-neutral-900/40 border border-neutral-900/80 hover:bg-neutral-900 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <h4 className="text-xs font-bold text-neutral-200 line-clamp-2 leading-snug">
                                {ep.title}
                              </h4>
                              <div className="flex items-center gap-3 text-[10px] text-neutral-400 mt-1.5">
                                {ep.published && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3 text-neutral-500" />
                                    {ep.published.slice(0, 16)}
                                  </span>
                                )}
                                {ep.duration && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-neutral-500" />
                                    {ep.duration}
                                  </span>
                                )}
                              </div>
                            </div>

                            <button 
                              disabled={isDisabled}
                              onClick={() => handleDownloadEpisode(ep)}
                              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 shrink-0 transition active:scale-95 ${
                                isDownloaded
                                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 opacity-80 cursor-default'
                                  : isTaskRunning || isSubmitting
                                  ? 'bg-amber-950/80 text-amber-400 border border-amber-800/40 opacity-90 cursor-wait'
                                  : 'bg-neutral-800 hover:bg-amber-600 hover:text-white text-neutral-300'
                              }`}
                              title={
                                isDownloaded 
                                  ? '已下載存入曲庫' 
                                  : isTaskRunning 
                                  ? `下載中 (${activeTask?.progress || '排程中...'})` 
                                  : '下載到伺服器與手錶'
                              }
                            >
                              {isSubmitting || isTaskRunning ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                  <span>下載中</span>
                                </>
                              ) : isDownloaded ? (
                                <>
                                  <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>已下載</span>
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5" />
                                  <span>下載</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center text-xs text-neutral-500 py-6">此節目尚未找到可下載單集</p>
                )}
              </div>
            ) : (
              podcastResults.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-neutral-400 px-1">搜尋結果 ({podcastResults.length})</h3>
                  <div className="space-y-2">
                    {podcastResults.map(p => (
                      <div 
                        key={p.id}
                        onClick={() => handleSelectPodcast(p)}
                        className="flex items-center justify-between p-3 rounded-2xl bg-neutral-900/40 border border-neutral-900/80 hover:bg-neutral-900 cursor-pointer transition active:scale-98"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {p.artwork ? (
                            <img src={p.artwork} alt={p.title} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-neutral-800 flex items-center justify-center text-amber-400 shrink-0">
                              <Mic className="w-5 h-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-neutral-200 truncate">{p.title}</p>
                            <p className="text-[10px] text-neutral-400 truncate">{p.artist}</p>
                            <p className="text-[10px] text-amber-500">{p.trackCount} 集單集</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-600 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Tab 4: 系統設定 (Settings) */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            {/* 1. Google 登入專用手錶密碼設定 */}
            {currentUser?.includes('@') && (
              <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
                <div className="flex items-center gap-2">
                  <Watch className="w-5 h-5 text-amber-400" />
                  <h2 className="text-sm font-bold text-neutral-200">Garmin 手錶專用連線密碼</h2>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  您目前使用 Google 帳號 (<span className="text-amber-400 font-mono">{currentUser}</span>) 登入。因 Garmin 手錶不支援 Google 網頁授權，請在此為手錶設定一組專用連線密碼：
                </p>

                <form onSubmit={handleSetWatchPassword} className="space-y-2.5 pt-1">
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase font-semibold">手錶專用連線密碼 (Watch Password)</label>
                    <input 
                      type="password" 
                      value={watchPassword}
                      onChange={(e) => setWatchPassword(e.target.value)}
                      placeholder="請輸入給手錶連線的密碼..."
                      className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  {watchPwdMsg && (
                    <p className={`text-xs ${watchPwdMsg.includes('成功') ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {watchPwdMsg}
                    </p>
                  )}
                  <button 
                    type="submit"
                    disabled={isSettingWatchPwd || !watchPassword.trim()}
                    className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-98 disabled:opacity-50"
                  >
                    {isSettingWatchPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    <span>確認設定手錶密碼</span>
                  </button>
                </form>
              </div>
            )}

            {/* 2. 管理者使用者管理專區 (Admin Only) */}
            {currentUserRole === 'admin' && (
              <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-rose-500" />
                  <h2 className="text-sm font-bold text-neutral-200">使用者管理 (管理者專屬)</h2>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  管理伺服器用戶，每位使用者皆擁有<b>完全獨立隔離的個人曲庫與資料夾</b>：
                </p>

                {/* 新增使用者表單 */}
                <form onSubmit={handleAdminCreateUser} className="p-3 bg-neutral-950/60 border border-neutral-800/80 rounded-2xl space-y-2.5">
                  <p className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-rose-400" />
                    <span>新增帳號密碼使用者</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-neutral-500">帳號名稱</label>
                      <input 
                        type="text" 
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="例如: runner1"
                        className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-neutral-500">登入密碼</label>
                      <input 
                        type="password" 
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        placeholder="密碼"
                        className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-500">Email (選填)</label>
                    <input 
                      type="text" 
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="選填備註信箱"
                      className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  {adminUserMsg && (
                    <p className={`text-xs ${adminUserMsg.includes('成功') ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {adminUserMsg}
                    </p>
                  )}
                  <button 
                    type="submit"
                    disabled={isCreatingUser || !newUsername.trim() || !newUserPassword.trim()}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition active:scale-98 disabled:opacity-50"
                  >
                    {isCreatingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    <span>確認建立使用者與獨立曲庫</span>
                  </button>
                </form>

                {/* 現有使用者清單 */}
                <div className="space-y-2 pt-1">
                  <h3 className="text-xs font-semibold text-neutral-400 px-1">現有使用者列表 ({userList.length})</h3>
                  <div className="space-y-2">
                    {userList.map(u => (
                      <div key={u.username} className="p-3 bg-neutral-950/80 border border-neutral-800/80 rounded-2xl flex items-center justify-between">
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-neutral-200 truncate">{u.username}</span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                              u.role === 'admin' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              {u.role}
                            </span>
                            {u.has_custom_watch_password && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400" title="已設定手錶密碼">
                                手錶可連線
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500 mt-0.5">
                            曲庫歌曲: {u.track_count || 0} 首 {u.email && `• ${u.email}`}
                          </p>
                        </div>
                        {u.username !== 'admin' && u.username !== currentUser && (
                          <button 
                            onClick={() => handleAdminDeleteUser(u.username)}
                            className="p-1.5 text-neutral-600 hover:text-rose-400 rounded-lg hover:bg-neutral-900 transition shrink-0"
                            title="刪除此用戶與其檔案"
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Google OAuth Client ID 設定 */}
                <div className="p-3 bg-neutral-950/60 border border-neutral-800/80 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-300">Google OAuth Client ID</span>
                    <button 
                      onClick={() => setIsEditingGoogleClientId(!isEditingGoogleClientId)}
                      className="text-xs text-rose-400 hover:underline"
                    >
                      {isEditingGoogleClientId ? '取消' : '變更設定'}
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-500 leading-relaxed">
                    填入 Google Cloud Console 產生的 Web Client ID 後，登入畫面將自動呈現 Google 一鍵登入按鈕。
                  </p>
                  {isEditingGoogleClientId ? (
                    <div className="space-y-2 pt-1">
                      <input 
                        type="text" 
                        value={tempGoogleClientId}
                        onChange={(e) => setTempGoogleClientId(e.target.value)}
                        placeholder="例如: xxxxx.apps.googleusercontent.com"
                        className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs font-mono text-white"
                      />
                      <button 
                        onClick={handleSaveGoogleClientId}
                        className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold"
                      >
                        儲存 Client ID
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-neutral-400 truncate">
                      {googleClientId || '尚未設定'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 3. 一般使用者修改登入密碼 */}
            {!currentUser?.includes('@') && (
              <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-amber-400" />
                  <h2 className="text-sm font-bold text-neutral-200">修改密碼 (手錶與網頁共用)</h2>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  目前登入帳號：<span className="text-rose-400 font-mono font-semibold">{currentUser}</span>。修改後手錶端亦需使用新密碼。
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
            )}

            {/* 4. Server URL 自訂設定 (僅 Admin / Root 可見與修改) */}
            {currentUserRole === 'admin' && (
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
            )}

            {/* 5. Garmin 連線資訊摘要 */}
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-neutral-900 space-y-3">
              <div className="flex items-center gap-2">
                <Watch className="w-5 h-5 text-emerald-400" />
                <h2 className="text-sm font-bold text-neutral-200">Garmin 手錶 App 連線摘要</h2>
              </div>
              <div className="space-y-2 text-xs text-neutral-300">
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-neutral-950/80 border border-neutral-800">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-semibold block">Server URL (手錶伺服器端點)</span>
                    <span className="font-mono text-emerald-400 truncate block text-xs select-all">{serverUrl}</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(serverUrl);
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition active:scale-95 ${
                      copiedUrl 
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white'
                    }`}
                    title="複製 Server URL"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? '已複製' : '複製'}</span>
                  </button>
                </div>
                <p>• <b>Username:</b> <span className="font-mono text-emerald-400">{currentUser}</span></p>
                <p>• <b>Password:</b> 您為此帳號設定的手錶密碼</p>
                <p>• <b>隔離保護:</b> 手錶僅會同步您專屬曲庫中打勾的歌曲。</p>
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

            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {/* 快轉 10 秒按鍵 */}
              <button
                onClick={handleForward10s}
                className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white flex flex-col items-center justify-center transition active:scale-90"
                title="前進 10 秒"
              >
                <div className="relative flex items-center justify-center">
                  <RotateCw className="w-4 h-4 text-neutral-300" />
                  <span className="absolute text-[8px] font-bold text-neutral-200 mt-[1px]">10</span>
                </div>
              </button>

              {/* 倍速切換按鍵 (1 -> 1.2 -> 1.5 -> 1) */}
              <button
                onClick={handleTogglePlaybackRate}
                className={`h-8 px-2 rounded-full border text-[11px] font-bold flex items-center justify-center transition active:scale-90 ${
                  playbackRate !== 1
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-700/60 hover:text-white'
                }`}
                title="切換播放速度 (1x > 1.2x > 1.5x > 1x)"
              >
                {playbackRate}x
              </button>

              {/* 播放 / 暫停按鍵 */}
              <button 
                onClick={() => handlePlay(currentTrack)}
                className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition active:scale-95 shadow-md shadow-rose-600/30"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar (4 個獨立清晰的導航標籤) */}
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
          <Radio className="w-5 h-5" />
          <span className="text-[10px]">音訊下載</span>
        </button>

        <button 
          onClick={() => setActiveTab('podcast')}
          className={`flex flex-col items-center gap-1 transition ${
            activeTab === 'podcast' ? 'text-amber-500 font-semibold' : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Mic className="w-5 h-5" />
          <span className="text-[10px]">Podcast</span>
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
