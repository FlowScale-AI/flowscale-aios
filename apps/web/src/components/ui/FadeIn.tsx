'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface FadeInProps {
  children: ReactNode
  delay?: number
  duration?: number
  from?: 'bottom' | 'top' | 'left' | 'right' | 'none'
  distance?: number
  className?: string
}

const directionMap = {
  bottom: { y: 1, x: 0 },
  top: { y: -1, x: 0 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  none: { x: 0, y: 0 },
}

export function FadeIn({
  children,
  delay = 0,
  duration = 0.4,
  from = 'bottom',
  distance = 12,
  className,
}: FadeInProps) {
  const dir = directionMap[from]

  return (
    <motion.div
      initial={{ opacity: 0, x: dir.x * distance, y: dir.y * distance }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
