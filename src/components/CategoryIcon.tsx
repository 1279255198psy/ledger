import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Award,
  Baby,
  Banknote,
  BookOpen,
  BriefcaseBusiness,
  BusFront,
  Car,
  CircleEllipsis,
  Clapperboard,
  Coffee,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  House,
  Laptop,
  Leaf,
  Music,
  PawPrint,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Shapes,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Stethoscope,
  TrendingUp,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { categoryTone, getCategory } from '../lib/categories'
import type { Category } from '../types'

interface IconOption {
  key: string
  label: string
  Icon: LucideIcon
}

export const CATEGORY_ICON_OPTIONS: IconOption[] = [
  { key: 'utensils', label: '餐饮', Icon: UtensilsCrossed },
  { key: 'coffee', label: '咖啡', Icon: Coffee },
  { key: 'bus', label: '公交', Icon: BusFront },
  { key: 'car', label: '汽车', Icon: Car },
  { key: 'plane', label: '旅行', Icon: Plane },
  { key: 'shopping', label: '购物', Icon: ShoppingBag },
  { key: 'house', label: '居住', Icon: House },
  { key: 'gamepad', label: '娱乐', Icon: Gamepad2 },
  { key: 'clapperboard', label: '影音', Icon: Clapperboard },
  { key: 'music', label: '音乐', Icon: Music },
  { key: 'stethoscope', label: '医疗', Icon: Stethoscope },
  { key: 'dumbbell', label: '运动', Icon: Dumbbell },
  { key: 'graduation', label: '教育', Icon: GraduationCap },
  { key: 'book', label: '阅读', Icon: BookOpen },
  { key: 'briefcase', label: '工作', Icon: BriefcaseBusiness },
  { key: 'laptop', label: '兼职', Icon: Laptop },
  { key: 'trend', label: '理财', Icon: TrendingUp },
  { key: 'piggy', label: '储蓄', Icon: PiggyBank },
  { key: 'banknote', label: '现金', Icon: Banknote },
  { key: 'award', label: '奖励', Icon: Award },
  { key: 'gift', label: '礼物', Icon: Gift },
  { key: 'heart', label: '心意', Icon: Heart },
  { key: 'paw', label: '宠物', Icon: PawPrint },
  { key: 'baby', label: '育儿', Icon: Baby },
  { key: 'sparkles', label: '美容', Icon: Sparkles },
  { key: 'wrench', label: '维修', Icon: Wrench },
  { key: 'receipt', label: '账单', Icon: Receipt },
  { key: 'repeat', label: '订阅', Icon: Repeat },
  { key: 'smartphone', label: '数码', Icon: Smartphone },
  { key: 'leaf', label: '生活', Icon: Leaf },
  { key: 'shapes', label: '其他', Icon: Shapes },
  { key: 'ellipsis', label: '杂项', Icon: CircleEllipsis },
]

const ICONS_BY_KEY = new Map(
  CATEGORY_ICON_OPTIONS.map((option) => [option.key, option.Icon]),
)

/** Keeps the familiar icons for categories saved before icon keys existed. */
const LEGACY_ICON_BY_ID: Record<string, string> = {
  food: 'utensils',
  transport: 'bus',
  shopping: 'shopping',
  housing: 'house',
  entertainment: 'gamepad',
  medical: 'stethoscope',
  education: 'graduation',
  other_expense: 'shapes',
  salary: 'briefcase',
  bonus: 'award',
  investment: 'trend',
  freelance: 'laptop',
  gift: 'gift',
  other_income: 'ellipsis',
}

export function getCategoryIconKey(category: Category): string {
  return category.icon ?? LEGACY_ICON_BY_ID[category.id] ?? 'shapes'
}

export function getCategoryIcon(category: Category): LucideIcon {
  return (
    ICONS_BY_KEY.get(getCategoryIconKey(category)) ?? Shapes
  )
}

interface CategoryIconProps {
  id?: string
  category?: Category
  size?: number
  compact?: boolean
}

export function CategoryIcon({
  id,
  category,
  size = 18,
  compact = false,
}: CategoryIconProps) {
  const resolved = category ?? getCategory(id ?? '')
  const Icon = getCategoryIcon(resolved)
  const toneClass = resolved.color ? '' : ` tone-${categoryTone(resolved.id)}`
  const style = resolved.color
    ? ({ '--tone': resolved.color } as CSSProperties)
    : undefined

  return (
    <span
      className={`category-icon${toneClass}${compact ? ' category-icon--compact' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={1.8} />
    </span>
  )
}
