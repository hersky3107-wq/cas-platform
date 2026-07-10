import { redirect } from 'next/navigation'

/** Root entry → the 동반자 (care) home. */
export default function Home() {
  redirect('/care')
}
