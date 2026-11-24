# Guard AI Firestore Security Specification

## 1. Data Invariants
1. **Identity Integrity**: Every user-created document (`road_scanner`, `vehicle_scanner`, `building_scanner`, `night_watch_alerts`, `incident_reports`, `payments`, `subscriptions`, `guard_users_live`, `user_permissions`) must have `userId == request.auth.uid` (or `ownerId == request.auth.uid` for `family_tracking`).
2. **PII Isolation**: Private user fields (`email`, `phone`, `emergencyContact`, `walletBalance`) live only in `users/{userId}` and `me_profiles/{userId}`, readable strictly by the owner or Admin. Public leaderboards and profiles read from `public_profiles` and `user_usage_stats` which exclude PII.
3. **Police Numbers Secrecy**: `police_stations` is readable and writable strictly by Admins (`isAdmin()`).
4. **No Direct Alert / Home Video Publishing**: Regular users cannot create `home_videos` or verified `alerts`. Only Admin approval promotes a report to `alerts` and `home_videos`.
5. **No Self-Privilege Escalation**: Users cannot create `users/{uid}` with `role == 'admin'` or update `role`, `subscription`, or `walletBalance` themselves.
6. **Strict Timestamps & Bounds**: All `createdAt` fields enforce `request.time`, and all strings/arrays enforce explicit `.size()` limits.

7. **Anti-Spam Report Controls**: Standard incident reports require a non-banned account active for >= 24 hours (`users/{uid}.createdAt + 24h <= request.time`), enforce a 30-minute cooldown (`users/{uid}.lastReportAt + 30m <= request.time`) atomically via `getAfter()`, stay in `'pending'` with `visibleOnMap: false` until Admin approves into `alerts`, auto-hide (`isHidden: true`, `verifiedByGuardAI: false`) + atomically flag the reporter on 3 distinct `'False'` community votes, and log immutable `{ userId, device, timestamp }` audit records in `report_audit_logs`.

## 2. Dirty Dozen Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Admin Escalation**: `setDoc(doc(db, 'users', uid), { uid, fullName: 'Attacker', role: 'admin', createdAt: serverTimestamp() })`
2. **Shadow Field Injection on User**: `updateDoc(doc(db, 'users', uid), { bio: 'hi', subscription: 'active', walletBalance: 999999 })`
3. **Cross-User PII Read**: Non-admin user calls `getDoc(doc(db, 'users', otherUid))`
4. **Police Number Leak**: Non-admin user calls `getDocs(collection(db, 'police_stations'))`
5. **Unapproved Alert Spoofing**: Non-admin user calls `addDoc(collection(db, 'alerts'), { type: 'Gunshot', verifiedByGuardAI: true, status: 'New', address: 'Lagos', createdAt: serverTimestamp() })`
6. **Unpaid Home Video Spoofing**: Non-admin user calls `addDoc(collection(db, 'home_videos'), { reportId: 'r1', userId: uid, userName: 'X', videoUrl: 'https://...', incidentType: 'Gun', verifiedAt: serverTimestamp() })`
7. **Self-Approving Payment**: User calls `updateDoc(doc(db, 'payments', payId), { status: 'APPROVED' })`
8. **Self-Approving Subscription**: User calls `addDoc(collection(db, 'subscriptions'), { userId: uid, plan: 'Yearly', status: 'active', amount: 35000, createdAt: serverTimestamp() })`
9. **Impersonating Another User's Scan**: User A calls `addDoc(collection(db, 'road_scanner'), { userId: userB, status: 'Road Baseline Live', createdAt: serverTimestamp() })`
10. **Reading Another User's Private Family Circle**: Non-owner calls `getDocs(collection(db, 'family_tracking'))` without owner filter
11. **ID Poisoning**: Creating `users/` with 500-char ID or invalid characters
12. **Client Timestamp Backdating / Anti-Spam Bypass**: Creating `incident_reports` with backdated `createdAt`, `visibleOnMap: true`, account < 24h old, or < 30m cooldown without atomic `lastReportAt` update
13. **Duplicate False Vote / False Reporter Flagging**: Submitting a second False vote from the same UID or setting `flaggedReporter: true` without an alert atomically reaching `falseCount >= 3`
14. **Audit Log Tampering**: Updating or deleting any document in `report_audit_logs`
