# ReAct 空转护栏

## 现象

「今天天气怎么样」类问题：模型换措辞反复 `web_search`，同参去重挡不住。

## 做法

`build_react_graph` 挂 LangChain 官方 middleware。工具次数对齐
[LangChain 内置 middleware 文档示例](https://docs.langchain.com/oss/python/langchain/middleware/built-in)：

| 护栏 | 参数来源 | medium / hard |
| --- | --- | --- |
| `web_search` 本轮 | 文档 `tool_name=search, run_limit=3` | **3** |
| 全体工具 | 文档 `run_limit=10` | **10** |
| 模型调用（触顶 end） | 略高于工具上限，避免模型先触顶 | medium 12 / hard 16 |
| 同参去重 | 自研 | 保留 |
| `recursion_limit` | 既有约定 | medium 12 / hard 28 |
