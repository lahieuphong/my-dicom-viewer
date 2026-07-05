export default function PatientSecurityNotice() {
  return (
    <div className="flex items-center w-full max-w-sm md:max-w-md bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-200 rounded-lg p-3 mb-6">
      <i
        className="fas fa-shield-alt text-sm md:text-base mr-2"
        aria-hidden="true"
      />
      <span className="text-xs md:text-sm">
        Thông tin của bạn được bảo mật và mã hóa
      </span>
    </div>
  );
}
