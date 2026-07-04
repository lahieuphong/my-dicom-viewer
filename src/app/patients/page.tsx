'use client';

import SharedHeader from '@/components/shared/Header';
import SharedFooter from '@/components/shared/Footer';
import PatientLookup from '@/components/Patients/PatientLookup';

export default function PatientLookupPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <SharedHeader
        showBackButton={false}
        showLogo
        showStudyUID={false}
        showSupport
        showSecurity
        showUserMenu
      />
      
      {/* Main content */}
      <main className="flex-1 p-10 space-y-6">
        <PatientLookup />
      </main>
      
      <SharedFooter />
    </div>
  );
}
