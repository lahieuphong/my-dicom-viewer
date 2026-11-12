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

## Kiểm thử

- `yarn verify`: architecture guard, ESLint, TypeScript và unit test
  (`yarn test:unit`). Unit test là các suite `node:test` trong `scripts/unit/`,
  chạy thẳng source TypeScript trên Node 24 qua loader `scripts/unit/loader.mjs`
  (map alias `@/`, thay Cornerstone core/tools bằng stub). Logic thuần nên được
  tách khỏi hook/component để test được theo cách này.
- `yarn test:cdp`: chạy toàn bộ browser regression trong Chrome headless qua
  Chrome DevTools Protocol (`scripts/run-cdp-tests.mjs`, harness chung
  `scripts/lib/cdp-harness.mjs`). Runner dùng lại viewer ở `VIEWER_ORIGIN` và
  Chrome ở `CDP_ORIGIN` nếu đang chạy; nếu không thì tự bật `next dev` và Chrome
  (theo port của hai biến này), rồi tắt chúng khi xong. `--list` liệt kê các
  regression, `--only a,b` chạy một nhóm.
- Chrome mặc định render WebGL bằng SwiftShader (chạy được khi không có GPU,
  như trên CI). `--gpu` dùng GPU thật: nhanh hơn khoảng 3 lần và làm lộ các
  timing race mà SwiftShader che đi.
- CI (`.github/workflows/ci.yml`) chạy `verify`, `build` và `test:cdp` cho mỗi
  push lên `main` và mỗi pull request; khi regression lỗi, log được upload thành
  artifact `cdp-logs`.
- Lần load đầu sau khi `next dev` khởi động có thể nhận chunk worker decode
  (~1 MB) đang ghi dở; các worker báo `SyntaxError` và không bao giờ trả về lần
  decode đầu tiên. Đây là race của dev server; bản production không bị.
  `lib/cornerstone/decodeWorkerHealth` theo dõi các worker cho tới khi mỗi
  worker trả lời lần đầu: worker báo lỗi trước đó thì khi chạy dev trang tự
  reload một lần (tối đa một lần mỗi 60 giây, mốc lưu trong `sessionStorage`),
  còn lại thì log lỗi. Runner vẫn tải viewer một lần trước khi chạy regression
  và reload nếu ảnh đầu tiên không hiện, làm đường dự phòng.
- Thay đổi lifecycle Cornerstone (attach, readiness, resize, camera) phải pass
  `test:cdp` cả mặc định lẫn `--gpu`.
- Harness coi một pane là sẵn sàng khi ảnh hiện tại đã thực sự hiển thị
  (`getCornerstoneImage()`), không chỉ khi `viewportStatus` là `rendered`:
  status đó cũng có sau một lần vẽ khi ảnh đầu tiên của stack còn đang nạp.

## Tiến độ

**Phase 2 (viewport ownership)** đã xong một phần ở pane chính, nhưng
`ViewportService` chưa được implement:

- `useRenderingEngine` là owner duy nhất của `StackViewport.setStack` ở pane
  chính. Đường attach dự phòng (`attachDisplaySet`, `ensureStackOnViewport`,
  watchdog, wrapper `setImageId`), guard "cooldown sau thao tác người dùng" và
  `useForceZoomOne` đã bị xóa. Series mở cho một navigation (measurement, SR,
  sidebar) bắt đầu ngay ở ảnh được yêu cầu (`getInitialImageIndex`), thay vì
  hiện ảnh đầu rồi nhảy. Engine publish `attachedStack` khi ảnh đầu tiên của
  stack đã vẽ; `useSelectedSeriesLoading` (`basic-viewer/application`) chạy
  theo tín hiệu đó (trước đây poll 50 ms), chỉ còn áp dụng navigation mà engine
  chưa áp dụng được, và giữ trạng thái loading của series đang chọn.
- Thứ tự ảnh của một series là thứ tự `files` của nó, tức thứ tự instance từ
  data source (`generate-dicom-manifest` sắp theo InstanceNumber). Engine,
  `useSelectedSeriesLoading`, measurement, SR export và Image Slice Sync đều
  đánh index theo danh sách này. `createDisplaySetFromSeries` chỉ còn dùng cho
  display set của runtime (`stackSopClassHandler`).
- Pane chính và pane phụ cùng enable/disable viewport qua
  `mountStackViewport`/`unmountStackViewport`
  (`lib/viewer/stackViewportLifecycle`); helper chỉ disable viewport còn nằm
  trên element của chính nó. `useRenderingEngine` có cùng hình dạng với
  `useSecondaryStackViewport`: một effect gắn viewport vào element trong suốt
  thời gian element mount, một effect đặt stack khi đổi series. Teardown chạy
  ngay khi unmount; teardown trễ 120 ms trước đây tắt nhầm viewport của viewer
  mới khi đổi study (regression `study-switch`). Bước chờ element, chờ kích
  thước và xóa canvas Cornerstone toàn trang đã bị xóa.
- Readiness lấy từ event thật của Cornerstone 3D (`STACK_NEW_IMAGE`,
  `IMAGE_RENDERED`) qua `useImageReadiness`: ảnh đang hiển thị
  (`getCornerstoneImage()`) có thuộc series đã chọn hay không. Polling/retry
  (`useEnsureImageRendered`, `lib/viewer/polling`) đã bị xóa. Hook không dựa vào
  `viewportStatus`, vì nó về `PRE_RENDER` mỗi lần cuộn hoặc đổi VOI, còn
  `setStack` đổi current image ID trước khi ảnh mới được load.
- Engine chỉ resize khi một canvas lệch kích thước với element của nó
  (`resizeEngineIfNeeded`), vì `engine.resize()` xóa canvas của mọi pane. Fit
  tự động giữ rotation/flip (`fitViewportKeepingOrientation`); chỉ Reset View
  đưa orientation về mặc định. Phần hình học giữ khung hình khi resize
  (`lib/viewer/resizeGeometry`) là hàm thuần và có unit test.
- Sau `setStack`, mọi pane (chính và phụ) render qua cùng một helper
  `renderViewportUntilReady` (`lib/viewer/renderUntilReady`): render, chờ
  `IMAGE_RENDERED`, retry với độ trễ tăng dần. Vòng poll 120 ms của pane chính
  đã bị xóa.
- Split layout dùng `ViewportGrid`; mỗi pane phụ có lifecycle riêng trong
  `useSecondaryStackViewport`. Image Slice Sync dùng vị trí ảnh từ manifest cho
  series chưa load (`lib/cornerstone/imageSliceSync`).

**Phase 3–4** đã bắt đầu: `basic-viewer/application` có thêm các phần thuần
hoặc độc lập với Cornerstone, tách ra từ `BasicViewerImplementation.tsx`:
`measurementSnapshot` (merge snapshot measurement, tìm series của ảnh),
`useSrCreateDialog` (hộp thoại tạo SR), `useHiddenMeasurements` (ẩn/hiện
measurement) và `useViewerToolMode` (tool đang chọn, kích hoạt trong tool group
và khóa tool chỉnh sửa khi đang mở SR). Hàng đợi chọn measurement và việc gộp các lần xóa trùng dùng
helper thuần `lib/utils/asyncQueues`. Chờ annotation xuất hiện trong state của
Cornerstone (`ensureAnnotationAvailable`) dùng event `ANNOTATION_ADDED` thay vì
poll; đường chờ này có unit test, vì với dữ liệu mẫu annotation luôn có sẵn khi
điều hướng.

Còn lại:

- `ViewportService` chưa có: hai hook dùng chung helper mount/render nhưng vẫn
  là hai owner riêng (pane phụ tự `setStack` và có hàng đợi render riêng). Cần
  gom chúng sau một service.
- Phase 1: `createBasicViewerRuntime` đã có, nhưng `BasicViewer` chưa dùng.
- Phase 3–4: `BasicViewerImplementation.tsx` vẫn giữ luồng xóa measurement
  (selection, style, refresh), đồng bộ selection với Cornerstone và trạng thái
  SR đang mở.

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
8. **Mở rộng khi có nhu cầu:** viewport grid đã có cho split layout; chỉ thêm
   hanging-protocol engine khi có comparison, fusion hoặc MPR. Không sao chép
   toàn bộ OHIF service graph sớm.
