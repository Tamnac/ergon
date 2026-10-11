# Ergon sync protocol v1

HTTP + JSON under `/api/v1`. Message shapes are defined in [v1.schema.json](v1.schema.json) (JSON Schema 2020-12, one `$defs` entry per message); [fixtures/v1.json](fixtures/v1.json) holds valid and invalid examples per message that both the client and server test suites validate. Binary values are standard base64 with padding. Timestamps are Unix milliseconds.

The server stores and forwards ciphertext. It knows accounts (public keys), devices, sequence numbers, sizes and times.

## Errors

Non-2xx responses carry `Error`: `{ "error": code, "message": text }`.

| Status | Code                                                       |
| ------ | ---------------------------------------------------------- |
| 400    | `bad_request`                                              |
| 401    | `unauthorized` (missing, unknown or revoked token)         |
| 403    | `invite_required`, `invalid_invite`, `registration_closed` |
| 404    | `not_found`                                                |
| 409    | `stale_snapshot`                                           |
| 410    | `cursor_pruned`                                            |
| 413    | `too_large`                                                |
| 500    | `internal`                                                 |

## Authentication

Authenticated endpoints take `Authorization: Bearer <token>`.

1. `POST /api/v1/challenge` → `Challenge` `{ nonce }`. Single use, valid for 5 minutes.
2. The client signs the UTF-8 bytes of `ergon-auth-v1:` followed by the nonce string with its Ed25519 key.
3. `POST /api/v1/session` with `SessionRequest` → `Session`. If the account (public key) is unknown the server registers it, subject to the registration mode, and returns `created: true`. Each session is one device.

Registration modes (server config): `open` accepts anyone; `invite` requires an unused invite code in `invite`, consumed on success (`invite_required` if missing, `invalid_invite` if unknown or used); `closed` accepts only public keys on the server's allowlist (`registration_closed` otherwise). Existing accounts can always sign in.

## Endpoints

| Method + path                       | Auth | Request          | Response                                 |
| ----------------------------------- | ---- | ---------------- | ---------------------------------------- |
| `GET /api/health`                   | no   |                  | `{ status: "ok" }`                       |
| `GET /api/v1/info`                  | no   |                  | `Info`                                   |
| `POST /api/v1/challenge`            | no   |                  | `Challenge`                              |
| `POST /api/v1/session`              | no   | `SessionRequest` | `Session`                                |
| `DELETE /api/v1/session`            | yes  |                  | 204, revokes the calling device          |
| `GET /api/v1/devices`               | yes  |                  | `Devices`                                |
| `DELETE /api/v1/devices/{id}`       | yes  |                  | 204; 404 if not a device of this account |
| `POST /api/v1/batches`              | yes  | `BatchPush`      | `BatchPushed`                            |
| `GET /api/v1/batches?after=&limit=` | yes  |                  | `Batches`                                |
| `GET /api/v1/snapshot`              | yes  |                  | `Snapshot`; 404 if none                  |
| `PUT /api/v1/snapshot`              | yes  | `Snapshot`       | 204                                      |
| `GET /api/v1/events`                | yes  |                  | `text/event-stream`                      |
| `POST /api/v1/links`                | yes  | `LinkCreate`     | `LinkCreated` (201)                      |
| `GET /api/v1/links/{id}`            | no   |                  | `Link`; 404 if unknown, used or expired  |

### Batches

A batch is an encrypted list of ops. `POST /api/v1/batches` assigns the next sequence number (increasing, not necessarily contiguous per account). It is idempotent per account and batch `id`: repeating a push returns the original `seq`. `data` is at most 1 MiB decoded (`too_large`).

`GET /api/v1/batches` returns the account's batches with `seq > after` (default 0) in ascending order, at most `limit` (default 500, max 1000), with `more` set if there are further batches. `sinceSnapshot` counts the account's batches after its latest snapshot; clients use it to decide when to upload one. If `after` is below the latest snapshot's `seq`, the batches in between are gone and the server answers 410 `cursor_pruned`; the client then loads the snapshot and continues from its `seq`.

### Snapshots

A snapshot is an encrypted compaction of all ops the client has applied up to batch `seq` (its pull cursor), plus its own ops. `PUT /api/v1/snapshot` replaces the stored snapshot if `seq` is greater than the current one (else 409 `stale_snapshot`), requires `seq` to be at most the account's latest batch `seq` (else 400), and deletes the account's batches with `seq <= seq`. `data` is at most 32 MiB decoded.

### Events

`GET /api/v1/events` streams server-sent events while the token is valid: `event: batch` with `BatchEvent` data `{ "seq": n }` whenever a batch is pushed to the account, and a `: ping` comment every 25 seconds.

### Device links

A signed-in device uploads the account seed encrypted with a one-time key (`POST /api/v1/links`) and shows the link id and key, e.g. as a QR code. The new device fetches it once with `GET /api/v1/links/{id}`, which deletes it. Links expire after 10 minutes. `data` is at most 4 KiB decoded.

## Client-side cryptography

The server doesn't depend on any of this; it is here so clients agree.

- The master seed is 32 random bytes, shown as a 24-word BIP-39 English phrase.
- HKDF-SHA256 with empty salt derives 32-byte keys from the seed: info `ergon/v1/encryption` for the data key, info `ergon/v1/signing` for the Ed25519 private key seed. The account id is the Ed25519 public key.
- Sealed data is `0x01 ‖ nonce (24 bytes) ‖ XChaCha20-Poly1305 ciphertext` of the gzipped JSON value, with associated data `ergon/v1/<kind>` where kind is `batch`, `snapshot` or `link`.
- Batch and snapshot plaintext: `{ "ops": Op[] }`, with `Op` as in `packages/core/src/model.ts`. Link plaintext: `{ "seed": base64 }`, sealed with a random 32-byte link key.
