// src/types/declarations.d.ts

// --- side-effect CSS imports (important to fix TS2882) ---
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
declare module '*.less';

// --- third-party modules used without types ---
declare module 'cornerstone-wado-image-loader';
declare module 'cornerstone-tools';
declare module 'cornerstone-math';

// Nếu bạn dùng thư viện CSS như 'tw-animate-css' và TypeScript vẫn báo lỗi,
// wildcard '*.css' ở trên sẽ che được lỗi đó.

// --- khai báo cho @cornerstonejs/dicom-image-loader (giữ nguyên nội dung bạn có) ---
import type { MetaDataProvider } from '@cornerstonejs/core';

declare module '@cornerstonejs/dicom-image-loader' {
  /** WADO-URI loader */
  export namespace wadouri {
    function register(): void;
    function loadImage(
      imageId: string,
      options?: any
    ): {
      promise: Promise<any>;
      cancelFn?: () => void;
      decache?: () => void;
    };
    const metaData: {
      metaDataProvider: MetaDataProvider;
    };
  }

  /** WADO-RS loader */
  export namespace wadors {
    /**
     * Đăng ký WADO-RS
     * @param options.name tên loader
     * @param options.url  URL PACS DICOMweb endpoint
     * @param options.headers headers kèm theo
     */
    function register(options: {
      name: string;
      url: string;
      headers: Record<string, string>;
    }): void;

    function loadImage(
      imageId: string,
      options?: any
    ): {
      promise: Promise<any>;
      cancelFn?: () => void;
      decache?: () => void;
    };

    const metaData: {
      metaDataProvider: MetaDataProvider;
    };
  }

  /** Hàm init chung của loader */
  export function init(opts: { maxWebWorkers: number }): Promise<void>;
}