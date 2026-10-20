package com.example.homecall

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

class HomeCallApp : Application() {

    companion object {
        private const val TAG = "HomeCallApp"
        const val CHANNEL_PRESENCE_ID = "homecall_presence_channel"
        const val CHANNEL_INCOMING_CALL_ID = "homecall_incoming_call_channel"
    }

    override fun onCreate() {
        super.onCreate()

        // Global crash guard to prevent silent terminates and log error details
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val stackTrace = sw.toString()
                Log.e(TAG, "FATAL UNCAUGHT EXCEPTION in thread ${thread.name}:\n$stackTrace")

                val crashFile = File(filesDir, "crash.log")
                crashFile.writeText("Time: ${System.currentTimeMillis()}\nThread: ${thread.name}\n$stackTrace")
            } catch (e: Exception) {
                Log.e(TAG, "Error writing crash log", e)
            }
            defaultHandler?.uncaughtException(thread, throwable)
        }

        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val notificationManager = getSystemService(NotificationManager::class.java) ?: return

                // 1. Presence channel (Low priority, silent, ongoing)
                val presenceChannel = NotificationChannel(
                    CHANNEL_PRESENCE_ID,
                    getString(R.string.channel_presence_name),
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = getString(R.string.channel_presence_desc)
                    setShowBadge(false)
                }

                // 2. Incoming call channel (High/Max priority, sound, vibration, heads-up)
                val defaultRingtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build()

                val incomingCallChannel = NotificationChannel(
                    CHANNEL_INCOMING_CALL_ID,
                    getString(R.string.channel_calls_name),
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = getString(R.string.channel_calls_desc)
                    try {
                        setSound(defaultRingtoneUri, audioAttributes)
                    } catch (e: Exception) {
                        Log.w(TAG, "Could not set custom ringtone: ${e.message}")
                    }
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 1000, 800, 1000, 800, 1000)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    try {
                        setBypassDnd(true)
                    } catch (e: Throwable) {
                        Log.w(TAG, "Could not set bypass DND (requires system policy): ${e.message}")
                    }
                }

                notificationManager.createNotificationChannel(presenceChannel)
                notificationManager.createNotificationChannel(incomingCallChannel)
                Log.d(TAG, "Notification channels initialized successfully")
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error creating notification channels: ${e.message}", e)
        }
    }
}
