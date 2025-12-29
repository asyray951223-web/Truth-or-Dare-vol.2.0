const { useState, useEffect, useMemo, useRef } = React;

function App() {
  // === 狀態管理 ===
  const [playableData, setPlayableData] = useState(() => {
    const savedCustom = getSavedState("tod_custom_pack", null);
    const initial = { ...defaultGameData };
    if (savedCustom) {
      initial.custom = savedCustom;
    }
    return initial;
  });
  const [currentCard, setCurrentCard] = useState(null);
  const [usedCardIds, setUsedCardIds] = useState(new Set()); // 追蹤已出過的題目 ID
  const [gameMode, setGameMode] = useState(null); // 'truth', 'dare', 'punishment'
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedPack, setSelectedPack] = useState(() =>
    getSavedState("tod_settings_pack", "普通朋友")
  );
  const [theme, setTheme] = useState(() => getSavedState("tod_theme", "party"));
  const [isMuted, setIsMuted] = useState(false);

  const [isNavOpen, setIsNavOpen] = useState(false);
  const [currentView, setCurrentView] = useState("game");

  // === 多人連線狀態 ===
  const [roomId, setRoomId] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [myUid, setMyUid] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [hostId, setHostId] = useState(null);
  const isRemoteUpdate = React.useRef(false); // 防止無限迴圈更新
  const autoJoinPending = useRef(false); // 標記是否需要自動執行加入邏輯
  const serverTimeOffset = useRef(0); // 伺服器時間偏移量

  // 使用者名稱 (用於連線綁定)
  const [myUserName, setMyUserName] = useState(() =>
    getSavedState("tod_username", "")
  );

  const [onlineUsers, setOnlineUsers] = useState({});

  // === Chat State ===
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef(null);
  const isChatOpenRef = useRef(isChatOpen); // 用於在監聽器中存取最新狀態

  // 最近加入的房間紀錄
  const [recentRooms, setRecentRooms] = useState(() =>
    getSavedState("tod_recent_rooms", [])
  );

  const addToRecentRooms = (id) => {
    setRecentRooms((prev) => {
      const newRooms = [id, ...prev.filter((r) => r !== id)].slice(0, 5);
      localStorage.setItem("tod_recent_rooms", JSON.stringify(newRooms));
      return newRooms;
    });
  };

  // 權限檢查：是否為房主或單機模式 (移至上方以便 Effect 使用)
  const isHost = !isOnline || (hostId && myUid && hostId === myUid);

  // 檢查是否輪到自己 (上一位玩家) 進行抽選
  const isMyTurnToRoll = useMemo(() => {
    if (!isOnline || !lastPlayerId || !myUid) return false;
    const lastPlayer = players.find((p) => p.id === lastPlayerId);
    return lastPlayer && lastPlayer.uid === myUid;
  }, [isOnline, lastPlayerId, players, myUid]);

  // 檢查是否為當前執行任務的玩家 (確保能同步懲罰/完成狀態)
  const isActivePlayer = useMemo(() => {
    if (!isOnline || !activePlayerId || !myUid) return false;
    const activePlayer = players.find((p) => p.id === activePlayerId);
    return activePlayer && activePlayer.uid === myUid;
  }, [isOnline, activePlayerId, players, myUid]);

  // 檢查是否為當前被轉盤選中的玩家 (確保在抽選結果出爐後擁有操作權)
  const isSelectedPlayer = useMemo(() => {
    if (!isOnline || !nextInstruction?.targetPlayer || !myUid) return false;
    return nextInstruction.targetPlayer.uid === myUid;
  }, [isOnline, nextInstruction, myUid]);

  const isFirstMount = useRef(true);
  const rouletteContainerRef = useRef(null);
  const qrCanvasRef = useRef(null);

  // 輪盤狀態
  const [rouletteState, setRouletteState] = useState({
    isSpinning: false,
    items: [],
    targetIndex: 0,
    duration: 5000,
  });

  // 骰子狀態
  const [diceState, setDiceState] = useState({
    value: 1,
    rotation: { x: 0, y: 0 },
    isRolling: false,
  });

  // 炸彈模式狀態
  const [bombState, setBombState] = useState({
    isActive: false,
    isExploded: false,
    timeLeft: 0,
    currentPlayerIdx: 0,
    currentTask: null,
  });
  const [bombDuration, setBombDuration] = useState(60);

  // 轉盤速度
  const [spinDelay, setSpinDelay] = useState(() =>
    getSavedState("tod_settings_speed", 800)
  );

  // 玩家列表
  const [players, setPlayers] = useState(() => {
    const saved = getSavedState("tod_players", defaultPlayers);
    return saved.length > 0 ? saved : defaultPlayers;
  });
  const [newPlayerName, setNewPlayerName] = useState("");

  const [customInputTruth, setCustomInputTruth] = useState("");
  const [customInputDare, setCustomInputDare] = useState("");

  // 當前執行者 ID
  const [activePlayerId, setActivePlayerId] = useState(null);
  const [lastPlayerId, setLastPlayerId] = useState(null);

  const [turnPhase, setTurnPhase] = useState("idle"); // idle, spinning, selected
  const [timer, setTimer] = useState(0);

  const [nextInstruction, setNextInstruction] = useState({
    icon: "🎲",
    text: "準備抽選",
    type: "none",
    targetPlayer: null,
  });

  const [nextPlayerRates, setNextPlayerRates] = useState(() =>
    getSavedState("tod_settings_rates", {
      clockwise: 10,
      random: 70,
      self: 20,
      choose: 0,
    })
  );

  const [difficultyRange, setDifficultyRange] = useState(() =>
    getSavedState("tod_settings_difficulty", { min: 1, max: 6 })
  );

  const [historyLog, setHistoryLog] = useState(() =>
    getSavedState("tod_history", [])
  );

  const [punishmentList, setPunishmentList] = useState(() =>
    getSavedState("tod_punishments", defaultPunishments)
  );
  const [customInputPunishment, setCustomInputPunishment] = useState("");

  const [managingPack, setManagingPack] = useState("custom");

  // === Firebase Auth (匿名登入) ===
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setMyUid(user.uid);
        setConnectionError(null);
      } else {
        auth.signInAnonymously().catch((error) => {
          console.error("Auth Error:", error);
          setConnectionError(error.message);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // === 自動儲存使用者名稱 ===
  useEffect(() => {
    if (myUserName !== undefined) {
      localStorage.setItem("tod_username", JSON.stringify(myUserName));
    }
  }, [myUserName]);

  // === URL Auto-Join Logic (掃描 QR Code 自動加入) ===
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam);
      setIsOnline(true);
      setCurrentView("online");
      autoJoinPending.current = true; // 標記為需要執行加入動作

      // 保存到 LocalStorage 以便 PWA 模式下讀取 (解決安裝後參數遺失問題)
      localStorage.setItem("tod_pending_room", roomParam);
      localStorage.setItem("tod_pending_room_time", Date.now().toString());
    } else {
      // 檢查是否有 Pending Room (針對 PWA 啟動情境)
      const pendingRoom = localStorage.getItem("tod_pending_room");
      const pendingTime = localStorage.getItem("tod_pending_room_time");

      if (pendingRoom && pendingTime) {
        const timeDiff = Date.now() - parseInt(pendingTime);
        if (timeDiff < 5 * 60 * 1000) {
          // 5分鐘內有效，避免無限期自動加入舊房間
          setRoomId(pendingRoom);
          setIsOnline(true);
          setCurrentView("online");
          autoJoinPending.current = true;
        }
        // 取用後清除，避免重複觸發
        localStorage.removeItem("tod_pending_room");
        localStorage.removeItem("tod_pending_room_time");
      }
    }
  }, []);

  // === Auto-Join Execution (執行自動加入) ===
  useEffect(() => {
    // 必須等到取得 myUid 且確實有觸發自動加入需求時才執行
    if (autoJoinPending.current && myUid && roomId && isOnline) {
      autoJoinPending.current = false; // 重置標記，避免重複執行

      const guestName = myUserName || "訪客";

      // 檢查房間是否存在並寫入訪客資料
      db.ref(`rooms/${roomId}`)
        .once("value")
        .then((snapshot) => {
          if (snapshot.exists()) {
            db.ref(`rooms/${roomId}/guests/${myUid}`).set({
              name: guestName,
            });
            addToRecentRooms(roomId);
          } else {
            alert("連結無效：房間不存在或已關閉");
            setIsOnline(false);
          }
        });
    }
  }, [myUid, roomId, isOnline, myUserName]);

  // === Firebase 連線邏輯 (監聽) ===
  useEffect(() => {
    if (!isOnline || !roomId || !myUid) return;

    const roomRef = db.ref(`rooms/${roomId}`);

    const handleData = (snapshot) => {
      const remoteState = snapshot.val();
      if (!remoteState) {
        // 房間不存在或為空
        return;
      }

      // 收到遠端狀態，更新本地狀態
      isRemoteUpdate.current = true;

      // 修正：Firebase 可能將陣列回傳為物件，需轉換回陣列以避免 React 渲染錯誤 (黑屏主因)
      if (remoteState.players) {
        const p = remoteState.players;
        const arr = Array.isArray(p) ? p : Object.values(p);
        setPlayers(arr.filter(Boolean)); // 過濾掉可能的空值 (null/undefined)
      } else {
        setPlayers([]);
      }

      // 修正：確保當遠端狀態為 null/undefined 時，本地狀態也能正確清空 (解決卡片殘留問題)
      setCurrentCard(remoteState.currentCard || null);
      setActivePlayerId(remoteState.activePlayerId || null);
      setLastPlayerId(remoteState.lastPlayerId || null);
      setGameMode(remoteState.gameMode || null);
      setTurnPhase(remoteState.turnPhase || "idle");

      // 強制同步：若處於轉盤轉動階段，強制清空卡片，確保動畫顯示
      if (remoteState.turnPhase === "spinning") {
        setCurrentCard(null);
        setCurrentView("game");
        setIsNavOpen(false);
        setIsChatOpen(false);
      }

      if (remoteState.nextInstruction)
        setNextInstruction(remoteState.nextInstruction);
      if (remoteState.rouletteState) {
        const r = remoteState.rouletteState;
        // 確保 items 是陣列，避免輪盤渲染時崩潰
        if (r.items) {
          if (!Array.isArray(r.items)) {
            r.items = Object.values(r.items);
          }
        } else {
          // 如果 Firebase 沒有儲存 items (因為是空陣列)，則手動補上空陣列
          r.items = [];
        }
        setRouletteState(r);
      }
      if (remoteState.diceState) {
        const d = remoteState.diceState;
        // 確保 rotation 存在，避免 3D 渲染時崩潰
        if (!d.rotation) d.rotation = { x: 0, y: 0 };
        setDiceState(d);
      }
      if (remoteState.bombState) {
        const bs = remoteState.bombState;
        // 修正：使用 Server Time 重新計算 timeLeft 以避免 UI 跳動 (Jitter)
        if (bs.isActive && bs.endTime) {
          const now = Date.now() + serverTimeOffset.current;
          bs.timeLeft = Math.max(0, (bs.endTime - now) / 1000);
        }
        setBombState(bs);
      }

      // === 同步歷史紀錄 ===
      if (remoteState.historyLog) {
        const h = remoteState.historyLog;
        setHistoryLog(Array.isArray(h) ? h : Object.values(h));
      }

      // === 同步自定義題庫 ===
      if (remoteState.customPack) {
        const c = remoteState.customPack;
        // 確保陣列格式，避免 Firebase 物件轉換導致錯誤
        if (c.truth && !Array.isArray(c.truth))
          c.truth = Object.values(c.truth);
        if (c.dare && !Array.isArray(c.dare)) c.dare = Object.values(c.dare);

        setPlayableData((prev) => ({
          ...prev,
          custom: c,
        }));
      }

      // 同步房主 ID，若遠端無房主(舊資料)且我有 ID，則自動補位
      if (remoteState.hostId) {
        setHostId(remoteState.hostId);
      } else if (myUid) {
        setHostId(myUid);
      }

      // 稍微延遲後重置旗標，避免立即觸發回傳
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 100);
    };

    roomRef.on("value", handleData);

    return () => roomRef.off("value", handleData);
  }, [isOnline, roomId, myUid]);

  // === QR Code Generation ===
  useEffect(() => {
    if (isOnline && roomId && currentView === "online" && qrCanvasRef.current) {
      const baseUrl = window.location.href.split("?")[0];
      const joinUrl = `${baseUrl}?room=${roomId}`;
      if (window.QRCode) {
        window.QRCode.toCanvas(
          qrCanvasRef.current,
          joinUrl,
          {
            width: 180,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
          },
          (error) => {
            if (error) console.error(error);
          }
        );
      }
    }
  }, [isOnline, roomId, currentView]);

  // === Firebase 同步邏輯 (寫入) ===
  // 當本地關鍵狀態改變時，寫入資料庫 (如果是遠端更新則不寫入)
  useEffect(() => {
    if (!isOnline || !roomId || isRemoteUpdate.current) return;

    // 只有房主、當前輪到的玩家、正在執行任務或被選中的玩家可以寫入
    if (!isHost && !isMyTurnToRoll && !isActivePlayer && !isSelectedPlayer)
      return;

    // 優化：加入防抖 (Debounce) 機制，避免頻繁寫入資料庫
    const delay = turnPhase === "spinning" ? 0 : 500; // 轉動時立即同步，避免競態條件
    const timerId = setTimeout(() => {
      const stateToSync = {
        players,
        currentCard,
        activePlayerId,
        lastPlayerId,
        gameMode,
        turnPhase,
        nextInstruction,
        rouletteState,
        diceState,
        bombState,
        hostId,
        historyLog,
        customPack: playableData.custom,
      };
      db.ref(`rooms/${roomId}`).update(stateToSync);
    }, delay);

    return () => clearTimeout(timerId);
  }, [
    players,
    currentCard,
    activePlayerId,
    lastPlayerId,
    gameMode,
    turnPhase,
    nextInstruction,
    rouletteState,
    diceState,
    bombState,
    isOnline,
    hostId,
    roomId,
    isHost,
    isMyTurnToRoll,
    isActivePlayer,
    isSelectedPlayer,
    historyLog,
    playableData,
  ]);

  // === Host: 監聽訪客加入請求並自動綁定 ===
  useEffect(() => {
    if (!isHost || !roomId || !isOnline) return;

    const guestsRef = db.ref(`rooms/${roomId}/guests`);
    const handleGuests = (snapshot) => {
      const guests = snapshot.val();
      if (!guests) return;

      // 使用 transaction 確保在多人連線時不會因為競態條件導致玩家名單覆蓋
      db.ref(`rooms/${roomId}/players`).transaction((currentPlayers) => {
        let newPlayers = [];
        if (currentPlayers) {
          newPlayers = Array.isArray(currentPlayers)
            ? [...currentPlayers]
            : Object.values(currentPlayers);
        }
        let hasChange = false;

        Object.entries(guests).forEach(([uid, data]) => {
          // 如果該 UID 尚未綁定任何玩家，則新增玩家
          if (!newPlayers.some((p) => p.uid === uid)) {
            newPlayers.push({
              id: Date.now() + Math.floor(Math.random() * 1000),
              name: data.name || "訪客",
              uid: uid, // 綁定 UID
              weight: 5,
              score: 0,
              history: { truth: 0, dare: 0, punishment: 0 },
            });
            hasChange = true;
          }
        });

        return hasChange ? newPlayers : undefined;
      });
    };

    guestsRef.on("value", handleGuests);
    return () => guestsRef.off("value", handleGuests);
  }, [isHost, roomId, isOnline]);

  // === Presence System (Online Status) ===
  useEffect(() => {
    if (!isOnline || !roomId || !myUid) return;

    const connectedRef = db.ref(".info/connected");
    const myPresenceRef = db.ref(`rooms/${roomId}/presence/${myUid}`);
    const roomPresenceRef = db.ref(`rooms/${roomId}/presence`);

    const handleConnected = (snap) => {
      if (snap.val() === true) {
        myPresenceRef.onDisconnect().remove();
        myPresenceRef.set(true);
      }
    };

    const handleRoomPresence = (snap) => {
      setOnlineUsers(snap.val() || {});
    };

    connectedRef.on("value", handleConnected);
    roomPresenceRef.on("value", handleRoomPresence);

    return () => {
      connectedRef.off("value", handleConnected);
      roomPresenceRef.off("value", handleRoomPresence);
      myPresenceRef.remove();
    };
  }, [isOnline, roomId, myUid]);

  // === Time Sync (校正伺服器時間) ===
  useEffect(() => {
    if (!isOnline) return;
    const offsetRef = db.ref(".info/serverTimeOffset");
    const handleOffset = (snap) => {
      serverTimeOffset.current = snap.val() || 0;
    };
    offsetRef.on("value", handleOffset);
    return () => offsetRef.off("value", handleOffset);
  }, [isOnline]);

  // === Player Join Notification (玩家加入提示) ===
  const prevPlayerCount = useRef(players.length);
  useEffect(() => {
    if (players.length > prevPlayerCount.current) {
      // 當玩家人數增加時，播放清脆的提示音 (Ding!)
      soundManager.playTone(1200, "sine", 0.1, 0.1);
      setTimeout(() => soundManager.playTone(1800, "sine", 0.2, 0.1), 100);
    }
    prevPlayerCount.current = players.length;
  }, [players]);

  // === Chat System ===
  // 更新 Ref 以便在 Firebase callback 中讀取
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
    if (isChatOpen) setUnreadCount(0);
  }, [isChatOpen]);

  // 監聽聊天訊息
  useEffect(() => {
    if (!isOnline || !roomId) return;

    const chatRef = db.ref(`rooms/${roomId}/chat`).limitToLast(50);

    const handleChatUpdate = (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setChatMessages([]);
        return;
      }
      // 轉換為陣列並排序
      const msgs = Object.entries(data)
        .map(([key, val]) => ({ id: key, ...val }))
        .sort((a, b) => a.timestamp - b.timestamp);

      setChatMessages((prev) => {
        // 如果不是初始載入，且有新訊息，且聊天室關閉中 -> 增加未讀並提示
        if (
          prev.length > 0 &&
          msgs.length > prev.length &&
          !isChatOpenRef.current
        ) {
          soundManager.playTick();
          setUnreadCount((c) => c + (msgs.length - prev.length));
        }
        return msgs;
      });
    };

    chatRef.on("value", handleChatUpdate);
    return () => chatRef.off("value", handleChatUpdate);
  }, [isOnline, roomId]);

  // 自動捲動到底部
  useEffect(() => {
    if (isChatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, isChatOpen]);

  // === Force Redirect to Game View on Spin (Sync) ===
  useEffect(() => {
    if (isOnline && turnPhase === "spinning") {
      if (currentView !== "game") setCurrentView("game");
      if (isNavOpen) setIsNavOpen(false);
      if (isChatOpen) setIsChatOpen(false);
    }
  }, [isOnline, turnPhase, currentView, isNavOpen, isChatOpen]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMessage = {
      text: chatInput.trim(),
      senderId: myUid,
      senderName: myUserName || "玩家",
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    };

    db.ref(`rooms/${roomId}/chat`).push(newMessage);
    setChatInput("");
  };

  // === 核心邏輯 ===

  const handleAddPlayer = (e) => {
    soundManager.playClick();
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    const newPlayer = {
      id: Date.now(),
      name: newPlayerName.trim(),
      weight: 5,
      score: 0,
      history: { truth: 0, dare: 0, punishment: 0 },
    };
    setPlayers([...players, newPlayer]);
    setNewPlayerName("");
  };

  const handleQuickSetup = () => {
    soundManager.playClick();
    if (
      players.length > 0 &&
      !window.confirm("這將會覆蓋目前的玩家名單，確定要執行嗎？")
    ) {
      return;
    }
    const quickPlayers = Array.from({ length: 4 }, (_, i) => ({
      id: Date.now() + i,
      name: `玩家${i + 1}`,
      weight: 5,
      score: 0,
      history: { truth: 0, dare: 0, punishment: 0 },
    }));
    setPlayers(quickPlayers);
  };

  const handleRemovePlayer = (id) => {
    soundManager.playClick();
    const playerToRemove = players.find((p) => p.id === id);
    if (
      !window.confirm(
        `確定要踢出玩家「${playerToRemove ? playerToRemove.name : ""}」嗎？`
      )
    ) {
      return;
    }
    setPlayers(players.filter((p) => p.id !== id));
    if (activePlayerId === id) {
      reset(); // 如果被踢的是當前玩家，重置回合
    }
  };

  const handleEditPlayerName = (id, currentName) => {
    if (!isHost) return;
    soundManager.playClick();
    const newName = prompt("請輸入新的玩家名稱：", currentName);
    if (newName && newName.trim()) {
      setPlayers((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: newName.trim() } : p))
      );
    }
  };

  const handlePlayerWeightChange = (id, newWeight) => {
    // No sound for slider drag to avoid spam
    setPlayers(
      players.map((p) =>
        p.id === id ? { ...p, weight: parseInt(newWeight) } : p
      )
    );
  };

  const pickSpecificPlayer = () => {
    if (players.length === 0) return null;
    const totalWeight = players.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) return null;
    let randomNum = Math.random() * totalWeight;
    for (const player of players) {
      if (randomNum < player.weight) return player;
      randomNum -= player.weight;
    }
    return players[0];
  };

  const getRandomRouletteItem = () => {
    if (players.length === 0)
      return { icon: "❓", text: "無玩家", type: "none" };
    const pool = players.map((p) => ({
      icon: "👤",
      text: p.name,
      type: "player",
      id: p.id,
    }));

    // Add flavor items based on settings
    if (nextPlayerRates.clockwise > 0)
      pool.push({ icon: "👉", text: "順時針", type: "flavor" });
    if (nextPlayerRates.self > 0)
      pool.push({ icon: "🔄", text: "連莊", type: "flavor" });

    return pool[Math.floor(Math.random() * pool.length)];
  };

  const triggerRandomDestiny = (player) => {
    const rand = Math.random();
    if (rand < 0.4) {
      drawCard("truth", player);
    } else if (rand < 0.8) {
      drawCard("dare", player);
    } else {
      drawPassCard(player);
    }
  };

  const drawPassCard = (player) => {
    if (player) setActivePlayerId(player.id);
    setIsAnimating(true);
    setGameMode("pass");
    setTimeout(() => {
      setCurrentCard({
        id: "pass_" + Date.now(),
        text: "下面一位！(直接跳過)",
        type: "pass",
      });
      setIsAnimating(false);
    }, spinDelay);
  };

  const rollNextPlayer = (instant = false) => {
    soundManager.playClick();
    if (players.length === 0) {
      alert("請先新增玩家！");
      return;
    }

    // 1. Calculate Weights
    const rates = nextPlayerRates;
    const options = [{ type: "random", weight: rates.random }];

    // Only add relative options if we have history and valid last player
    if (lastPlayerId && players.find((p) => p.id === lastPlayerId)) {
      options.push({ type: "self", weight: rates.self });
      if (players.length > 1) {
        options.push({ type: "clockwise", weight: rates.clockwise });
      }
    }

    const totalWeight = options.reduce((sum, opt) => sum + opt.weight, 0);
    let selectedType = "random";

    if (totalWeight > 0) {
      let r = Math.random() * totalWeight;
      for (const opt of options) {
        if (r < opt.weight) {
          selectedType = opt.type;
          break;
        }
        r -= opt.weight;
      }
    }

    // 2. Resolve to Player
    let targetPlayer = null;
    let displayText = "";
    let displayIcon = "";

    if (selectedType === "clockwise") {
      const lastIdx = players.findIndex((p) => p.id === lastPlayerId);
      const nextIdx = (lastIdx + 1) % players.length;
      targetPlayer = players[nextIdx];
      displayText = `順時針 (${targetPlayer.name})`;
      displayIcon = "👉";
    } else if (selectedType === "self") {
      targetPlayer = players.find((p) => p.id === lastPlayerId);
      displayText = `連莊 (${targetPlayer.name})`;
      displayIcon = "🔄";
    } else {
      // Random
      targetPlayer = pickSpecificPlayer();
      displayText = targetPlayer.name;
      displayIcon = "👤";
    }

    const result = {
      id: "player",
      icon: displayIcon,
      text: displayText,
      type: "player",
      targetPlayer: targetPlayer,
    };

    finalizeRoll(result, instant);
  };

  const finalizeRoll = (result, instant) => {
    isRemoteUpdate.current = false; // 確保本地操作能觸發 Firebase 同步
    setCurrentCard(null); // 確保本地卡片被移除，優先顯示轉盤
    if (instant) {
      setNextInstruction(result);
      setRouletteState({
        isSpinning: false,
        items: [result],
        targetIndex: 0,
      });
      setTurnPhase("selected");
      return;
    }

    setTurnPhase("spinning");

    // 準備輪盤動畫數據
    const totalItems = 60;
    const targetIndex = 50;
    const spinDuration = 5000;
    // 動態調整轉動時間 (3s ~ 8s)，讓其受「轉盤速度」設定影響
    const spinDuration1 = Math.min(Math.max(spinDelay * 5, 3000), 8000);

    // 為了視覺連續性，列表的第一個項目應該是當前顯示的項目
    const startItem = nextInstruction;

    const items = Array.from({ length: totalItems }, (_, i) => {
      if (i === 0) return startItem;
      if (i === targetIndex) return result;
      return getRandomRouletteItem();
    });

    // 1. 直接開始旋轉 (移除 setTimeout 以避免狀態不同步)
    setRouletteState({
      isSpinning: true,
      items,
      targetIndex,
      duration: spinDuration,
      startTime: Date.now() + serverTimeOffset.current,
    });

    // 2. 動畫結束後更新指令並解鎖
    setTimeout(() => {
      soundManager.playWin();
      if (navigator.vibrate) navigator.vibrate([50, 50, 100]); // 震動回饋：成功模式 (震-停-震)
      setNextInstruction(result);
      setRouletteState((prev) => ({ ...prev, isSpinning: false }));
      setTurnPhase("selected");

      // 自動觸發隨機命運
      setTimeout(() => {
        triggerRandomDestiny(result.targetPlayer);
      }, 1000);
    }, spinDuration);
  };

  const toggleMute = () => {
    soundManager.muted = !soundManager.muted;
    setIsMuted(soundManager.muted);
    if (!soundManager.muted) soundManager.playClick();
  };

  const drawCard = (type, specificPlayer = null) => {
    if (isAnimating || rouletteState.isSpinning) return;
    soundManager.playClick();

    let deck = [];

    if (selectedPack === "custom") {
      // 混沌大亂鬥：聚合所有題庫
      Object.values(playableData).forEach((pack) => {
        if (pack[type]) {
          deck = [...deck, ...pack[type]];
        }
      });
    } else {
      // 一般模式：該模式題目 + 自定義題目 (全模式通用)
      if (playableData[selectedPack]?.[type]) {
        deck = [...playableData[selectedPack][type]];
      }
      if (playableData.custom?.[type]) {
        deck = [...deck, ...playableData.custom[type]];
      }
    }

    if (!deck || deck.length === 0) {
      alert(`😱 喔喔！題庫是空的！`);
      return;
    }

    // 過濾掉已使用過的題目
    const availableDeck = deck.filter(
      (card) =>
        !usedCardIds.has(card.id) &&
        (card.level === undefined ||
          (card.level >= difficultyRange.min &&
            card.level <= difficultyRange.max))
    );

    if (availableDeck.length === 0) {
      if (
        window.confirm(
          "🎉 符合當前難度設定的題目已全部抽完！是否要重置並重新開始？"
        )
      ) {
        setUsedCardIds(new Set());
        // 重置後不立即抽牌，讓使用者再點一次，避免混亂
      }
      return;
    }

    const target = specificPlayer || nextInstruction.targetPlayer;
    setActivePlayerId(target ? target.id : null);

    setIsAnimating(true);
    setGameMode(type);

    setTimeout(() => {
      const randomIdx = Math.floor(Math.random() * availableDeck.length);
      const selectedCard = availableDeck[randomIdx];
      setCurrentCard(selectedCard);
      setUsedCardIds((prev) => new Set(prev).add(selectedCard.id));
      setIsAnimating(false);
    }, spinDelay);
  };

  const drawPunishment = () => {
    if (isAnimating || rouletteState.isSpinning) return;
    soundManager.playClick();
    setIsAnimating(true);
    setGameMode("punishment");
    setTimeout(() => {
      const randomIdx = Math.floor(Math.random() * punishmentList.length);
      setCurrentCard(punishmentList[randomIdx]);
      setIsAnimating(false);
    }, spinDelay + 200);
  };

  const completeTurn = () => {
    soundManager.playClick();
    if (activePlayerId && gameMode !== "pass") {
      const player = players.find((p) => p.id === activePlayerId);
      if (player && currentCard) {
        setHistoryLog((prev) => [
          {
            id: Date.now(),
            type: gameMode,
            text: currentCard.text,
            playerName: player.name,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
          ...prev,
        ]);
      }
      setLastPlayerId(activePlayerId);
      setPlayers((prevPlayers) =>
        prevPlayers.map((p) => {
          if (p.id === activePlayerId) {
            const scoreToAdd = gameMode === "dare" ? 2 : 1;
            const historyKey = gameMode;
            return {
              ...p,
              score: p.score + scoreToAdd,
              history: {
                ...p.history,
                [historyKey]: p.history[historyKey] + 1,
              },
            };
          }
          return p;
        })
      );
    }
    setCurrentCard(null);
    setGameMode(null);
    setActivePlayerId(null);
    setTurnPhase("idle");
  };

  const rollDice = () => {
    if (diceState.isRolling) return;
    soundManager.playClick();

    const target = Math.floor(Math.random() * 6) + 1;

    // 定義每個點數對應的旋轉角度 (Base rotations)
    // 1: (0, 0), 2: (0, -90), 3: (0, 180), 4: (0, 90), 5: (-90, 0), 6: (90, 0)
    let baseX = 0,
      baseY = 0;
    switch (target) {
      case 1:
        baseX = 0;
        baseY = 0;
        break;
      case 2:
        baseX = 0;
        baseY = -90;
        break;
      case 3:
        baseX = 0;
        baseY = 180;
        break;
      case 4:
        baseX = 0;
        baseY = 90;
        break;
      case 5:
        baseX = -90;
        baseY = 0;
        break;
      case 6:
        baseX = 90;
        baseY = 0;
        break;
    }

    // 增加隨機圈數 (至少 2 圈，至多 4 圈)
    const spins = 2 + Math.floor(Math.random() * 3);
    const extraX = 360 * spins;
    const extraY = 360 * spins;

    // 計算累積旋轉角度，確保動畫順暢連接
    const currentX = diceState.rotation.x;
    const currentY = diceState.rotation.y;

    // 算法：當前角度 + (補足到360的倍數) + 目標基礎角度 + 額外圈數
    const modX = ((currentX % 360) + 360) % 360;
    const modY = ((currentY % 360) + 360) % 360;

    const newX = currentX + (360 - modX) + baseX + extraX;
    const newY = currentY + (360 - modY) + baseY + extraY;

    setDiceState({
      value: target,
      rotation: { x: newX, y: newY },
      isRolling: true,
    });

    // 播放滾動音效
    let ticks = 0;
    const interval = setInterval(() => {
      // 根據點數大小決定音高 (點數越大音越高)，並加入些微隨機感
      const baseFreq = 200 + target * 100;
      const jitter = (Math.random() - 0.5) * 50;
      soundManager.playTone(baseFreq + jitter, "square", 0.05, 0.03);
      if (navigator.vibrate) navigator.vibrate(15);
      ticks++;
      if (ticks > 8) clearInterval(interval);
    }, 100);

    setTimeout(() => {
      setDiceState((prev) => ({ ...prev, isRolling: false }));
      soundManager.playWin();
      if (navigator.vibrate) navigator.vibrate([50, 50, 100]);
    }, 1000);
  };

  // 炸彈模式邏輯
  const startBombGame = () => {
    if (players.length < 2) {
      alert("炸彈模式至少需要 2 位玩家！");
      return;
    }
    soundManager.playClick();
    const now = Date.now() + serverTimeOffset.current; // 使用校正後的伺服器時間
    setBombState({
      isActive: true,
      isExploded: false,
      endTime: now + bombDuration * 1000, // 設定結束時間戳記
      timeLeft: bombDuration,
      currentPlayerIdx: Math.floor(Math.random() * players.length),
      currentTask: null,
    });
  };

  const drawBombTask = () => {
    soundManager.playClick();
    // 隨機抽取一個題目 (混合真心話與大冒險)
    let deck = [];
    if (selectedPack === "custom") {
      Object.values(playableData).forEach((pack) => {
        if (pack.truth) deck = [...deck, ...pack.truth];
        if (pack.dare) deck = [...deck, ...pack.dare];
      });
    } else {
      if (playableData[selectedPack]) {
        deck = [
          ...playableData[selectedPack].truth,
          ...playableData[selectedPack].dare,
        ];
      }
      if (playableData.custom) {
        deck = [
          ...deck,
          ...playableData.custom.truth,
          ...playableData.custom.dare,
        ];
      }
    }

    if (deck.length === 0) {
      setBombState((prev) => ({
        ...prev,
        currentTask: { text: "快傳給下一個人！(無題目)" },
      }));
      return;
    }

    const randomCard = deck[Math.floor(Math.random() * deck.length)];
    setBombState((prev) => ({ ...prev, currentTask: randomCard }));
  };

  const passBomb = () => {
    soundManager.playClick();
    setBombState((prev) => ({
      ...prev,
      currentPlayerIdx: (prev.currentPlayerIdx + 1) % players.length,
      currentTask: null,
    }));
  };

  const handleBombPunishment = () => {
    soundManager.playClick();
    const randomIdx = Math.floor(Math.random() * punishmentList.length);
    setBombState((prev) => ({
      ...prev,
      currentTask: punishmentList[randomIdx], // 借用 currentTask 顯示懲罰
    }));
  };

  const handleAddQuestion = (pack, type, text, setText) => {
    if (!text.trim()) return;
    soundManager.playClick();
    setPlayableData((prev) => ({
      ...prev,
      [pack]: {
        ...prev[pack],
        [type]: [
          ...prev[pack][type],
          {
            id: `${pack}_${type}_${Date.now()}`,
            text: text.trim(),
            level: 1,
          },
        ],
      },
    }));
    setText("");
  };

  const handleRemoveQuestion = (pack, type, id) => {
    soundManager.playClick();
    setPlayableData((prev) => ({
      ...prev,
      [pack]: {
        ...prev[pack],
        [type]: prev[pack][type].filter((item) => item.id !== id),
      },
    }));
  };

  const addPunishment = (text) => {
    soundManager.playClick();
    if (!text.trim()) return;
    setPunishmentList((prev) => [
      ...prev,
      { id: `p_c_${Date.now()}`, text: text.trim(), type: "custom" },
    ]);
    setCustomInputPunishment("");
  };

  const removePunishment = (id) => {
    soundManager.playClick();
    setPunishmentList((prev) => prev.filter((p) => p.id !== id));
  };

  const handleRateChange = (key, value) => {
    const newVal = parseInt(value);
    setNextPlayerRates((prev) => {
      const activeKeys = ["clockwise", "random", "self"];
      if (!activeKeys.includes(key)) return { ...prev, [key]: newVal };

      const otherKeys = activeKeys.filter((k) => k !== key);
      const currentSumOthers = otherKeys.reduce((sum, k) => sum + prev[k], 0);

      if (newVal + currentSumOthers <= 100) {
        return { ...prev, [key]: newVal };
      }

      let remainingOverflow = newVal + currentSumOthers - 100;
      let newRates = { ...prev, [key]: newVal };
      const othersSorted = otherKeys
        .map((k) => ({ key: k, val: prev[k] }))
        .sort((a, b) => b.val - a.val);

      for (const other of othersSorted) {
        if (remainingOverflow <= 0) break;
        const deduction = Math.min(other.val, remainingOverflow);
        newRates[other.key] -= deduction;
        remainingOverflow -= deduction;
      }
      return newRates;
    });
  };

  const handleClearPack = (pack) => {
    if (
      window.confirm(
        `確定要清空「${pack === "custom" ? "自定義" : pack}」的所有題目嗎？`
      )
    ) {
      soundManager.playClick();
      setPlayableData((prev) => ({
        ...prev,
        [pack]: { truth: [], dare: [] },
      }));
    }
  };

  const handleRestorePack = (pack) => {
    if (pack === "custom") return;
    if (window.confirm(`確定要將「${pack}」恢復為預設值嗎？`)) {
      soundManager.playClick();
      setPlayableData((prev) => ({
        ...prev,
        [pack]: JSON.parse(JSON.stringify(defaultGameData[pack])),
      }));
    }
  };

  const handleRestoreDefault = () => {
    if (window.confirm("重置所有設定?")) {
      soundManager.playClick();
      setPlayableData(defaultGameData);
      setSelectedPack("普通朋友");
      localStorage.removeItem("tod_custom_pack");
      setPunishmentList(defaultPunishments);
      localStorage.removeItem("tod_punishments");
      setNextPlayerRates({
        clockwise: 10,
        random: 70,
        self: 20,
        choose: 0,
      });
      setDifficultyRange({ min: 1, max: 6 });
      localStorage.removeItem("tod_settings_difficulty");
      setSpinDelay(800);
      setPlayers([...defaultPlayers]);
      setHistoryLog([]);
      localStorage.removeItem("tod_history");
      setUsedCardIds(new Set());
      reset();
    }
  };

  // 複製房間連結
  const handleCopyLink = () => {
    soundManager.playClick();
    const baseUrl = window.location.href.split("?")[0];
    const joinUrl = `${baseUrl}?room=${roomId}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(joinUrl)
        .then(() => alert("連結已複製！快傳給朋友吧！"))
        .catch((err) => prompt("複製失敗，請手動複製：", joinUrl));
    } else {
      prompt("請手動複製連結：", joinUrl);
    }
  };

  // 截圖分享功能
  const handleShare = async () => {
    soundManager.playClick();
    const cardElement = document.getElementById("game-card");
    if (!cardElement) return;

    try {
      const canvas = await window.html2canvas(cardElement, {
        backgroundColor: theme === "party" ? "#ffffff" : "#1e1e1e",
        scale: 2, // 提高解析度
        logging: false,
        useCORS: true,
      });

      canvas.toBlob(async (blob) => {
        if (!blob) return;

        // 嘗試使用 Web Share API (手機端)
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], "tod_card.png", {
            type: "image/png",
          });
          const shareData = {
            files: [file],
            title: "真心話大冒險",
            text: "這題太狠了！😱 #TruthOrDare",
          };

          if (navigator.canShare(shareData)) {
            try {
              await navigator.share(shareData);
              return;
            } catch (err) {
              console.log("Share cancelled/failed", err);
            }
          }
        }

        // 備案：直接下載 (電腦端)
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `tod_card_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      console.error("Screenshot error:", err);
      alert("截圖失敗，請稍後再試");
    }
  };

  // 資料匯出
  const handleExportData = () => {
    soundManager.playClick();
    const data = {
      players,
      playableData,
      punishments: punishmentList,
      settings: {
        theme,
        spinDelay,
        selectedPack,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tod_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 資料匯入
  const handleImportData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.players) setPlayers(data.players);
        if (data.playableData) {
          setPlayableData((prev) => ({ ...prev, ...data.playableData }));
        } else if (data.customPack) {
          setPlayableData((prev) => ({
            ...prev,
            custom: data.customPack,
          }));
        }
        if (data.punishments) setPunishmentList(data.punishments);
        if (data.settings) {
          if (data.settings.theme) setTheme(data.settings.theme);
          if (data.settings.spinDelay) setSpinDelay(data.settings.spinDelay);
          if (data.settings.selectedPack)
            setSelectedPack(data.settings.selectedPack);
        }
        alert("資料匯入成功！");
        soundManager.playWin();
      } catch (err) {
        alert("匯入失敗：檔案格式錯誤");
      }
    };
    reader.readAsText(file);
  };

  // 自定義題庫匯出
  const handleExportCustomPack = () => {
    soundManager.playClick();
    const data = playableData.custom || { truth: [], dare: [] };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tod_custom_pack_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 自定義題庫匯入
  const handleImportCustomPack = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (
          data.truth &&
          Array.isArray(data.truth) &&
          data.dare &&
          Array.isArray(data.dare)
        ) {
          setPlayableData((prev) => ({
            ...prev,
            custom: data,
          }));
          alert("自定義題庫匯入成功！");
          soundManager.playWin();
        } else {
          alert("匯入失敗：格式不符 (需包含 truth 和 dare 陣列)");
        }
      } catch (err) {
        alert("匯入失敗：檔案格式錯誤");
      }
    };
    reader.readAsText(file);
  };

  const toggleTheme = () => {
    soundManager.playClick();
    setTheme((prev) => (prev === "royal" ? "party" : "royal"));
  };
  const reset = () => {
    setCurrentCard(null);
    setGameMode(null);
    setActivePlayerId(null);
    setTurnPhase("idle");
  };

  // 當切換題庫時，重置已使用的題目紀錄
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    setUsedCardIds(new Set());

    // 自動調整難度範圍
    let newRange = { min: 1, max: 6 };
    switch (selectedPack) {
      case "合家歡樂":
        newRange = { min: 1, max: 1 };
        break;
      case "普通朋友":
        newRange = { min: 1, max: 3 };
        break;
      case "生死之交":
        newRange = { min: 2, max: 5 };
        break;
      case "感情鑑定":
        newRange = { min: 1, max: 5 };
        break;
      case "only大人":
        newRange = { min: 3, max: 6 };
        break;
      default:
        newRange = { min: 1, max: 6 };
    }
    setDifficultyRange(newRange);
  }, [selectedPack]);

  // 自動存檔：當主題或玩家資料變更時，寫入 LocalStorage
  useEffect(() => {
    localStorage.setItem("tod_theme", JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("tod_players", JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    if (playableData.custom) {
      localStorage.setItem(
        "tod_custom_pack",
        JSON.stringify(playableData.custom)
      );
    }
  }, [playableData]);

  // 自動存檔：設定與機率
  useEffect(() => {
    localStorage.setItem("tod_settings_pack", JSON.stringify(selectedPack));
  }, [selectedPack]);

  useEffect(() => {
    localStorage.setItem("tod_settings_speed", JSON.stringify(spinDelay));
  }, [spinDelay]);

  useEffect(() => {
    localStorage.setItem("tod_settings_rates", JSON.stringify(nextPlayerRates));
  }, [nextPlayerRates]);

  useEffect(() => {
    localStorage.setItem(
      "tod_settings_difficulty",
      JSON.stringify(difficultyRange)
    );
  }, [difficultyRange]);

  useEffect(() => {
    localStorage.setItem("tod_punishments", JSON.stringify(punishmentList));
  }, [punishmentList]);

  useEffect(() => {
    localStorage.setItem("tod_history", JSON.stringify(historyLog));
  }, [historyLog]);

  // 計時器邏輯
  useEffect(() => {
    let interval;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      // 最後 3 秒發出警示
      if (timer <= 3) soundManager.playTick();
    } else if (timer === 0 && interval) {
      // 這裡邏輯有點複雜，因為 timer 0 會觸發清除 interval
      // 簡單處理：在 timer 變更為 0 的前一刻（即 1 -> 0）觸發鬧鐘
      // 但在 useEffect 中較難捕捉，改在 setTimer 處處理或忽略
    }
    return () => clearInterval(interval);
  }, [timer]);

  // 切換卡片時重置計時器
  useEffect(() => setTimer(0), [currentCard]);

  // 優化：輪盤動畫邏輯 (JS Driven Animation)
  // 改用 JS 計算位置以避免 getComputedStyle 造成的 Layout Thrashing
  useEffect(() => {
    if (!rouletteState.isSpinning) return;

    let animationFrameId;

    // 計算動畫起始時間 (支援多端同步)
    let timeCorrection = 0;
    if (rouletteState.startTime) {
      const serverNow = Date.now() + serverTimeOffset.current;
      const diff = serverNow - rouletteState.startTime;
      // 若計算出的經過時間超過動畫總長，可能是時鐘偏差過大
      // 此時強制重置 timeCorrection 為 0，確保動畫能播放 (犧牲同步性換取體驗)
      if (diff > rouletteState.duration) {
        timeCorrection = 0;
      } else {
        timeCorrection = Math.max(0, diff);
      }
    }
    const startTime = performance.now() - timeCorrection;

    const startPos = 112; // 起始偏移量 (第一個項目的中心)
    // 目標位置：targetIndex * itemWidth(224) + centerOffset(112)
    const endPos = rouletteState.targetIndex * 224 + 112;
    const distance = endPos - startPos;
    const duration = rouletteState.duration;

    let lastIndex = -1;
    let lastPos = startPos;

    const animate = (time) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing: EaseOutQuart (類似 cubic-bezier(0.1, 0.7, 0.1, 1) 的快速啟動慢速停止效果)
      const ease = 1 - Math.pow(1 - progress, 4);

      const currentPos = startPos + distance * ease;

      if (rouletteContainerRef.current) {
        // 直接操作 DOM transform，避免 reflow
        rouletteContainerRef.current.style.transform = `translateX(-${currentPos}px)`;

        // 1. 音效觸發 (基於計算出的位置)
        const currentIndex = Math.round((currentPos - 112) / 224);
        if (currentIndex !== lastIndex && currentIndex >= 0) {
          soundManager.playTick();
          if (navigator.vibrate) navigator.vibrate(15); // 震動回饋：轉動時的短震動
          lastIndex = currentIndex;
        }

        // 2. 動態模糊 (基於速度)
        const velocity = Math.abs(currentPos - lastPos); // pixels per frame
        const blurAmount = Math.min(velocity * 0.5, 8);
        rouletteContainerRef.current.style.filter = `blur(${blurAmount}px)`;
      }

      lastPos = currentPos;

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        // 動畫結束
        if (rouletteContainerRef.current) {
          rouletteContainerRef.current.style.filter = "none";
          // 確保最後位置準確
          rouletteContainerRef.current.style.transform = `translateX(-${endPos}px)`;
        }
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (rouletteContainerRef.current) {
        rouletteContainerRef.current.style.filter = "none";
      }
    };
  }, [
    rouletteState.isSpinning,
    rouletteState.targetIndex,
    rouletteState.duration,
    rouletteState.startTime,
  ]);

  // 炸彈計時器
  useEffect(() => {
    let interval;
    if (bombState.isActive && bombState.timeLeft > 0) {
      interval = setInterval(() => {
        setBombState((prev) => {
          // 如果有 endTime，使用時間戳記計算剩餘時間 (確保多端同步)
          // 否則使用舊的遞減方式 (相容性)
          let newTime;
          if (prev.endTime) {
            const now = Date.now() + serverTimeOffset.current; // 使用校正後的伺服器時間
            newTime = Math.max(0, (prev.endTime - now) / 1000);
          } else {
            newTime = prev.timeLeft - 0.1;
          }

          // 音效邏輯
          if (newTime <= 0) {
            // 只有房主能觸發爆炸狀態更新，訪客等待同步
            if (isHost) {
              soundManager.playExplosion();
              return {
                ...prev,
                isActive: false,
                isExploded: true,
                timeLeft: 0,
              };
            }
            return { ...prev, timeLeft: 0 };
          }

          // 根據剩餘時間調整滴答聲頻率
          const tickInterval = prev.timeLeft > 10 ? 1 : 0.2;
          const shouldTick =
            Math.floor(prev.timeLeft / tickInterval) !==
            Math.floor(newTime / tickInterval);

          if (shouldTick) {
            soundManager.playTick();
          }

          return { ...prev, timeLeft: newTime };
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [bombState.isActive, isHost]);

  // 監聽爆炸狀態以播放音效 (針對訪客)
  useEffect(() => {
    if (bombState.isExploded) {
      soundManager.playExplosion();
    }
  }, [bombState.isExploded]);

  // 優化：使用 useMemo 避免每次 render 都重新排序
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => b.score - a.score);
  }, [players]);

  return (
    <div
      className={`min-h-screen transition-colors duration-500 bg-skin-base text-skin-text ${
        theme === "party" ? "theme-party" : ""
      } font-sans overflow-x-hidden relative`}
    >
      {/* Hamburger Menu */}
      <button
        onClick={() => {
          soundManager.playClick();
          setIsNavOpen(!isNavOpen);
        }}
        className="fixed top-4 left-4 z-50 p-3 rounded-full bg-skin-card border border-skin-border text-skin-text shadow-lg hover:bg-skin-accent hover:text-black transition-all duration-300"
      >
        {isNavOpen ? "✕" : "☰"}
      </button>

      {/* Mute Button */}
      <button
        onClick={toggleMute}
        className="fixed top-4 right-4 z-50 p-3 rounded-full bg-skin-card border border-skin-border text-skin-text shadow-lg hover:bg-skin-accent hover:text-black transition-all duration-300"
      >
        {isMuted ? "🔇" : "🔊"}
      </button>

      <nav
        className={`fixed top-0 left-0 h-full w-64 bg-skin-card/95 backdrop-blur-md border-r border-skin-border flex flex-col py-24 gap-2 transition-transform duration-300 z-40 ${
          isNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("game");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "game"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">🏠</span>
            <span className="font-bold tracking-widest">遊戲主頁</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("modes");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "modes"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">🎮</span>
            <span className="font-bold tracking-widest">遊戲模式</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("bomb");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "bomb"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">💣</span>
            <span className="font-bold tracking-widest">炸彈模式</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("dice");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "dice"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">🎲</span>
            <span className="font-bold tracking-widest">擲骰子</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("online");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "online"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">🌐</span>
            <span className="font-bold tracking-widest">多人連線</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("players");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "players"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">👥</span>
            <span className="font-bold tracking-widest">玩家名單</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("customPack");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "customPack"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">📝</span>
            <span className="font-bold tracking-widest">自定義題庫</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("leaderboard");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "leaderboard"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
            title="排行榜"
          >
            <span className="text-2xl">🏆</span>
            <span className="font-bold tracking-widest">排行榜</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("history");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "history"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">📜</span>
            <span className="font-bold tracking-widest">歷史紀錄</span>
          </button>
        </div>

        <div className="relative w-full px-4">
          <button
            onClick={() => {
              soundManager.playClick();
              setCurrentView("settings");
              setIsNavOpen(false);
            }}
            className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 ${
              currentView === "settings"
                ? "bg-skin-accent text-black"
                : "text-skin-muted hover:bg-skin-base hover:text-skin-text"
            }`}
          >
            <span className="text-2xl">⚙️</span>
            <span className="font-bold tracking-widest">遊戲設定</span>
          </button>
        </div>
      </nav>

      <main className="flex flex-col items-center justify-center min-h-[70vh] p-4">
        {currentView === "game" && (
          <>
            <header className="mb-8 text-center animate-fade-in">
              <h1 className="text-5xl md:text-7xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-luxury-gold to-skin-text tracking-wider mb-4">
                TRUTH OR DARE
              </h1>
              <div className="text-skin-muted text-sm uppercase tracking-[0.3em] mb-8">
                Current Mode:{" "}
                <span className="text-skin-accent">{selectedPack}</span>
                {isOnline && (
                  <span className="ml-4 text-green-400 border border-green-500/30 px-2 py-1 rounded text-xs animate-pulse">
                    ● ONLINE: {roomId}
                  </span>
                )}
              </div>
            </header>

            <div className="w-full max-w-md min-h-[400px] flex flex-col items-center justify-center relative perspective-1000 animate-fade-in">
              {currentCard && turnPhase !== "spinning" ? (
                <div
                  id="game-card"
                  className={`w-full bg-skin-card border p-8 rounded-2xl shadow-2xl transform backface-hidden transition-all ${
                    gameMode === "punishment"
                      ? "border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]"
                      : "border-skin-border"
                  } ${
                    isAnimating
                      ? "rotate-y-180 opacity-0"
                      : "rotate-y-0 opacity-100"
                  }`}
                  style={{ transitionDuration: `${spinDelay}ms` }}
                >
                  <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest ${
                          gameMode === "truth"
                            ? "bg-blue-500/10 text-blue-400"
                            : gameMode === "dare"
                            ? "bg-red-500/10 text-red-400"
                            : gameMode === "pass"
                            ? "bg-gray-500/10 text-gray-400"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        {gameMode === "truth"
                          ? "真心話"
                          : gameMode === "dare"
                          ? "DARE"
                          : gameMode === "pass"
                          ? "PASS"
                          : "PUNISHMENT"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShare();
                        }}
                        className="text-skin-muted hover:text-skin-accent transition-colors p-1"
                        title="分享截圖"
                        data-html2canvas-ignore
                      >
                        📸
                      </button>
                    </div>

                    {activePlayerId &&
                      players.find((p) => p.id === activePlayerId) && (
                        <span className="text-xs bg-skin-accent text-black px-2 py-1 rounded font-bold animate-pulse">
                          執行者:{" "}
                          {players.find((p) => p.id === activePlayerId).name}
                        </span>
                      )}
                  </div>

                  <h2
                    className={`text-2xl md:text-3xl font-serif leading-relaxed min-h-[160px] flex items-center justify-center text-center ${
                      gameMode === "punishment"
                        ? "text-rose-500 font-bold"
                        : gameMode === "pass"
                        ? "text-skin-muted font-bold"
                        : "text-skin-text"
                    }`}
                  >
                    {currentCard.text}
                  </h2>

                  {/* Timer Section */}
                  <div className="flex flex-col items-center justify-center mb-6 h-12">
                    {timer > 0 ? (
                      <button
                        onClick={() => {
                          soundManager.playClick();
                          setTimer(0);
                        }}
                        className="text-4xl font-bold text-skin-accent transition-colors animate-pulse hover:text-red-500 cursor-pointer"
                        title="點擊停止"
                      >
                        {timer}s
                      </button>
                    ) : (
                      <div className="flex gap-3 opacity-50 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            soundManager.playClick();
                            setTimer(30);
                          }}
                          className="flex items-center gap-1 px-3 py-1 rounded-full border border-skin-border text-xs text-skin-muted hover:bg-skin-accent hover:text-black transition-colors"
                        >
                          ⏱️ 30s
                        </button>
                        <button
                          onClick={() => {
                            soundManager.playClick();
                            setTimer(60);
                          }}
                          className="flex items-center gap-1 px-3 py-1 rounded-full border border-skin-border text-xs text-skin-muted hover:bg-skin-accent hover:text-black transition-colors"
                        >
                          ⏱️ 60s
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-8 flex flex-col gap-3">
                    <button
                      onClick={completeTurn}
                      className="w-full py-4 bg-skin-accent text-black font-bold uppercase tracking-[0.2em] rounded-lg hover:brightness-110 transition-all shadow-lg"
                    >
                      {gameMode === "pass"
                        ? "跳過回合"
                        : activePlayerId
                        ? `完成任務 (+${gameMode === "dare" ? 2 : 1}分)`
                        : "下一回合"}
                    </button>
                    {gameMode !== "punishment" && gameMode !== "pass" && (
                      <button
                        onClick={drawPunishment}
                        className="w-full py-3 border border-skin-border text-skin-muted hover:text-rose-500 hover:border-rose-500 transition-colors uppercase text-xs tracking-widest rounded-lg"
                      >
                        放棄並接受懲罰
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full">
                  {/* Roulette Section */}
                  <div className="mb-8 relative w-full max-w-2xl mx-auto h-80 mask-fade-sides overflow-hidden bg-skin-card/30 border-y border-skin-border backdrop-blur-sm flex items-center">
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-skin-muted uppercase tracking-widest z-10 bg-skin-base/80 px-2 rounded-full border border-skin-border">
                      WHO'S NEXT?
                    </div>

                    {/* Center Indicator */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-skin-accent z-20 shadow-[0_0_10px_var(--accent-color)]"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 border-2 border-skin-accent rounded-xl z-20 shadow-[0_0_20px_var(--accent-color)] opacity-50 pointer-events-none"></div>

                    <div
                      ref={rouletteContainerRef}
                      className="flex items-center h-full absolute left-1/2 top-0"
                      style={{
                        // 初始位置或靜止位置 (動畫由 JS 控制)
                        transform: `translateX(calc(-${
                          rouletteState.targetIndex * 224 + 112
                        }px))`, // 224px = w-48(192) + mx-4(32)
                        width: "max-content",
                      }}
                    >
                      {rouletteState.items.map((item, idx) => (
                        <div
                          key={idx}
                          className={`w-48 h-48 flex-shrink-0 flex flex-col items-center justify-center gap-4 mx-4 p-4 rounded-xl border ${
                            idx === rouletteState.targetIndex
                              ? "bg-skin-accent text-black border-skin-accent scale-110 shadow-lg"
                              : "bg-skin-card border-skin-border text-skin-muted opacity-70"
                          } transition-all duration-300`}
                        >
                          <span className="text-7xl">{item.icon}</span>
                          <span className="text-xl font-bold truncate w-full text-center">
                            {item.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {turnPhase === "selected" ? (
                    <div className="h-32 flex items-center justify-center text-skin-muted animate-pulse">
                      正在決定命運...
                    </div>
                  ) : (
                    <button
                      onClick={() => rollNextPlayer()}
                      disabled={
                        turnPhase === "spinning" ||
                        (!isHost &&
                          !isMyTurnToRoll &&
                          !isActivePlayer &&
                          !isSelectedPlayer)
                      }
                      className={`w-full h-32 text-3xl font-bold rounded-2xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed tracking-widest uppercase ${
                        !isHost &&
                        !isMyTurnToRoll &&
                        !isActivePlayer &&
                        !isSelectedPlayer
                          ? "bg-skin-card border border-skin-border text-skin-muted"
                          : "bg-skin-accent text-black hover:brightness-110"
                      }`}
                    >
                      {turnPhase === "spinning"
                        ? "抽選中..."
                        : !isHost &&
                          !isMyTurnToRoll &&
                          !isActivePlayer &&
                          !isSelectedPlayer
                        ? "等待抽選..."
                        : "抽選玩家"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {currentView === "bomb" && (
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              TIME BOMB
            </h2>

            {!bombState.isActive && !bombState.isExploded ? (
              <div className="text-center space-y-8">
                <div className="text-9xl animate-bounce">💣</div>
                <p className="text-skin-muted">
                  手機將變身為定時炸彈！
                  <br />
                  回答問題後傳給下一位玩家，
                  <br />
                  時間到時持有手機的人就輸了！
                </p>

                <div className="bg-skin-card p-4 rounded-xl border border-skin-border w-full max-w-xs mx-auto">
                  <label className="block text-sm font-bold text-skin-muted mb-2 uppercase tracking-widest">
                    爆炸倒數:{" "}
                    <span className="text-skin-accent text-lg">
                      {bombDuration}
                    </span>{" "}
                    秒
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="180"
                    step="5"
                    value={bombDuration}
                    onChange={(e) => setBombDuration(parseInt(e.target.value))}
                    className="w-full accent-skin-accent h-2 bg-skin-border rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <button
                  onClick={startBombGame}
                  disabled={!isHost}
                  className={`px-12 py-4 font-bold text-xl rounded-xl shadow-lg transition-all uppercase tracking-widest ${
                    isHost
                      ? "bg-skin-accent text-black hover:brightness-110"
                      : "bg-skin-card border border-skin-border text-skin-muted cursor-not-allowed"
                  }`}
                >
                  {isHost ? "開始遊戲" : "等待房主開始"}
                </button>
              </div>
            ) : bombState.isExploded ? (
              <div className="text-center space-y-8 animate-pulse">
                <div className="text-9xl">💥</div>
                <h3 className="text-4xl font-bold text-rose-500">BOOM!</h3>
                <p className="text-2xl text-skin-text">
                  <span className="font-bold text-skin-accent">
                    {players[bombState.currentPlayerIdx]?.name}
                  </span>{" "}
                  爆炸了！
                </p>

                {bombState.currentTask ? (
                  <div className="p-6 bg-skin-card border border-rose-500 rounded-xl shadow-[0_0_30px_rgba(244,63,94,0.3)]">
                    <h4 className="text-rose-500 font-bold mb-2">懲罰內容</h4>
                    <p className="text-xl">{bombState.currentTask.text}</p>
                  </div>
                ) : (
                  isHost && (
                    <button
                      onClick={handleBombPunishment}
                      className="px-8 py-3 border border-rose-500 text-rose-500 font-bold rounded-lg hover:bg-rose-500 hover:text-white transition-all"
                    >
                      抽取懲罰
                    </button>
                  )
                )}

                {isHost && (
                  <button
                    onClick={() =>
                      setBombState((prev) => ({
                        ...prev,
                        isExploded: false,
                        currentTask: null,
                      }))
                    }
                    className="block mx-auto mt-8 text-skin-muted hover:text-skin-text underline"
                  >
                    重新開始
                  </button>
                )}
              </div>
            ) : (
              <div className="w-full max-w-md text-center space-y-8">
                <div
                  className={`text-9xl font-mono font-bold transition-transform duration-100 ${
                    bombState.timeLeft < 10
                      ? "animate-ping text-red-500"
                      : "animate-pulse text-skin-accent"
                  }`}
                >
                  {Math.ceil(bombState.timeLeft)}
                </div>

                <div className="bg-skin-card p-6 rounded-xl border border-skin-border">
                  <p className="text-sm text-skin-muted uppercase tracking-widest mb-2">
                    Current Holder
                  </p>
                  <h3 className="text-3xl font-bold text-skin-accent mb-6">
                    {players[bombState.currentPlayerIdx]?.name}
                  </h3>

                  {bombState.currentTask ? (
                    <div className="space-y-6">
                      <p className="text-xl font-bold min-h-[80px] flex items-center justify-center">
                        {bombState.currentTask.text}
                      </p>
                      {isHost && (
                        <button
                          onClick={passBomb}
                          className="w-full py-4 bg-green-500 text-black font-bold text-xl rounded-xl hover:brightness-110 transition-all shadow-lg"
                        >
                          ✅ 完成並傳遞！
                        </button>
                      )}
                    </div>
                  ) : (
                    isHost && (
                      <button
                        onClick={drawBombTask}
                        className="w-full py-4 bg-skin-accent text-black font-bold text-xl rounded-xl hover:brightness-110 transition-all shadow-lg"
                      >
                        🃏 抽取任務
                      </button>
                    )
                  )}
                </div>
                <p className="text-xs text-skin-muted animate-pulse">
                  {bombState.timeLeft < 10
                    ? "快一點！時間快到了！"
                    : "時間正在倒數..."}
                </p>
              </div>
            )}
          </div>
        )}

        {currentView === "dice" && (
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-12 text-center text-skin-accent">
              DICE MODE
            </h2>

            <div className="dice-scene mb-16">
              <div
                className="dice-cube"
                style={{
                  transform: `rotateX(${diceState.rotation.x}deg) rotateY(${diceState.rotation.y}deg)`,
                }}
              >
                {/* Face 1 (Front) */}
                <div
                  className="dice-face"
                  style={{ transform: "rotateY(0deg) translateZ(100px)" }}
                >
                  <div className="w-8 h-8 rounded-full bg-skin-text"></div>
                </div>

                {/* Face 2 (Right) */}
                <div
                  className="dice-face"
                  style={{
                    transform: "rotateY(90deg) translateZ(100px)",
                  }}
                >
                  <div className="flex flex-col justify-between h-24 w-24">
                    <div className="w-6 h-6 rounded-full bg-skin-text self-start"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text self-end"></div>
                  </div>
                </div>

                {/* Face 3 (Back) */}
                <div
                  className="dice-face"
                  style={{
                    transform: "rotateY(180deg) translateZ(100px)",
                  }}
                >
                  <div className="flex flex-col justify-between h-24 w-24">
                    <div className="w-6 h-6 rounded-full bg-skin-text self-start"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text self-center"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text self-end"></div>
                  </div>
                </div>

                {/* Face 4 (Left) */}
                <div
                  className="dice-face"
                  style={{
                    transform: "rotateY(-90deg) translateZ(100px)",
                  }}
                >
                  <div className="grid grid-cols-2 gap-8">
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                  </div>
                </div>

                {/* Face 5 (Top) */}
                <div
                  className="dice-face"
                  style={{
                    transform: "rotateX(90deg) translateZ(100px)",
                  }}
                >
                  <div className="grid grid-cols-3 grid-rows-3 w-24 h-24">
                    <div className="w-6 h-6 rounded-full bg-skin-text col-start-1 row-start-1"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text col-start-3 row-start-1"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text col-start-2 row-start-2"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text col-start-1 row-start-3"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text col-start-3 row-start-3"></div>
                  </div>
                </div>

                {/* Face 6 (Bottom) */}
                <div
                  className="dice-face"
                  style={{
                    transform: "rotateX(-90deg) translateZ(100px)",
                  }}
                >
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                    <div className="w-6 h-6 rounded-full bg-skin-text"></div>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={rollDice}
              disabled={diceState.isRolling}
              className="px-12 py-4 font-bold text-xl rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest bg-skin-accent text-black hover:brightness-110"
            >
              {diceState.isRolling ? "Rolling..." : "ROLL DICE"}
            </button>

            {!diceState.isRolling && (
              <div className="mt-8 text-6xl font-bold text-skin-text animate-fade-in">
                {diceState.value}
              </div>
            )}
          </div>
        )}

        {currentView === "online" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              多人連線大廳
            </h2>

            {!isOnline ? (
              <div className="space-y-12 text-center">
                {connectionError && (
                  <div className="p-4 bg-red-500/20 border border-red-500 text-red-400 rounded-lg text-sm mb-6 flex flex-col gap-2">
                    <div className="font-bold">
                      連線失敗 ({connectionError})
                    </div>
                    <div className="text-xs text-left mx-auto max-w-xs space-y-1">
                      <p>請檢查 Firebase Console 設定：</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>
                          進入 <strong>Authentication</strong> &gt;{" "}
                          <strong>Sign-in method</strong>
                        </li>
                        <li>
                          確認已啟用 <strong>匿名 (Anonymous)</strong> 登入
                        </li>
                        <li>若這是複製的專案，請建立自己的專案並更新 Config</li>
                      </ol>
                    </div>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 rounded text-red-200 transition-colors"
                    >
                      重試連線
                    </button>
                  </div>
                )}
                {/* Create Section */}
                <div className="max-w-xs mx-auto mb-8">
                  <label className="block text-sm font-bold text-skin-muted mb-2 uppercase tracking-widest">
                    你的暱稱 (用於綁定玩家)
                  </label>
                  <input
                    type="text"
                    value={myUserName}
                    onChange={(e) => setMyUserName(e.target.value)}
                    placeholder="輸入你的名字..."
                    className="w-full bg-skin-base border border-skin-border rounded-lg px-4 py-3 text-skin-text focus:border-skin-accent outline-none text-center text-lg"
                  />
                </div>

                <div className="space-y-4">
                  <div className="text-6xl mb-4">🏠</div>
                  <h3 className="text-xl font-bold text-skin-text">
                    創建新房間
                  </h3>
                  <p className="text-skin-muted text-sm">
                    建立一個新房間並成為房主
                  </p>
                  <button
                    onClick={() => {
                      if (connectionError)
                        return alert("連線失敗，無法創建房間");
                      if (!myUid) return;
                      soundManager.playClick();
                      const newRoomId = Math.floor(
                        1000 + Math.random() * 9000
                      ).toString();
                      setRoomId(newRoomId);
                      setHostId(myUid); // 創建者直接成為房主

                      // 初始化玩家列表，將房主加入
                      const hostPlayer = {
                        id: Date.now(),
                        name: myUserName || "房主",
                        uid: myUid,
                        weight: 5,
                        score: 0,
                        history: { truth: 0, dare: 0, punishment: 0 },
                      };
                      setPlayers([hostPlayer]);

                      addToRecentRooms(newRoomId);
                      setIsOnline(true);
                    }}
                    disabled={!myUid && !connectionError}
                    className={`w-full max-w-xs mx-auto py-4 font-bold text-xl rounded-xl shadow-lg transition-all uppercase tracking-widest ${
                      !myUid && !connectionError
                        ? "bg-skin-muted/20 text-skin-muted cursor-wait"
                        : "bg-skin-accent text-black hover:brightness-110"
                    }`}
                  >
                    {!myUid && !connectionError ? "連線中..." : "創建房間"}
                  </button>
                </div>

                <div className="relative flex items-center justify-center">
                  <div className="absolute w-full border-t border-skin-border"></div>
                  <span className="relative bg-skin-card px-4 text-skin-muted text-sm uppercase tracking-widest">
                    OR
                  </span>
                </div>

                {/* Join Section */}
                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-skin-text">加入房間</h3>
                  <p className="text-skin-muted text-sm">
                    輸入朋友分享的房間號碼
                  </p>
                  <div className="flex flex-col gap-4 max-w-xs mx-auto">
                    <input
                      type="text"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      placeholder="輸入 4 位數號碼"
                      className="bg-skin-base border border-skin-border rounded-lg px-4 py-3 text-skin-text focus:border-skin-accent outline-none text-center text-xl tracking-widest uppercase"
                    />
                    <button
                      onClick={() => {
                        const safeRoomId = roomId.trim();
                        if (!safeRoomId) return alert("請輸入房間號碼");
                        if (/[.#$[\]]/.test(safeRoomId))
                          return alert("房間號碼不能包含特殊符號");

                        if (connectionError)
                          return alert("連線失敗，無法加入房間");
                        if (!myUid) return;
                        soundManager.playClick();

                        // 檢查房間是否存在
                        db.ref(`rooms/${safeRoomId}`)
                          .once("value")
                          .then((snapshot) => {
                            if (snapshot.exists()) {
                              // 寫入訪客資訊，等待房主綁定
                              const safeName = String(myUserName || "").trim();
                              const guestName = safeName || "訪客";
                              db.ref(`rooms/${safeRoomId}/guests/${myUid}`).set(
                                {
                                  name: guestName,
                                }
                              );

                              addToRecentRooms(safeRoomId);
                              setIsOnline(true);
                            } else {
                              alert("找不到此房間，請確認號碼是否正確！");
                            }
                          })
                          .catch((err) => {
                            console.error("Join Error:", err);
                            alert("加入失敗，請檢查網路或房間號碼");
                          });
                      }}
                      disabled={!myUid && !connectionError}
                      className={`border px-6 py-3 rounded-lg font-bold transition-all ${
                        !myUid && !connectionError
                          ? "border-skin-muted text-skin-muted cursor-wait"
                          : "bg-skin-base border-skin-accent text-skin-accent hover:bg-skin-accent hover:text-black"
                      }`}
                    >
                      {!myUid && !connectionError ? "連線中..." : "加入房間"}
                    </button>
                  </div>
                </div>

                {recentRooms.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-skin-border w-full max-w-xs mx-auto">
                    <h4 className="text-sm font-bold text-skin-muted mb-4 uppercase tracking-widest text-center">
                      最近加入
                    </h4>
                    <div className="flex flex-col gap-2">
                      {recentRooms.map((id) => (
                        <button
                          key={id}
                          onClick={() => setRoomId(id)}
                          className="flex justify-between items-center p-3 bg-skin-base border border-skin-border rounded-lg hover:border-skin-accent transition-colors group"
                        >
                          <span className="font-mono font-bold text-skin-text">
                            {id}
                          </span>
                          <span className="text-xs text-skin-accent opacity-0 group-hover:opacity-100 transition-opacity">
                            填入
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm("確定要清除最近加入紀錄嗎？")) {
                          setRecentRooms([]);
                          localStorage.removeItem("tod_recent_rooms");
                        }
                      }}
                      className="mt-4 text-xs text-skin-muted hover:text-red-400 transition-colors block mx-auto"
                    >
                      清除紀錄
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-8 text-center">
                <div className="text-6xl mb-4 animate-pulse">🌐</div>
                <div>
                  <p className="text-skin-muted uppercase tracking-widest mb-2">
                    Current Room
                  </p>
                  <div className="text-5xl font-bold text-skin-accent font-mono tracking-widest mb-4">
                    {roomId}
                  </div>
                  <p className="text-sm text-skin-muted">
                    將此號碼分享給朋友，讓他們加入遊戲！
                  </p>
                </div>

                <div className="flex flex-col items-center gap-2 animate-fade-in">
                  <div className="p-2 bg-white rounded-xl shadow-lg">
                    <canvas ref={qrCanvasRef}></canvas>
                  </div>
                  <p className="text-xs text-skin-muted">
                    掃描 QR Code 直接加入
                  </p>
                  <button
                    onClick={handleCopyLink}
                    className="mt-2 px-6 py-2 bg-skin-base border border-skin-accent text-skin-accent rounded-lg hover:bg-skin-accent hover:text-black transition-all font-bold text-sm flex items-center gap-2"
                  >
                    <span>🔗</span> 複製房間連結
                  </button>
                </div>

                {isHost ? (
                  <div className="p-4 bg-skin-accent/10 border border-skin-accent/30 rounded-lg text-skin-accent">
                    👑 你是房主，擁有管理權限
                  </div>
                ) : (
                  <div className="p-4 bg-skin-base border border-skin-border rounded-lg text-skin-muted">
                    👤 你是訪客，等待房主操作
                  </div>
                )}

                <div className="pt-8 border-t border-skin-border">
                  <button
                    onClick={() => {
                      soundManager.playClick();
                      setIsOnline(false);
                      setRoomId("");
                      window.location.reload();
                    }}
                    className="bg-red-500/20 text-red-400 border border-red-500/50 px-8 py-3 rounded-lg font-bold hover:bg-red-500/30 transition-all"
                  >
                    斷開連線 / 離開房間
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === "modes" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              選擇遊戲模式
            </h2>
            <div className="grid grid-cols-1 gap-4">
              {Object.keys(playableData).map((pack) => {
                const isChaos = pack === "custom";
                const displayName = isChaos ? "混沌大亂鬥" : pack;
                const displayDesc = isChaos
                  ? "包含所有分級題目 (預設 + 自定義)"
                  : `包含 ${playableData[pack].truth.length} 真心話 / ${playableData[pack].dare.length} 大冒險`;

                return (
                  <button
                    key={pack}
                    onClick={() => {
                      soundManager.playClick();
                      setSelectedPack(pack);
                    }}
                    className={`p-6 rounded-xl border transition-all flex items-center justify-between group ${
                      selectedPack === pack
                        ? "bg-skin-accent text-black border-skin-accent shadow-lg scale-[1.02]"
                        : "bg-skin-base/50 border-skin-border text-skin-text hover:border-skin-accent/50"
                    }`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="text-xl font-bold uppercase tracking-widest mb-1">
                        {displayName}
                      </span>
                      <span
                        className={`text-xs ${
                          selectedPack === pack
                            ? "text-black/70"
                            : "text-skin-muted"
                        }`}
                      >
                        {displayDesc}
                      </span>
                    </div>
                    {selectedPack === pack && (
                      <span className="text-2xl animate-pulse">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentView === "settings" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              遊戲設定
            </h2>
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-skin-border">
                <h3 className="font-bold text-skin-text">主題風格</h3>
                <button
                  onClick={toggleTheme}
                  className="px-4 py-2 rounded-full bg-skin-base border border-skin-border hover:border-skin-accent transition-colors"
                >
                  {theme === "royal" ? "🌙 貴族黑金" : "☀️ 活力派對"}
                </button>
              </div>

              <div className="space-y-3 pb-4 border-b border-skin-border">
                <h3 className="font-bold text-skin-text">轉盤速度</h3>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-skin-muted">快</span>
                  <input
                    type="range"
                    min="200"
                    max="3000"
                    step="100"
                    value={spinDelay}
                    disabled={!isHost}
                    onChange={(e) => setSpinDelay(parseInt(e.target.value))}
                    className={`flex-1 accent-skin-accent h-2 bg-skin-border rounded-lg appearance-none ${
                      isHost
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-50"
                    }`}
                  />
                  <span className="text-sm text-skin-muted">慢</span>
                </div>
              </div>

              <div className="space-y-3 pb-4 border-b border-skin-border">
                <h3 className="font-bold text-skin-text">
                  題目難度篩選 (Lv.{difficultyRange.min} - Lv.
                  {difficultyRange.max})
                </h3>
                <div className="flex flex-col gap-4 px-2">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-skin-muted w-16">
                      最低 Lv.{difficultyRange.min}
                    </span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      value={difficultyRange.min}
                      disabled={!isHost}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setDifficultyRange((prev) => ({
                          ...prev,
                          min: Math.min(val, prev.max),
                        }));
                      }}
                      className={`flex-1 accent-skin-accent h-2 bg-skin-border rounded-lg appearance-none ${
                        isHost
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-50"
                      }`}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-skin-muted w-16">
                      最高 Lv.{difficultyRange.max}
                    </span>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      value={difficultyRange.max}
                      disabled={!isHost}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setDifficultyRange((prev) => ({
                          ...prev,
                          max: Math.max(val, prev.min),
                        }));
                      }}
                      className={`flex-1 accent-skin-accent h-2 bg-skin-border rounded-lg appearance-none ${
                        isHost
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-50"
                      }`}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-skin-muted uppercase tracking-wider">
                    <span>溫馨 (1)</span>
                    <span>刺激 (3)</span>
                    <span>成人 (6)</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pb-4 border-b border-skin-border">
                <h3 className="font-bold text-skin-text">指令機率權重</h3>
                {[
                  { key: "clockwise", label: "👉 下面一位" },
                  { key: "random", label: "🎲 隨機 (依玩家權重)" },
                  { key: "self", label: "🔄 連莊" },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between"
                  >
                    <span className="text-skin-muted">{item.label}</span>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={nextPlayerRates[item.key]}
                        disabled={!isHost}
                        onChange={(e) =>
                          handleRateChange(item.key, e.target.value)
                        }
                        className={`accent-skin-accent w-32 h-2 bg-skin-border rounded-lg appearance-none ${
                          isHost
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-50"
                        }`}
                      />
                      <span className="w-12 text-right text-skin-text font-bold">
                        {nextPlayerRates[item.key]}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {isHost && (
                <div className="space-y-3 pb-4 border-b border-skin-border">
                  <h3 className="font-bold text-skin-text">資料備份</h3>
                  <div className="flex gap-4">
                    <button
                      onClick={handleExportData}
                      className="flex-1 py-3 bg-skin-base border border-skin-border hover:border-skin-accent rounded-lg transition-colors text-sm"
                    >
                      📤 匯出資料 (Backup)
                    </button>
                    <label className="flex-1 py-3 bg-skin-base border border-skin-border hover:border-skin-accent rounded-lg transition-colors text-sm text-center cursor-pointer">
                      📥 匯入資料 (Restore)
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportData}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {isHost && (
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={handleRestoreDefault}
                    className="flex-1 py-3 border border-green-500/30 text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                  >
                    ♻️ 重置所有設定
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === "customPack" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              題庫管理
            </h2>

            {/* Pack Selector */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-skin-muted mb-2 uppercase tracking-widest">
                選擇要編輯的題庫
              </label>
              <select
                value={managingPack}
                onChange={(e) => {
                  soundManager.playClick();
                  setManagingPack(e.target.value);
                }}
                className="w-full p-3 rounded-lg bg-skin-base border border-skin-border text-skin-text focus:border-skin-accent outline-none transition-colors"
              >
                <option value="custom">📝 自定義題目 (全模式通用)</option>
                {Object.keys(defaultGameData)
                  .filter((k) => k !== "custom")
                  .map((pack) => (
                    <option key={pack} value={pack}>
                      🎮 {pack}
                    </option>
                  ))}
              </select>
            </div>

            {/* Import/Export Buttons for Custom Pack */}
            {managingPack === "custom" && isHost && (
              <div className="flex gap-4 mb-6 pb-6 border-b border-skin-border">
                <button
                  onClick={handleExportCustomPack}
                  className="flex-1 py-3 bg-skin-base border border-skin-border hover:border-skin-accent rounded-lg transition-colors text-sm font-bold"
                >
                  📤 分享題庫 (JSON)
                </button>
                <label className="flex-1 py-3 bg-skin-base border border-skin-border hover:border-skin-accent rounded-lg transition-colors text-sm font-bold text-center cursor-pointer">
                  📥 匯入題庫
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportCustomPack}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            <div className="space-y-6">
              {/* Truth Section */}
              <div className="bg-skin-base/30 p-4 rounded-lg">
                <h4 className="text-sm font-bold text-blue-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <span className="text-xl">🤫</span> 真心話 (Truth)
                </h4>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={customInputTruth}
                    onChange={(e) => setCustomInputTruth(e.target.value)}
                    placeholder={`新增至 ${
                      managingPack === "custom" ? "自定義 (通用)" : managingPack
                    }...`}
                    className="flex-1 bg-skin-base border border-skin-border rounded-lg px-4 py-2 text-skin-text focus:border-skin-accent outline-none transition-colors"
                  />
                  <button
                    onClick={() =>
                      handleAddQuestion(
                        managingPack,
                        "truth",
                        customInputTruth,
                        setCustomInputTruth
                      )
                    }
                    className="bg-blue-500/20 text-blue-400 border border-blue-500/50 px-6 py-2 rounded-lg font-bold hover:bg-blue-500/30 transition-colors"
                  >
                    新增
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                  {playableData[managingPack]?.truth.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center bg-skin-card p-3 rounded-lg border border-skin-border hover:border-blue-500/30 transition-colors"
                    >
                      <span className="flex-1 mr-4 text-skin-text">
                        {item.text}
                      </span>
                      {isHost && (
                        <button
                          onClick={() =>
                            handleRemoveQuestion(managingPack, "truth", item.id)
                          }
                          className="w-8 h-8 flex items-center justify-center rounded-full text-skin-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          title="刪除"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {playableData[managingPack]?.truth.length === 0 && (
                    <div className="text-center text-skin-muted py-8 border-2 border-dashed border-skin-border rounded-lg">
                      尚無題目
                    </div>
                  )}
                </div>
              </div>

              {/* Dare Section */}
              <div className="bg-skin-base/30 p-4 rounded-lg">
                <h4 className="text-sm font-bold text-red-400 mb-3 uppercase tracking-widest flex items-center gap-2">
                  <span className="text-xl">🔥</span> 大冒險 (Dare)
                </h4>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={customInputDare}
                    onChange={(e) => setCustomInputDare(e.target.value)}
                    placeholder={`新增至 ${
                      managingPack === "custom" ? "自定義 (通用)" : managingPack
                    }...`}
                    className="flex-1 bg-skin-base border border-skin-border rounded-lg px-4 py-2 text-skin-text focus:border-skin-accent outline-none transition-colors"
                  />
                  <button
                    onClick={() =>
                      handleAddQuestion(
                        managingPack,
                        "dare",
                        customInputDare,
                        setCustomInputDare
                      )
                    }
                    className="bg-red-500/20 text-red-400 border border-red-500/50 px-6 py-2 rounded-lg font-bold hover:bg-red-500/30 transition-colors"
                  >
                    新增
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                  {playableData[managingPack]?.dare.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center bg-skin-card p-3 rounded-lg border border-skin-border hover:border-red-500/30 transition-colors"
                    >
                      <span className="flex-1 mr-4 text-skin-text">
                        {item.text}
                      </span>
                      {isHost && (
                        <button
                          onClick={() =>
                            handleRemoveQuestion(managingPack, "dare", item.id)
                          }
                          className="w-8 h-8 flex items-center justify-center rounded-full text-skin-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          title="刪除"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {playableData[managingPack]?.dare.length === 0 && (
                    <div className="text-center text-skin-muted py-8 border-2 border-dashed border-skin-border rounded-lg">
                      尚無題目
                    </div>
                  )}
                </div>
              </div>

              {/* Punishment Section */}
              {managingPack === "custom" && (
                <div className="bg-skin-base/30 p-4 rounded-lg">
                  <h4 className="text-sm font-bold text-rose-500 mb-3 uppercase tracking-widest flex items-center gap-2">
                    <span className="text-xl">⚡</span> 懲罰 (Punishment)
                  </h4>
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={customInputPunishment}
                      onChange={(e) => setCustomInputPunishment(e.target.value)}
                      placeholder="輸入懲罰內容..."
                      className="flex-1 bg-skin-base border border-skin-border rounded-lg px-4 py-2 text-skin-text focus:border-skin-accent outline-none transition-colors"
                    />
                    <button
                      onClick={() => addPunishment(customInputPunishment)}
                      className="bg-rose-500/20 text-rose-500 border border-rose-500/50 px-6 py-2 rounded-lg font-bold hover:bg-rose-500/30 transition-colors"
                    >
                      新增
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                    {punishmentList.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center bg-skin-card p-3 rounded-lg border border-skin-border hover:border-rose-500/30 transition-colors"
                      >
                        <span className="flex-1 mr-4 text-skin-text">
                          {item.text}
                        </span>
                        {isHost && (
                          <button
                            onClick={() => removePunishment(item.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-skin-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    {punishmentList.length === 0 && (
                      <div className="text-center text-skin-muted py-8 border-2 border-dashed border-skin-border rounded-lg">
                        尚無懲罰
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isHost && (
                <div className="pt-4 border-t border-skin-border flex gap-4">
                  {managingPack !== "custom" && (
                    <button
                      onClick={() => handleRestorePack(managingPack)}
                      className="flex-1 py-3 border border-green-500/30 text-green-400 hover:bg-green-500/10 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <span>♻️</span> 恢復預設值
                    </button>
                  )}

                  <button
                    onClick={() => handleClearPack(managingPack)}
                    className="flex-1 py-3 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <span>🗑️</span> 清空此題庫
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === "players" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              玩家名單
            </h2>
            <div className="space-y-6">
              {isHost && (
                <form onSubmit={handleAddPlayer} className="flex gap-4">
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    placeholder="輸入新玩家名字..."
                    className="flex-1 bg-skin-base border border-skin-border rounded-lg px-4 py-3 text-skin-text focus:border-skin-accent outline-none transition-colors"
                  />
                  <button
                    type="submit"
                    className="bg-skin-accent text-black px-6 py-3 rounded-lg font-bold hover:brightness-110 transition-all"
                  >
                    新增
                  </button>
                </form>
              )}

              <div className="flex justify-end gap-2">
                {isHost && (
                  <>
                    <button
                      onClick={() => {
                        soundManager.playClick();
                        if (window.confirm("確定要踢出所有離線玩家嗎？")) {
                          setPlayers((prev) =>
                            prev.filter((p) => !p.uid || onlineUsers[p.uid])
                          );
                        }
                      }}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 border border-red-500/30 px-3 py-1 rounded-lg hover:bg-red-500/10"
                    >
                      <span>🚫</span> 踢出離線
                    </button>
                    <button
                      onClick={handleQuickSetup}
                      className="text-sm text-skin-accent hover:text-skin-text transition-colors flex items-center gap-1 border border-skin-accent/30 px-3 py-1 rounded-lg hover:bg-skin-accent/10"
                    >
                      <span>⚡</span> 快速生成 4 位玩家
                    </button>
                  </>
                )}
              </div>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {players.length === 0 ? (
                  <div className="text-center py-12 text-skin-muted border-2 border-dashed border-skin-border rounded-xl">
                    <p className="text-xl mb-2">👥</p>
                    <p>尚無玩家資料</p>
                  </div>
                ) : (
                  players.map((p) => {
                    if (!p) return null;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-4 bg-skin-base/50 p-4 rounded-xl border border-skin-border hover:border-skin-accent/50 transition-colors animate-fade-in"
                      >
                        <div className="w-10 h-10 rounded-full bg-skin-accent/20 flex items-center justify-center text-skin-accent font-bold relative">
                          {String(p.name || "?").charAt(0)}
                          {isOnline && p.uid && onlineUsers[p.uid] && (
                            <span
                              className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-skin-card rounded-full shadow-[0_0_5px_rgba(34,197,94,0.8)]"
                              title="在線"
                            ></span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg text-skin-text">
                                {p.name || "未知玩家"}
                              </span>
                              {isHost && (
                                <button
                                  onClick={() =>
                                    handleEditPlayerName(p.id, p.name)
                                  }
                                  className="text-xs opacity-50 hover:opacity-100 transition-opacity"
                                  title="修改名稱"
                                >
                                  ✏️
                                </button>
                              )}
                            </div>
                            <span className="text-xs px-2 py-1 rounded bg-skin-card border border-skin-border text-skin-muted">
                              權重: {p.weight}
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="10"
                            step="1"
                            value={p.weight || 0}
                            disabled={!isHost}
                            onChange={(e) =>
                              handlePlayerWeightChange(p.id, e.target.value)
                            }
                            className={`w-full accent-skin-accent h-1 bg-skin-border rounded-lg appearance-none ${
                              isHost
                                ? "cursor-pointer"
                                : "cursor-not-allowed opacity-50"
                            }`}
                          />
                        </div>
                        {isHost && (
                          <button
                            onClick={() => handleRemovePlayer(p.id)}
                            className="w-10 h-10 flex items-center justify-center rounded-full text-skin-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                            title="踢出玩家"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === "leaderboard" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <h2 className="text-3xl font-serif font-bold mb-8 text-center text-skin-accent">
              排行榜
            </h2>
            <div className="space-y-4">
              {sortedPlayers.length === 0 ? (
                <div className="text-center py-12 text-skin-muted border-2 border-dashed border-skin-border rounded-xl">
                  <p className="text-xl mb-2">🏆</p>
                  <p>尚無戰績，快開始遊戲吧！</p>
                </div>
              ) : (
                sortedPlayers.map((p, index) => (
                  <div
                    key={p.id}
                    className={`flex items-center p-4 rounded-xl border transition-all ${
                      index === 0
                        ? "bg-gradient-to-r from-yellow-500/20 to-transparent border-yellow-500/50 scale-105 shadow-lg"
                        : "bg-skin-base/50 border-skin-border"
                    }`}
                  >
                    <div className="w-12 text-2xl font-bold text-center">
                      {index === 0
                        ? "🥇"
                        : index === 1
                        ? "🥈"
                        : index === 2
                        ? "🥉"
                        : `#${index + 1}`}
                    </div>
                    <div className="flex-1 px-4">
                      <div className="font-bold text-xl text-skin-text mb-1">
                        {p.name}
                      </div>
                      <div className="flex gap-4 text-xs text-skin-muted uppercase tracking-wider">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                          真心話 {p.history.truth}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-400"></span>
                          大冒險 {p.history.dare}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                          懲罰 {p.history.punishment}
                        </span>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-skin-accent">
                      {p.score}
                      <span className="text-xs ml-1 text-skin-muted font-normal">
                        PTS
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-8 text-center text-xs text-skin-muted uppercase tracking-widest opacity-50">
              計分規則：真心話 +1 / 大冒險 +2 / 懲罰 +1
            </div>
          </div>
        )}

        {currentView === "history" && (
          <div className="w-full max-w-2xl mx-auto p-6 bg-skin-card rounded-xl border border-skin-border animate-fade-in">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-serif font-bold text-skin-accent">
                歷史紀錄
              </h2>
              {historyLog.length > 0 && isHost && (
                <button
                  onClick={() => {
                    if (window.confirm("確定要清空歷史紀錄嗎？")) {
                      soundManager.playClick();
                      setHistoryLog([]);
                    }
                  }}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 px-3 py-1 rounded-full transition-colors"
                >
                  清空紀錄
                </button>
              )}
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
              {historyLog.length === 0 ? (
                <div className="text-center py-12 text-skin-muted border-2 border-dashed border-skin-border rounded-xl">
                  <p className="text-xl mb-2">📜</p>
                  <p>尚無遊戲紀錄</p>
                </div>
              ) : (
                historyLog.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-skin-border bg-skin-base/30 flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                            log.type === "truth"
                              ? "bg-blue-500/20 text-blue-400"
                              : log.type === "dare"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-rose-500/20 text-rose-500"
                          }`}
                        >
                          {log.type === "truth"
                            ? "真心話"
                            : log.type === "dare"
                            ? "大冒險"
                            : "懲罰"}
                        </span>
                        <span className="font-bold text-skin-text">
                          {log.playerName}
                        </span>
                      </div>
                      <span className="text-xs text-skin-muted">
                        {log.time}
                      </span>
                    </div>
                    <p className="text-skin-muted text-sm pl-1">{log.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
      <footer className="fixed bottom-4 w-full text-center text-skin-muted text-[10px] tracking-[0.5em] opacity-50">
        DESIGNED FOR IMMERSIVE SOCIAL EXPERIENCE
      </footer>

      {/* Chat Button */}
      {isOnline && (
        <button
          onClick={() => {
            soundManager.playClick();
            setIsChatOpen(!isChatOpen);
          }}
          className="fixed bottom-4 right-4 z-50 p-3 rounded-full bg-skin-card border border-skin-border text-skin-text shadow-lg hover:bg-skin-accent hover:text-black transition-all duration-300"
        >
          💬
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-bounce">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat Window */}
      {isOnline && isChatOpen && (
        <div className="fixed bottom-20 right-4 w-80 h-96 bg-skin-card border border-skin-border rounded-xl shadow-2xl z-50 flex flex-col animate-fade-in overflow-hidden">
          <div className="p-3 border-b border-skin-border bg-skin-base/50 flex justify-between items-center">
            <h3 className="font-bold text-skin-accent">聊天室</h3>
            <button
              onClick={() => setIsChatOpen(false)}
              className="text-skin-muted hover:text-skin-text"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-skin-base/30">
            {chatMessages.length === 0 && (
              <div className="text-center text-xs text-skin-muted mt-4">
                尚無訊息
              </div>
            )}
            {chatMessages.map((msg) => {
              const isMe = msg.senderId === myUid;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isMe ? "items-end" : "items-start"
                  }`}
                >
                  <span className="text-[10px] text-skin-muted mb-1 px-1">
                    {msg.senderName}
                  </span>
                  <div
                    className={`px-3 py-2 rounded-lg max-w-[85%] text-sm break-words ${
                      isMe
                        ? "bg-skin-accent text-black rounded-tr-none"
                        : "bg-skin-border text-skin-text rounded-tl-none"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-skin-border bg-skin-base/50 flex gap-2"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="輸入訊息..."
              className="flex-1 bg-skin-base border border-skin-border rounded-lg px-3 py-2 text-sm text-skin-text focus:border-skin-accent outline-none"
            />
            <button
              type="submit"
              className="bg-skin-accent text-black px-3 py-2 rounded-lg font-bold text-sm hover:brightness-110"
            >
              傳送
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
