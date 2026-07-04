// src/app/page.tsx
import { redirect } from 'next/navigation';

export default function Page() {
  // khi user truy cập “/”, tự động đẩy về “/studies”
  redirect('/studies');
  // redirect('/patients'); 
}