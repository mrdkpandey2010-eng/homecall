package com.example.homecall

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.random.Random

class HomeCallService : Service() {

    companion object {
        private const val TAG = "HomeCallService"
        private const val NOTIFICATION_PRESENCE_ID = 1001
        private const val NOTIFICATION_INCOMING_CALL_ID = 2002

        const val PREFS_NAME = "homecall_prefs"
        const val PREF_USER_ID = "user_id"

        const val ACTION_START_SERVICE = "com.example.homecall.ACTION_START"
        const val ACTION_STOP_SERVICE = "com.example.homecall.ACTION_STOP"
        const val ACTION_ANSWER_CALL = "com.example.homecall.ACTION_ANSWER"
        const val ACTION_DECLINE_CALL = "com.example.homecall.ACTION_DECLINE"
        const val ACTION_SYNC_USER_ID = "com.example.homecall.ACTION_SYNC_USER"
        const val BROADCAST_CALL_CANCELLED = "com.example.homecall.BROADCAST_CALL_CANCELLED"

        const val EXTRA_CALLER_ID = "caller_id"
        const val EXTRA_USER_ID = "user_id"

        const val FIREBASE_DB_URL = "https://anoncall-app-default-rtdb.firebaseio.com"

        @Volatile
        var isServiceRunning = false

        @Volatile
        var currentActiveCallerId: String? = null
    }

    private lateinit var prefs: SharedPreferences
    private var myUserId: String = ""
    private var wakeLock: PowerManager.WakeLock? = null

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private var heartbeatJob: Job? = null

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    private var eventSource: EventSource? = null
    private lateinit var okHttpClient: OkHttpClient

    private var isRinging = false
    private var connectivityManager: ConnectivityManager? = null
    private var isNetworkCallbackRegistered = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Log.d(TAG, "Network available. Setting status to online...")
            setOnlineStatus(true)
            startCallListener()
        }

        override fun onLost(network: Network) {
            Log.d(TAG, "Network lost. Setting status to offline...")
            setOnlineStatus(false)
            stopCallListener()
        }
    }

    override fun onCreate() {
        super.onCreate()
        isServiceRunning = true
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        initUserId()

        // 1. Safe Foreground Notification Startup (Prevents Android 14+ crashes)
        startServiceInForeground()

        // 2. Safe Wakelock Setup
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HomeCall::PresenceLock").apply {
                setReferenceCounted(false)
                acquire(24 * 60 * 60 * 1000L) // 24 hours safeguard
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Wakelock could not be acquired: ${e.message}")
        }

        // 3. Safe Vibrator Setup
        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Vibrator setup error: ${e.message}")
        }

        // 4. OkHttpClient Setup
        okHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // Indefinite for SSE
            .retryOnConnectionFailure(true)
            .build()

        // 5. Safe Network Callback Setup
        try {
            connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val networkRequest = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager?.registerNetworkCallback(networkRequest, networkCallback)
            isNetworkCallbackRegistered = true
        } catch (e: Throwable) {
            Log.w(TAG, "NetworkCallback registration error: ${e.message}")
        }

        setOnlineStatus(true)
        startHeartbeat()
        startCallListener()
    }

    private fun startServiceInForeground() {
        val notification = buildPresenceNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_PRESENCE_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_PRESENCE_ID, notification)
            }
            Log.d(TAG, "startForeground executed successfully")
        } catch (e: Throwable) {
            Log.w(TAG, "startForeground with DATA_SYNC failed, trying default: ${e.message}")
            try {
                startForeground(NOTIFICATION_PRESENCE_ID, notification)
            } catch (e2: Throwable) {
                Log.e(TAG, "startForeground fallback failed: ${e2.message}", e2)
            }
        }
    }

    private fun initUserId() {
        var id = prefs.getString(PREF_USER_ID, null)
        if (id.isNullOrEmpty() || !id.matches(Regex("^User-\\d{6}$"))) {
            val num = Random.nextInt(100000, 999999)
            id = "User-$num"
            prefs.edit().putString(PREF_USER_ID, id).apply()
        }
        myUserId = id
        Log.d(TAG, "Service initialized with User ID: $myUserId")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.let {
            when (it.action) {
                ACTION_SYNC_USER_ID -> {
                    val newId = it.getStringExtra(EXTRA_USER_ID)
                    if (!newId.isNullOrEmpty() && newId != myUserId) {
                        Log.d(TAG, "Syncing new User ID: $newId")
                        setOnlineStatus(false)
                        stopCallListener()
                        myUserId = newId
                        prefs.edit().putString(PREF_USER_ID, newId).apply()
                        updatePresenceNotification()
                        setOnlineStatus(true)
                        startCallListener()
                    }
                }
                ACTION_DECLINE_CALL -> {
                    val callerId = it.getStringExtra(EXTRA_CALLER_ID)
                    declineCall(callerId)
                }
                ACTION_ANSWER_CALL -> {
                    val callerId = it.getStringExtra(EXTRA_CALLER_ID)
                    answerCall(callerId)
                }
                ACTION_STOP_SERVICE -> {
                    stopSelf()
                }
                else -> {}
            }
        }
        return START_STICKY
    }

    private fun buildPresenceNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, HomeCallApp.CHANNEL_PRESENCE_ID)
            .setContentTitle("HomeCall: Always Online")
            .setContentText("ID: $myUserId • Permanent Call Receiver Active")
            .setSmallIcon(R.drawable.ic_call)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updatePresenceNotification() {
        try {
            val manager = NotificationManagerCompat.from(this)
            manager.notify(NOTIFICATION_PRESENCE_ID, buildPresenceNotification())
        } catch (e: Throwable) {
            Log.w(TAG, "Notification update error", e)
        }
    }

    private fun setOnlineStatus(online: Boolean) {
        if (myUserId.isEmpty()) return
        serviceScope.launch {
            try {
                val json = JSONObject().apply {
                    put("status", if (online) "online" else "offline")
                    put("last_seen", System.currentTimeMillis())
                }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$FIREBASE_DB_URL/users/$myUserId.json")
                    .put(body)
                    .build()

                okHttpClient.newCall(request).execute().close()
                Log.d(TAG, "Presence updated in Firebase: $myUserId -> ${if (online) "online" else "offline"}")
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to update presence: ${e.message}")
            }
        }
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = serviceScope.launch {
            while (isActive) {
                delay(25_000)
                try {
                    val json = JSONObject().apply {
                        put("status", "online")
                        put("last_seen", System.currentTimeMillis())
                    }
                    val body = json.toString().toRequestBody("application/json".toMediaType())
                    val request = Request.Builder()
                        .url("$FIREBASE_DB_URL/users/$myUserId.json")
                        .patch(body)
                        .build()
                    okHttpClient.newCall(request).execute().close()
                } catch (e: Throwable) {
                    Log.w(TAG, "Heartbeat ping failed: ${e.message}")
                }
            }
        }
    }

    private fun startCallListener() {
        if (myUserId.isEmpty()) return
        stopCallListener()

        val sseUrl = "$FIREBASE_DB_URL/calls/$myUserId.json"
        val request = Request.Builder()
            .url(sseUrl)
            .header("Accept", "text/event-stream")
            .build()

        try {
            val factory = EventSources.createFactory(okHttpClient)
            eventSource = factory.newEventSource(request, object : EventSourceListener() {
                override fun onOpen(eventSource: EventSource, response: Response) {
                    Log.d(TAG, "SSE Call Listener connected to: $sseUrl")
                }

                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    handleIncomingCallData(data)
                }

                override fun onClosed(eventSource: EventSource) {
                    Log.d(TAG, "SSE Call Listener closed. Reconnecting in 3s...")
                    serviceScope.launch {
                        delay(3000)
                        startCallListener()
                    }
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    Log.w(TAG, "SSE Call Listener failure: ${t?.message}. Reconnecting in 5s...")
                    serviceScope.launch {
                        delay(5000)
                        startCallListener()
                    }
                }
            })
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to start SSE Call Listener: ${e.message}")
        }
    }

    private fun stopCallListener() {
        try {
            eventSource?.cancel()
        } catch (e: Throwable) {}
        eventSource = null
    }

    private fun handleIncomingCallData(payload: String) {
        try {
            if (payload.trim() == "null" || payload.isEmpty()) {
                if (isRinging) {
                    dismissIncomingCall(notifyRemote = false)
                }
                return
            }

            val json = JSONObject(payload)
            val callData = if (json.has("data")) json.optJSONObject("data") else json

            if (callData == null || callData.toString() == "null") {
                if (isRinging) {
                    dismissIncomingCall(notifyRemote = false)
                }
                return
            }

            val status = callData.optString("status")
            val caller = callData.optString("caller")

            if (status == "ringing" && caller.isNotEmpty() && callData.has("offer")) {
                if (!isRinging) {
                    currentActiveCallerId = caller
                    showIncomingCall(caller)
                }
            } else if (status == "ended" || status == "rejected") {
                dismissIncomingCall(notifyRemote = false)
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error parsing call event: ${e.message}")
        }
    }

    private fun showIncomingCall(callerId: String) {
        isRinging = true
        startRingtoneAndVibration()

        // 1. Full Screen Intent (Opens WhatsApp-style IncomingCallActivity over lock screen)
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            putExtra(EXTRA_CALLER_ID, callerId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_USER_ACTION
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            1,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 2. Answer Action
        val answerIntent = Intent(this, MainActivity::class.java).apply {
            action = ACTION_ANSWER_CALL
            putExtra(EXTRA_CALLER_ID, callerId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val answerPendingIntent = PendingIntent.getActivity(
            this,
            2,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 3. Decline Action
        val declineIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = ACTION_DECLINE_CALL
            putExtra(EXTRA_CALLER_ID, callerId)
        }
        val declinePendingIntent = PendingIntent.getBroadcast(
            this,
            3,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 4. Build Notification
        val notification = NotificationCompat.Builder(this, HomeCallApp.CHANNEL_INCOMING_CALL_ID)
            .setContentTitle("Incoming Voice Call")
            .setContentText("$callerId is calling...")
            .setSmallIcon(R.drawable.ic_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(R.drawable.ic_call_end, getString(R.string.action_decline), declinePendingIntent)
            .addAction(R.drawable.ic_call, getString(R.string.action_answer), answerPendingIntent)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_INCOMING_CALL_ID, notification)
        } catch (e: Throwable) {
            Log.w(TAG, "Notification display error: ${e.message}")
        }

        try {
            startActivity(fullScreenIntent)
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch IncomingCallActivity: ${e.message}")
        }
    }

    private fun startRingtoneAndVibration() {
        try {
            val ringtoneUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setDataSource(applicationContext, ringtoneUri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error playing ringtone: ${e.message}")
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(
                    VibrationEffect.createWaveform(
                        longArrayOf(0, 1000, 800, 1000, 800, 1000),
                        0
                    )
                )
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(longArrayOf(0, 1000, 800, 1000, 800, 1000), 0)
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error vibrating: ${e.message}")
        }
    }

    private fun stopRingtoneAndVibration() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.reset()
            mediaPlayer?.release()
            mediaPlayer = null
        } catch (e: Throwable) {}

        try {
            vibrator?.cancel()
        } catch (e: Throwable) {}
    }

    fun declineCall(callerId: String?) {
        stopRingtoneAndVibration()
        try {
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_INCOMING_CALL_ID)
        } catch (e: Throwable) {}
        isRinging = false
        currentActiveCallerId = null

        try {
            sendBroadcast(Intent(BROADCAST_CALL_CANCELLED))
        } catch (e: Throwable) {}

        serviceScope.launch {
            try {
                val json = JSONObject().apply { put("status", "rejected") }
                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$FIREBASE_DB_URL/calls/$myUserId.json")
                    .patch(body)
                    .build()
                okHttpClient.newCall(request).execute().close()
                Log.d(TAG, "Call rejected in Firebase RTDB")
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to reject call in DB: ${e.message}")
            }
        }
    }

    fun answerCall(callerId: String?) {
        stopRingtoneAndVibration()
        try {
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_INCOMING_CALL_ID)
        } catch (e: Throwable) {}
        isRinging = false
        currentActiveCallerId = null

        try {
            val intent = Intent(this, MainActivity::class.java).apply {
                action = ACTION_ANSWER_CALL
                putExtra(EXTRA_CALLER_ID, callerId)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            startActivity(intent)
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to launch MainActivity on answer: ${e.message}")
        }
    }

    private fun dismissIncomingCall(notifyRemote: Boolean) {
        stopRingtoneAndVibration()
        try {
            NotificationManagerCompat.from(this).cancel(NOTIFICATION_INCOMING_CALL_ID)
        } catch (e: Throwable) {}
        isRinging = false
        currentActiveCallerId = null

        try {
            sendBroadcast(Intent(BROADCAST_CALL_CANCELLED))
        } catch (e: Throwable) {}
    }

    override fun onDestroy() {
        isServiceRunning = false
        setOnlineStatus(false)
        stopRingtoneAndVibration()
        stopCallListener()
        heartbeatJob?.cancel()
        if (isNetworkCallbackRegistered) {
            try {
                connectivityManager?.unregisterNetworkCallback(networkCallback)
                isNetworkCallbackRegistered = false
            } catch (e: Throwable) {}
        }
        try {
            wakeLock?.release()
        } catch (e: Throwable) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
