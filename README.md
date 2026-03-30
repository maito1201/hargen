# hargen

Claude Codeの会話ログからフィードバックパターンを分析し、ハーネス（CLAUDE.md / hooks / skills）の改善を提案するスキル。

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

1. `~/.claude/history.jsonl` からユーザーのプロンプトを抽出
2. 既存のCLAUDE.md / hooks / skills の構成を把握
3. ログからフィードバックパターンを分類し、根本原因を分析
4. Faceted Promptingの設計原則に基づいた改善案を、適用後のdiffとして提示
5. ユーザーが承認した項目のみ反映

詳細は [SKILL.md](./skills/hargen/SKILL.md) を参照。
