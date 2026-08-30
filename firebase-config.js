import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    GoogleAuthProvider,
    browserLocalPersistence,
    getAuth,
    setPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Конфигурация веб-приложения Firebase публична по замыслу Firebase.
// Доступ к данным ограничивается Firestore Rules, а не скрытием этих значений.
const firebaseConfig = {
    apiKey: 'AIzaSyDD9akfhmRpCwyWBRx1FJd-2mSjoItLLjE',
    authDomain: 'taxiuspeh-76d55.firebaseapp.com',
    projectId: 'taxiuspeh-76d55',
    storageBucket: 'taxiuspeh-76d55.firebasestorage.app',
    messagingSenderId: '678422371368',
    appId: '1:678422371368:web:64c7b4b48c102b3efda91d',
    measurementId: 'G-2QR7FSH0RD'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Сессия сохраняется на устройстве. Ошибка сохранения не должна блокировать вход.
setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn('Не удалось сохранить сессию Firebase:', error.code || error.message);
});

export { app, auth, db, googleProvider };
