# 账页 · 日常账 / 项目账 记账方案

> 方案版本：v1（2026-10-22）  
> 目标：在现有账页流水模型上，增加日常/项目双账、共用支出比例分摊、双口径月度统计，以及跨月项目的“总账单 + 月度归集”。

## 1. 结论先行

- **一本流水，两个维度**：`归属`决定这笔钱算日常还是项目，`交易发生日`决定它进哪个月。
- **一条流水拆成 N 条分摊行**：分摊行金额之和必须等于流水总额；所有报表只汇总分摊行。
- **项目账不是第二本账**：项目只是分摊行上的一个维度。项目总账单和月度报表是同一批数据的两种切法，不是两份数据。
- **月度两个口径**：
  - **纯日常总花费**：只汇总“日常”分摊行；
  - **当月所有花费**：日常 + 当月所有项目归集；
  - 两者之差，正好是**当月项目归集**。
- **跨月项目**：项目总账单保留全周期；月度报表按每笔交易的 `date` 归集，互不覆盖。

## 2. 核心模型

### 2.1 三个概念

| 概念 | 定义 | 数据表现 |
|---|---|---|
| 日常账 | 所有 `targetType = daily` 的分摊行 | 虚拟账本，不建独立表 |
| 项目账 | 某个 `projectId` 的所有分摊行 | `Project` + 分摊行 |
| 共用支出 | 一条流水有多条分摊行，分别落到日常/一个或多个项目 | 1 条 `Transaction` + N 条 `AllocationLine` |

日常账不需要单独的“账本”实体。否则同一笔共用支出要么被复制两份，要么必须跨账本引用，都会让对账变复杂。

### 2.2 数据流向

```text
LedgerTransaction（1 条，记录实际支付总额）
        │  拆分
        ▼
AllocationLine（N 条：日常 / 项目 A / 项目 B ...）
        │
        ├── 按 (month, targetType) 汇总 ─────► 月度报表
        └── 按 projectId 汇总（忽略 month）──► 项目总账单
```

### 2.3 一笔钱只算一次

例如项目聚餐 600 元，由项目 A 和项目 B 各承担一半：

- 流水只有一条：总额 600；
- 分摊行两条：项目 A 300、项目 B 300；
- 月度“所有花费”只计 600，不是 1200；
- 项目 A 账单计 300，项目 B 账单计 300。

项目账单是这 600 元的切片，不是另外两笔支出。

## 3. 字段设计

> 现有 v1 的 `amount` 单位是元。v2 建议统一用整数分 `amountCents`，避免比例分摊的浮点误差。  
> 迁移时：`amountCents = Math.round(amount * 100)`。如果暂时不想改字段名，可保留 `amount`（元、最多两位小数），但分摊计算先转成分。

### 3.1 Project

```ts
interface Project {
  id: string                 // 稳定主键，改名不变
  name: string
  code?: string              // 项目编号，可选
  status: 'active' | 'closed'
  startDate: string          // YYYY-MM-DD
  endDate?: string           // 空表示未定结束日
  budgetCents?: number       // 项目预算，可选
  currency: Currency         // 目前可统一 CNY
  owner?: string
  note?: string
  archivedAt?: string        // 归档后不在选择器出现，但历史报表保留
  createdAt: string
  updatedAt: string
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 项目主键，例如 `p-hz` |
| `name` | string | 是 | 展示名，例如“杭州客户现场” |
| `status` | string | 是 | `active` 进行中；`closed` 已结束。结束不等于删除 |
| `startDate` | string | 是 | 项目开始日，仅用于展示和提醒，不作为过滤条件 |
| `endDate` | string | 否 | 项目结束日；为空表示长期项目 |
| `budgetCents` | number | 否 | 项目预算，单位分 |
| `archivedAt` | string | 否 | 归档时间；归档项目仍参与历史统计 |
| `createdAt` / `updatedAt` | string | 是 | 审计时间 |

**规则**：

- 有流水的项目禁止硬删除，只能归档。
- `startDate` / `endDate` 不限制交易日期；项目账单按 `projectId` 汇总所有分摊行，否则补记、跨期费用会被漏掉。
- 项目关闭后仍可补记交易，但 UI 提示“项目已关闭，确认补记”。

### 3.2 LedgerTransaction

```ts
type TransactionTypeV2 = 'expense' | 'income' | 'refund'

interface LedgerTransactionV2 {
  id: string
  schemaVersion: 2
  type: TransactionTypeV2
  amountCents: number          // 实际支付/收到的总额
  date: string                 // YYYY-MM-DD，交易发生日，归属月份依据
  categoryId: string
  accountId: string
  note: string
  allocations: AllocationLine[]
  refundOf?: string            // type=refund 时指向原交易
  linkedTransactionId?: string // 报销/关联交易，可选
  createdAt: string            // 录入时间，仅审计
  updatedAt?: string
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `amountCents` | number | 是 | 流水总额，单位分；分摊行之和必须等于它 |
| `date` | string | 是 | 交易发生日；月份 = `date.slice(0, 7)` |
| `type` | string | 是 | `expense` / `income` / `refund` |
| `categoryId` | string | 是 | 复用现有分类，例如 `food` |
| `accountId` | string | 是 | 付款/收款账户 |
| `allocations` | AllocationLine[] | 是 | 至少一条；`expense` / `income` / `refund` 都必须有 |
| `refundOf` | string | 否 | 退款指向原交易，用于复制原分摊与审计 |
| `createdAt` | string | 是 | 录入时间，不参与月份归属 |

**关键点**：

- 交易上**不放** `projectId`。项目只存在分摊行上，否则一笔交易拆给多个项目时会产生二义性。
- 交易上**不放** `bookType`。日常/项目/共用是由分摊行派生出来的，存一份缓存字段容易和分摊行不一致。
- 退款金额仍存正数，统计时按 `type=refund` 取负号。

### 3.3 AllocationLine

```ts
type AllocationTarget = 'daily' | 'project'

interface AllocationLine {
  id: string
  targetType: AllocationTarget
  projectId?: string          // targetType=project 时必填
  amountCents: number         // 最终分摊金额，权威值
  weight?: number             // 分摊权重：比例用 bp，人头用人数
  ratioBp?: number            // 展示占比，1 bp = 0.01%，10000 = 100%
  basis: 'ratio' | 'headcount' | 'fixed' | 'migrated'
  note?: string               // 例如“我 1 人”“项目同事 2 人”
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `targetType` | string | 是 | `daily` 日常；`project` 项目 |
| `projectId` | string | 项目行必填 | 必须引用存在的项目 |
| `amountCents` | number | 是 | 最终分摊金额，正整数；以它为准 |
| `weight` | number | 否 | 比例模式存 bp；人头模式存人数；固定金额模式可空 |
| `ratioBp` | number | 否 | 展示用占比，由 `amountCents / 流水总额` 反算 |
| `basis` | string | 是 | 这次分摊是怎么来的，便于审计和重算 |

**硬约束**：

1. 非退款交易至少一条分摊行。
2. `Σ allocations.amountCents === transaction.amountCents`，一分钱都不能差。
3. `targetType = project` 时 `projectId` 必填；`daily` 时不得填。
4. 单行金额必须大于 0；退款通过交易类型取负，不靠负数分摊行。
5. `ratioBp` 只用于展示，**金额以 `amountCents` 为准**。
6. 保存和导入时都必须校验以上规则。

### 3.4 Posting（派生，不落库）

所有报表都先转成统一的“记账分录”视图，再做分组。这样月度报表和项目账单共用一套口径。

```ts
interface Posting {
  month: string                 // YYYY-MM
  date: string
  transactionId: string
  allocationId: string
  kind: 'expense' | 'income'
  targetType: 'daily' | 'project'
  projectId?: string
  categoryId: string
  signedCents: number           // 退款为负数
}
```

生成规则：

```ts
function toPostings(t: LedgerTransactionV2, original?: LedgerTransactionV2): Posting[] {
  const kind =
    t.type === 'refund'
      ? (original?.type === 'income' ? 'income' : 'expense')
      : t.type

  const sign = t.type === 'refund' ? -1 : 1

  return t.allocations.map((a) => ({
    month: t.date.slice(0, 7),
    date: t.date,
    transactionId: t.id,
    allocationId: a.id,
    kind,
    targetType: a.targetType,
    projectId: a.projectId,
    categoryId: t.categoryId,
    signedCents: sign * a.amountCents,
  }))
}
```

说明：

- `refund` 默认冲减支出；如果原交易是收入，则冲减收入。
- 收入也走同一套分摊行，只是 `kind = income`；项目收入可以落到项目上。
- 转账（如果以后支持）不生成 posting，不计入花费和收入。

### 3.5 报表 DTO

```ts
interface CategoryAmount {
  categoryId: string
  amountCents: number
  shareBp: number
}

interface ProjectMonthRow {
  projectId: string
  name: string
  monthExpenseCents: number
  monthIncomeCents: number
  cumulativeExpenseCents: number
  cumulativeIncomeCents: number
  budgetCents?: number
  budgetUsedBp?: number
}

interface MonthlyReport {
  month: string
  dailyExpenseCents: number        // 纯日常总花费
  projectExpenseCents: number      // 当月项目归集合计
  totalExpenseCents: number        // 当月所有花费
  dailyIncomeCents: number
  projectIncomeCents: number
  totalIncomeCents: number
  balanceCents: number             // 总收入 - 总花费
  dailyByCategory: CategoryAmount[]
  projects: ProjectMonthRow[]      // 当月有归集的项目，含累计
}

interface ProjectStatementLine {
  date: string
  month: string
  transactionId: string
  note: string
  categoryId: string
  grossCents: number               // 流水总额
  allocatedCents: number           // 计入本项目的金额（退款为负）
  ratioBp: number
  runningTotalCents: number
}

interface ProjectReport {
  project: Project
  totalExpenseCents: number        // 项目总账单（全周期）
  totalIncomeCents: number
  netCents: number
  byMonth: ProjectMonthRow[]
  byCategory: CategoryAmount[]
  lines: ProjectStatementLine[]
}
```

## 4. 记账规则

### 4.1 归属判定

| 情形 | `allocations` | 结果 |
|---|---|---|
| 纯日常 | 1 条 `daily`，100% | 只进日常账 |
| 纯项目 | 1 条 `project`，100% | 只进该项目账单 |
| 跨账共用 | `daily` + 1 个或多个 `project` | 两部分分别进日常和项目 |
| 多项目共用 | 2 个以上 `project` 行 | 每个项目各计一份，月度总计只算一次 |
| 多人共用/垫付 | 日常/项目 + `receivable`（可选扩展） | 只有自己承担的部分计花费 |

派生一个展示用的 `scope`，但不要落库：

```ts
function getScope(t: LedgerTransactionV2): 'daily' | 'project' | 'shared' {
  const hasDaily = t.allocations.some((a) => a.targetType === 'daily')
  const hasProject = t.allocations.some((a) => a.targetType === 'project')
  if (hasDaily && hasProject) return 'shared'
  return hasProject ? 'project' : 'daily'
}
```

注意：两个以上项目、没有日常，也算 `shared`（共用但不是日常），`scope` 具体怎么命名可按 UI 需要调整；统计口径不受影响。

### 4.2 分摊模式

支持三种输入方式，最终都落成 `amountCents`：

1. **按比例**：输入 40% / 60%，权重存 `4000 / 6000` bp。
2. **按人头**：输入 1 人 / 2 人，权重存 `1 / 2`。
3. **按固定金额**：先给日常/某个项目固定金额，剩余给最后一行；金额之和不符时拒绝保存。

规则：

- 至少一条分摊行，权重必须大于 0。
- 比例模式权重之和应为 10000 bp；不是 10000 时按权重归一化。
- 人头模式可以先把同一目标的人头合并，再按目标汇总。
- 修改流水总额时：
  - `basis = ratio` 或 `headcount`：按原权重重算；
  - `basis = fixed`：提示用户调整，或把差额补到最后一行，不能静默改数。
- 每次保存都显示“分摊合计 / 流水总额”，不一致时禁止提交。

### 4.3 舍入：最大余数法

金额按分计算，步骤：

1. `raw_i = 总额 × weight_i / Σweight`；
2. 每条先向下取整到分；
3. 剩余的分，按小数部分从大到小，每条补 1 分；
4. 小数部分相同，权重大的优先；再相同，按行顺序。

例：100.00 元按 1:1:1 分：

```text
10000 分 ÷ 3 = 3333.33 分
先分：3333 / 3333 / 3333，余 1 分
最大余数相同 → 第一行补 1 分
结果：3334 / 3333 / 3333 = 100.00 元
```

例：180.00 元按 1:2 分：

```text
6000 / 12000 分，正好整除
```

退款按原分摊比例拆分时，也用同一套最大余数法，保证退款各行之和等于退款总额。

### 4.4 退款、报销、转账

**退款**

- 交易类型 `refund`，金额存正数，`refundOf` 指向原交易。
- 退款时复制原交易的分摊行作为快照（目标、比例、金额），不重新按当前规则计算。
- 统计时取负号：`signedCents = -amountCents`。
- 跨月退款记在退款发生月，不回写原月：
  - 9 月高铁 553 计入项目 A；
  - 10 月退票 53；
  - 9 月项目 A 仍是 1,153；
  - 10 月项目 A 归集 = 1,256 - 53 = 1,203；
  - 项目 A 总账单 = 2,409 - 53 = 2,356。
- 部分退款按原分摊行比例拆分，最大余数法保证总和。
- 如果原交易的分摊后来被修改，退款保留自己的快照；UI 提示差异，允许用户手动重算退款。

**报销**

- 报销到账记一笔 `income`，分摊到同一个项目，`linkedTransactionId` 指向原支出。
- 项目账单同时显示：支出 800、收入 800、净额 0。
- 月度“所有花费”仍记 800，不拿收入抵扣。理由：花费看的是真实发生额，净成本看项目账单，两个指标不要混。
- 如果只是个人垫付、同事还钱，不是项目报销，见 4.6 的 `receivable`。

**转账**

- 如果以后支持账户间转账，单独类型，不生成 posting，不计入花费/收入。
- 转账不需要分摊行。

### 4.5 日期与月份

- 归属月份只看 `date`，即交易发生日。
- `createdAt` 只用于审计，不参与任何月度统计。
- 补记旧账：11 月 5 日补记 10 月 30 日的打车费，`date = 2026-10-30`，进 10 月报表；`createdAt = 2026-11-05...`。
- 项目跨月时，不把整笔金额按项目周期平均摊到各月；每笔交易落在自己的发生月。
- 项目起止日期只做提示，不改变归属月份，也不过滤项目账单。

### 4.6 共用支出的两种含义

**第一种：跨账共用（本方案核心）**

同一笔钱一部分是日常生活，一部分是项目成本。

例：团队午餐 180 元，3 人，我 1 人日常、项目同事 2 人：

```text
日常 60.00（1/3）
项目 A 120.00（2/3）
```

月度纯日常只计 60，当月所有花费计 180，项目 A 账单计 120。

**第二种：多人共用/AA（可选扩展）**

同事/朋友 AA，别人那份以后还给我，不属于我的花费，也不属于项目成本。可给 `targetType` 增加 `receivable`：

```text
晚餐 300 元，3 人，我先付：
日常 100.00      // 我自己那份
应收 200.00      // 另外两人以后还我
```

- 纯日常花费 = 100；
- 当月所有花费 = 100（应收不是花费）；
- 现金流出 = 300；
- 还款到账时冲减应收，不计收入；
- 如果这笔钱由项目承担，就把“别人那份”改成 `project`，不用 `receivable`。

如果暂时不做 AA，可以先只支持 `daily / project`，不影响主方案。

## 5. 统计口径

### 5.1 月度

设：

- `D(m)`：月份 m 的纯日常总花费；
- `P(m)`：月份 m 的项目归集合计；
- `A(m)`：月份 m 的所有花费；
- `P_p(m)`：项目 p 在月份 m 的归集。

公式：

```text
D(m) = Σ signedCents，条件：month = m, kind = expense, targetType = daily
P(m) = Σ signedCents，条件：month = m, kind = expense, targetType = project
A(m) = D(m) + P(m)

P_p(m) = Σ signedCents，条件：month = m, kind = expense, projectId = p
```

| 指标 | 公式 | 含义 |
|---|---|---|
| 纯日常总花费 | `D(m)` | 只算日常分摊；共用餐费只计日常那一份；退款冲减 |
| 当月项目归集 | `P(m)` | 当月所有项目分摊行之和 |
| 当月所有花费 | `A(m) = D(m) + P(m)` | 当月实际发生的全部花费，一笔只算一次 |
| 当月收入 | 收入 posting 之和 | 日常收入 + 项目收入 |
| 当月结余 | 总收入 - 总花费 | 不把项目收入拿去抵项目支出，除非另做净额报表 |

要点：

- `A(m)` 包含项目支出，但不重复计算：一笔 600 元拆给两个项目，`A(m)` 仍是 600。
- `D(m)` 包含共用支出中的日常份额，不包含项目份额。
- 退款在退款发生月以负数冲减；跨月退款会让当月项目归集变小，这是收付实现制的正常结果。
- 启用 `receivable` 扩展后，`A(m)` 不再等于现金流出；现金流出单独按流水总额统计。

### 5.2 项目

```text
项目 p 的总账单     = Σ_m P_p(m)
项目 p 截至 m 的累计 = Σ_{k <= m} P_p(k)
项目 p 当月归集     = P_p(m)
```

- 项目总账单是**全周期**的，不受当前选中月份影响。
- 项目账单同时保留收入、净额：`净额 = 项目收入 - 项目支出`。
- 项目预算使用率：`已归集 / 预算`，只算支出。
- 项目账单的明细按日期升序排列，带“计入本项目金额”和“累计”两列。

### 5.3 预算

- **个人月度预算**对 `D(m)`（纯日常），不对 `A(m)`。
- **项目预算**单独放在 `Project.budgetCents`，只对项目归集。
- 理由：项目支出通常可报销/可结算，如果混进生活预算，预算条会失真。

样例中（个人预算 8,000 元）：

| 月份 | 纯日常 D | 预算使用 | 当月所有 A | 若用 A 算预算 |
|---|---:|---:|---:|---:|
| 2026-09 | 4,865.00 | 60.8% | 6,018.00 | 75.2% |
| 2026-10 | 4,650.00 | 58.1% | 7,706.00 | 96.3% |

10 月实际生活支出只用了 58.1%，但加上项目采购就接近预算上限。预算条应该看前者。

如果用户坚持用“所有花费”做预算，可加设置 `budgetBasis: 'daily' | 'all'`，默认 `daily`。

### 5.4 对账不变量

这六条可以直接写成测试：

```text
1. 每条交易：Σ allocations.amountCents = transaction.amountCents
2. 每个月：A(m) = D(m) + P(m)
3. 每个月：P(m) = Σ_p P_p(m)
4. 每个项目：ProjectTotal(p) = Σ_m P_p(m)
5. Σ_m A(m) = Σ 所有支出流水金额 - Σ 退款金额（未启用 receivable 时）
6. 跨月矩阵：每行合计 = 项目总账单；每列合计 = 当月项目归集
```

## 6. 跨月项目

项目 A：2026-09-18 开始，2026-10-15 结束。交易分布在 9 月和 10 月。

```text
                   2026-09        2026-10        合计
项目 A 归集        1,153.00       1,256.00       2,409.00
```

三个视图同时成立：

1. **9 月月度报表**：项目 A 当月归集 1,153.00；
2. **10 月月度报表**：项目 A 当月归集 1,256.00，累计 2,409.00；
3. **项目 A 总账单**：全周期 2,409.00，明细按 9 月、10 月分组。

查看 10 月报表时，项目卡片显示“本月 1,256 / 累计 2,409”；查看 9 月报表时显示“本月 1,153 / 累计 1,153”。项目总账单不随月份切换而变化。

规则：

- 不把项目总账单按月份平均摊；每笔交易在哪个月发生，就进哪个月。
- 项目结束后补记的旧交易，按 `date` 回到原月份，同时更新项目总账单。
- 关闭项目不等于冻结数据；只是默认不再出现在新建交易的项目选择器里。
- 项目归档后从选择器隐藏，但历史月度报表和项目账单仍能按 `projectId` 汇总。

## 7. 完整样例

### 7.1 项目

| id | 名称 | 周期 | 预算 | 状态 |
|---|---|---|---:|---|
| `p-hz` | 杭州客户现场 | 2026-09-18 ~ 2026-10-15 | 12,000.00 | closed |
| `p-web` | 官网改版 | 2026-09-01 ~ 2026-11-30 | 8,000.00 | active |

### 7.2 流水与分摊

| 编号 | 日期 | 类型 | 摘要 | 分类 | 总额 | 分摊 |
|---|---|---|---|---|---:|---|
| S1 | 2026-09-01 | expense | 房租 | housing | 4,500.00 | 日常 4,500.00（100%） |
| S2 | 2026-09-05 | expense | 超市 | shopping | 260.00 | 日常 260.00（100%） |
| S3 | 2026-09-10 | income | 工资 | salary | 15,200.00 | 日常收入 15,200.00 |
| S4 | 2026-09-18 | expense | 高铁 | transport | 553.00 | 项目 A 553.00（100%） |
| S5 | 2026-09-19 | expense | 酒店 | housing | 480.00 | 项目 A 480.00（100%） |
| S6 | 2026-09-20 | expense | 团队午餐（3 人） | food | 180.00 | 日常 60.00（1/3）+ 项目 A 120.00（2/3） |
| S7 | 2026-09-26 | expense | 咖啡 | food | 45.00 | 日常 45.00（100%） |
| O1 | 2026-10-01 | expense | 房租 | housing | 4,500.00 | 日常 4,500.00（100%） |
| O2 | 2026-10-08 | expense | 项目聚餐 | food | 600.00 | 项目 A 300.00（50%）+ 项目 B 300.00（50%） |
| O3 | 2026-10-10 | expense | 打车 | transport | 96.00 | 项目 A 96.00（100%） |
| O4 | 2026-10-12 | expense | 工作午餐（3 人） | food | 90.00 | 日常 30.00（1/3）+ 项目 A 60.00（2/3） |
| O5 | 2026-10-15 | expense | 客户礼品 | other_expense | 800.00 | 项目 A 800.00（100%） |
| O6 | 2026-10-18 | expense | 买菜 | food | 120.00 | 日常 120.00（100%） |
| O7 | 2026-10-20 | expense | 官网素材采购 | other_expense | 1,500.00 | 项目 B 1,500.00（100%） |
| O8 | 2026-10-22 | income | 工资 | salary | 15,200.00 | 日常收入 15,200.00 |

### 7.3 月度报表

**2026-09**

| 指标 | 金额 |
|---|---:|
| 纯日常总花费 | 4,865.00 |
| 其中：共用午餐的日常份额 | 60.00 |
| 项目 A 归集 | 1,153.00 |
| 项目 B 归集 | 0.00 |
| 当月项目归集合计 | 1,153.00 |
| 当月所有花费 | 6,018.00 |
| 当月收入 | 15,200.00 |
| 当月结余 | 9,182.00 |

**2026-10**

| 指标 | 金额 |
|---|---:|
| 纯日常总花费 | 4,650.00 |
| 其中：共用午餐的日常份额 | 30.00 |
| 项目 A 归集 | 1,256.00 |
| 项目 B 归集 | 1,800.00 |
| 当月项目归集合计 | 3,056.00 |
| 当月所有花费 | 7,706.00 |
| 当月收入 | 15,200.00 |
| 当月结余 | 7,494.00 |

**跨月矩阵**

| 口径 | 2026-09 | 2026-10 | 合计 |
|---|---:|---:|---:|
| 纯日常 | 4,865.00 | 4,650.00 | 9,515.00 |
| 项目 A | 1,153.00 | 1,256.00 | 2,409.00 |
| 项目 B | 0.00 | 1,800.00 | 1,800.00 |
| 项目小计 | 1,153.00 | 3,056.00 | 4,209.00 |
| 当月所有花费 | 6,018.00 | 7,706.00 | 13,724.00 |
| 当月收入 | 15,200.00 | 15,200.00 | 30,400.00 |
| 当月结余 | 9,182.00 | 7,494.00 | 16,676.00 |

校验：

```text
4,865 + 1,153 = 6,018
4,650 + 3,056 = 7,706
9,515 + 4,209 = 13,724
2,409 = 1,153 + 1,256
```

### 7.4 项目 A 总账单

项目：杭州客户现场（`p-hz`）  
周期：2026-09-18 ~ 2026-10-15  
预算：12,000.00 / 已用 2,409.00（20.1%）

| 日期 | 摘要 | 交易总额 | 分摊比例 | 计入项目 | 累计 |
|---|---|---:|---:|---:|---:|
| 2026-09-18 | 高铁 | 553.00 | 100% | 553.00 | 553.00 |
| 2026-09-19 | 酒店 | 480.00 | 100% | 480.00 | 1,033.00 |
| 2026-09-20 | 团队午餐 | 180.00 | 66.67% | 120.00 | 1,153.00 |
| 2026-10-08 | 项目聚餐 | 600.00 | 50% | 300.00 | 1,453.00 |
| 2026-10-10 | 打车 | 96.00 | 100% | 96.00 | 1,549.00 |
| 2026-10-12 | 工作午餐 | 90.00 | 66.67% | 60.00 | 1,609.00 |
| 2026-10-15 | 客户礼品 | 800.00 | 100% | 800.00 | 2,409.00 |

**按月小计**

| 月份 | 本月归集 | 累计 |
|---|---:|---:|
| 2026-09 | 1,153.00 | 1,153.00 |
| 2026-10 | 1,256.00 | 2,409.00 |
| 合计 | 2,409.00 | — |

项目 B 的账单：

| 日期 | 摘要 | 交易总额 | 分摊比例 | 计入项目 |
|---|---|---:|---:|---:|
| 2026-10-08 | 项目聚餐 | 600.00 | 50% | 300.00 |
| 2026-10-20 | 官网素材采购 | 1,500.00 | 100% | 1,500.00 |
| 合计 | | | | 1,800.00 |

### 7.5 关键观察

- **共用餐费**：S6 总额 180，日常 60、项目 A 120。纯日常只计 60，当月所有花费计 180。
- **多项目共用**：O2 总额 600，项目 A 300、项目 B 300。两个项目各计 300，但当月所有花费只计 600。
- **跨月项目**：项目 A 总账单 2,409 = 9 月 1,153 + 10 月 1,256。10 月入账不会改写 9 月报表。
- **预算口径**：10 月纯日常 4,650（58.1%），所有花费 7,706（96.3%）。生活预算应看前者。
- **不要重复加**：月度报表里已经有“当月所有花费”，不要再把“项目小计”加一次。

### 7.6 JSON 样例

**项目 A**

```json
{
  "id": "p-hz",
  "name": "杭州客户现场",
  "code": "HZ-2026",
  "status": "closed",
  "startDate": "2026-09-18",
  "endDate": "2026-10-15",
  "budgetCents": 1200000,
  "currency": "CNY",
  "owner": "我",
  "note": "现场实施与客户培训",
  "createdAt": "2026-09-15T10:00:00+08:00",
  "updatedAt": "2026-10-16T09:00:00+08:00"
}
```

**S6：团队午餐 180 元，日常 1/3、项目 A 2/3**

```json
{
  "id": "txn-2026-09-20-lunch",
  "schemaVersion": 2,
  "type": "expense",
  "amountCents": 18000,
  "date": "2026-09-20",
  "categoryId": "food",
  "accountId": "wechat",
  "note": "团队午餐（3 人）",
  "createdAt": "2026-09-20T12:40:00+08:00",
  "allocations": [
    {
      "id": "al-lunch-1",
      "targetType": "daily",
      "amountCents": 6000,
      "weight": 1,
      "ratioBp": 3333,
      "basis": "headcount",
      "note": "我 1 人"
    },
    {
      "id": "al-lunch-2",
      "targetType": "project",
      "projectId": "p-hz",
      "amountCents": 12000,
      "weight": 2,
      "ratioBp": 6667,
      "basis": "headcount",
      "note": "项目同事 2 人"
    }
  ]
}
```

**O2：项目聚餐 600 元，项目 A / 项目 B 各 50%**

```json
{
  "id": "txn-2026-10-08-dinner",
  "schemaVersion": 2,
  "type": "expense",
  "amountCents": 60000,
  "date": "2026-10-08",
  "categoryId": "food",
  "accountId": "alipay",
  "note": "项目聚餐",
  "createdAt": "2026-10-08T19:20:00+08:00",
  "allocations": [
    {
      "id": "al-dinner-1",
      "targetType": "project",
      "projectId": "p-hz",
      "amountCents": 30000,
      "weight": 1,
      "ratioBp": 5000,
      "basis": "ratio"
    },
    {
      "id": "al-dinner-2",
      "targetType": "project",
      "projectId": "p-web",
      "amountCents": 30000,
      "weight": 1,
      "ratioBp": 5000,
      "basis": "ratio"
    }
  ]
}
```

**O7：官网素材采购 1,500 元，全部项目 B**

```json
{
  "id": "txn-2026-10-20-assets",
  "schemaVersion": 2,
  "type": "expense",
  "amountCents": 150000,
  "date": "2026-10-20",
  "categoryId": "other_expense",
  "accountId": "bank",
  "note": "官网素材采购",
  "createdAt": "2026-10-20T15:10:00+08:00",
  "allocations": [
    {
      "id": "al-assets-1",
      "targetType": "project",
      "projectId": "p-web",
      "amountCents": 150000,
      "weight": 1,
      "ratioBp": 10000,
      "basis": "ratio"
    }
  ]
}
```

### 7.7 验收断言

```ts
expect(sum(s6.allocations.map(a => a.amountCents))).toBe(18000)

expect(sep.dailyExpenseCents).toBe(486500)
expect(sep.projectExpenseCents).toBe(115300)
expect(sep.totalExpenseCents).toBe(601800)

expect(oct.dailyExpenseCents).toBe(465000)
expect(oct.projectExpenseCents).toBe(305600)
expect(oct.totalExpenseCents).toBe(770600)

expect(hz.totalExpenseCents).toBe(240900)
expect(hz.byMonth['2026-09'].monthExpenseCents).toBe(115300)
expect(hz.byMonth['2026-10'].monthExpenseCents).toBe(125600)

expect(web.totalExpenseCents).toBe(180000)

expect(matrixColumn('2026-09')).toBe(601800)
expect(matrixColumn('2026-10')).toBe(770600)
expect(matrixGrandTotal).toBe(1372400)
```

## 8. 落地与迁移

### 8.1 v1 → v2

现有 v1 交易只有 `amount`（元）、没有分摊行。迁移时：

```ts
function migrateV1(t: LedgerTransactionV1): LedgerTransactionV2 {
  const amountCents = Math.round(t.amount * 100)
  return {
    id: t.id,
    schemaVersion: 2,
    type: t.type,
    amountCents,
    date: t.date,
    categoryId: t.categoryId,
    accountId: t.accountId,
    note: t.note,
    createdAt: t.createdAt,
    allocations: [
      {
        id: `${t.id}-al-1`,
        targetType: 'daily',
        amountCents,
        weight: 1,
        ratioBp: 10000,
        basis: 'migrated',
      },
    ],
  }
}
```

迁移规则：

- 所有旧交易默认 100% 日常，行为与现在一致。
- 旧预算 `budget` 迁移为个人日常预算 `budgetCents`。
- 项目列表初始化为空，由用户创建。
- 迁移前保留一份 v1 备份，例如 `ledger.v1.json` 或继续使用 `ledger.json.bak`。
- 迁移成功并首次保存 v2 后，再清理 v1 数据；失败时回退到 v1。

### 8.2 存储

建议键位：

```text
zhangye.transactions.v2   交易 + 分摊行
zhangye.projects.v1       项目
zhangye.budget.v2         个人日常预算
zhangye.schema.v2         数据版本标记
```

Tauri 的 `ledger.json` 快照增加：

```json
{
  "app": "zhangye",
  "version": 2,
  "projects": [],
  "transactions": [],
  "budgetCents": 800000,
  "settings": {}
}
```

加载顺序：

1. 读 v2；有则直接用。
2. 没有 v2，读 v1；迁移；校验；写 v2。
3. 两者都没有，按新账本初始化。
4. 任何一步校验失败，不要覆盖原文件，提示用户导出备份。

### 8.3 导入 / 导出

**JSON**：包含 `schemaVersion`、`projects`、`transactions`、预算和设置。导入时逐条校验：

- 分摊行之和等于流水总额；
- 项目引用存在；
- 日期格式正确；
- 金额为正整数分。

不满足时列出具体交易 ID 和差额，拒绝导入，不静默修补。

**CSV**：一行一条分摊行，方便 Excel 透视。

| 列 | 示例 | 说明 |
|---|---|---|
| 交易ID | txn-2026-09-20-lunch | 同一笔共用支出的多行用同一 ID |
| 分摊ID | al-lunch-1 | 分摊行主键 |
| 日期 | 2026-09-20 | 交易发生日 |
| 月份 | 2026-09 | 由日期派生 |
| 类型 | expense | 支出/收入/退款 |
| 摘要 | 团队午餐（3 人） | 备注 |
| 分类 | food | 分类 ID |
| 账户 | wechat | 账户 ID |
| 交易总额 | 180.00 | 同一交易的多行会重复，不要直接求和 |
| 归属 | 日常 | 日常 / 项目 |
| 项目 | 空 | 项目 ID 或名称 |
| 分摊比例 | 33.33% | 展示用 |
| 分摊金额 | 60.00 | **透视时对这一列求和** |
| 备注 | 我 1 人 | 分摊说明 |

Excel 透视建议：

- 行：月份；
- 列：归属 / 项目；
- 值：分摊金额；
- 筛选：类型。

这样一眼能看出每月纯日常、各项目归集和总额。

### 8.4 UI 落点

- **记账弹窗**：归属选择“日常 / 项目 / 共用”；
  - 日常：自动生成一条 100% 日常分摊行；
  - 项目：选择项目，生成一条 100% 项目分摊行；
  - 共用：显示分摊编辑器，支持比例、人头、固定金额，实时显示合计差额。
- **流水列表**：显示“日常 / 项目 / 共用”徽标；共用显示项目名和比例。
- **概览**：同时显示“生活支出（纯日常）”和“总支出（含项目）”，后者下面小字显示“其中项目归集”。
- **预算条**：默认绑定生活支出。
- **项目页**（左侧导航独立选项卡）：
  - 顶部是日历底板，点选日期即可设定项目开始日与截止日；不设截止表示长期项目，结束后可手动结束；
  - 日历上按项目显示彩色日期条，形成轻量的甘特式时间轴；筛选“进行中 / 已结束 / 已归档 / 全部”时同步影响日历上的项目条；
  - 项目列表 + 详情：总支出、预算进度、分类预算、流水明细；
  - 项目本身不设分类；每笔流水的分类保持在该交易上，项目详情按分摊行汇总分类；
  - 共用支出在项目详情中只显示归入本项目的金额。
- **统计页**：日常/项目堆叠柱状图；可按项目筛选；分类排行可切换“日常 / 项目”。
- **设置**：预算口径（默认日常）、常用分摊模板（可选）；项目的新建与管理不放在设置里。

### 8.5 分阶段

1. **第一阶段**：v2 数据结构 + v1 迁移 + 所有旧交易 100% 日常。界面不变，确保数据安全。
2. **第二阶段**：项目 CRUD + 记账时选项目 + 项目简单账单（纯项目，不支持分摊）。
3. **第三阶段**：共用支出分摊编辑器 + 月度双口径（纯日常 / 所有花费）。
4. **第四阶段**：项目总账单 + 跨月矩阵 + CSV 导出。
5. **第五阶段**：退款、报销、多人 AA / receivable 扩展。

### 8.6 当前实现进度（2026-10-22）

已完成：

- v2 数据结构、整数分金额、v1 数据迁移与备份兼容；
- 左侧导航新增“项目”页：日历底板、日期范围选择、项目列表、项目详情；
- 项目新建、编辑、结束、重启、归档、恢复与项目预算；
- 项目分类预算：按 `categoryId` 设置预算，由该项目的分摊行实时汇总，超支时提示；
- 项目本身不设分类；每笔消费保留自己的分类，项目详情只做归集；
- 记账弹窗的“日常 / 项目 / 共用”归属；
- 共用支出按比例或固定金额分摊，支持日常 + 多个项目，最大余数法保证总额对齐；
- 流水列表的“项目 / 共用”归属标记；
- 概览与统计页的“生活支出 / 项目支出 / 支出总额”三口径，预算只绑定生活支出；
- 项目账单：项目总支出、本月归集、截至本月累计、项目预算进度、逐月归集明细。

尚未完成：

- 人头分摊、分摊模板；
- 项目分类预算的提醒阈值、项目筛选与日常/项目堆叠图；
- 分摊行级 CSV 导出；
- 退款、报销、应收与多币种扩展。

## 9. 边界情况

| 场景 | 处理 |
|---|---|
| 跨月退款 | 记在退款发生月，负数冲减；原月不改；项目总账单净额减少；UI 标注“含退款 -X” |
| 部分退款 | 按原分摊行比例拆分退款额，最大余数法保证总和 |
| 退款后修改原分摊 | 退款保留快照；提示差异；允许手动重算退款 |
| 项目报销 | 记收入并分摊到项目，关联原支出；项目账单显示支出、收入、净额；月度花费不抵扣 |
| 项目关闭后补记 | 允许；按交易日期回到对应月份；同步更新项目总账单；UI 提示 |
| 删除项目 | 有流水禁止硬删除，只能归档；归档后不出现在选择器，历史报表保留 |
| 项目改名 | 报表按 ID 关联，改名不影响历史；展示当前名称 |
| 项目日期外交易 | 允许，提示“早于开始日/晚于结束日”，仍计入项目账单 |
| 转账 | 不计花费/收入；如果以后支持，单独类型，不生成 posting |
| 多币种 | 交易存 `currency`、`fxRateToBase`、`baseAmountCents`；报表用 base 金额；历史不随汇率重算 |
| 分摊行金额为 0 | 不生成该行；至少保留一条大于 0 的分摊行 |
| 固定金额之和超总额 | 拒绝保存，提示差额 |
| 固定金额之和小于总额 | 差额补到最后一条，或要求用户调整 |
| 一笔交易拆多个项目 | 支持；每个项目一行；月度所有花费仍只算一次 |
| 项目专用分类 | 可给 `Category` 加 `scope: daily / project / both`；共用一个 `categoryId`，需要时再在分摊行加分类覆盖 |
| 导入数据不变量失败 | 拒绝导入，列出交易 ID、总额、分摊合计和差额 |
| 报表缓存 | 数据量小，直接由 postings 实时汇总；若缓存，交易/项目变更时按 ID 失效 |

## 10. 一句话记住

**流水记一次，分摊行决定归属；月份看发生日，项目看 projectId；月度算两份，项目账单算全周期；所有报表来自同一批分摊行，所以怎么切都不会多算一笔。**
