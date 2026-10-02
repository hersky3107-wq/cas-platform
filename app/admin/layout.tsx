import { KrElectionAdminBanners } from './KrElectionAdminBanners'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <KrElectionAdminBanners />
      {children}
    </>
  )
}
