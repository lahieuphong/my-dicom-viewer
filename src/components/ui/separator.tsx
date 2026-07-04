import { cn } from '@/lib/utils';

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({
  orientation = 'horizontal',
  className,
  ...props
}: SeparatorProps) {
  // Horizontal: 1px height full-width, background border
  if (orientation === 'horizontal') {
    return (
      <div
        role="separator"
        className={cn('my-2 h-px w-full bg-border', className)}
        {...props}
      />
    );
  }
  // Vertical: 1px border-left, chiều cao 1.5rem (h-6)
  return (
    <div
      role="separator"
      className={cn('mx-2 h-6 border-l border-border', className)}
      {...props}
    />
  );
}
