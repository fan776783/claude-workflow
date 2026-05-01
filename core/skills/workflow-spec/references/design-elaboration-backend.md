# 设计深化 — 后端分支（§ 5.6 System Design）

> 本文件从 `design-elaboration.md` 拆分，专注后端系统设计流程。

在**主会话内**完成（纯文本 + Mermaid，上下文增量可控）。

## § 5.6.1 API Contract Summary

从 § 4.1 Primary Flow 推导接口清单：

| 端点 | 方法 | 请求体要点 | 响应体要点 | 鉴权 |
|------|------|-----------|-----------|------|

## § 5.6.2 Data Flow

Mermaid 数据流图，覆盖：Client → API → Service → Repository → Storage。

## § 5.6.3 Service Boundaries

基于 § 5.1 Module Responsibilities 定义服务边界：

| 服务/模块 | 职责 | 通信方式 | 关键约束 |
|----------|------|---------|---------| 

## § 5.6.4 Data Migration（条件）

仅当涉及 schema 变更时填写。无 schema 变更时删除本节。
