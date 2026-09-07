# 同期コード方式の中継サーバー

「同期コード」で端末どうしをつなぐための、小さな中継サーバー。
Cloudflare Workers の無料枠で足りる（1日10万リクエストまで）。
**アプリの端末間同期はこのサーバーが要る。** デプロイして URL を設定するまで、
アプリの同期の画面は「同期サーバーのURLが未設定です」と出たまま何も通信しない。

## 何を預かるのか

預かるのは、同期コードから作った **部屋ID（コードのSHA-256）** と、
同じコードから作った鍵で暗号化した **暗号文** だけ。
同期コードそのものはサーバーへ送られないため、サーバーの管理者でも中身は読めない。
学習記録には答案の本文やメモが入るので、平文では置かない。

公開済みの中継サーバー（2026-09-07 時点）:
**https://civics-sync.still-cloud-a091.workers.dev**
（KV名前空間 `SYNC_ROOMS` = `e61430910c3d46d8bebc3c0f7f324178`。`public/sync-config.js` に設定済み）

## デプロイ・作り直し

```bash
cd worker
npx wrangler login                            # ブラウザでCloudflareにログイン
npx wrangler kv namespace create SYNC_ROOMS   # 表示された id を wrangler.toml に貼る
npx wrangler deploy                           # 表示された https://〜.workers.dev を控える
```

`wrangler.toml` の `ALLOWED_ORIGINS` は、アプリを置いている配信元に合わせる
（GitHub Pages なら `https://<ユーザー名>.github.io`）。`*` にすると誰の配信元からでも呼べる。

## アプリ側の設定

控えたURLを、次のどちらかに入れる。

- `public/sync-config.js` の `endpoint` に書いて `npm run deploy`（配布する全端末に効く）
- アプリの「設定・データ → 端末間同期 → 詳細設定」に貼る（その端末だけ・作り直し不要）

`index.html` の Content-Security-Policy は `https://*.workers.dev` だけを許可している。
独自ドメインで動かすときは、そのドメインを `connect-src` に足すこと（足さないと通信が黙って失敗する）。

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| `GET` | `/v1/rooms/:roomId` | `{ rev, updatedAt, blob }`。未保存なら 404 |
| `PUT` | `/v1/rooms/:roomId` | `{ blob }` を保存。`If-Match` が現在の版と違えば 412 |
| `DELETE` | `/v1/rooms/:roomId` | 部屋を削除 |
| `GET` | `/health` | 動作確認 |

`If-Match: *` は「まだ誰も書いていないときだけ通す」の意味。
412 が返ったらアプリ側が読み直して統合し直すので、更新が消えることはない。
部屋は最後に書いてから400日で自動的に消える（書くたびに延びる）。
