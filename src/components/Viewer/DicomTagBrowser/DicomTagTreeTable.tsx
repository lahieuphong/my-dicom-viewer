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
      className="min-w-[760px] table-fixed"
      data-testid="dicom-tag-table"
    >
      <TableHeader className="sticky top-0 z-10 bg-primary/15 backdrop-blur-sm">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[190px] px-4 font-semibold">Tag</TableHead>
          <TableHead className="w-[72px] font-semibold">VR</TableHead>
          <TableHead className="w-[270px] font-semibold">Keyword</TableHead>
          <TableHead className="font-semibold">Value</TableHead>
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
                className="px-2 py-2.5 text-left align-top font-normal whitespace-normal"
              >
                <div
                  className="flex min-w-0 items-start"
                  style={{ paddingLeft: `${Math.min(depth, 12) * 18}px` }}
                >
                  {expandable && !searchActive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mr-1 size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
                      aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${node.keyword}`}
                      aria-expanded={isExpanded}
                      onClick={() => onToggle(node.id)}
                    >
                      <ExpansionIcon className="size-4" aria-hidden="true" />
                    </Button>
                  ) : expandable ? (
                    <span className="mr-1 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="mr-1 block size-7 shrink-0" aria-hidden="true" />
                  )}
                  <span className="pt-1 font-mono text-xs tabular-nums text-foreground">
                    {depth > 0 && (
                      <span className="sr-only">Cấp {depth + 1}. </span>
                    )}
                    {node.tag}
                  </span>
                </div>
              </th>
              <TableCell className="py-3 align-top font-mono text-xs text-muted-foreground">
                {node.vr || '—'}
              </TableCell>
              <TableCell className="py-3 align-top whitespace-normal break-words font-medium">
                {node.keyword}
              </TableCell>
              <TableCell className="py-3 pr-4 align-top whitespace-pre-wrap break-all text-muted-foreground">
                {node.value || '—'}
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
