'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { filterDicomTagTree, type DicomTagNode } from '@/lib/dicom-tags';
import { cn } from '@/lib/utils';

type FlatTagRow = {
  node: DicomTagNode;
  depth: number;
};

type DicomTagTreeTableProps = {
  nodes: readonly DicomTagNode[];
  search: string;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

const RENDER_BATCH_SIZE = 400;

function flattenTagTree(
  nodes: readonly DicomTagNode[],
  expanded: ReadonlySet<string>,
  expandAll: boolean,
  depth = 0,
  rows: FlatTagRow[] = []
): FlatTagRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (
      node.children.length > 0 &&
      (expandAll || expanded.has(node.id))
    ) {
      flattenTagTree(node.children, expanded, expandAll, depth + 1, rows);
    }
  }
  return rows;
}

export default function DicomTagTreeTable({
  nodes,
  search,
  expanded,
  onToggle,
}: DicomTagTreeTableProps) {
  const normalizedSearch = search.trim();
  const searchActive = Boolean(normalizedSearch);
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH_SIZE);
  const rows = useMemo(() => {
    const filtered = filterDicomTagTree(nodes, normalizedSearch);
    return flattenTagTree(filtered, expanded, searchActive);
  }, [expanded, nodes, normalizedSearch]);
  const visibleRows = rows.slice(0, renderLimit);

  useEffect(() => {
    setRenderLimit(RENDER_BATCH_SIZE);
  }, [nodes, normalizedSearch]);

  if (rows.length === 0) {
    return (
      <div
        className="flex min-h-52 items-center justify-center px-6 text-center text-sm text-muted-foreground"
        data-testid="dicom-tag-empty-state"
      >
        Không tìm thấy metadata phù hợp.
      </div>
    );
  }

  return (
    <Table
      noContainer
      className="w-full table-fixed"
      data-testid="dicom-tag-table"
    >
      <TableHeader className="sticky top-0 z-10 bg-primary/15 backdrop-blur-sm">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[7rem] px-2 font-semibold sm:w-[10rem] sm:px-3 lg:w-[11rem] lg:px-4">
            Tag
          </TableHead>
          <TableHead className="w-11 px-1 font-semibold sm:w-14 sm:px-2 lg:w-[4.5rem]">
            VR
          </TableHead>
          <TableHead className="w-[30%] px-1 font-semibold sm:w-[38%] sm:px-3 lg:w-[17rem]">
            Keyword
          </TableHead>
          <TableHead className="px-2 font-semibold sm:px-3 lg:px-4">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleRows.map(({ node, depth }) => {
          const expandable = node.children.length > 0;
          const isExpanded = searchActive || expanded.has(node.id);
          const ExpansionIcon = isExpanded ? ChevronDown : ChevronRight;

          return (
            <TableRow
              key={node.id}
              className={cn(
                'hover:bg-primary/5',
                node.kind === 'item' && 'bg-muted/25'
              )}
              data-tag={node.tag}
              data-depth={depth}
              data-node-kind={node.kind}
            >
              <th
                scope="row"
                className="min-w-0 px-1.5 py-2 text-left align-top font-normal sm:px-2 sm:py-2.5 lg:px-3"
              >
                <div
                  className="flex min-w-0 items-start overflow-hidden"
                  style={{ paddingLeft: `${Math.min(depth, 5) * 8}px` }}
                >
                  {expandable && !searchActive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mr-0.5 size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground sm:mr-1"
                      aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${node.keyword}`}
                      aria-expanded={isExpanded}
                      onClick={() => onToggle(node.id)}
                    >
                      <ExpansionIcon className="size-4" aria-hidden="true" />
                    </Button>
                  ) : expandable ? (
                    <span className="mr-0.5 flex size-7 shrink-0 items-center justify-center text-muted-foreground sm:mr-1">
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="mr-0.5 block size-7 shrink-0 sm:mr-1" aria-hidden="true" />
                  )}
                  <span
                    className="min-w-0 truncate pt-1 font-mono text-[11px] tabular-nums text-foreground sm:text-xs"
                    title={node.tag}
                  >
                    {depth > 0 && (
                      <span className="sr-only">Cấp {depth + 1}. </span>
                    )}
                    {node.tag}
                  </span>
                </div>
              </th>
              <TableCell className="px-1 py-2.5 align-top font-mono text-[11px] text-muted-foreground sm:px-2 sm:py-3 sm:text-xs">
                {node.vr || '—'}
              </TableCell>
              <TableCell className="min-w-0 px-2 py-2.5 align-top sm:px-3 sm:py-3 lg:px-4">
                <span
                  className="block min-w-0 truncate text-xs font-medium sm:text-sm xl:overflow-visible xl:text-clip xl:whitespace-normal xl:break-words"
                  title={node.keyword}
                >
                  {node.keyword}
                </span>
              </TableCell>
              <TableCell className="min-w-0 px-2 py-2.5 align-top text-muted-foreground sm:px-3 sm:py-3 lg:px-4">
                <span
                  className="block min-w-0 truncate text-xs sm:text-sm xl:overflow-visible xl:text-clip xl:whitespace-pre-wrap xl:break-all"
                  title={node.value || undefined}
                >
                  {node.value || '—'}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
        {visibleRows.length < rows.length && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={4} className="px-4 py-4 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="dicom-tag-show-more"
                onClick={() =>
                  setRenderLimit((current) => current + RENDER_BATCH_SIZE)
                }
              >
                Hiển thị thêm{' '}
                {Math.min(RENDER_BATCH_SIZE, rows.length - visibleRows.length)} hàng
              </Button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
