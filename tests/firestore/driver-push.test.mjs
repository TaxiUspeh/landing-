import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId:'demo-taxi-rules-check', firestore:{host:'127.0.0.1',port:8088,rules:await readFile('../../firestore.rules','utf8')} });
try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
        const db=context.firestore();
        await setDoc(doc(db,'driverAccounts','me'),{driverId:'32',active:true});
        await setDoc(doc(db,'drivers','32'),{status:'active',authUid:'me'});
        await setDoc(doc(db,'settings','driverPortal'),{webPushVapidKey:'public-key'});
        await setDoc(doc(db,'driverPushTokens','me-phone'),{uid:'previous-account',driverId:'666',token:'old-token',enabled:true});
    });
    const db=env.authenticatedContext('me').firestore();
    const payload=()=>({uid:'me',driverId:'32',token:'new-token',enabled:true,updatedAt:serverTimestamp()});
    await assertSucceeds(getDoc(doc(db,'settings','driverPortal')));
    await assertFails(setDoc(doc(db,'driverPushTokens','me-phone'),payload()));
    const current=doc(db,'driverPushTokens','me-phone-v2-32');
    await assertSucceeds(setDoc(current,payload()));
    await assertSucceeds(setDoc(current,{...payload(),token:'refreshed-token'}));
    await assertSucceeds(setDoc(current,{enabled:false,updatedAt:serverTimestamp()},{merge:true}));
    await assertFails(getDoc(current)); // Non-admin drivers never need to read registration tokens.
    await assertFails(setDoc(doc(env.authenticatedContext('stranger').firestore(),'driverPushTokens','new-phone'),payload()));
    await assertFails(setDoc(current,{...payload(),uid:'stranger'}));
    await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'driverAccounts','me'),{driverId:'53',active:true}));
    await assertFails(setDoc(current,{...payload(),driverId:'53'}));
    await assertSucceeds(setDoc(doc(db,'driverPushTokens','me-phone-v2-53'),{...payload(),driverId:'53'}));
    console.log('PASS: existing Firestore rules allow migrated/refreshed subscriptions and still reject wrong owners/cards');
} finally { await env.cleanup(); }
