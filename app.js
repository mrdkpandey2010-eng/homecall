/**
 * HomeCall - Zero-Login High Definition Voice Calling Application
 * Powered by Agora RTC SDK v4 & Firebase Realtime Database
 * Seamless Single-Pipeline Audio with Android Native VoIP Kernel Integration
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  onDisconnect,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { CONFIG as DEFAULT_CONFIG } from "./config.js";

// ==========================================
// 1. INITIALIZATION & ZERO-LOGIN IDENTITY
// ==========================================

let customConfig = null;
try {
  const saved = localStorage.getItem("app_credentials_override");
  if (saved) {
    customConfig = JSON.parse(saved);
  }
} catch (e) {
  console.warn("Failed to parse custom credentials override:", e);
}

export const CONFIG = customConfig || DEFAULT_CONFIG;

// Sync with Native Android Bridge if running inside Android APK
if (window.AndroidBridge && typeof window.AndroidBridge.getUserId === 'function') {
  try {
    const bridgeId = window.AndroidBridge.getUserId();
    if (bridgeId && /^User-\d{6}$/.test(bridgeId)) {
      localStorage.setItem("app_user_id", bridgeId);
    }
  } catch (e) {}
}

// Generate or retrieve unique User ID ('User-XXXXXX')
let myUserId = localStorage.getItem("app_user_id");
if (!myUserId || !/^User-\d{6}$/.test(myUserId)) {
  const randomSixDigits = Math.floor(100000 + Math.random() * 900000);
  myUserId = `User-${randomSixDigits}`;
  localStorage.setItem("app_user_id", myUserId);
}

if (window.AndroidBridge && typeof window.AndroidBridge.onUserIdReady === 'function') {
  try {
    window.AndroidBridge.onUserIdReady(myUserId);
  } catch (e) {}
}

const currentUserIdEl = document.getElementById("current-user-id");
if (currentUserIdEl) currentUserIdEl.textContent = myUserId;

const copyBtn = document.getElementById("btn-copy-id");
if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(myUserId);
      showToast("User ID copied to clipboard!", "success");
    } catch {
      showToast(myUserId, "info");
    }
  });
}

// ==========================================
// 2. FIREBASE REALTIME DATABASE PRESENCE
// ==========================================

let db = null;
let app = null;

try {
  app = initializeApp(CONFIG.FIREBASE_CONFIG);
  db = getDatabase(app);
} catch (err) {
  console.error("[HomeCall] Firebase initialization error:", err);
  showToast("Firebase initialization error. Check config.js", "error");
}

const myPresenceRef = db ? ref(db, `users/${myUserId}`) : null;
const connectedRef = db ? ref(db, ".info/connected") : null;
const allUsersRef = db ? ref(db, "users") : null;
const myIncomingCallRef = db ? ref(db, `calls/${myUserId}`) : null;

if (connectedRef && myPresenceRef) {
  onValue(connectedRef, (snapshot) => {
    if (snapshot.val() === true) {
      onDisconnect(myPresenceRef).set({
        status: "offline",
        last_seen: Date.now()
      });

      set(myPresenceRef, {
        status: "online",
        last_seen: Date.now()
      });
    }
  });
}

window.addEventListener("beforeunload", () => {
  if (db && myUserId) {
    try {
      set(ref(db, `users/${myUserId}`), {
        status: "offline",
        last_seen: Date.now()
      });
    } catch (e) {}
  }
});

setInterval(() => {
  if (db && myUserId) {
    try {
      update(ref(db, `users/${myUserId}`), {
        status: "online",
        last_seen: Date.now()
      });
    } catch (e) {}
  }
}, 25000);

const usersCache = new Map();
let searchQuery = "";

const searchInputEl = document.getElementById("input-search-users");
if (searchInputEl) {
  searchInputEl.addEventListener("input", (e) => {
    searchQuery = (e.target.value || "").toLowerCase().trim();
    renderUsersDashboard();
  });
}

if (allUsersRef) {
  onValue(allUsersRef, (snapshot) => {
    const data = snapshot.val();
    usersCache.clear();

    if (data) {
      Object.keys(data).forEach((uid) => {
        usersCache.set(uid, data[uid]);
      });
    }

    renderUsersDashboard();
  });
}

function renderUsersDashboard() {
  const container = document.getElementById("users-list-container");
  const countBadge = document.getElementById("user-count-badge");
  const emptyState = document.getElementById("empty-state");
  if (!container) return;

  container.innerHTML = "";

  let onlineCount = 0;
  usersCache.forEach((user, uid) => {
    if (uid !== myUserId && user.status === "online") onlineCount++;
  });
  if (countBadge) countBadge.textContent = `${onlineCount} Online`;

  const entries = Array.from(usersCache.entries()).filter(([userId]) => {
    if (!searchQuery) return true;
    return userId.toLowerCase().includes(searchQuery);
  });

  if (entries.length === 0) {
    if (emptyState) emptyState.classList.remove("hidden");
    return;
  } else {
    if (emptyState) emptyState.classList.add("hidden");
  }

  const sortedUsers = entries.sort(([idA, userA], [idB, userB]) => {
    if (idA === myUserId) return -1;
    if (idB === myUserId) return 1;
    if (userA.status === "online" && userB.status !== "online") return -1;
    if (userA.status !== "online" && userB.status === "online") return 1;
    return (userB.last_seen || 0) - (userA.last_seen || 0);
  });

  sortedUsers.forEach(([userId, userData]) => {
    const isSelf = userId === myUserId;
    const isOnline = userData.status === "online";
    const lastSeenText = formatLastSeen(userData.last_seen);

    const card = document.createElement("div");
    card.className = `bg-slate-900 border rounded-2xl p-4 flex items-center justify-between transition-all duration-200 shadow-sm ${
      isOnline
        ? "border-emerald-500/30 hover:border-emerald-500/60 shadow-emerald-500/5 bg-slate-900/90"
        : "border-slate-800/80 opacity-70"
    }`;

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="relative shrink-0">
          <div class="w-11 h-11 rounded-2xl ${
            isOnline ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-500"
          } flex items-center justify-center font-bold text-sm">
            ${userId.slice(-4)}
          </div>
          <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
            isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-600"
          }"></span>
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-white text-sm tracking-tight">${userId}</span>
            ${
              isSelf
                ? `<span class="text-[9px] bg-slate-800 text-emerald-400 font-bold px-1.5 py-0.5 rounded-full border border-slate-700">You</span>`
                : ""
            }
          </div>
          <div class="flex items-center gap-1.5 text-xs mt-0.5">
            ${
              isOnline
                ? `<span class="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                     <span class="text-emerald-400 text-[10px]">●</span> Online
                   </span>`
                : `<span class="text-slate-500 text-[11px]">Offline • ${lastSeenText}</span>`
            }
          </div>
        </div>
      </div>
      <div>
        ${
          isSelf
            ? `<span class="text-[11px] text-slate-500 font-mono italic px-3 py-1">This Device</span>`
            : `<button
                type="button"
                data-target-user="${userId}"
                class="call-user-btn cursor-pointer flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                  isOnline
                    ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "bg-slate-800 text-slate-500 hover:bg-slate-700/60"
                }">
                <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span class="pointer-events-none">Call</span>
              </button>`
        }
      </div>
    `;

    container.appendChild(card);
  });
}

function formatLastSeen(timestamp) {
  if (!timestamp) return "Never";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ==========================================
// 3. AUDIO SYSTEM & SOUND SYNTHESIS
// ==========================================

let audioCtx = null;
let ringtoneOscillator = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playOutgoingRingback() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    stopRingtone();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    osc1.type = "sine";
    osc2.type = "sine";

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    const now = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
      const t = now + i * 4.0;
      gainNode.gain.setValueAtTime(0.12, t);
      gainNode.gain.setValueAtTime(0.12, t + 1.8);
      gainNode.gain.setValueAtTime(0, t + 1.85);
    }

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start();
    osc2.start();

    ringtoneOscillator = {
      stop: () => {
        try {
          osc1.stop();
          osc2.stop();
          osc1.disconnect();
          osc2.disconnect();
          gainNode.disconnect();
        } catch (e) {}
      }
    };
  } catch (e) {}
}

function playIncomingRingtone() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    stopRingtone();

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "triangle";
    gainNode.gain.setValueAtTime(0, ctx.currentTime);

    const now = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
      const t = now + i * 2.5;
      gainNode.gain.setValueAtTime(0.2, t);
      osc.frequency.setValueAtTime(523.25, t);
      osc.frequency.setValueAtTime(659.25, t + 0.15);
      osc.frequency.setValueAtTime(783.99, t + 0.3);
      gainNode.gain.setValueAtTime(0, t + 0.9);
    }

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();

    ringtoneOscillator = {
      stop: () => {
        try {
          osc.stop();
          osc.disconnect();
          gainNode.disconnect();
        } catch (e) {}
      }
    };
  } catch (e) {}
}

function stopRingtone() {
  if (ringtoneOscillator) {
    try {
      ringtoneOscillator.stop();
    } catch (e) {}
    ringtoneOscillator = null;
  }
  // Suspend WebAudio context so it yields audio hardware completely to the call
  if (audioCtx && audioCtx.state === "running") {
    try {
      audioCtx.suspend();
    } catch (e) {}
  }
}

// ==========================================
// 4. UNIFIED MICROPHONE ACQUISITION
// ==========================================

let localMediaStream = null;
let localAgoraAudioTrack = null;

async function acquireLocalMicrophone() {
  if (localMediaStream && localMediaStream.active && localMediaStream.getAudioTracks().some(t => t.readyState === "live")) {
    return localMediaStream;
  }

  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000
    },
    video: false
  };

  console.log("[HomeCall] Requesting native hardware microphone...");
  localMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  updateMicStatusUI("granted");
  return localMediaStream;
}

// ==========================================
// 5. AGORA RTC SDK v4 AUDIO INTEGRATION
// ==========================================

let agoraClient = null;
let isAgoraAudioActive = false;

async function joinAgoraVoiceChannel(channelName) {
  if (typeof AgoraRTC === "undefined") {
    console.warn("[HomeCall] AgoraRTC SDK not loaded.");
    return false;
  }

  const appId = (CONFIG && CONFIG.AGORA_APP_ID) ? CONFIG.AGORA_APP_ID : "a6f0bbf1744f4ffe85275fcae3d8858b";
  if (!appId || appId === "YOUR_AGORA_APP_ID") {
    return false;
  }

  try {
    console.log("[HomeCall] Attempting Agora RTC channel:", channelName);
    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    agoraClient.on("user-published", async (user, mediaType) => {
      console.log("[HomeCall] Agora remote user-published:", user.uid, mediaType);
      try {
        await agoraClient.subscribe(user, mediaType);
        if (mediaType === "audio") {
          console.log("[HomeCall] Playing Agora HD stream!");
          user.audioTrack.play();
          user.audioTrack.setVolume(100);
          isAgoraAudioActive = true;
          stopRingtone();
          updateCallStatusUI("Connected (Agora HD)", true);

          if (window.AndroidBridge && typeof window.AndroidBridge.onCallStarted === 'function') {
            window.AndroidBridge.onCallStarted(currentCallPartnerId || String(user.uid));
          }
        }
      } catch (subErr) {
        console.warn("[HomeCall] Agora subscribe notice:", subErr);
      }
    });

    await agoraClient.join(appId, channelName, null, null);
    console.log("[HomeCall] Successfully joined Agora channel:", channelName);

    if (localMediaStream && localMediaStream.getAudioTracks().length > 0) {
      localAgoraAudioTrack = AgoraRTC.createCustomAudioTrack({
        mediaStreamTrack: localMediaStream.getAudioTracks()[0]
      });
      await agoraClient.publish([localAgoraAudioTrack]);
      console.log("[HomeCall] Published local audio to Agora!");
    }
    return true;
  } catch (err) {
    console.warn("[HomeCall] Agora RTC note (" + err.message + "). WebRTC will handle voice stream.");
    if (agoraClient) {
      try { await agoraClient.leave(); } catch (e) {}
      agoraClient = null;
    }
    localAgoraAudioTrack = null;
    isAgoraAudioActive = false;
    return false;
  }
}

async function leaveAgoraVoiceChannel() {
  isAgoraAudioActive = false;
  localAgoraAudioTrack = null;
  if (agoraClient) {
    try {
      await agoraClient.leave();
    } catch (e) {}
    agoraClient = null;
  }
}

// ==========================================
// 6. CALL TRIGGER & SIGNALING (FIREBASE RTDB)
// ==========================================

let peerConnection = null;
let currentChannelName = null;
let currentCallPartnerId = null;
let currentCallRole = null;
let isCallActive = false;
let callTimerInterval = null;
let callStartTime = null;
let isMicMuted = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:openrelay.metered.ca:80" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turns:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceCandidatePoolSize: 10
};

/**
 * Caller: Initiate call to target user
 */
async function initiateCall(targetUserId) {
  if (!db) {
    showToast("Firebase Realtime Database is not configured.", "error");
    return;
  }

  if (isCallActive) {
    showToast("You are already in an active call.", "warning");
    return;
  }

  const targetUser = usersCache.get(targetUserId);
  if (!targetUser || targetUser.status !== "online") {
    showToast("User is offline", "warning");
    return;
  }

  try {
    await acquireLocalMicrophone();
  } catch (micErr) {
    console.error("[HomeCall] Mic error:", micErr);
    updateMicStatusUI("denied");
    showToast("Microphone permission required to call.", "error");
    return;
  }

  const channelName = [myUserId, targetUserId].sort().join("-");
  currentChannelName = channelName;
  currentCallPartnerId = targetUserId;
  currentCallRole = "caller";
  isCallActive = true;

  showActiveCallUI(targetUserId, "Ringing...");
  playOutgoingRingback();

  // 1. Connect Agora RTC Primary Channel
  joinAgoraVoiceChannel(channelName).catch((e) => console.warn(e));

  // 2. Setup WebRTC PeerConnection as Dual-Engine Redundancy
  try {
    peerConnection = new RTCPeerConnection(rtcConfig);

    if (localMediaStream) {
      localMediaStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localMediaStream);
      });
    }

    const calleeCandidateQueue = [];

    peerConnection.ontrack = (event) => {
      console.log("[HomeCall] WebRTC ontrack received!");
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const audioElement = document.getElementById("remote-audio-player");
      if (audioElement) {
        audioElement.srcObject = remoteStream;
        audioElement.volume = 1.0;
        audioElement.muted = false;
        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
          playPromise.catch((e) => {
            console.warn("[HomeCall] HTML5 audio play notice:", e);
            try {
              const ctx = getAudioContext();
              if (ctx) {
                if (ctx.state === "suspended") ctx.resume();
                const src = ctx.createMediaStreamSource(remoteStream);
                src.connect(ctx.destination);
                console.log("[HomeCall] WebAudio direct hardware pipe connected!");
              }
            } catch (err) {}
          });
        }
      }
      stopRingtone();
      updateCallStatusUI("Connected (HD Voice)", true);

      if (window.AndroidBridge && typeof window.AndroidBridge.onCallStarted === 'function') {
        window.AndroidBridge.onCallStarted(targetUserId);
      }
    };

    const callerCandidatesRef = ref(db, `calls/${targetUserId}/callerCandidates`);
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        push(callerCandidatesRef, event.candidate.toJSON());
      }
    };

    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    const callOfferRef = ref(db, `calls/${targetUserId}`);
    await set(callOfferRef, {
      caller: myUserId,
      recipient: targetUserId,
      channel: channelName,
      status: "ringing",
      offer: { type: offer.type, sdp: offer.sdp },
      timestamp: Date.now()
    });

    onDisconnect(callOfferRef).remove();

    onValue(callOfferRef, async (snap) => {
      const data = snap.val();
      if (!data) {
        if (isCallActive && currentCallRole === "caller") {
          showToast("Call ended", "info");
          terminateCall(false);
        }
        return;
      }

      if (data.status === "accepted" && data.answer) {
        stopRingtone();
        if (peerConnection && !peerConnection.currentRemoteDescription) {
          const remoteDesc = new RTCSessionDescription(data.answer);
          await peerConnection.setRemoteDescription(remoteDesc);
          startCallTimer();

          // Flush queued candidates
          while (calleeCandidateQueue.length > 0) {
            const c = calleeCandidateQueue.shift();
            try {
              await peerConnection.addIceCandidate(c);
            } catch (e) {}
          }
        }
      } else if (data.status === "rejected") {
        stopRingtone();
        showToast("Call was declined", "warning");
        terminateCall(false);
      } else if (data.status === "ended") {
        stopRingtone();
        showToast("Call ended", "info");
        terminateCall(false);
      }
    });

    const calleeCandidatesRef = ref(db, `calls/${targetUserId}/calleeCandidates`);
    onChildAdded(calleeCandidatesRef, async (snapshot) => {
      const candidateData = snapshot.val();
      if (!candidateData) return;
      const candidate = new RTCIceCandidate(candidateData);
      if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (e) {}
      } else {
        calleeCandidateQueue.push(candidate);
      }
    });
  } catch (err) {
    console.error("[HomeCall] Signaling error:", err);
  }
}

/**
 * Callee: Listen for incoming calls
 */
if (myIncomingCallRef) {
  onValue(myIncomingCallRef, (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      hideIncomingCallModal();
      return;
    }

    if (data.status === "ringing" && !isCallActive && data.offer) {
      currentCallPartnerId = data.caller;
      currentChannelName = data.channel;
      currentCallRole = "callee";
      window._pendingIncomingCallData = data;

      showIncomingCallModal(data.caller);
      playIncomingRingtone();
    } else if (data.status === "ended" || data.status === "rejected") {
      hideIncomingCallModal();
      stopRingtone();
      if (isCallActive && currentCallRole === "callee") {
        terminateCall(false);
      }
    }
  });
}

/**
 * Callee: Accept incoming call
 */
async function acceptIncomingCall() {
  stopRingtone();
  hideIncomingCallModal();

  const data = window._pendingIncomingCallData;
  if (!data || !currentCallPartnerId) return;

  isCallActive = true;
  showActiveCallUI(currentCallPartnerId, "Connecting...");

  try {
    await acquireLocalMicrophone();
  } catch (micErr) {
    console.error("[HomeCall] Mic error on accept:", micErr);
    showToast("Microphone permission required.", "error");
    terminateCall(true);
    return;
  }

  // 1. Connect Agora RTC Primary Channel
  const channelName = data.channel || [myUserId, currentCallPartnerId].sort().join("-");
  joinAgoraVoiceChannel(channelName).catch((e) => console.warn(e));

  // 2. Setup WebRTC PeerConnection as Dual-Engine Redundancy
  try {
    peerConnection = new RTCPeerConnection(rtcConfig);

    if (localMediaStream) {
      localMediaStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localMediaStream);
      });
    }

    const callerCandidateQueue = [];

    peerConnection.ontrack = (event) => {
      console.log("[HomeCall] WebRTC ontrack received!");
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const audioElement = document.getElementById("remote-audio-player");
      if (audioElement) {
        audioElement.srcObject = remoteStream;
        audioElement.volume = 1.0;
        audioElement.muted = false;
        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
          playPromise.catch((e) => {
            console.warn("[HomeCall] HTML5 audio play notice:", e);
            try {
              const ctx = getAudioContext();
              if (ctx) {
                if (ctx.state === "suspended") ctx.resume();
                const src = ctx.createMediaStreamSource(remoteStream);
                src.connect(ctx.destination);
                console.log("[HomeCall] WebAudio direct hardware pipe connected!");
              }
            } catch (err) {}
          });
        }
      }
      stopRingtone();
      updateCallStatusUI("Connected (HD Voice)", true);

      if (window.AndroidBridge && typeof window.AndroidBridge.onCallStarted === 'function') {
        window.AndroidBridge.onCallStarted(currentCallPartnerId);
      }
    };

    const calleeCandidatesRef = ref(db, `calls/${myUserId}/calleeCandidates`);
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        push(calleeCandidatesRef, event.candidate.toJSON());
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await update(ref(db, `calls/${myUserId}`), {
      answer: { type: answer.type, sdp: answer.sdp },
      status: "accepted"
    });

    startCallTimer();

    // Flush queued candidates
    while (callerCandidateQueue.length > 0) {
      const c = callerCandidateQueue.shift();
      try {
        await peerConnection.addIceCandidate(c);
      } catch (e) {}
    }

    const callerCandidatesRef = ref(db, `calls/${myUserId}/callerCandidates`);
    onChildAdded(callerCandidatesRef, async (snapshot) => {
      const candidateData = snapshot.val();
      if (!candidateData) return;
      const candidate = new RTCIceCandidate(candidateData);
      if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (e) {}
      } else {
        callerCandidateQueue.push(candidate);
      }
    });
  } catch (err) {
    console.error("[HomeCall] Error accepting WebRTC call:", err);
  }
}
window.acceptIncomingCall = acceptIncomingCall;
window.handleIncomingCallFromNative = acceptIncomingCall;

/**
 * Callee declines call
 */
async function declineIncomingCall() {
  stopRingtone();
  hideIncomingCallModal();

  try {
    if (db && myUserId) {
      await update(ref(db, `calls/${myUserId}`), { status: "rejected" });
      setTimeout(() => {
        remove(ref(db, `calls/${myUserId}`)).catch(() => {});
      }, 1000);
    }
  } catch (e) {}

  isCallActive = false;
  currentCallPartnerId = null;
  currentChannelName = null;
  currentCallRole = null;
  window._pendingIncomingCallData = null;
}

/**
 * Terminate call (Hangup)
 */
async function terminateCall(notifyPeer = true) {
  stopRingtone();
  stopCallTimer();

  // Close Agora RTC Channel
  await leaveAgoraVoiceChannel();

  // Close WebRTC PeerConnection
  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (e) {}
    peerConnection = null;
  }

  // Stop local microphone tracks
  if (localMediaStream) {
    localMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (e) {}
    });
    localMediaStream = null;
  }

  const audioElement = document.getElementById("remote-audio-player");
  if (audioElement) {
    audioElement.pause();
    audioElement.srcObject = null;
  }

  // Reset Android AudioManager back to normal
  if (window.AndroidBridge && typeof window.AndroidBridge.onCallEnded === "function") {
    try {
      window.AndroidBridge.onCallEnded();
    } catch (e) {}
  }

  if (notifyPeer && db) {
    try {
      if (currentCallRole === "caller" && currentCallPartnerId) {
        await update(ref(db, `calls/${currentCallPartnerId}`), { status: "ended" });
        setTimeout(() => remove(ref(db, `calls/${currentCallPartnerId}`)).catch(() => {}), 1500);
      } else if (currentCallRole === "callee") {
        await update(ref(db, `calls/${myUserId}`), { status: "ended" });
        setTimeout(() => remove(ref(db, `calls/${myUserId}`)).catch(() => {}), 1500);
      }
    } catch (e) {}
  }

  isCallActive = false;
  currentCallPartnerId = null;
  currentChannelName = null;
  currentCallRole = null;
  isMicMuted = false;
  window._pendingIncomingCallData = null;

  hideActiveCallUI();
  resetMicToggleButton();
}

/**
 * Toggle Microphone Mute
 */
function toggleMic() {
  isMicMuted = !isMicMuted;

  if (localAgoraAudioTrack) {
    try {
      localAgoraAudioTrack.setEnabled(!isMicMuted);
    } catch (e) {}
  }

  if (localMediaStream) {
    localMediaStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMicMuted;
    });
  }

  updateMicToggleUI(isMicMuted);
}

// ==========================================
// 7. UI HELPERS & TIMERS
// ==========================================

function showActiveCallUI(partnerId, statusText) {
  const modal = document.getElementById("active-call-modal");
  const partnerEl = document.getElementById("call-partner-id");
  const statusEl = document.getElementById("call-status-label");

  if (modal) modal.classList.remove("hidden");
  if (partnerEl) partnerEl.textContent = partnerId;
  if (statusEl) statusEl.textContent = statusText;
}

function hideActiveCallUI() {
  const modal = document.getElementById("active-call-modal");
  if (modal) modal.classList.add("hidden");
}

function updateCallStatusUI(statusText, isConnected = false) {
  const statusEl = document.getElementById("call-status-label");
  const badgeEl = document.getElementById("call-quality-badge");

  if (statusEl) statusEl.textContent = statusText;
  if (badgeEl) {
    if (isConnected) {
      badgeEl.className = "text-[10px] bg-emerald-950 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded-full border border-emerald-500/40 animate-pulse";
    }
  }
}

function startCallTimer() {
  stopCallTimer();
  callStartTime = Date.now();
  const timerEl = document.getElementById("call-timer");

  callTimerInterval = setInterval(() => {
    if (!callStartTime || !timerEl) return;
    const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const secs = String(elapsedSec % 60).padStart(2, "0");
    timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
  const timerEl = document.getElementById("call-timer");
  if (timerEl) timerEl.textContent = "00:00";
}

function showIncomingCallModal(callerId) {
  const modal = document.getElementById("incoming-call-modal");
  const callerEl = document.getElementById("incoming-caller-id");
  if (modal) modal.classList.remove("hidden");
  if (callerEl) callerEl.textContent = callerId;
}

function hideIncomingCallModal() {
  const modal = document.getElementById("incoming-call-modal");
  if (modal) modal.classList.add("hidden");
}

function updateMicToggleUI(muted) {
  const labelEl = document.getElementById("label-toggle-mic");
  const iconOn = document.getElementById("icon-mic-on");
  const iconOff = document.getElementById("icon-mic-off");
  const btn = document.getElementById("btn-toggle-mic");

  if (muted) {
    if (labelEl) labelEl.textContent = "Unmute";
    if (iconOn) iconOn.classList.add("hidden");
    if (iconOff) iconOff.classList.remove("hidden");
    if (btn) btn.className = "flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-red-950/80 border border-red-500/40 text-red-200 transition-all font-semibold text-xs active:scale-95";
  } else {
    if (labelEl) labelEl.textContent = "Mute";
    if (iconOn) iconOn.classList.remove("hidden");
    if (iconOff) iconOff.classList.add("hidden");
    if (btn) btn.className = "flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-slate-700/80 hover:bg-slate-600 text-slate-200 transition-all font-semibold text-xs active:scale-95";
  }
}

function resetMicToggleButton() {
  isMicMuted = false;
  updateMicToggleUI(false);
}

function updateMicStatusUI(status) {
  const dot = document.getElementById("mic-status-dot");
  const text = document.getElementById("mic-status-text");

  if (status === "granted") {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400";
    if (text) text.textContent = "Mic Ready 🎙️";
  } else if (status === "denied") {
    if (dot) dot.className = "w-2 h-2 rounded-full bg-red-400";
    if (text) text.textContent = "Mic Blocked ❌";
  }
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const bgStyles = {
    info: "bg-slate-900 border-slate-700 text-slate-200",
    success: "bg-emerald-950 border-emerald-500/60 text-emerald-200",
    warning: "bg-amber-950 border-amber-500/60 text-amber-200",
    error: "bg-red-950 border-red-500/60 text-red-200"
  };

  toast.className = `border rounded-2xl px-4 py-3 text-xs shadow-2xl flex items-center justify-between gap-3 pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${
    bgStyles[type] || bgStyles.info
  }`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="text-slate-400 hover:text-white ml-2 text-base leading-none">✕</button>
  `;

  toast.querySelector("button").onclick = () => {
    toast.remove();
  };

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ==========================================
// 8. EVENT LISTENERS
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
  const listContainer = document.getElementById("users-list-container");
  if (listContainer) {
    listContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".call-user-btn");
      if (!btn) return;
      const targetId = btn.getAttribute("data-target-user");
      if (targetId) {
        initiateCall(targetId);
      }
    });
  }

  const checkMicBtn = document.getElementById("btn-check-mic");
  if (checkMicBtn) {
    checkMicBtn.addEventListener("click", async () => {
      try {
        await acquireLocalMicrophone();
        showToast("Microphone is active and ready!", "success");
      } catch (err) {
        showToast("Microphone error: " + err.message, "error");
      }
    });
  }

  const endCallBtn = document.getElementById("btn-end-call");
  if (endCallBtn) endCallBtn.addEventListener("click", () => terminateCall(true));

  const toggleMicBtn = document.getElementById("btn-toggle-mic");
  if (toggleMicBtn) toggleMicBtn.addEventListener("click", toggleMic);

  const acceptBtn = document.getElementById("btn-accept-call");
  if (acceptBtn) acceptBtn.addEventListener("click", acceptIncomingCall);

  const declineBtn = document.getElementById("btn-decline-call");
  if (declineBtn) declineBtn.addEventListener("click", declineIncomingCall);

  const openSettingsBtn = document.getElementById("btn-open-settings");
  const warningSetupBtn = document.getElementById("btn-warning-setup");
  const closeSettingsBtn = document.getElementById("btn-close-settings");
  const settingsModal = document.getElementById("settings-modal");
  const saveSettingsBtn = document.getElementById("btn-save-settings");
  const resetCredsBtn = document.getElementById("btn-reset-credentials");
  const inputAgora = document.getElementById("input-agora-app-id");
  const inputFirebase = document.getElementById("input-firebase-config");

  function openSettings() {
    if (!settingsModal) return;
    if (inputAgora) inputAgora.value = CONFIG.AGORA_APP_ID || "";
    if (inputFirebase) inputFirebase.value = JSON.stringify(CONFIG.FIREBASE_CONFIG, null, 2);
    settingsModal.classList.remove("hidden");
  }

  if (openSettingsBtn) openSettingsBtn.addEventListener("click", openSettings);
  if (warningSetupBtn) warningSetupBtn.addEventListener("click", openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      try {
        const newAgora = inputAgora.value.trim();
        const newFirebase = JSON.parse(inputFirebase.value.trim());

        const newCfg = {
          AGORA_APP_ID: newAgora,
          FIREBASE_CONFIG: newFirebase
        };
        localStorage.setItem("app_credentials_override", JSON.stringify(newCfg));
        showToast("Settings saved! Reloading...", "success");
        setTimeout(() => window.location.reload(), 1000);
      } catch (err) {
        showToast("Invalid JSON in Firebase config", "error");
      }
    });
  }

  if (resetCredsBtn) {
    resetCredsBtn.addEventListener("click", () => {
      localStorage.removeItem("app_credentials_override");
      showToast("Reset to defaults! Reloading...", "info");
      setTimeout(() => window.location.reload(), 1000);
    });
  }
});
