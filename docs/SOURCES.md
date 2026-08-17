# 规则来源（Sources）

`cn-linebreak` 的每类规则都应有可追溯的规范来源。以下为已用与计划使用的权威资源。

## 已使用（v0.1.1）

| 来源 | 用途 |
|---|---|
| [W3C《中文排版需求》CLReq](https://www.w3.org/International/clreq/) | 行首行尾禁则、标点位置、换行与断词原则 |
| [GB/T 15834—2011《标点符号用法》](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=22EA6D162E4110E752259661E1A0D0A8) | 行首/行尾禁用标点集合、成对符号（引号/括号/书名号） |
| [Unicode UAX #14](https://unicode.org/reports/tr14/) | 字符级换行允许/禁止/必须，官方测试数据 [LineBreakTest.txt](https://www.unicode.org/Public/UCD/latest/ucd/auxiliary/LineBreakTest.txt)（v0.2.0 全量接入） |
| [CSS Text Module Level 3](https://www.w3.org/TR/css-text-3/) | `line-break` / `word-break` / `overflow-wrap` / `white-space` / `<wbr>` 语义核对 |

## 计划使用（v0.2.0+）

| 来源 | 用途 |
|---|---|
| [GB/T 13715—1992《信息处理用现代汉语分词规范》](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=B48FFFB924DF90488FEBCB89B91C8869) | 二字/三字词、稳定词组、人名地名机构名、数量结构 |
| [GB/T 20532—2025《信息处理用现代汉语词类标记规范》](https://std.samr.gov.cn/gb/search/gbDetailed?id=3DBA2132861A0D16E06397BE0A0A8119) | 统一词性体系（2026-03-01 实施） |
| [Unicode UAX #29](https://unicode.org/reports/tr29/) + [`Intl.Segmenter`](https://tc39.es/ecma402/#segmenter-objects) | 基础词语边界（需配合项目保护词典） |
| [UD 中文树库 zh_gsdsimp](https://universaldependencies.org/treebanks/zh_gsdsimp/) | 分词、词性、依存句法（CC BY-SA 4.0，需署名） |
| [Stanford Stanza](https://stanfordnlp.github.io/stanza/) / [LTP](https://github.com/HIT-SCIR/ltp) / [北大现代汉语短语结构知识库](https://opendata.pku.edu.cn/dataset.xhtml?persistentId=doi%3A10.18170%2FDVN%2FNPDNSO) | 高级模式可选 NLP 后端（不进入默认零依赖路径） |

## 规范使用原则

- 不复制标准全文；把规则重新表达为结构化数据，并保留标准号与条款来源。
- 每条审查结果可通过 `rule` 字段反查来源（见 `docs/RULES.md` 规则表与 `test/` 用例）。
