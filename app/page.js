'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  useEffect(() => { router.replace('/login') }, [router])
  return <main className="grid min-h-screen place-items-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[rgb(var(--primary)/.25)] border-t-[rgb(var(--primary))]" /></main>
}
