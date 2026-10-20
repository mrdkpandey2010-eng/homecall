/**
 * AnonCall - Zero-Login WebRTC Voice Calling App
 * WhatsApp-grade Opus HD Calling with Firebase Realtime Database Signaling
 * Supports Direct WebRTC P2P (Google STUN) and Agora RTC v4 Fallback
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

// Check if credentials override exists in localStorage
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

// Check if credentials have been replaced
const isConfigured =
  CONFIG.FIREBASE_CONFIG &&
  CONFIG.FIREBASE_CONFIG.apiKey &&
  CONFIG.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

if (!isConfigured) {
  const warningEl = document.getElementById("credentials-warning");
  if (warningEl) warningEl.classList.remove("hidden");
  console.warn(
    "[AnonCall] Placeholder credentials detected. Please provide valid Firebase RTDB credentials."
  );
}

// Sync with Android Native Bridge if running inside Android APK
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

// Display current User ID in UI
const currentUserIdEl = document.getElementById("current-user-id");
if (currentUserIdEl) currentUserIdEl.textContent = myUserId;

// Copy ID to clipboard
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
  console.error("[AnonCall] Firebase initialization error:", err);
  showToast("Firebase initialization error. Check config.js", "error");
}

const myPresenceRef = db ? ref(db, `users/${myUserId}`) : null;
const connectedRef = db ? ref(db, ".info/connected") : null;
const allUsersRef = db ? ref(db, "users") : null;
const myIncomingCallRef = db ? ref(db, `calls/${myUserId}`) : null;

// Track user connection status with onDisconnect hook
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

// Ensure offline status on window unload / pagehide
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

// Cache of registered users for quick status validation
const usersCache = new Map();

// Listen to all users presence in real-time
if (allUsersRef) {
  onValue(
    allUsersRef,
    (snapshot) => {
      const data = snapshot.val() || {};
      usersCache.clear();

      const skeleton = document.getElementById("users-loading-skeleton");
      if (skeleton) skeleton.remove();

      let onlineCount = 0;
      let offlineCount = 0;
      const userEntries = Object.entries(data);

      userEntries.forEach(([id, info]) => {
        usersCache.set(id, info);
        if (info.status === "online") onlineCount++;
        else offlineCount++;
      });

      const userCountBadge = document.getElementById("user-count-badge");
      const onlineCountEl = document.getElementById("online-count");
      const offlineCountEl = document.getElementById("offline-count");

      if (userCountBadge) userCountBadge.textContent = `${userEntries.length} Total`;
      if (onlineCountEl) onlineCountEl.textContent = onlineCount;
      if (offlineCountEl) offlineCountEl.textContent = offlineCount;

      // Sort: Current user first, then online users, then recently seen
      userEntries.sort(([idA, userA], [idB, userB]) => {
        if (idA === myUserId) return -1;
        if (idB === myUserId) return 1;
        if (userA.status === "online" && userB.status !== "online") return -1;
        if (userB.status === "online" && userA.status !== "online") return 1;
        return (userB.last_seen || 0) - (userA.last_seen || 0);
      });

      renderUserDirectory(userEntries);
    },
    (error) => {
      console.error("[AnonCall] Firebase read error:", error);
      const skeleton = document.getElementById("users-loading-skeleton");
      if (skeleton) {
        skeleton.innerHTML = `
          <div class="p-4 bg-red-950/40 border border-red-500/30 rounded-xl text-center text-xs text-red-200">
            <p class="font-bold mb-1">Firebase Connection Permission Error</p>
            <p class="text-slate-400 mb-2">${error.message}</p>
            <p class="text-[11px] text-amber-300">Please go to Firebase Console &gt; Realtime Database &gt; Rules, set read/write to true and click Publish.</p>
          </div>
        `;
      }
      showToast("Firebase Error: " + error.message, "error");
    }
  );
}

/**
 * Render the live user dashboard
 */
function renderUserDirectory(userEntries) {
  const container = document.getElementById("user-list");
  if (!container) return;

  if (userEntries.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <p class="text-sm">No registered users in database yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  userEntries.forEach(([userId, userData]) => {
    const isSelf = userId === myUserId;
    const isOnline = userData.status === "online";
    const lastSeenText = formatLastSeen(userData.last_seen);

    const card = document.createElement("div");
    card.className = `flex items-center justify-between p-3.5 rounded-xl border transition-all ${
      isSelf
        ? "bg-slate-800/40 border-slate-700/60"
        : isOnline
        ? "bg-slate-800/80 border-slate-700/80 hover:border-emerald-500/50 shadow-sm"
        : "bg-slate-900/40 border-slate-800/50 opacity-75"
    }`;

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="relative w-9 h-9 rounded-full ${
          isOnline ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"
        } flex items-center justify-center font-mono font-bold text-xs">
          ${userId.slice(-2)}
          <span class="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
            isOnline ? "bg-emerald-500" : "bg-slate-500"
          }"></span>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-semibold ${isOnline ? "text-slate-100" : "text-slate-400"}">
              ${userId}
            </span>
            ${
              isSelf
                ? `<span class="text-[10px] bg-slate-700 text-slate-300 font-medium px-1.5 py-0.2 rounded">You</span>`
                : ""
            }
          </div>
          <div class="flex items-center gap-1.5 text-xs">
            ${
              isOnline
                ? `<span class="text-emerald-400 font-medium flex items-center gap-1">
                     <span class="text-emerald-400 text-xs">●</span> Online
                   </span>`
                : `<span class="text-slate-500">● Offline • ${lastSeenText}</span>`
            }
          </div>
        </div>
      </div>
      <div>
        ${
          isSelf
            ? `<span class="text-xs text-slate-500 font-mono italic px-3 py-1">Current Device</span>`
            : `<button
                type="button"
                data-target-user="${userId}"
                class="call-user-btn cursor-pointer relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isOnline
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 active:scale-95"
                    : "bg-slate-800 text-slate-500 hover:bg-slate-700/60"
                }">
                <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
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
// 3. WEBRTC P2P & CALL STATE MANAGEMENT
// ==========================================

// Global WebRTC State
let peerConnection = null;
let localMediaStream = null;
let currentChannelName = null;
let currentCallPartnerId = null;
let currentCallRole = null; // 'caller' | 'callee'
let isCallActive = false;
let callTimerInterval = null;
let callStartTime = null;
let isMicMuted = false;

// Google Public STUN Configuration (100% Free, Global, Zero-Certificate)
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

// Audio context for synthesized ringback and ringing sounds
let audioCtx = null;
let ringtoneOscillator = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
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

    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    for (let i = 0; i < 15; i++) {
      const cycleStart = now + i * 4;
      gainNode.gain.setValueAtTime(0.08, cycleStart);
      gainNode.gain.setValueAtTime(0.08, cycleStart + 1.5);
      gainNode.gain.setValueAtTime(0, cycleStart + 1.51);
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

    const now = ctx.currentTime;
    for (let i = 0; i < 15; i++) {
      const t = now + i * 2.5;
      gainNode.gain.setValueAtTime(0.12, t);
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
    ringtoneOscillator.stop();
    ringtoneOscillator = null;
  }
}

/**
 * Acquire local microphone with strict hardware constraints
 * (Suppress background rumble, echo loops, robotic clipping)
 */
async function acquireLocalMicrophone() {
  if (localMediaStream) return localMediaStream;

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

  localMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  updateMicStatusUI("granted");
  return localMediaStream;
}

// ==========================================
// 4. CALL TRIGGER & SIGNALING (FIREBASE RTDB)
// ==========================================

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

  // Verify recipient live status in Firebase RTDB
  const targetUser = usersCache.get(targetUserId);
  if (!targetUser || targetUser.status !== "online") {
    showToast("User is offline", "warning");
    return;
  }

  // Immediately request microphone permission inside this user click gesture
  try {
    await acquireLocalMicrophone();
  } catch (micErr) {
    console.error("[AnonCall] Mic permission error:", micErr);
    updateMicStatusUI("denied");
    showToast("Microphone permission required! Please tap 'Allow' when prompted.", "error");
    return;
  }

  // Sort and join User IDs to create unique channel identifier
  const channelName = [myUserId, targetUserId].sort().join("-");

  currentChannelName = channelName;
  currentCallPartnerId = targetUserId;
  currentCallRole = "caller";
  isCallActive = true;

  showActiveCallUI(targetUserId, "Ringing...");
  playOutgoingRingback();

  try {
    // 1. Create WebRTC Peer Connection
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local audio tracks to peer connection
    localMediaStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localMediaStream);
    });

    // Handle remote audio stream
    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const audioElement = document.getElementById("remote-audio-player");
      if (audioElement) {
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        audioElement.muted = false;
        audioElement.playsInline = true;
        audioElement.play().catch((e) => console.warn("[AnonCall] Autoplay error:", e));
      }
      stopRingtone();
      updateCallStatusUI("Connected (Opus HD)", true);
    };

    // Gather ICE candidates and push to Firebase
    const callerCandidatesRef = ref(db, `calls/${targetUserId}/callerCandidates`);
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        push(callerCandidatesRef, event.candidate.toJSON());
      }
    };

    // 2. Create WebRTC Offer
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true
    });
    await peerConnection.setLocalDescription(offer);

    // 3. Write call offer to recipient's node in Firebase RTDB
    const callOfferRef = ref(db, `calls/${targetUserId}`);
    await set(callOfferRef, {
      caller: myUserId,
      recipient: targetUserId,
      channel: channelName,
      status: "ringing",
      offer: {
        type: offer.type,
        sdp: offer.sdp
      },
      timestamp: Date.now()
    });

    // Auto-remove offer if caller disconnects unexpectedly
    onDisconnect(callOfferRef).remove();

    // 4. Listen for recipient answer on calls/${targetUserId}
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

    // 5. Listen for Callee ICE candidates
    const calleeCandidatesRef = ref(db, `calls/${targetUserId}/calleeCandidates`);
    onChildAdded(calleeCandidatesRef, (snapshot) => {
      const candidateData = snapshot.val();
      if (candidateData && peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
      }
    });
  } catch (err) {
    console.error("[AnonCall] Signaling error:", err);
    stopRingtone();
    showToast("Call failed: " + err.message, "error");
    terminateCall(false);
  }
}

/**
 * Callee: Listen for incoming calls on `calls/${myUserId}`
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

      // Store offer for acceptance
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
  if (!data || !data.offer || !currentCallPartnerId) return;

  isCallActive = true;
  showActiveCallUI(currentCallPartnerId, "Connecting...");

  // Acquire microphone directly inside this Accept click gesture
  try {
    await acquireLocalMicrophone();
  } catch (micErr) {
    console.error("[AnonCall] Mic error on accept:", micErr);
    showToast("Microphone permission required to speak.", "error");
    updateMicStatusUI("denied");
    terminateCall(true);
    return;
  }

  try {
    // 1. Create WebRTC Peer Connection
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    localMediaStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localMediaStream);
    });

    // Handle incoming remote audio
    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      const audioElement = document.getElementById("remote-audio-player");
      if (audioElement) {
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        audioElement.muted = false;
        audioElement.playsInline = true;
        audioElement.play().catch((e) => console.warn("[AnonCall] Autoplay error:", e));
      }
      stopRingtone();
      updateCallStatusUI("Connected (Opus HD)", true);
    };

    // Gather Callee ICE candidates
    const calleeCandidatesRef = ref(db, `calls/${myUserId}/calleeCandidates`);
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        push(calleeCandidatesRef, event.candidate.toJSON());
      }
    };

    // 2. Set Remote Description (Caller's Offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

    // 3. Create WebRTC Answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // 4. Send Answer to Firebase RTDB
    await update(ref(db, `calls/${myUserId}`), {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      },
      status: "accepted"
    });

    startCallTimer();

    // 5. Listen for Caller ICE candidates
    const callerCandidatesRef = ref(db, `calls/${myUserId}/callerCandidates`);
    onChildAdded(callerCandidatesRef, (snapshot) => {
      const candidateData = snapshot.val();
      if (candidateData && peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
      }
    });
  } catch (err) {
    console.error("[AnonCall] Error accepting call:", err);
    showToast("Failed to connect call: " + err.message, "error");
    terminateCall(true);
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

  // Clear audio element
  const audioElement = document.getElementById("remote-audio-player");
  if (audioElement) {
    audioElement.srcObject = null;
  }

  // Notify peer in Firebase RTDB
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
 * Toggle Microphone Mute / Unmute
 */
function toggleMic() {
  if (!localMediaStream) return;

  isMicMuted = !isMicMuted;
  localMediaStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMicMuted;
  });

  const iconOn = document.getElementById("icon-mic-on");
  const iconOff = document.getElementById("icon-mic-off");
  const label = document.getElementById("label-toggle-mic");
  const btn = document.getElementById("btn-toggle-mic");

  if (isMicMuted) {
    iconOn?.classList.add("hidden");
    iconOff?.classList.remove("hidden");
    if (label) label.textContent = "Unmute";
    btn?.classList.add("bg-red-500/20", "text-red-400", "border", "border-red-500/40");
    btn?.classList.remove("bg-slate-700", "text-slate-200");
    showToast("Microphone muted", "info");
  } else {
    iconOn?.classList.remove("hidden");
    iconOff?.classList.add("hidden");
    if (label) label.textContent = "Mute";
    btn?.classList.remove("bg-red-500/20", "text-red-400", "border", "border-red-500/40");
    btn?.classList.add("bg-slate-700", "text-slate-200");
    showToast("Microphone unmuted", "info");
  }
}

function resetMicToggleButton() {
  document.getElementById("icon-mic-on")?.classList.remove("hidden");
  document.getElementById("icon-mic-off")?.classList.add("hidden");
  const label = document.getElementById("label-toggle-mic");
  if (label) label.textContent = "Mute";
  const btn = document.getElementById("btn-toggle-mic");
  if (btn) {
    btn.classList.remove("bg-red-500/20", "text-red-400", "border", "border-red-500/40");
    btn.classList.add("bg-slate-700", "text-slate-200");
  }
}

// ==========================================
// 5. CALL UI HELPERS & NOTIFICATIONS
// ==========================================

function showActiveCallUI(partnerId, statusText) {
  const modal = document.getElementById("active-call-modal");
  const partnerIdEl = document.getElementById("call-partner-id");
  const statusEl = document.getElementById("call-status-label");
  const timerEl = document.getElementById("call-timer");

  if (partnerIdEl) partnerIdEl.textContent = partnerId;
  if (statusEl) statusEl.textContent = statusText;
  if (timerEl) timerEl.textContent = "00:00";
  if (modal) modal.classList.remove("hidden");
}

function updateCallStatusUI(text, isConnected) {
  const statusEl = document.getElementById("call-status-label");
  if (statusEl) {
    statusEl.textContent = text;
    if (isConnected) statusEl.className = "text-xs text-emerald-400 font-semibold";
  }
}

function hideActiveCallUI() {
  document.getElementById("active-call-modal")?.classList.add("hidden");
}

function showIncomingCallModal(callerId) {
  const modal = document.getElementById("incoming-call-modal");
  const callerEl = document.getElementById("incoming-caller-id");
  if (callerEl) callerEl.textContent = callerId;
  if (modal) modal.classList.remove("hidden");
}

function hideIncomingCallModal() {
  document.getElementById("incoming-call-modal")?.classList.add("hidden");
}

function startCallTimer() {
  stopCallTimer();
  callStartTime = Date.now();
  const timerEl = document.getElementById("call-timer");

  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
}

// Non-intrusive Toast Notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-xs font-medium border transition-all duration-300 transform translate-y-[-10px] opacity-0 ${
    type === "warning"
      ? "bg-amber-950/90 border-amber-500/40 text-amber-200"
      : type === "error"
      ? "bg-red-950/90 border-red-500/40 text-red-200"
      : type === "success"
      ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-200"
      : "bg-slate-800/95 border-slate-700 text-slate-200"
  }`;

  const iconSvg =
    type === "warning"
      ? `<svg class="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`
      : type === "error"
      ? `<svg class="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
      : type === "success"
      ? `<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
      : `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

  toast.innerHTML = `${iconSvg}<span class="flex-1">${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.remove("translate-y-[-10px]", "opacity-0"));

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-[-5px]");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================
// 6. UI EVENT ATTACHMENTS
// ==========================================

const endCallBtn = document.getElementById("btn-end-call");
if (endCallBtn) {
  endCallBtn.addEventListener("click", () => terminateCall(true));
}

const acceptCallBtn = document.getElementById("btn-accept-call");
if (acceptCallBtn) {
  acceptCallBtn.addEventListener("click", acceptIncomingCall);
}

const declineCallBtn = document.getElementById("btn-decline-call");
if (declineCallBtn) {
  declineCallBtn.addEventListener("click", declineIncomingCall);
}

const toggleMicBtn = document.getElementById("btn-toggle-mic");
if (toggleMicBtn) {
  toggleMicBtn.addEventListener("click", toggleMic);
}

// Delegated event listener for user directory call buttons
const userListContainer = document.getElementById("user-list");
if (userListContainer) {
  userListContainer.addEventListener("click", (e) => {
    const btn = e.target.closest(".call-user-btn");
    if (!btn) return;
    const targetId = btn.getAttribute("data-target-user");
    if (targetId) {
      initiateCall(targetId);
    }
  });
}

// Microphone Permission Helpers & Status Indicator
const checkMicBtn = document.getElementById("btn-check-mic");

function updateMicStatusUI(state) {
  const dot = document.getElementById("mic-status-dot");
  const text = document.getElementById("mic-status-text");
  if (!dot || !text) return;

  if (state === "granted") {
    dot.className = "w-2 h-2 rounded-full bg-emerald-400";
    text.textContent = "Mic Ready ✓";
  } else if (state === "denied") {
    dot.className = "w-2 h-2 rounded-full bg-red-500";
    text.textContent = "Mic Blocked ✕";
  } else {
    dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
    text.textContent = "Enable Mic 🎤";
  }
}

async function requestMicPermission() {
  try {
    await acquireLocalMicrophone();
    updateMicStatusUI("granted");
    showToast("Microphone ready! 🎤", "success");
  } catch (err) {
    console.error("Mic check error:", err);
    updateMicStatusUI("denied");
    showToast("Microphone permission was denied. Please allow microphone in browser.", "error");
  }
}

checkMicBtn?.addEventListener("click", requestMicPermission);

// Check permission status on startup
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: "microphone" }).then((status) => {
    updateMicStatusUI(status.state);
    status.onchange = () => updateMicStatusUI(status.state);
  }).catch(() => {});
}

// Credentials Setup Modal Handlers
const settingsModal = document.getElementById("settings-modal");
const openSettingsBtn = document.getElementById("btn-open-settings");
const warningSetupBtn = document.getElementById("btn-warning-setup");
const closeSettingsBtn = document.getElementById("btn-close-settings");
const cancelSettingsBtn = document.getElementById("btn-cancel-settings");
const saveSettingsBtn = document.getElementById("btn-save-settings");
const resetConfigBtn = document.getElementById("btn-reset-config");
const copyRulesBtn = document.getElementById("btn-copy-rules");

function openSettingsModal() {
  const inputFirebase = document.getElementById("input-firebase-config");

  if (inputFirebase && CONFIG.FIREBASE_CONFIG?.apiKey !== "YOUR_API_KEY") {
    inputFirebase.value = JSON.stringify(CONFIG.FIREBASE_CONFIG, null, 2);
  }
  if (settingsModal) settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add("hidden");
}

openSettingsBtn?.addEventListener("click", openSettingsModal);
warningSetupBtn?.addEventListener("click", openSettingsModal);
closeSettingsBtn?.addEventListener("click", closeSettingsModal);
cancelSettingsBtn?.addEventListener("click", closeSettingsModal);

copyRulesBtn?.addEventListener("click", () => {
  const rules = JSON.stringify(
    {
      rules: {
        users: { ".read": true, "$u": { ".write": true } },
        calls: { ".read": true, "$u": { ".write": true } }
      }
    },
    null,
    2
  );
  navigator.clipboard.writeText(rules).then(() => {
    showToast("Firebase Rules copied to clipboard!", "success");
  });
});

saveSettingsBtn?.addEventListener("click", () => {
  const rawFirebase = document.getElementById("input-firebase-config")?.value.trim();

  let parsedFirebase = null;
  try {
    let cleanJson = rawFirebase;
    if (cleanJson.startsWith("const firebaseConfig =") || cleanJson.startsWith("var firebaseConfig =")) {
      cleanJson = cleanJson.replace(/^[^{]*/, "").replace(/;?\s*$/, "");
    }
    cleanJson = cleanJson.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    parsedFirebase = JSON.parse(cleanJson);
  } catch (err) {
    showToast("Invalid Firebase Config format. Please paste valid JSON.", "error");
    return;
  }

  if (!parsedFirebase.apiKey || !parsedFirebase.databaseURL) {
    showToast("Firebase Config must include apiKey and databaseURL", "warning");
    return;
  }

  const newConfig = {
    AGORA_APP_ID: CONFIG.AGORA_APP_ID || "",
    FIREBASE_CONFIG: parsedFirebase
  };

  localStorage.setItem("app_credentials_override", JSON.stringify(newConfig));
  showToast("Credentials saved! Connecting...", "success");
  setTimeout(() => window.location.reload(), 600);
});

resetConfigBtn?.addEventListener("click", () => {
  localStorage.removeItem("app_credentials_override");
  showToast("Reset to config.js defaults! Reloading...", "info");
  setTimeout(() => window.location.reload(), 600);
});
