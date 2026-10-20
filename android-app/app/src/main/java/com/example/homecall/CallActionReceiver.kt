package com.example.homecall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callerId = intent.getStringExtra(HomeCallService.EXTRA_CALLER_ID)
        val serviceIntent = Intent(context, HomeCallService::class.java).apply {
            action = intent.action
            putExtra(HomeCallService.EXTRA_CALLER_ID, callerId)
        }
        context.startService(serviceIntent)
    }
}
