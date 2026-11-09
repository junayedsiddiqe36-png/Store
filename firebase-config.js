/* ============================================================
   ★ শুধু এই ফাইলটা এডিট করবেন ★
   Firebase Console → ⚙️ Project settings → Your apps → Web app
   সেখান থেকে firebaseConfig-এর মানগুলো কপি করে নিচে বসান।
   ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAoyZ5BrE4tPOW3pVaF-g5Xdm_bt5xQqi4",
  authDomain: "http://bot-store-b1781.firebaseapp.com",
  projectId: "bot-store-b1781",
  storageBucket: "http://bot-store-b1781.firebasestorage.app",
  messagingSenderId: "980515760381",
  appId: "1:980515760381:web:2624fb2117be653639b694"
};

// অ্যাডমিনের Gmail (Google দিয়ে লগইন করবেন)।
// firestore.rules ফাইলেও একই ইমেইল বসাতে হবে।
window.OWNER_EMAIL = "junayedsiddiqe518@gmail.com";

/* ------------------------------------------------------------
   🔴 Google লগইন কোন ডোমেইন দিয়ে চলবে?

   "auto"  → Netlify (*.netlify.app) ও Vercel (*.vercel.app)-এ
             নিজের ডোমেইন দিয়েই লগইন হবে (সুপারিশকৃত)।
             এর জন্য netlify.toml / vercel.json-এর ভিতরে
             PASTE_PROJECT_ID জায়গায় Project ID বসাতে হবে।
             এতে firebaseapp.com-এ যাওয়া লাগে না — তাই
             DNS_PROBE_FINISHED_NXDOMAIN সমস্যাও হয় না।

   true    → সবসময় নিজের ডোমেইন (কাস্টম ডোমেইন হলে এটা দিন)।
   false   → পুরোনো নিয়ম, firebaseapp.com দিয়ে।
             GitHub Pages-এ চালালে false দিতে হবে।
   ------------------------------------------------------------ */
window.USE_OWN_DOMAIN_FOR_AUTH = "auto";
