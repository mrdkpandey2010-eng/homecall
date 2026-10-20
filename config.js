/**
 * Configuration for Zero-Login WebRTC Calling Application
 * Replace the placeholders below with your Agora.io App ID and Firebase Realtime Database credentials.
 */
export const CONFIG = {
  // Agora RTC App ID (From Agora Console -> Project Management)
  AGORA_APP_ID: "YOUR_AGORA_APP_ID",

  // Firebase Realtime Database Config (From Firebase Console -> Project Settings)
  FIREBASE_CONFIG: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  }
};
