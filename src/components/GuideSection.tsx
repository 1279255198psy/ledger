const TOPICS: Array<{ title: string; body: string }> = [
  {
    title: '记一笔',
    body: '按 N 或点「记一笔」。金额、收支、分类、账户、日期与备注都在同一个面板里，分类也能当场新建。',
  },
  {
    title: '流水与筛选',
    body: '流水按月分组。用大分类筛选时，它下面的小分类会一起出现。',
  },
  {
    title: '记账提醒',
    body: '提醒默认每天 21:00 开启，首次打开时系统会询问通知权限。可以在设置里改时间、改成工作日或周末，也可以关掉；桌面版关闭窗口后会留在托盘继续提醒。',
  },
  {
    title: '预算',
    body: '月预算是一个总数；每日额度可以自动随花费调整，也可以逐日手动填写。分类上限只统计大分类。区间预算给旅行、装修这类一段时间单独定额，跨月时整段连续计算，不参与月度校验。',
  },
  {
    title: '项目',
    body: '项目以日期条铺在日历上。「独立核算」的项目只占项目预算；「计入日常」的项目同时占用每日与分类额度。共用的一笔支出可以同时归入几个项目。',
  },
  {
    title: '负债',
    body: '记下本金和每次还款，剩余金额会自动算出。还款只记在负债里，不会生成流水；确实从账户付出的钱，要另记一笔支出。',
  },
  {
    title: '同步与备份',
    body: '同一 Wi-Fi 下，电脑开启双端同步后，手机填电脑地址和 10 位同步码即可。数据在本机加密后传输，不经过服务器。设置 → 数据管理可导出 JSON 备份或 CSV 流水。',
  },
]

export function GuideSection() {
  return (
    <>
      <section className="settings-section">
        <div className="settings-heading">
          <h3>使用指南</h3>
          <p>日常会用到的几件事。其余功能不必一次学完，用到时再看。</p>
        </div>
      </section>
      {TOPICS.map((topic) => (
        <section className="settings-section" key={topic.title}>
          <div className="settings-heading guide-heading">
            <h3>{topic.title}</h3>
            <p>{topic.body}</p>
          </div>
        </section>
      ))}
    </>
  )
}
