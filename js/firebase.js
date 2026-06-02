import { deleteApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc as firestoreDoc,
    getDoc,
    getDocs,
    getFirestore,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBu78yhEoIHxfi3CeSi64PFAxh3k5MDj4M",
    authDomain: "checklist-5s.firebaseapp.com",
    projectId: "checklist-5s",
    storageBucket: "checklist-5s.firebasestorage.app",
    messagingSenderId: "236598402594",
    appId: "1:236598402594:web:65b15d6ab449c5fd55b47b",
    measurementId: "G-BZ55C36L1Q"
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getFirestore(app);
export const auth = getAuth(app);

export async function criarUsuarioAuthSecundario(email, password) {
    const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const secondaryAuth = getAuth(secondaryApp);
    try {
        const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        return credential.user;
    } finally {
        await signOut(secondaryAuth).catch(() => {});
        await deleteApp(secondaryApp).catch(() => {});
    }
}

export {
    addDoc,
    collection,
    deleteDoc,
    firestoreDoc,
    getDoc,
    getDocs,
    limit,
    onAuthStateChanged,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    signInWithEmailAndPassword,
    signOut,
    updateDoc
};
