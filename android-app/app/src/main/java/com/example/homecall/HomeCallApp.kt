package com.example.homecall

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build

class HomeCallApp : Application() {

    companion object {
        const val CHANNEL_PRESENCE_ID = "homecall_presence_channel"
        const val CHANNEL_INCOMING_CALL_ID = "homecall_incoming_call_channel"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)

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
                setSound(defaultRingtoneUri, audioAttributes)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 1000, 800, 1000, 800, 1000)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                setBypassDnd(true)
            }

            notificationManager.createNotificationChannel(presenceChannel)
            notificationManager.createNotificationChannel(incomingCallChannel)
        }
    }
}
