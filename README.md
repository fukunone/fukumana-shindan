# フクマナ「福祉経営 学びタイプ診断」

保育博2026のブースやSNSから案内する、スマホ向けの無料診断サイトです。
HTML・CSS・JavaScriptだけで動き、**回答はブラウザの中だけで処理され、どこにも保存・送信されません**。

- 仕様：[SPEC.md](SPEC.md)
- 公開URL（予定）：`https://fukunone.github.io/fukumana-shindan/`
  - 保育博用：`https://fukunone.github.io/fukumana-shindan/?field=hoiku`（Q1「分野」を飛ばして保育として診断）

---

## 1. 公開手順（GitHub Pages）

初回だけ、次の手順で設定します。

1. このリポジトリの変更を `main` ブランチに取り込む（プルリクエストをマージ）
2. GitHub のリポジトリ画面 → **Settings** → 左メニュー **Pages**
3. **Build and deployment** の **Source** を **「GitHub Actions」** にする
4. **Actions** タブで「GitHub Pages に公開」が緑のチェックになるまで待つ（2〜3分）
   - 動いていなければ「GitHub Pages に公開」→ **Run workflow** で手動実行
5. Settings → Pages に表示される URL を開いて確認する

以後は `main` に変更が入るたびに自動で公開し直されます（結果ページ・OGP画像・QRコードも自動で作り直されます）。

> **リポジトリが非公開（Private）の場合**：GitHub Pages を使うには、無料プランではリポジトリを公開（Public）にする必要があります（有料プランなら非公開のまま可）。

### 公開URLが予定と違う場合（独自ドメインを使う場合など）

SNSのプレビュー画像（OGP）とQRコードは公開URLをもとに作られます。
`data/content.json` の `site.url` を実際の公開URL（`https://` で始まり `/` で終わる形）に書き換えて `main` に反映してください。

---

## 2. QRコード

公開後、次のURLからダウンロードできます（`site.url` から自動生成）。

| 用途 | ファイル | 読み取り先 |
|---|---|---|
| 保育博用 | `assets/qr/qr-hoiku.svg`（印刷用）／`.png` | `公開URL?field=hoiku` |
| SNS・チラシ用 | `assets/qr/qr-sns.svg`（印刷用）／`.png` | `公開URL` |

例：`https://fukunone.github.io/fukumana-shindan/assets/qr/qr-hoiku.svg`

**印刷前に必ず、スマホで読み取って診断ページが開くことを確認してください。**

手元のパソコンで作る場合（Node.js が必要）：

```bash
npm install
```

```bash
npm run build
```

---

## 3. 画像の差し替え

`assets/` の画像を**同じファイル名で上書き**するだけで差し替わります。

| ファイル | 内容 | 推奨サイズ |
|---|---|---|
| `assets/fukuneko.png` | フクノネコ（トップ・結果画面・結果画像・OGP） | 正方形 800×800 px、背景透過PNG |
| `assets/logo.png` | フクマナのロゴ（ヘッダー・結果画像・OGP） | 横長、高さ 96 px 以上、背景透過PNG |
| `assets/favicon.png` | ブラウザのタブのアイコン | 正方形 192×192 px |

GitHub の画面から差し替える場合：`assets` フォルダを開く → **Add file → Upload files** → 同名ファイルをドラッグ → **Commit changes**。
OGP画像（SNSのプレビュー）は公開時に自動で作り直されます。

色は `css/style.css` の先頭（`:root { ... }`）にまとめてあります。タイプごとの色は `data/content.json` の各タイプの `color` です。

---

## 4. 文言の編集（質問・結果・リンク）

**文言はすべて `data/content.json` の1ファイルにまとまっています。**
GitHub 上でファイルを開き、鉛筆アイコン（Edit）から直接編集できます。

| 変えたいもの | 場所 |
|---|---|
| トップ画面の説明 | `top` |
| 分野ごとの呼び方（園／事業所・施設…） | `fields` の `place`（場所）・`staff`（職員の呼び方）・`roleNotes`（立場の補足） |
| 質問と選択肢 | `roles` → `A`（一般職員）`B`（管理職）`C`（経営者）`D`（開業検討）→ `questions` |
| 講義の名前・1行説明・伸びしろ分野名 | `courses` |
| タイプ名・キャッチコピー・説明文・次の一歩ボタン | `types` |
| 学び方アドバイス | `advice`（共通）と各 `roles` の `advice` |
| リンク先URL | `links`（**仕様で固定。変更しないでください**） |

### 書き方のルール

- 文字は `"` と `"` の間だけを書き換えてください。`"`・`,`・`{` `}` を消すと動かなくなります。
- `{place}` は分野に応じて「園／事業所・施設／職場」、`{staff}` は「保育士／職員」に自動で置き換わります。
- 選択肢の `"scores": { "finance": 3 }` は「この選択肢を選ぶと『財務・会計』に3点」という意味です。
  講義の記号：`finance` 財務・会計／`tax` 税務／`labor` 労務／`management` マネジメント／`kaigyo` 開業／`analysis` 内部統制・経営分析／`marketing` マーケティング／`sp1` 特別講義1／`sp2` 特別講義2／`sp3` 特別講義3
- 表現ルール（仕様書2章）：営利的な表現は使わず「収支差額」「本業の収支」など／料金・価格は書かない／制度名・数値は書かない／「弱み」ではなく「伸びしろ」。

保存（Commit）すると自動でチェックが走り、書き間違いや禁止表現があると **Actions タブが赤く** なって公開が止まります（サイトは直前の正常な状態のまま）。赤いときは中のログに理由が日本語で表示されます。

### 診断のしくみ（参考）

1. 立場ごとの質問で、選んだ選択肢の点数を各講義に足します。
2. 点数の高い順に3講義を「おすすめの講義」として表示します（同点は `priority` の順）。
3. タイプは次のように決まります（`typeRule`）。
   - 一般職員：Q「将来の働き方」の答えで決定。開業志向は「開業」「財務・会計」を必ずおすすめに含めます。
   - 管理職・経営者：グループ（人材系／財務系／採用・発信系）のうち、最も点数の高い講義を含むグループのタイプ。
   - 開業検討：常に「開業準備タイプ」。開業時期で説明文が変わります。

---

## 5. ファイル構成

```
index.html            診断ページ
r/<タイプ>.html        タイプ別の結果ページ（シェアされたリンクの先）※自動生成
data/content.json     文言・質問・結果・リンク（ここを編集）
css/style.css         見た目
js/app.js             画面の動き
js/diagnosis.js       診断ロジック
js/card.js            結果画像（1080×1080）・OGP画像の描画
assets/               画像（フクノネコ・ロゴ・OGP・QR）
tools/build.js        結果ページ・OGP画像（1200×630）・QRコードの生成スクリプト
tools/test.js         仕様書10章の自動チェック（全パターン・禁止表現・リンク）
tools/e2e.js          ブラウザでの操作テスト（画面幅・シェア・画像保存）
.github/workflows/    GitHub Pages への自動公開
```

## 6. 確認用コマンド（開発者向け）

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run e2e
```

```bash
npm run serve
```

`npm run serve` の後、`http://localhost:8080/` で確認できます（`data/content.json` を読み込むため、HTMLファイルを直接ダブルクリックしても動きません）。

## 7. 実機での最終確認チェックリスト

自動テストは Chromium で iPhone・Android の画面を再現して行っています。公開後、実機で次を確認してください。

- [ ] iPhone（Safari）：QRから開く → 診断 → 「Xでシェア」「LINEで送る」「リンクをコピー」
- [ ] iPhone（Safari）：「結果画像を保存」→「画像を保存・共有」→ 共有シートの「画像を保存」で写真アプリに入る
- [ ] Android（Chrome）：同じ操作。「画像を保存」でダウンロードされ、ギャラリーやInstagramで選べる
- [ ] LINE・Xにシェアしたリンクで、タイプ別の画像とタイトルがプレビュー表示される
- [ ] 保育博用QR（`?field=hoiku`）で、分野の質問が出ずに「園」「保育士」の言葉で表示される
