# Deepening

如何安全地深化一组 shallow modules。假设已读 `core/specs/shared/architecture-language.md` 的词汇。

## 依赖分类

评估候选时,先分类其依赖。类别决定 deepened module 如何跨 seam 测试。

### 1. In-process

纯计算、内存状态、无 I/O。总是可深化——合并 modules,直接通过新 interface 测试。不需要 adapter。

### 2. Local-substitutable

有本地测试替身的依赖(PGLite for Postgres、in-memory filesystem)。替身存在即可深化。测试用替身跑在 test suite 中。seam 是内部的;不暴露在 module 外部 interface。

### 3. Remote but owned (Ports & Adapters)

跨网络边界的自有服务(microservices、internal APIs)。在 seam 定义 **port**(interface)。deep module 拥有逻辑;transport 作为 **adapter** 注入。测试用 in-memory adapter;生产用 HTTP/gRPC/queue adapter。

推荐格式:_"在 seam 定义 port,实现 HTTP adapter(生产)和 in-memory adapter(测试),逻辑集中在一个 deep module 即使部署跨网络。"_

### 4. True external (Mock)

不可控的第三方服务(Stripe / Twilio 等)。deepened module 把外部依赖作为注入 port;测试用 mock adapter。

## Seam 纪律

- **One adapter = hypothetical seam. Two adapters = real seam.** 至少两个 adapter(production + test)才引入 port。单 adapter 的 seam 只是 indirection。
- **Internal seam vs external seam.** Deep module 可以有 internal seam(implementation 私有,自己测试用)。不要把 internal seam 暴露到外部 interface。

## 测试策略:替换而非叠加

- 旧 shallow modules 的 unit tests 在 deepened interface 测试存在后变成废物——删掉
- 新测试写在 deepened module 的 interface 上。**Interface is the test surface**
- 测试断言 observable outcomes through the interface,不测 internal state
- 测试应 survive internal refactors——描述行为不描述实现。refactor 让测试挂 = 测试穿透了 interface
