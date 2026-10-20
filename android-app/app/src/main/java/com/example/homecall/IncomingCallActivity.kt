package com.example.homecall

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat

class IncomingCallActivity : ComponentActivity() {

    private var callerId: String? = null

    private val callCancelledReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        callerId = intent.getStringExtra(HomeCallService.EXTRA_CALLER_ID) ?: "Unknown User"

        setupWindowFlags()

        // Register broadcast listener for remote call cancellation
        val filter = IntentFilter(HomeCallService.BROADCAST_CALL_CANCELLED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(callCancelledReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(callCancelledReceiver, filter)
        }

        buildUI()
    }

    private fun setupWindowFlags() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
                val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                keyguardManager?.requestDismissKeyguard(this, null)
            } else {
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } catch (e: Throwable) {
            android.util.Log.w("IncomingCallActivity", "setupWindowFlags error: ${e.message}")
        }
    }

    private fun buildUI() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B141B")) // WhatsApp dark background
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(40, 100, 40, 100)
        }

        // Top Header
        val headerText = TextView(this).apply {
            text = "HomeCall Voice Call"
            setTextColor(Color.parseColor("#8696A0"))
            textSize = 15f
            gravity = Gravity.CENTER
        }
        root.addView(headerText)

        // Caller ID Title
        val callerNameText = TextView(this).apply {
            text = callerId
            setTextColor(Color.WHITE)
            textSize = 28f
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 8)
        }
        root.addView(callerNameText)

        // Subtitle status
        val statusText = TextView(this).apply {
            text = "Incoming Opus HD Voice Call..."
            setTextColor(Color.parseColor("#25D366")) // WhatsApp green accent
            textSize = 16f
            gravity = Gravity.CENTER
        }
        root.addView(statusText)

        // Spacer
        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1.0f
            )
        }
        root.addView(spacer)

        // Caller Avatar Circle with Pulse Look
        val avatarContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(160.dpToPx(), 160.dpToPx()).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#1F2C34"))
                setStroke(3.dpToPx(), Color.parseColor("#25D366"))
            }
        }
        val avatarIcon = ImageView(this).apply {
            setImageDrawable(ContextCompat.getDrawable(this@IncomingCallActivity, R.drawable.ic_call))
            setColorFilter(Color.parseColor("#25D366"))
            layoutParams = FrameLayout.LayoutParams(70.dpToPx(), 70.dpToPx()).apply {
                gravity = Gravity.CENTER
            }
        }
        avatarContainer.addView(avatarIcon)
        root.addView(avatarContainer)

        // Bottom Spacer
        val bottomSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1.0f
            )
        }
        root.addView(bottomSpacer)

        // Action Buttons Row (Decline & Answer)
        val buttonsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        // Decline Button (Red)
        val declineLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(40, 0, 40, 0)
        }
        val declineBtn = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(72.dpToPx(), 72.dpToPx())
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#EA4335")) // Red
            }
            setImageDrawable(ContextCompat.getDrawable(this@IncomingCallActivity, R.drawable.ic_call_end))
            setPadding(18.dpToPx(), 18.dpToPx(), 18.dpToPx(), 18.dpToPx())
            setOnClickListener {
                onDecline()
            }
        }
        val declineLabel = TextView(this).apply {
            text = "Decline"
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(0, 8.dpToPx(), 0, 0)
        }
        declineLayout.addView(declineBtn)
        declineLayout.addView(declineLabel)
        buttonsRow.addView(declineLayout)

        // Answer Button (Green)
        val answerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(40, 0, 40, 0)
        }
        val answerBtn = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(72.dpToPx(), 72.dpToPx())
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#25D366")) // WhatsApp Green
            }
            setImageDrawable(ContextCompat.getDrawable(this@IncomingCallActivity, R.drawable.ic_call))
            setPadding(18.dpToPx(), 18.dpToPx(), 18.dpToPx(), 18.dpToPx())
            setOnClickListener {
                onAnswer()
            }
        }
        val answerLabel = TextView(this).apply {
            text = "Answer"
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(0, 8.dpToPx(), 0, 0)
        }
        answerLayout.addView(answerBtn)
        answerLayout.addView(answerLabel)
        buttonsRow.addView(answerLayout)

        root.addView(buttonsRow)

        setContentView(root)
    }

    private fun onAnswer() {
        val intent = Intent(this, HomeCallService::class.java).apply {
            action = HomeCallService.ACTION_ANSWER_CALL
            putExtra(HomeCallService.EXTRA_CALLER_ID, callerId)
        }
        startService(intent)
        finish()
    }

    private fun onDecline() {
        val intent = Intent(this, HomeCallService::class.java).apply {
            action = HomeCallService.ACTION_DECLINE_CALL
            putExtra(HomeCallService.EXTRA_CALLER_ID, callerId)
        }
        startService(intent)
        finish()
    }

    private fun Int.dpToPx(): Int = (this * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        try {
            unregisterReceiver(callCancelledReceiver)
        } catch (e: Exception) {}
        super.onDestroy()
    }
}
