# hargen

Claude Codeの会話ログからフィードバックパターンを分析し、ハーネス（CLAUDE.md / hooks / skills / memory）の改善を提案するスキル。

## 解決する課題

Claudeに毎回同じダメ出しをしていませんか？

hargenはあなたの会話ログを分析し、繰り返し指摘しているパターンを発見します。既存のCLAUDE.mdでカバーされているか、ルールがあるのに守られていないか、新たに追加すべきかを判断し、Faceted Promptingの設計原則に基づいた具体的な改善案を提示します。

## インストール

### Claude Code プラグインとして（推奨）

```bash
claude plugins marketplace add maito1201/hargen
claude plugins install hargen
```

インストール後、Claude Codeのチャットで `/hargen` と入力するとスキルが起動します。

### プラグインなしで利用する

Claude Codeのチャットで以下のように伝えてください：

```
https://github.com/maito1201/hargen/blob/main/skills/hargen/SKILL.md の内容を確認し、設定の改善提案を行なってください
```

## 仕組み

1. `~/.claude/history.jsonl` からユーザーのプロンプトを抽出し、フィードバックを含みそうなセッションを特定
2. 既存のCLAUDE.md / hooks / skills / memory の構成を把握
3. 特定したセッションのトランスクリプトを**サブエージェントで並列分析**（Workflowツール優先）。1セッション=1エージェントで文脈込みのフィードバックを構造化抽出
4. フィードバックを根本原因でグルーピングし、既存ハーネス・memoryと突合
5. memoryを診断（重複の統合 / 陳腐化の削除 / 頻出フィードバックのCLAUDE.mdへの昇格）
6. Faceted Promptingの設計原則に基づいた改善案を、適用後のdiffとして提示
7. ユーザーが承認した項目のみ反映

詳細は [SKILL.md](./skills/hargen/SKILL.md) を参照。

## CLI

スキルが内部で使う抽出コマンド。単体でも利用可能。

```bash
# ユーザープロンプトの抽出（history.jsonl）
npx --yes @maito1201/hargen@latest extract-prompts --days 30 --max-chars 200

# プロジェクトのセッショントランスクリプト一覧（パス・サイズ・更新日時）
npx --yes @maito1201/hargen@latest list-sessions --project myapp --days 30

# トランスクリプトから会話ダイジェストを抽出
# （tool_result / thinking / システム注入を除去し、数MB → 数十KBに圧縮）
npx --yes @maito1201/hargen@latest extract-session <sessionId|path> --project myapp
```
