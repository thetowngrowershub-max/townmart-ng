# Rotating TownMart secrets

## Column encryption key (`DATA_ENCRYPTION_KEY`)

Ciphertexts carry the id of the key that wrote them (`v1.<keyId>.…`), so old and new keys can coexist.

1. Generate a new key: `openssl rand -base64 32`.
2. Deploy with the new key as current and the old one kept for decryption:
   ```
   DATA_ENCRYPTION_KEY=<new>
   DATA_ENCRYPTION_KEY_ID=k2
   DATA_ENCRYPTION_KEY_k1=<old>
   ```
   New writes use `k2`; existing `k1` values still decrypt.
3. Re-encrypt existing rows with a worker job that reads each `*_encrypted` column, decrypts and re-encrypts it (the re-encryption job ships with the Phase 6 column-encryption audit).
4. When no `v1.k1.` values remain (`SELECT count(*) FROM users WHERE phone_encrypted LIKE 'v1.k1.%'`, and the same for every encrypted column), remove `DATA_ENCRYPTION_KEY_k1`.

Never lose an old key while ciphertexts that use it remain: that data becomes unrecoverable.

## Lookup hash key (`DATA_HASH_KEY`)

Changing it changes every `phone_hash` and `ip_hash`. Recompute `phone_hash` from the decrypted phone numbers in the same maintenance window. IP hashes are only used for rate limiting and audit correlation and can simply start over.

## `AUTH_SECRET`

Rotating it invalidates Auth.js OAuth state/CSRF cookies in flight. Database sessions are unaffected.

## Database role passwords

```sql
ALTER ROLE townmart_app PASSWORD '<new>';
```
Update `DATABASE_URL` (and PgBouncer's auth file in production), then restart the web app and worker. Do the same for `townmart_migrator` and `townmart_readonly`.
