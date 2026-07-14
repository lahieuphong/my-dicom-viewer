# Viewer architecture

## Mục tiêu

Kiến trúc đích lấy các ranh giới quan trọng của OHIF làm tham chiếu
(`platform`, `extensions`, `modes`) nhưng vẫn giữ ứng dụng trong một package
Next.js. Giai đoạn này ưu tiên tính tương thích: thiết lập public API và
dependency boundary trước, sau đó chuyển implementation từng phần mà không làm
thay đổi giao diện hay hành vi viewer.

## Các layer hiện tại

```text
src/app                         Next.js routes và application bootstrap
src/modes                       Workflow composition theo route/use case
src/extensions                  Các capability có thể thay thế hoặc tái sử dụng
src/platform/core               Domain, contracts, services và runtime thuần TypeScript
src/platform/ui                 UI primitives, shell, feedback và theme
src/features                    Workflow ngoài viewer: auth, studies, patients
src/server                      Filesystem/backend implementation chỉ chạy trên server
src/config                      Runtime configuration dùng chung
src/lib, src/hooks, src/context Compatibility layer trong thời gian di trú
```

Vai trò của từng layer:

- `platform/core` là phần lõi trung lập framework. Nó không biết React, Next.js,
  Cornerstone, DOM, filesystem hay implementation của extension.
- `platform/ui` chứa UI dùng chung. React được phép ở layer này, nhưng
  business state, PACS access và Cornerstone lifecycle không thuộc về UI
  primitives.
- `extensions` cung cấp implementation cho capability. Hiện có default UI,
  Cornerstone, DICOM SR và static-DICOM data source. Code phụ thuộc vendor phải
  được giữ bên trong extension tương ứng.
- `modes` chỉ composition các extension, runtime và layout policy thành một
  workflow. `basic-viewer` là mode hiện tại.
- `app` chuyển URL/HTTP/Next.js lifecycle thành lời gọi tới mode hoặc
  feature; route không sở hữu viewer business logic.
- `server` sở hữu Node/filesystem access. Browser source không được import
  layer này.
- `features` sở hữu các use case không phải extension của viewer, ví dụ study
  list, patient lookup và authentication.

## Hướng dependency được phép

Dependency chỉ được đi theo hướng sau:

```text
app routes ---> modes --------------------> platform/core
     |             |                              ^
     |             +------> extensions -----------+
     |                          |
     +------> features          +------> platform/ui
     |
     +------> app/api ------> server

browser data flow:
mode/feature -> static-dicom data source -> /api/* -> server/dicom-manifest
```

Quy tắc cụ thể:

1. `platform/core` chỉ import nội bộ `platform/core` hoặc dependency thuần
   TypeScript không gắn framework. Cấm React, Next.js, Cornerstone,
   `extensions`, `components`, `hooks`, `server`, `window`, `document` và `fs`.
2. Mode và code ngoài extension import public API của extension, không import
   implementation sâu. Server-safe mode metadata được phép import explicit
   `manifest` entry point để không kéo client-only Cornerstone code vào RSC graph.
3. Cornerstone imports và Cornerstone-specific types về đích chỉ tồn tại trong
   `extensions/cornerstone`. Core contracts dùng generic mount target và canonical
   domain types.
4. Chỉ `src/server`, `src/app/api` và facade server deprecated được import
   `@/server/*`.
5. Viewer route import `@/modes/basic-viewer`, không import legacy
   `components/Viewer/Viewer` trực tiếp.
6. Cross-layer consumer dùng `index.ts` public API. Deep import chỉ được dùng
   nội bộ trong chính layer/capability đó.

Chạy guard thủ công bằng:

```bash
node scripts/check-architecture.mjs
```

## Canonical public APIs

### `@/platform/core`

Public root xuất:

- Canonical DICOM domain: `DicomStudy`, `DicomSeries`, `DicomInstance`,
  `DisplaySet`, `RegisteredDisplaySet`, `Measurement`, `ViewportSnapshot`.
- Contracts: `StudyDataSource`, `SopClassHandler`, `ViewportService`,
  `MeasurementService`, `Disposable`.
- Services: `DisplaySetService`, `CommandManager`,
  `InMemoryMeasurementService`.
- Per-viewer lifecycle boundary: `ViewerRuntime`.

Domain model không được khai báo lại trong component, hook, HTTP client hay
Cornerstone adapter.

### `@/extensions/static-dicom-data-source`

Public root xuất `staticDicomDataSource`, `createStaticDicomDataSource`, extension
manifest/ID và các named function tương thích. `staticDicomDataSource` implement
`StudyDataSource` và giữ request de-duplication/cache của browser data access.

### `@/extensions/cornerstone`

Public root là seam duy nhất cho Cornerstone bootstrap, stack SOP handler, viewport,
tools, measurements và Cornerstone command schema. Trong giai đoạn compatibility,
một số export vẫn trỏ tới implementation cũ; consumer mới vẫn phải import qua
public root này.

### `@/extensions/default` và `@/extensions/dicom-sr`

`default` xuất viewer layout, toolbar và panel UI. `dicom-sr` xuất SR manifest,
runtime facade và SR UI. SR về đích sử dụng canonical measurements thay vì đọc
Cornerstone global annotation state trực tiếp.

### `@/modes/basic-viewer`

Mode xuất `BasicViewer`, `basicViewerMode` và runtime factory. Next.js viewer
route import trực tiếp client entry `BasicViewer.tsx` để giữ RSC graph sạch.
Implementation hiện tại đã nằm trong mode; đường dẫn
`components/Viewer/Viewer.tsx` chỉ còn là compatibility facade.

### `@/server/dicom-manifest`

Public server root xuất `getDicomIndex`, `getStudySummaries`, `getStudySummary`,
`getSeriesForStudy` và manifest DTO types. Filesystem, manifest normalization và mtime
cache chỉ tồn tại sau boundary này.

### `@/platform/ui`

Public root xuất app shell, feedback, theme và primitives dùng chung. UI không
được trở thành data source hoặc service locator.

## Compatibility facades

Facade cho phép chuyển import path trước khi chuyển implementation:

- `src/lib/pacs/services.ts` re-export static-DICOM extension.
- `src/lib/pacs/dicomIndex.ts` re-export server manifest boundary và chỉ được
  giữ cho server callers cũ.
- Các root trong `extensions/cornerstone`, `extensions/default` và
  `extensions/dicom-sr` hiện re-export một số component/hook cũ.
- `components/Viewer/Viewer.tsx` re-export `BasicViewer` để giữ import path cũ.
- `hooks/useSeriesLoader.ts` và `hooks/useBatchedFrameState.ts` re-export các
  application hooks hiện đã thuộc `modes/basic-viewer/application`.
- Type aliases như `Study`, `Series`, `Instance`, `DisplaySet` và
  `AnnotationMeasurement` giữ structural compatibility với canonical core types.

Facade không phải vị trí để thêm logic mới. Nó phải mỏng, có thể deprecated
và được xóa sau khi không còn consumer.

## Chính sách migration: không đổi UI, không đổi behavior

Mỗi bước migration kiến trúc phải tuân thủ:

- Không thay JSX structure, CSS class, interaction, tool binding, loading state,
  measurement semantics, SR output hay URL contract trừ khi có yêu cầu sản phẩm
  riêng.
- Tạo canonical contract/public root trước; chuyển consumer theo nhóm nhỏ; chỉ
  sau đó mới chuyển ownership của implementation.
- Khi chuyển implementation, facade cũ phải delegate hoặc re-export implementation
  mới. Không duy trì hai state store, hai cache hay hai lifecycle song song.
- Giữ nguyên public function signatures trong giai đoạn compatibility. API canonical
  mới có thể được thêm song song.
- Server/client split phải explicit: browser gọi HTTP data source; chỉ API route gọi
  filesystem repository.
- Mỗi bước phải chạy TypeScript, lint/build phù hợp và architecture guard.
  Thay đổi lifecycle Cornerstone cần thêm smoke test viewer trước khi xóa fallback.

## Các phase tiếp theo

1. **Runtime adoption:** tạo một `ViewerRuntime` cho mỗi `BasicViewer`, register static
   data source, stack SOP handler và typed commands; legacy Viewer vẫn render UI.
2. **Viewport ownership:** triển khai `ViewportService` trong Cornerstone extension và
   gom engine creation, enable/disable, attach stack, readiness, resize, preload và
   cleanup vào một lifecycle owner.
3. **Viewer controller:** chuyển orchestration khỏi `Viewer.tsx` sang
   `basic-viewer/application`; Viewer component chỉ còn composition và view model.
4. **Measurement ownership:** Cornerstone annotation adapter đồng bộ với một
   `MeasurementService`; panel và navigation không đọc vendor global state.
5. **SR boundary:** DICOM SR service dùng canonical Study/Measurement/DisplaySet, tách
   serializer khỏi React hook và Cornerstone state.
6. **UI extension cleanup:** toolbar gọi typed commands; layout/panels nhận view model;
   xóa prop drilling và deep legacy imports.
7. **Facade removal:** xóa `lib/pacs`, legacy Cornerstone hook re-exports và legacy
   Viewer wrapper khi không còn consumer.
8. **Mở rộng khi có nhu cầu:** chỉ thêm viewport-grid/hanging-protocol engine khi
   có multi-viewport, comparison, fusion hoặc MPR; không sao chép toàn bộ OHIF
   service graph sớm.
