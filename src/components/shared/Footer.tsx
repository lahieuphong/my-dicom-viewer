'use client';

export default function SharedFooter() {
  return (
    <footer className="w-full bg-card border-t border-border">
      {/* Padding wrapper */}
      <div className="w-full px-4 py-6 md:px-8 md:py-10">
        {/* Nội dung chính: 1 cột mobile, 3 cột từ md */}
        <div className="max-w-screen-xl mx-auto grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {/* Về chúng tôi */}
          <div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 text-foreground">
              Về chúng tôi
            </h3>
            <p className="text-xs md:text-sm text-secondary-foreground leading-relaxed">
              CÔNG TY TNHH HVTT được thành lập từ tháng 09 năm 2011, chuyên cung cấp các giải pháp quản lý cho lĩnh vực y tế.
              Chúng tôi không ngừng nỗ lực phát triển với sứ mệnh cung cấp những giải pháp công nghệ thông tin, phần mềm, sản phẩm tốt nhất đến khách hàng.
            </p>
          </div>

          {/* Liên hệ */}
          <div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 text-foreground">
              Liên hệ
            </h3>
            <div className="text-xs md:text-sm text-secondary-foreground space-y-1 leading-relaxed">
              <p>Địa chỉ: 17/15 Tổ 45, đường Trần Thị Bốc, ấp Thới Tứ, xã Thới Tam Thôn, huyện Hóc Môn, TP.HCM</p>
              <p>Ms Hằng: 0939 906 123</p>
              <p>Mr Thành: 0907 911 343</p>
              <p>Email: info@hvttgroup.com</p>
            </div>
          </div>

          {/* Thông tin pháp lý */}
          <div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 text-foreground">
              Thông tin pháp lý
            </h3>
            <div className="text-xs md:text-sm text-secondary-foreground space-y-1 leading-relaxed">
              <p>Mã số ĐKKD: 0311173090</p>
              <p>Đăng ký lần đầu: 21/09/2011</p>
              <p>Đăng ký thay đổi lần thứ 3: 04/06/2020</p>
              <p>Nơi cấp: Sở Kế hoạch và Đầu tư TP.HCM</p>
            </div>
          </div>
        </div>

        {/* Footer bottom, chỉ mình text */}
        <div className="mt-6 md:mt-8 pt-4 md:pt-6 border-t border-border text-center max-w-screen-xl mx-auto">
          <p className="text-xs md:text-sm text-secondary-foreground">
            © {new Date().getFullYear()} CÔNG TY TNHH HVTT (HVTT). Tất cả các quyền được bảo lưu.
          </p>
          <p className="mt-1 text-xs md:text-sm text-secondary-foreground">
            Website: www.hvttgroup.com
          </p>
        </div>
      </div>
    </footer>
  );
}
