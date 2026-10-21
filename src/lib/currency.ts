import type { Currency } from '../types'

export interface CurrencyOption {
  id: Currency
  name: string
  symbol: string
  code: string
}

export const CURRENCIES: CurrencyOption[] = [
  { id: 'CNY', name: '人民币', symbol: '¥', code: 'CNY' },
  { id: 'USD', name: '美元', symbol: '$', code: 'USD' },
  { id: 'GBP', name: '英镑', symbol: '£', code: 'GBP' },
  { id: 'EUR', name: '欧元', symbol: '€', code: 'EUR' },
  { id: 'JPY', name: '日元', symbol: 'JP¥', code: 'JPY' },
  { id: 'KRW', name: '韩元', symbol: '₩', code: 'KRW' },
]

export const DEFAULT_CURRENCY: Currency = 'CNY'

const CURRENCY_IDS = new Set<string>(CURRENCIES.map((item) => item.id))

// Money is formatted in dozens of places, so the active currency lives in
// module state rather than threading a prop through every caller.
let activeCurrency: Currency = DEFAULT_CURRENCY

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && CURRENCY_IDS.has(value)
}

export function normalizeCurrency(value: unknown): Currency {
  return isCurrency(value) ? value : DEFAULT_CURRENCY
}

export function getCurrency(id: Currency): CurrencyOption {
  return CURRENCIES.find((item) => item.id === id) ?? CURRENCIES[0]
}

export function getActiveCurrency(): Currency {
  return activeCurrency
}

export function setActiveCurrency(currency: Currency): void {
  activeCurrency = normalizeCurrency(currency)
}

export function activeCurrencySymbol(): string {
  return getCurrency(activeCurrency).symbol
}
