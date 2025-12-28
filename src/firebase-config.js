// === Firebase 設定 ===
const firebaseConfig = {
  apiKey: "AIzaSyBi-VIoa3swbrQqoeik9y5FtOHheJ3x8KA",
  authDomain: "truth-or-dare-online-v2.firebaseapp.com",
  databaseURL: "https://truth-or-dare-online-v2-default-rtdb.firebaseio.com",
  projectId: "truth-or-dare-online-v2",
  storageBucket: "truth-or-dare-online-v2.firebasestorage.app",
  messagingSenderId: "144397063274",
  appId: "1:144397063274:web:5c9e0d2161a1fcdd296613",
  measurementId: "G-86LC0DZ2RS",
};

// 初始化 Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
window.db = firebase.database();
window.auth = firebase.auth();
