import type {
  CaptureDirection,
  CaptureEventRecord,
} from './types'

export interface ParsedPayment {
  direction: CaptureDirection
  amountCents: number | null
  merchant: string
  cardTail: string
  bankName: string
  /** Reasons the result is incomplete; shown on the pending item. */
  issues: string[]
}

const AMOUNT_CONTEXT =
  /支付|付款|消费|扣款|支出|转账|退款|入账|到账|收款|金额|交易|还款|缴费|取现/

const AMOUNT_NOISE =
  /余额|可用|剩余|额度|积分|优惠|立减|折扣|手续费|服务费|汇率/

/** Numbers that are almost never the payment amount. */
const NON_AMOUNT_AFTER = '月日年时分秒号期次个笔%％.:：'
const NON_AMOUNT_BEFORE =
  /(?:尾号|卡号|账号|订单号?|编号|手机号?|电话|验证码|第|日期|时间|有效期|截止)\s*$/

const MERCHANT_PATTERNS: RegExp[] = [
  /(?:收款方|收款人|商户名称|商户|对方户名|对方名称|对方)\s*[：:]\s*([^\s，,。；;：:]{1,24})/,
  /(?:付款给|转账给|转给|支付给)\s*([^\s，,。；;：:]{1,24})/,
  /向\s*([^\s，,。；;：:]{1,24}?)\s*(?:消费|付款|支付|转账)/,
  /在\s*([^\s，,。；;：:]{1,24}?)\s*(?:消费|付款|支付)/,
  /(?:来自|由)\s*([^\s，,。；;：:]{1,24})/,
]

const CARD_TAIL_PATTERNS: RegExp[] = [
  /尾号\s*(\d{3,4})/,
  /末四位\s*(\d{3,4})/,
  /后四位\s*(\d{3,4})/,
]

/** Bank aliases, longest names first so 工商银行 never becomes 中国银行. */
const BANK_ALIASES: Array<[RegExp, string]> = [
  [/工商银行|工行/, '工商银行'],
  [/建设银行|建行/, '建设银行'],
  [/农业银行|农行/, '农业银行'],
  [/中国银行|中行/, '中国银行'],
  [/交通银行|交行/, '交通银行'],
  [/招商银行|招行/, '招商银行'],
  [/邮政储蓄|邮储/, '邮储银行'],
  [/中信银行/, '中信银行'],
  [/浦发银行|浦发/, '浦发银行'],
  [/民生银行|民生/, '民生银行'],
  [/兴业银行|兴业/, '兴业银行'],
  [/光大银行|光大/, '光大银行'],
  [/平安银行/, '平安银行'],
  [/华夏银行|华夏/, '华夏银行'],
  [/广发银行|广发/, '广发银行'],
  [/北京银行/, '北京银行'],
  [/上海银行/, '上海银行'],
  [/农商银行|农村商业银行/, '农商银行'],
]

/** The text a notification exposes, without guessing at hidden fields. */
export function captureEventText(event: CaptureEventRecord): string {
  return [event.title, event.bigText || event.text, event.subText]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ')
}

export function parseCaptureEvent(event: CaptureEventRecord): ParsedPayment {
  return parsePaymentText(captureEventText(event))
}

export function parsePaymentText(text: string): ParsedPayment {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const amountCents = findAmount(normalized)
  const direction = detectDirection(normalized)
  const merchant = findMerchant(normalized)

  const issues: string[] = []
  if (amountCents === null) issues.push('未识别到金额')
  if (direction === 'unknown') issues.push('未判断出收支方向')

  return {
    direction,
    amountCents,
    merchant,
    cardTail: findCardTail(normalized),
    bankName: findBankName(normalized),
    issues,
  }
}

function detectDirection(text: string): CaptureDirection {
  // App names contain direction words: 「支付宝」 must not mean a payment.
  const content = text.replace(
    /支付宝|微信支付|财付通|云闪付|银联支付/g,
    ' ',
  )
  // Refund first: 「退款到账」 also contains 到账, but it is money coming back.
  if (/退款|退回|退货|冲正|已退/.test(content)) return 'refund'
  if (/转账|转出|转入|汇款|汇入|转给/.test(content)) return 'transfer'
  // 「收款方：星巴克」 appears on expense notices, so require a direction word.
  if (/收入|到账|入账|存入|已收款|收款成功/.test(content)) return 'income'
  if (/支付|付款|消费|扣款|支出|取现|还款|缴费/.test(content)) return 'expense'
  return 'unknown'
}

function findCardTail(text: string): string {
  for (const pattern of CARD_TAIL_PATTERNS) {
    const match = pattern.exec(text)
    if (match) return match[1]
  }
  return ''
}

function findBankName(text: string): string {
  for (const [pattern, name] of BANK_ALIASES) {
    if (pattern.test(text)) return name
  }
  return ''
}

/**
 * Picks the number that is most likely the payment amount. Notifications also
 * carry balances, dates, card tails and order numbers, so every candidate is
 * scored by its surroundings instead of taking the first match.
 */
function findAmount(text: string): number | null {
  const pattern = /(\d[\d,]*(?:\.\d{1,2})?)/g
  let best: { cents: number; score: number } | null = null
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]
    const start = match.index
    const end = start + raw.length
    if (looksLikeNonAmount(text, start, end)) continue

    const value = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value) || value <= 0 || value > 99_999_999) continue
    const cents = Math.round(value * 100)
    if (cents <= 0) continue

    const before = text.slice(Math.max(0, start - 14), start)
    const after = text.slice(end, end + 14)

    let score = 0
    if (/(?:[¥￥]|人民币|RMB|CNY)\s*$/i.test(before)) score += 3
    if (/^\s*(?:元|块)/.test(after)) score += 3
    if (AMOUNT_CONTEXT.test(before) || AMOUNT_CONTEXT.test(after.slice(0, 10))) {
      score += 5
    }
    // A balance often sits right next to the real amount; never let it win.
    if (AMOUNT_NOISE.test(before.slice(-8))) score -= 6
    if (raw.includes('.')) score += 1

    if (score <= 0) continue
    if (!best || score > best.score) best = { cents, score }
  }

  return best ? best.cents : null
}

function looksLikeNonAmount(text: string, start: number, end: number): boolean {
  const next = text.charAt(end)
  if (next && NON_AMOUNT_AFTER.includes(next)) return true
  const previous = text.charAt(start - 1)
  if (previous === '.' || previous === ',' || previous === '，') return true
  if (previous === ':' || previous === '：') return true
  // A currency sign immediately before the digits is a good sign.
  if (previous === '¥' || previous === '￥') return false
  if (NON_AMOUNT_BEFORE.test(text.slice(Math.max(0, start - 10), start))) {
    return true
  }
  if (/^\s*(?:位|次|个|笔|分钟|小时|天)/.test(text.slice(end, end + 4))) {
    return true
  }
  return false
}

function findMerchant(text: string): string {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const name = cleanMerchant(match[1])
    if (name) return name
  }
  return ''
}

function cleanMerchant(value: string): string {
  let name = value
    .trim()
    .replace(/^[「『（(【[]+|[」』）)】\]，,。；;：:\s]+$/g, '')
    .replace(/[，,。；;：:]+$/g, '')
  if (!name || name.length > 24) return ''
  // These are senders, not merchants; keeping them adds noise to the note.
  if (/^(微信|微信支付|支付宝|支付宝支付|银行|云闪付|银联|通知|付款通知)$/.test(name)) {
    return ''
  }
  if (/银行$|银行通知$|动账通知|交易提醒|支付通知|消费提醒/.test(name)) return ''
  if (
    /^(尾号|卡号|余额|可用|验证码|订单|消费|支付|交易|动账|账户|银行卡|金额|日期|时间|入账|到账|支出|收入)/.test(
      name,
    )
  ) {
    return ''
  }
  return name
}
