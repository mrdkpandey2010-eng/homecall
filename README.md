# 📞 AnonCall — Zero-Login WebRTC Voice Calling App

A lightweight, secure, and production-ready Single Page Application (SPA) for browser-to-browser voice calling with **WhatsApp-grade audio quality**, built with **Agora RTC SDK v4** and **Firebase Realtime Database**.

---

## 🚀 Quick Setup Guide (Firebase + Agora + GitHub)

### 1️⃣ Firebase Setup (Step-by-Step)

1. Go to [Firebase Console](https://console.firebase.google.com/) and click **"Add Project"** (e.g. `anoncall-app`).
2. Disable Google Analytics (optional) and click **Create Project**.
3. **Enable Realtime Database**:
   - In the left sidebar, click **Build** -> **Realtime Database**.
   - Click **Create Database**, select a region (e.g., United States or Belgium).
   - Choose **Start in test mode** (or configure Rules below).
4. **Configure Database Security Rules**:
   - Go to the **Rules** tab in Realtime Database.
   - Paste the following rules and click **Publish**:
     ```json
     {
       "rules": {
         "users": {
           ".read": true,
           "$userId": {
             ".write": true
           }
         },
         "calls": {
           ".read": true,
           "$userId": {
             ".write": true
           }
         }
       }
     }
     ```
5. **Get Web Configuration**:
   - In Project Overview, click the Web icon (`</>`) to add a web app.
   - Register App Name (e.g., `AnonCall Web`).
   - Copy the `firebaseConfig` object and paste it into `config.js` or via the in-app Setup modal.

---

### 2️⃣ Agora.io Setup (Step-by-Step)

1. Sign up for free at [Agora Console](https://console.agora.io/) (Includes **10,000 free minutes** every month).
2. Go to **Project Management** -> click **Create Project**.
3. Enter Project Name: `AnonCall`.
4. Use authentication method: **"Testing mode: APP ID"** (App ID only, no token server needed for quick peer calling).
5. Copy your **App ID** and paste it into `config.js` (or in the app settings modal).

---

### 3️⃣ GitHub Setup & Deployment

#### Local Git Commit & Push:
To push this project to your GitHub account:

```bash
# 1. Create a new repository on https://github.com/new (e.g. "anoncall")
# 2. Run the following commands in this directory:
git add .
git commit -m "Initial commit: AnonCall WebRTC voice calling app"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

#### Automatic GitHub Pages Deployment:
- Once pushed to GitHub, go to your repository **Settings** -> **Pages**.
- Under **Build and deployment** > **Source**, select **GitHub Actions**.
- The included `.github/workflows/deploy.yml` will automatically build and publish your app live to `https://<username>.github.io/<repo>/`!

---

### 4️⃣ Local Development & Testing

Run locally with Node.js:
```bash
npm start
```
This opens `http://localhost:3000`.

Open two tabs (or one normal tab and one Incognito tab) to test:
- Two unique IDs (`User-XXXXXX`) will be assigned automatically.
- Both users will show as **Online (●)** in the directory.
- Click **Call** on one device/tab to trigger ringing and connect HD voice!

---

## 🛡️ Architecture & Security
- **Zero-Login**: No phone numbers, emails, or passwords. Random anonymous user IDs stored in `localStorage`.
- **Accurate Real-Time Presence**: Firebase `.info/connected` + `onDisconnect()` hooks handle instant disconnect detection.
- **Opus HD Audio**: Enforces Agora `rtc` mode with `opus` codec, hardware echo cancellation, noise suppression, and auto gain control.
- **Sandbox Privacy**: 100% browser WebRTC sandbox without touching cellular networks or dialer logs.
