'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type AdminPreviewValue = {
  isRealAdmin: boolean
  previewAsUser: boolean
  setPreviewAsUser: (next: boolean) => void
  /** False when the operator is previewing a normal user. */
  effectiveIsAdmin: boolean
}

const AdminPreviewContext = createContext<AdminPreviewValue>({
  isRealAdmin: false,
  previewAsUser: false,
  setPreviewAsUser: () => undefined,
  effectiveIsAdmin: false,
})

export function AdminPreviewProvider({
  isRealAdmin,
  children,
}: {
  isRealAdmin: boolean
  children: ReactNode
}) {
  const [previewAsUser, setPreviewAsUser] = useState(false)
  const value = useMemo<AdminPreviewValue>(
    () => ({
      isRealAdmin,
      previewAsUser: isRealAdmin ? previewAsUser : false,
      setPreviewAsUser,
      effectiveIsAdmin: isRealAdmin && !previewAsUser,
    }),
    [isRealAdmin, previewAsUser],
  )
  return <AdminPreviewContext.Provider value={value}>{children}</AdminPreviewContext.Provider>
}

export function useAdminPreview(): AdminPreviewValue {
  return useContext(AdminPreviewContext)
}
