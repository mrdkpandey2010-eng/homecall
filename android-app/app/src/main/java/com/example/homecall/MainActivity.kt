package com.example.homecall

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MainActivity"
    }

    private lateinit var webView: WebView
    private lateinit var permissionContainer: LinearLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var prefs: SharedPreferences

    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val audioGranted = permissions[Manifest.permission.RECORD_AUDIO] ?: false
        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions[Manifest.permission.POST_NOTIFICATIONS] ?: false
        } else true

        Log.d(TAG, "Permissions callback: audio=$audioGranted, notif=$notifGranted")
        checkAndHandlePermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = getSharedPreferences(HomeCallService.PREFS_NAME, Context.MODE_PRIVATE)

        val rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
        }

        // 1. Setup WebView
        setupWebView()
        rootLayout.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        // 2. Setup Progress Bar
        progressBar = ProgressBar(this).apply {
            visibility = View.VISIBLE
        }
        val progressParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
        }
        rootLayout.addView(progressBar, progressParams)

        // 3. Setup Compulsory Permission Banner/Overlay
        setupPermissionUI()
        rootLayout.addView(permissionContainer, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        setContentView(rootLayout)

        checkAndHandlePermissions()
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action == HomeCallService.ACTION_ANSWER_CALL) {
            val callerId = intent.getStringExtra(HomeCallService.EXTRA_CALLER_ID)
            Log.d(TAG, "Answering call from native intent: $callerId")
            webView.postDelayed({
                webView.evaluateJavascript(
                    "if (window.handleIncomingCallFromNative) { window.handleIncomingCallFromNative('${callerId ?: ""}'); } else if (window.acceptIncomingCall) { window.acceptIncomingCall(); }",
                    null
                )
            }, 800)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
            }

            // Grant WebRTC microphone capture without browser prompt
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.let {
                        val resources = it.resources
                        for (r in resources) {
                            if (r == PermissionRequest.RESOURCE_AUDIO_CAPTURE) {
                                it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                                return
                            }
                        }
                        it.grant(resources)
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    progressBar.visibility = View.GONE
                }
            }

            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
        }

        // Load local bundled web application
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    private fun setupPermissionUI() {
        permissionContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#E60F172A")) // Semi-transparent dark
            setPadding(48, 64, 48, 64)
            visibility = View.GONE
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 48, 48, 48)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = 24f
                setColor(Color.parseColor("#1E293B"))
                setStroke(2, Color.parseColor("#334155"))
            }
        }

        val title = TextView(this).apply {
            text = "Compulsory Permissions"
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 16)
        }
        card.addView(title)

        val desc = TextView(this).apply {
            text = "HomeCall requires the following permissions to stay permanently online and receive incoming WhatsApp-quality voice calls in realtime:"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 32)
        }
        card.addView(desc)

        // Item 1: Mic
        card.addView(createPermissionItem("🎙️ Microphone", "Required for WebRTC Opus HD voice speaking."))
        // Item 2: Notifications
        card.addView(createPermissionItem("🔔 Call Notifications", "Required for WhatsApp-style incoming call ringing."))
        // Item 3: Battery Optimization
        card.addView(createPermissionItem("⚡ 24/7 Permanent Online", "Must ignore battery saving so call receiver never gets killed."))

        val grantButton = Button(this).apply {
            text = "Grant Compulsory Permissions"
            setTextColor(Color.WHITE)
            textSize = 15f
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = 16f
                setColor(Color.parseColor("#25D366")) // WhatsApp Green
            }
            setPadding(32, 24, 32, 24)
            setOnClickListener {
                requestCompulsoryPermissions()
            }
        }
        card.addView(grantButton)

        permissionContainer.addView(card)
    }

    private fun createPermissionItem(title: String, subtitle: String): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, 24)
            addView(TextView(this@MainActivity).apply {
                text = title
                setTextColor(Color.parseColor("#38BDF8"))
                textSize = 16f
            })
            addView(TextView(this@MainActivity).apply {
                text = subtitle
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 13f
            })
        }
    }

    private fun checkAndHandlePermissions() {
        val audioGranted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else true

        val isBatteryIgnored = isBatteryOptimizationIgnored()

        if (!audioGranted || !notifGranted) {
            permissionContainer.visibility = View.VISIBLE
        } else {
            permissionContainer.visibility = View.GONE
            startHomeCallForegroundService()
            if (!isBatteryIgnored) {
                requestIgnoreBatteryOptimization()
            }
        }
    }

    private fun requestCompulsoryPermissions() {
        val permissionsToRequest = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionsLauncher.launch(permissionsToRequest.toTypedArray())
        } else {
            requestIgnoreBatteryOptimization()
            permissionContainer.visibility = View.GONE
            startHomeCallForegroundService()
        }
    }

    private fun isBatteryOptimizationIgnored(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(packageName)
        }
        return true
    }

    @SuppressLint("BatteryLife")
    private fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isBatteryOptimizationIgnored()) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Battery optimization intent failed: ${e.message}")
            }
        }
    }

    private fun startHomeCallForegroundService() {
        val serviceIntent = Intent(this, HomeCallService::class.java).apply {
            action = HomeCallService.ACTION_START_SERVICE
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun getUserId(): String {
            return prefs.getString(HomeCallService.PREF_USER_ID, "") ?: ""
        }

        @JavascriptInterface
        fun onUserIdReady(userId: String) {
            Log.d(TAG, "Bridge: onUserIdReady received $userId")
            if (userId.isNotEmpty()) {
                prefs.edit().putString(HomeCallService.PREF_USER_ID, userId).apply()
                val syncIntent = Intent(this@MainActivity, HomeCallService::class.java).apply {
                    action = HomeCallService.ACTION_SYNC_USER_ID
                    putExtra(HomeCallService.EXTRA_USER_ID, userId)
                }
                startService(syncIntent)
            }
        }

        @JavascriptInterface
        fun onCallStarted(partnerId: String) {
            Log.d(TAG, "Bridge: Call started with $partnerId")
        }

        @JavascriptInterface
        fun onCallEnded() {
            Log.d(TAG, "Bridge: Call ended")
        }

        @JavascriptInterface
        fun requestBatteryExemption() {
            runOnUiThread {
                requestIgnoreBatteryOptimization()
            }
        }

        @JavascriptInterface
        fun isBatteryOptimizationIgnored(): Boolean {
            return this@MainActivity.isBatteryOptimizationIgnored()
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // Minimize the app instead of closing, so call receiving remains active
        moveTaskToBack(true)
    }
}
