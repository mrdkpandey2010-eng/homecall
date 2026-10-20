/**
 * AnonCall - Zero-Login WebRTC Audio Calling App
 * Integrates Agora RTC SDK v4 and Firebase Realtime Database v10
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect
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
  CONFIG.AGORA_APP_ID &&
  CONFIG.AGORA_APP_ID !== "YOUR_AGORA_APP_ID" &&
  CONFIG.FIREBASE_CONFIG &&
  CONFIG.FIREBASE_CONFIG.apiKey &&
  CONFIG.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

if (!isConfigured) {
  const warningEl = document.getElementById("credentials-warning");
  if (warningEl) warningEl.classList.remove("hidden");
  console.warn(
    "[AnonCall] Placeholder credentials detected. Please provide valid Agora & Firebase RTDB credentials."
  );
}

// Generate or retrieve unique User ID ('User-XXXXXX')
let myUserId = localStorage.getItem("app_user_id");
if (!myUserId || !/^User-\d{6}$/.test(myUserId)) {
  const randomSixDigits = Math.floor(100000 + Math.random() * 900000);
  myUserId = `User-${randomSixDigits}`;
  localStorage.setItem("app_user_id", myUserId);
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
      // Set status to offline immediately when client disconnects
      onDisconnect(myPresenceRef).set({
        status: "offline",
        last_seen: Date.now()
      });

      // Set status to online now
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
    // Best-effort beacon to set offline immediately before teardown
    try {
      set(ref(db, `users/${myUserId}`), {
        status: "offline",
        last_seen: Date.now()
      });
    } catch (e) {
      // Ignore sync teardown errors
    }
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

      // Update stats
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
                data-target-user="${userId}"
                class="call-user-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isOnline
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 active:scale-95"
                    : "bg-slate-800 text-slate-500 hover:bg-slate-700/60 cursor-pointer"
                }">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call
              </button>`
        }
      </div>
    `;

    container.appendChild(card);
  });

  // Attach event listeners to call buttons
  container.querySelectorAll(".call-user-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = e.currentTarget.getAttribute("data-target-user");
      if (targetId) initiateCall(targetId);
    });
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
// 3. AGORA RTC & CALL STATE MANAGEMENT
// ==========================================

// Force RTC mode and Opus codec for WhatsApp-grade voice
const agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "opus" });

let localAudioTrack = null;
let currentChannelName = null;
let currentCallPartnerId = null;
let currentCallRole = null; // 'caller' | 'callee'
let isCallActive = false;
let callTimerInterval = null;
let callStartTime = null;
let isMicMuted = false;

// Audio context for synthesized ringback and ringing sounds (Zero External Audio File Dependency)
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

    // Standard phone dual-frequency tone (440Hz + 480Hz)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;

    // Pulse rhythm (2s on, 4s off)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    const now = ctx.currentTime;
    for (let i = 0; i < 10; i++) {
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
        } catch (e) {
          // ignore
        }
      }
    };
  } catch (e) {
    console.warn("[AnonCall] Ringback synth error:", e);
  }
}

function playIncomingRingtone() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    stopRingtone();

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5

    const now = ctx.currentTime;
    // Cheerful ring pattern
    for (let i = 0; i < 15; i++) {
      const t = now + i * 2.5;
      gainNode.gain.setValueAtTime(0.12, t);
      osc.frequency.setValueAtTime(523.25, t);
      osc.frequency.setValueAtTime(659.25, t + 0.15); // E5
      osc.frequency.setValueAtTime(783.99, t + 0.3); // G5
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
        } catch (e) {
          // ignore
        }
      }
    };
  } catch (e) {
    console.warn("[AnonCall] Ringtone synth error:", e);
  }
}

function stopRingtone() {
  if (ringtoneOscillator) {
    ringtoneOscillator.stop();
    ringtoneOscillator = null;
  }
}

/**
 * Handle remote stream subscription
 * Strictly attaches incoming audio track to hidden HTML5 audio element
 */
agoraClient.on("user-published", async (remoteUser, mediaType) => {
  if (mediaType === "audio") {
    try {
      await agoraClient.subscribe(remoteUser, mediaType);
      const remoteAudioTrack = remoteUser.audioTrack;

      if (remoteAudioTrack) {
        const audioElement = document.getElementById("remote-audio-player");
        const mediaStreamTrack = remoteAudioTrack.getMediaStreamTrack();

        if (audioElement && mediaStreamTrack) {
          // Attach underlying MediaStreamTrack to hidden HTML5 audio element
          audioElement.srcObject = new MediaStream([mediaStreamTrack]);
          audioElement.autoplay = true;
          audioElement.muted = false;
          audioElement.playsInline = true;

          audioElement.play().catch((playErr) => {
            console.warn(
              "[AnonCall] HTML5 audio autoplay policy catch, fallback to Agora play:",
              playErr
            );
            remoteAudioTrack.play();
          });
        } else {
          remoteAudioTrack.play();
        }
      }

      // Stop ringing and switch state to connected
      stopRingtone();
      updateCallStatusUI("Connected (Opus HD)", true);
    } catch (err) {
      console.error("[AnonCall] Error subscribing to remote user audio:", err);
      showToast("Error receiving remote audio", "error");
    }
  }
});

agoraClient.on("user-unpublished", (remoteUser, mediaType) => {
  if (mediaType === "audio") {
    const audioElement = document.getElementById("remote-audio-player");
    if (audioElement) {
      audioElement.srcObject = null;
    }
  }
});

agoraClient.on("user-left", () => {
  showToast("Remote user left the call", "info");
  terminateCall(false);
});

// ==========================================
// 4. CALL TRIGGER & SIGNALING (FIREBASE RTDB)
// ==========================================

/**
 * Start call to target user
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

  // Pre-check Agora App ID
  if (!isConfigured) {
    showToast("Configure credentials in config.js first.", "error");
    return;
  }

  // Dynamically sort and join User IDs to prevent race conditions
  const channelName = [myUserId, targetUserId].sort().join("-");

  currentChannelName = channelName;
  currentCallPartnerId = targetUserId;
  currentCallRole = "caller";
  isCallActive = true;

  // Show active call banner in "Calling..." state
  showActiveCallUI(targetUserId, "Ringing...");
  playOutgoingRingback();

  try {
    // Write call offer to recipient's inbox in Firebase RTDB
    const callOfferRef = ref(db, `calls/${targetUserId}`);
    await set(callOfferRef, {
      caller: myUserId,
      recipient: targetUserId,
      channel: channelName,
      status: "ringing",
      timestamp: Date.now()
    });

    // Automatically remove ringing offer if caller disconnects
    onDisconnect(callOfferRef).remove();

    // Listen for recipient response on calls/${targetUserId}
    const callWatchUnsub = onValue(callOfferRef, async (snap) => {
      const data = snap.val();

      // If call node was deleted or status cancelled
      if (!data) {
        if (isCallActive && currentCallRole === "caller") {
          showToast("Call ended", "info");
          terminateCall(false);
        }
        return;
      }

      if (data.status === "accepted") {
        // Recipient accepted! Join Agora RTC channel
        stopRingtone();
        updateCallStatusUI("Connecting Agora RTC...", false);
        await joinAgoraChannelAndPublish(channelName);
        startCallTimer();
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

    // Store listener reference for cleanup
    window._activeCallWatchUnsub = callWatchUnsub;
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

    // No pending call
    if (!data) {
      hideIncomingCallModal();
      return;
    }

    if (data.status === "ringing" && !isCallActive) {
      // Incoming call received
      currentCallPartnerId = data.caller;
      currentChannelName = data.channel;
      currentCallRole = "callee";

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
 * Join Agora channel with strict hardware constraints on local microphone track
 */
async function joinAgoraChannelAndPublish(channelName) {
  try {
    // 1. Join channel
    await agoraClient.join(CONFIG.AGORA_APP_ID, channelName, null, myUserId);

    // 2. Create microphone audio track with strict hardware constraints
    // Suppress background room rumble, echo loops, and clipping
    localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      // W3C audio constraints
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      // Agora RTC specific options
      AEC: true,
      ANS: true,
      AGC: true,
      encoderConfig: "high_quality_stereo"
    });

    // 3. Publish local track
    await agoraClient.publish([localAudioTrack]);
    updateCallStatusUI("Connected (Opus HD)", true);
  } catch (err) {
    console.error("[AnonCall] Hardware mic / Agora join error:", err);
    if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
      showToast("Microphone access is required for voice calls.", "error");
    } else {
      showToast("Audio connection error: " + err.message, "error");
    }
    terminateCall(true);
  }
}

/**
 * Callee accepts call
 */
async function acceptIncomingCall() {
  stopRingtone();
  hideIncomingCallModal();

  if (!currentChannelName || !currentCallPartnerId) return;

  isCallActive = true;
  showActiveCallUI(currentCallPartnerId, "Connecting...");

  try {
    // Notify caller in RTDB
    await update(ref(db, `calls/${myUserId}`), { status: "accepted" });

    // Join Agora channel & publish local mic
    await joinAgoraChannelAndPublish(currentChannelName);
    startCallTimer();
  } catch (err) {
    console.error("[AnonCall] Error accepting call:", err);
    showToast("Failed to connect call: " + err.message, "error");
    terminateCall(true);
  }
}

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
  } catch (e) {
    console.warn("Decline cleanup error:", e);
  }

  isCallActive = false;
  currentCallPartnerId = null;
  currentChannelName = null;
  currentCallRole = null;
}

/**
 * Terminate call (Hangup)
 */
async function terminateCall(notifyPeer = true) {
  stopRingtone();
  stopCallTimer();

  // Clean up signaling node in Firebase RTDB
  if (notifyPeer && db) {
    try {
      if (currentCallRole === "caller" && currentCallPartnerId) {
        await update(ref(db, `calls/${currentCallPartnerId}`), { status: "ended" });
        setTimeout(() => {
          remove(ref(db, `calls/${currentCallPartnerId}`)).catch(() => {});
        }, 1000);
      } else if (currentCallRole === "callee") {
        await update(ref(db, `calls/${myUserId}`), { status: "ended" });
        setTimeout(() => {
          remove(ref(db, `calls/${myUserId}`)).catch(() => {});
        }, 1000);
      }
    } catch (e) {
      console.warn("RTDB call teardown error:", e);
    }
  }

  // Stop & close local mic track
  if (localAudioTrack) {
    try {
      localAudioTrack.stop();
      localAudioTrack.close();
    } catch (e) {
      console.warn("Error closing local audio track:", e);
    }
    localAudioTrack = null;
  }

  // Clear remote audio element
  const audioElement = document.getElementById("remote-audio-player");
  if (audioElement) {
    audioElement.srcObject = null;
  }

  // Leave Agora RTC channel
  try {
    await agoraClient.leave();
  } catch (e) {
    // Ignore already-left errors
  }

  // Reset state
  isCallActive = false;
  currentCallPartnerId = null;
  currentChannelName = null;
  currentCallRole = null;
  isMicMuted = false;

  hideActiveCallUI();
  resetMicToggleButton();
}

/**
 * Toggle Microphone Mute / Unmute
 */
function toggleMic() {
  if (!localAudioTrack) return;

  isMicMuted = !isMicMuted;
  localAudioTrack.setEnabled(!isMicMuted);

  const iconOn = document.getElementById("icon-mic-on");
  const iconOff = document.getElementById("icon-mic-off");
  const label = document.getElementById("label-toggle-mic");
  const btn = document.getElementById("btn-toggle-mic");

  if (isMicMuted) {
    iconOn.classList.add("hidden");
    iconOff.classList.remove("hidden");
    label.textContent = "Unmute";
    btn.classList.add("bg-red-500/20", "text-red-400", "border", "border-red-500/40");
    btn.classList.remove("bg-slate-700", "text-slate-200");
    showToast("Microphone muted", "info");
  } else {
    iconOn.classList.remove("hidden");
    iconOff.classList.add("hidden");
    label.textContent = "Mute";
    btn.classList.remove("bg-red-500/20", "text-red-400", "border", "border-red-500/40");
    btn.classList.add("bg-slate-700", "text-slate-200");
    showToast("Microphone unmuted", "info");
  }
}

function resetMicToggleButton() {
  const iconOn = document.getElementById("icon-mic-on");
  const iconOff = document.getElementById("icon-mic-off");
  const label = document.getElementById("label-toggle-mic");
  const btn = document.getElementById("btn-toggle-mic");

  if (iconOn) iconOn.classList.remove("hidden");
  if (iconOff) iconOff.classList.add("hidden");
  if (label) label.textContent = "Mute";
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
    if (isConnected) {
      statusEl.className = "text-xs text-emerald-400 font-semibold";
    }
  }
}

function hideActiveCallUI() {
  const modal = document.getElementById("active-call-modal");
  if (modal) modal.classList.add("hidden");
}

function showIncomingCallModal(callerId) {
  const modal = document.getElementById("incoming-call-modal");
  const callerEl = document.getElementById("incoming-caller-id");
  if (callerEl) callerEl.textContent = callerId;
  if (modal) modal.classList.remove("hidden");
}

function hideIncomingCallModal() {
  const modal = document.getElementById("incoming-call-modal");
  if (modal) modal.classList.add("hidden");
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

/**
 * Non-intrusive Toast Notifications
 * Avoids blocking the browser thread with window.alert()
 */
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

  toast.innerHTML = `
    ${iconSvg}
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-[-10px]", "opacity-0");
  });

  // Automatically remove after 3.5s
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
  const inputAgora = document.getElementById("input-agora-id");
  const inputFirebase = document.getElementById("input-firebase-config");

  if (inputAgora && CONFIG.AGORA_APP_ID !== "YOUR_AGORA_APP_ID") {
    inputAgora.value = CONFIG.AGORA_APP_ID;
  }
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
  const agoraId = document.getElementById("input-agora-id")?.value.trim();
  const rawFirebase = document.getElementById("input-firebase-config")?.value.trim();

  if (!agoraId) {
    showToast("Please enter a valid Agora App ID", "warning");
    return;
  }

  let parsedFirebase = null;
  try {
    let cleanJson = rawFirebase;
    if (cleanJson.startsWith("const firebaseConfig =") || cleanJson.startsWith("var firebaseConfig =")) {
      cleanJson = cleanJson.replace(/^[^{]*/, "").replace(/;?\s*$/, "");
    }
    // Convert unquoted keys to quoted JSON keys
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
    AGORA_APP_ID: agoraId,
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

