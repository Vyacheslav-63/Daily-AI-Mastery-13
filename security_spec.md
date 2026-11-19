# Security Specification — Daily AI Mastery

## 1. Data Invariants
1. A user progress document `/users/{userId}` belongs strictly to the verified authenticated user (`request.auth.uid == userId && request.auth.token.email_verified == true`). No cross-user reads or root collection listing are permitted, protecting user email PII.
2. Sub-collections `/users/{userId}/lessons/{dayId}` and `/users/{userId}/quizResults/{resultId}` enforce `ownerUid == request.auth.uid` and require the parent `/users/{userId}` document to exist via `get()`/`exists()` (Master Gate).
3. All timestamps (`updatedAt`, `completedAt`) must equal `request.time`.
4. All IDs (`userId`, `dayId`, `resultId`, `uid`, `ownerUid`) must match `^[a-zA-Z0-9_-]+$` and be <= 128 chars.
5. `unlockedDay >= 1`, `correctAnswers <= totalAnswered`, `score <= total`.

## 2. Adversarial Test Vectors ("Dirty Dozen" Payloads)
1. Unauthenticated read/write to `/users/uid1`. -> DENIED
2. Unverified email user writing to `/users/uid1`. -> DENIED
3. Cross-user read/update to `/users/uid2` while signed in as `uid1`. -> DENIED
4. Root collection `list` query on `/users`. -> DENIED
5. Shadow field injection (`isAdmin: true`) on `/users/uid1` create or update. -> DENIED
6. Spoofed `uid` mismatch (`uid: "uid2"` inside `/users/uid1`). -> DENIED
7. Client-forged timestamp (`updatedAt: "2020-01-01T00:00:00Z"` instead of `request.time`). -> DENIED
8. Oversized ID poisoning (200-char `dayId` or invalid characters `../admin`). -> DENIED
9. Oversized `content` string (> 20000 chars) on `/users/uid1/lessons/6`. -> DENIED
10. Unbounded array poisoning (`completedDays` > 365 items or non-integer item). -> DENIED
11. `quizResults` mutation after creation (terminal score tampering). -> DENIED
12. Invalid `quizType` enum (`"hacked"` instead of `"daily"` or `"weekly"`). -> DENIED
