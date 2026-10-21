import type { LucideIcon } from 'lucide-react'
import {
  Award,
  BriefcaseBusiness,
  BusFront,
  CircleEllipsis,
  Gamepad2,
  Gift,
  GraduationCap,
  House,
  Laptop,
  Shapes,
  ShoppingBag,
  Stethoscope,
  TrendingUp,
  UtensilsCrossed,
} from 'lucide-react'
import { CATEGORY_TONES } from '../lib/data'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  food: UtensilsCrossed,
  transport: BusFront,
  shopping: ShoppingBag,
  housing: House,
  entertainment: Gamepad2,
  medical: Stethoscope,
  education: GraduationCap,
  other_expense: Shapes,
  salary: BriefcaseBusiness,
  bonus: Award,
  investment: TrendingUp,
  freelance: Laptop,
  gift: Gift,
  other_income: CircleEllipsis,
}

interface CategoryIconProps {
  id: string
  size?: number
  compact?: boolean
}

export function CategoryIcon({
  id,
  size = 18,
  compact = false,
}: CategoryIconProps) {
  const Icon = CATEGORY_ICONS[id] ?? Shapes
  const tone = CATEGORY_TONES[id] ?? 'stone'

  return (
    <span
      className={`category-icon tone-${tone}${compact ? ' category-icon--compact' : ''}`}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={1.8} />
    </span>
  )
}
