import { useEffect, useRef, useState } from 'react'

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const next = element.getBoundingClientRect().width
      if (next > 0) setWidth(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
