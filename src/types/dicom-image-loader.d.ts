// cornerstonejs-dicom-image-loader.d.ts
import type { MetaDataProvider } from '@cornerstonejs/core';

declare module '@cornerstonejs/dicom-image-loader' {
  /** WADO‑URI loader */
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

  /** WADO‑RS loader */
  export namespace wadors {
    /**
     * Đăng ký WADO‑RS
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
